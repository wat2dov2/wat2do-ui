//! Durable local scheduling for the one human-authenticated Instagram browser.
//!
//! Only the worker executes browser operations. Callers submit sanitized identities and
//! wait for results; no cookies, tokens, or browser profiles enter this database.
//!
//! The SQLite file, its schema and every stored value are the ones the Python queue
//! used (`~/.local/state/wat2do/instagram-browser/jobs.sqlite3`), written with Python's
//! JSON formatting, so jobs in flight survive a change of implementation.

use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use regex::Regex;
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row, params, params_from_iter};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::browser_digest::DigestResolution;
use super::browser_following::{validate_cursor, validate_list_owner};
use super::browser_ingestion::canonical_target_url;
use super::browser_session::{canonical_post_url, validate_account_username};
use super::errors::{BrowserError, BrowserResult, StorageError};
use crate::controlbox::instagram_browser as control;
use crate::host::{Event, Host};
use crate::pyjson;
use crate::schools::validate_recipient_id;

pub const WORKER_INSTALLATION_PAUSE: &str = "Browser worker installation in progress";

const AVAILABLE_ACCOUNT_SQL: &str = "account_username NOT IN (SELECT value FROM json_each(COALESCE(\
(SELECT value FROM settings WHERE key='excluded_accounts'),'[]')))";

// Rate limit holds: "browser" stops every claim, "retrieval" only profile retrievals,
// "following" only Following list reads.
const BROWSER_SCOPE: &str = "browser";
const RETRIEVAL_SCOPE: &str = "retrieval";
const FOLLOWING_SCOPE: &str = "following";
/// Set (to a reason) to stop Following reads alone, leaving every other job running.
pub const FOLLOWING_PAUSED: &str = "following_paused";

/// Every job kind the queue accepts; a stored table missing any of them is rebuilt.
const JOB_KINDS: [&str; 4] = ["digest", "retrieval", "engagement", "following"];

/// The finished Following reads still to be collected: the crawl takes each within
/// seconds, so older ones are deleted rather than kept with their account lists.
const FINISHED_FOLLOWING_SQL: &str =
    "kind='following' AND state IN ('succeeded','failed','cancelled','unsupported')";

/// Python's `_QUEUE_SCHEMA` with the `following` kind added: SQLite keeps this text in
/// `sqlite_master`, and a stored table that lacks a kind is rebuilt with every job.
/// Nothing queues `direct` jobs any more, but older queues still hold some, and the
/// rebuild copies every job, so the kind stays allowed.
const QUEUE_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('digest', 'retrieval', 'engagement', 'direct', 'following')),
        school TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        account_username TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
            CHECK(state IN ('pending','running','succeeded','failed','cancelled','unsupported')),
        created_at REAL NOT NULL,
        started_at REAL,
        finished_at REAL,
        result TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_waiting ON jobs(state, kind, created_at);

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS diagnostic_events (
        id TEXT PRIMARY KEY, event TEXT NOT NULL, created_at REAL NOT NULL
    );
";

/// The removed Codex review gate kept evidence in these tables.
const OBSOLETE_REVIEW_TABLES: [&str; 4] = [
    "review_snapshots",
    "review_artifacts",
    "review_completions",
    "review_artifact_retention",
];

/// Settings of the removed review gate and Brave's former notification capture.
const OBSOLETE_SETTINGS: [&str; 17] = [
    "notification_reviewed_target:*",
    "notification_review_reopened:*",
    "notification_import_attempts:*",
    "manual_import_attempts:*",
    "notification_review_cursor",
    "notification_import_status",
    "notification_import_error",
    "review_storage_status",
    // Notified posts now reach the ingestion queue without Brave.
    "notification_delivery:*",
    "notification_ledger_claim",
    "notification_browser_import_claim",
    "notification_source_status",
    "notification_enqueue_status",
    "manual_retrieval:*",
    "manual_enqueued:*",
    "manual_imported:*",
    // Worker tabs now live in their own popup windows.
    "browser_window_id",
];

const UPSERT_SETTING: &str =
    "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value";

const SQLITE_BUSY: i32 = 5;
const SQLITE_LOCKED: i32 = 6;
const SQLITE_FULL: i32 = 13;

static SCHOOL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9-]{1,80}$").expect("valid regex"));
static CACHE_ID_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._:-]{1,255}$").expect("valid regex"));

fn scope(job: Option<&BrowserJob>) -> &'static str {
    match job.map(|job| job.kind.as_str()) {
        Some("retrieval") => RETRIEVAL_SCOPE,
        Some("following") => FOLLOWING_SCOPE,
        _ => BROWSER_SCOPE,
    }
}

/// `$XDG_STATE_HOME/wat2do/instagram-browser`, or `~/.local/state/...`.
pub fn default_state_directory() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_directory().join(".local/state"));
    base.join("wat2do/instagram-browser")
}

pub fn home_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrowserJob {
    pub id: String,
    pub kind: String,
    pub school: String,
    pub recipient_id: String,
    pub account_username: String,
    pub payload: Map<String, Value>,
    pub state: String,
    pub created_at: f64,
    pub started_at: Option<f64>,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub attempts: i64,
}

impl BrowserJob {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let payload: String = row.get("payload")?;
        let result: Option<String> = row.get("result")?;
        let payload = match serde_json::from_str(&payload) {
            Ok(Value::Object(payload)) => payload,
            _ => Map::new(),
        };
        Ok(Self {
            id: row.get("id")?,
            kind: row.get("kind")?,
            school: row.get("school")?,
            recipient_id: row.get("recipient_id")?,
            account_username: row.get("account_username")?,
            payload,
            state: row.get("state")?,
            created_at: row.get("created_at")?,
            started_at: row.get("started_at")?,
            result: result
                .filter(|result| !result.is_empty())
                .and_then(|result| serde_json::from_str(&result).ok()),
            error: row.get("error")?,
            attempts: row.get("attempts")?,
        })
    }

    /// `dataclasses.asdict(job)`.
    pub fn to_value(&self) -> Value {
        json!({
            "id": self.id,
            "kind": self.kind,
            "school": self.school,
            "recipient_id": self.recipient_id,
            "account_username": self.account_username,
            "payload": self.payload,
            "state": self.state,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "result": self.result,
            "error": self.error,
            "attempts": self.attempts,
        })
    }

    /// Whether this is an inspection-only engagement.
    pub fn dry_run(&self) -> bool {
        self.payload.get("dry_run").is_some_and(pyjson::truthy)
    }
}

/// SQLite transactions provide cross-process admission and school rotation.
pub struct BrowserJobQueue {
    pub state_directory: PathBuf,
    pub database_path: PathBuf,
    delivery_generation: String,
    host: Arc<dyn Host>,
    /// Set after a storage failure: claims wait until the worker recovers the queue.
    pub storage_unavailable: AtomicBool,
    /// Set whenever a retrieval finishes, so a listed profile's posts are queued at once.
    pub retrieval_finished: Event,
    /// A pause (truthy JSON) that could not be stored yet; reads see it first.
    pending_pause: Mutex<Option<Value>>,
    pending_rate_limit: AtomicBool,
}

fn storage(error: rusqlite::Error) -> BrowserError {
    BrowserError::Storage(StorageError::from(error))
}

/// Bind a JSON value as Python's sqlite3 binds the object `json.loads` returned.
fn sql_value(value: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match value {
        Value::Null => Sql::Null,
        Value::Bool(flag) => Sql::Integer(i64::from(*flag)),
        Value::Number(number) => number
            .as_i64()
            .map(Sql::Integer)
            .unwrap_or_else(|| Sql::Real(number.as_f64().unwrap_or(f64::NAN))),
        Value::String(text) => Sql::Text(text.clone()),
        other => Sql::Text(other.to_string()),
    }
}

impl BrowserJobQueue {
    /// Open (creating or upgrading) the queue in `state_directory`, or the default.
    pub fn open(state_directory: Option<&Path>, host: Arc<dyn Host>) -> BrowserResult<Arc<Self>> {
        let state_directory = state_directory
            .map(Path::to_path_buf)
            .unwrap_or_else(default_state_directory);
        let mut queue = Self {
            database_path: state_directory.join("jobs.sqlite3"),
            state_directory,
            delivery_generation: String::new(),
            host,
            storage_unavailable: AtomicBool::new(false),
            retrieval_finished: Event::default(),
            pending_pause: Mutex::new(None),
            pending_rate_limit: AtomicBool::new(false),
        };
        queue.delivery_generation = queue.retry_storage(|| queue.initialize())?;
        Ok(Arc::new(queue))
    }

    fn initialize(&self) -> BrowserResult<String> {
        if let Some(parent) = self.state_directory.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        }
        if !self.state_directory.is_dir() {
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&self.state_directory)
                .or_else(|error| {
                    if self.state_directory.is_dir() {
                        Ok(())
                    } else {
                        Err(error)
                    }
                })
                .map_err(|error| BrowserError::other("OSError", error.to_string()))?;
        }
        if let Some(generation) = self.current_delivery_generation()? {
            self.restrict_database_file()?;
            return Ok(generation);
        }
        let db = self.connect()?;
        let empty = db
            .query_row("SELECT 1 FROM sqlite_master WHERE type='table'", [], |_| {
                Ok(())
            })
            .optional()
            .map_err(storage)?
            .is_none();
        if empty {
            db.execute_batch("PRAGMA auto_vacuum=INCREMENTAL")
                .map_err(storage)?;
        }
        db.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))
            .map_err(storage)?;
        db.execute_batch("BEGIN IMMEDIATE").map_err(storage)?;
        let existing: Option<String> = db
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='jobs'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)?;
        // SQLite cannot add values to a CHECK constraint in place.
        // Rebuild atomically while preserving every job and its history.
        if let Some(existing) = existing
            && JOB_KINDS
                .iter()
                .any(|kind| !existing.contains(&format!("'{kind}'")))
        {
            db.execute_batch("ALTER TABLE jobs RENAME TO jobs_previous")
                .map_err(storage)?;
            db.execute_batch(
                QUEUE_SCHEMA
                    .split(';')
                    .next()
                    .expect("schema has a jobs table"),
            )
            .map_err(storage)?;
            db.execute_batch("INSERT INTO jobs SELECT * FROM jobs_previous")
                .map_err(storage)?;
            db.execute_batch("DROP TABLE jobs_previous")
                .map_err(storage)?;
        }
        for statement in QUEUE_SCHEMA.split(';') {
            if !statement.trim().is_empty() {
                db.execute_batch(statement).map_err(storage)?;
            }
        }
        let tables: Vec<String> = {
            let mut statement = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                .map_err(storage)?;
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(storage)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage)?
        };
        let obsolete: Vec<&String> = tables
            .iter()
            .filter(|name| OBSOLETE_REVIEW_TABLES.contains(&name.as_str()))
            .collect();
        for table in &obsolete {
            db.execute_batch(&format!("DROP TABLE {table}"))
                .map_err(storage)?;
        }
        for pattern in OBSOLETE_SETTINGS {
            db.execute("DELETE FROM settings WHERE key GLOB ?", [pattern])
                .map_err(storage)?;
        }
        let retired = db
            .query_row(
                "SELECT 1 FROM settings WHERE key='notification_retrievals_retired'",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(storage)?
            .is_some();
        if !retired {
            // Their posts moved to the ingestion queue, which fetches them without Brave.
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE kind='retrieval' AND state='pending'",
                [self.host.time()],
            )
            .map_err(storage)?;
            db.execute_batch(
                "INSERT INTO settings VALUES ('notification_retrievals_retired','true')",
            )
            .map_err(storage)?;
        }
        db.execute(
            "INSERT INTO settings VALUES ('delivery_generation',?) ON CONFLICT(key) DO NOTHING",
            [pyjson::dumps(
                &Value::from(uuid::Uuid::new_v4().to_string()),
                None,
            )],
        )
        .map_err(storage)?;
        let raw: String = db
            .query_row(
                "SELECT value FROM settings WHERE key='delivery_generation'",
                [],
                |row| row.get(0),
            )
            .map_err(storage)?;
        let generation = Self::validate_delivery_generation(&raw)?;
        db.execute_batch("COMMIT").map_err(storage)?;
        drop(db);
        self.restrict_database_file()?;
        if !obsolete.is_empty() {
            self.reclaim_obsolete_storage();
        }
        Ok(generation)
    }

    fn restrict_database_file(&self) -> BrowserResult<()> {
        std::fs::set_permissions(&self.database_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| BrowserError::other("OSError", error.to_string()))
    }

    /// Shrink a database once after dropping removed review storage.
    fn reclaim_obsolete_storage(&self) {
        let reclaimed = self.connect().and_then(|db| {
            db.execute_batch("PRAGMA auto_vacuum=INCREMENTAL; VACUUM")
                .map_err(storage)
        });
        if let Err(error) = reclaimed {
            // A busy database still reuses the freed pages for later queue writes.
            tracing::warn!("Browser queue could not reclaim review storage ({error})");
        }
    }

    /// Identify the durable queue so a recreated database can recover cloud delivery.
    pub fn delivery_generation(&self) -> &str {
        &self.delivery_generation
    }

    fn validate_delivery_generation(raw: &str) -> BrowserResult<String> {
        let invalid =
            || BrowserError::Value("Browser queue delivery generation is invalid".to_owned());
        let Ok(Value::String(generation)) = serde_json::from_str::<Value>(raw) else {
            return Err(invalid());
        };
        match uuid::Uuid::parse_str(&generation) {
            Ok(parsed) if parsed.hyphenated().to_string() == generation => Ok(generation),
            _ => Err(invalid()),
        }
    }

    /// Read current WAL queues without competing with maintenance's writer.
    fn current_delivery_generation(&self) -> BrowserResult<Option<String>> {
        if !self.database_path.is_file() {
            return Ok(None);
        }
        let db = Connection::open_with_flags(
            &self.database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(storage)?;
        db.busy_timeout(Duration::from_secs_f64(
            control().storage_busy_timeout_seconds,
        ))
        .map_err(storage)?;
        db.execute_batch("PRAGMA query_only=ON; BEGIN")
            .map_err(storage)?;
        let mode: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .map_err(storage)?;
        if mode != "wal" {
            return Ok(None);
        }
        let definitions: Vec<(String, String, Option<String>)> = {
            let mut statement = db
                .prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index')")
                .map_err(storage)?;
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(storage)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage)?
        };
        if definitions
            .iter()
            .any(|(_, name, _)| OBSOLETE_REVIEW_TABLES.contains(&name.as_str()))
        {
            return Ok(None);
        }
        static DECLARED: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"^CREATE (TABLE|INDEX) IF NOT EXISTS (\w+)").expect("valid regex")
        });
        for statement in QUEUE_SCHEMA.split(';') {
            if statement.trim().is_empty() {
                continue;
            }
            let expected = DECLARED
                .captures(statement.trim())
                .expect("Canonical queue schema must declare named objects");
            let kind = expected[1].to_lowercase();
            let actual = definitions
                .iter()
                .find(|(actual_kind, name, _)| *actual_kind == kind && *name == expected[2])
                .and_then(|(_, _, sql)| sql.as_deref());
            match actual {
                Some(actual) if schema_tokens(actual) == schema_tokens(statement) => {}
                _ => return Ok(None),
            }
        }
        let retired = db
            .query_row(
                "SELECT 1 FROM settings WHERE key='notification_retrievals_retired'",
                [],
                |_| Ok(()),
            )
            .optional()
            .map_err(storage)?
            .is_some();
        if !retired {
            // Upgrade once: Brave no longer captures notified posts.
            return Ok(None);
        }
        let row: Option<String> = db
            .query_row(
                "SELECT value FROM settings WHERE key='delivery_generation'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)?;
        row.map(|raw| Self::validate_delivery_generation(&raw))
            .transpose()
    }

    fn connect(&self) -> BrowserResult<Connection> {
        let db = Connection::open(&self.database_path).map_err(storage)?;
        db.busy_timeout(Duration::from_secs_f64(
            control().storage_busy_timeout_seconds,
        ))
        .map_err(storage)?;
        Ok(db)
    }

    /// `_retry_storage`: retry a rolled-back queue transaction, never the browser
    /// operation it records. A full, busy or locked database is retried; anything else,
    /// or the last attempt, marks storage unavailable.
    fn retry_storage<T>(
        &self,
        mut operation: impl FnMut() -> BrowserResult<T>,
    ) -> BrowserResult<T> {
        for attempt in 0..control().storage_retry_limit {
            match operation() {
                Err(BrowserError::Storage(error)) => {
                    let code = error.primary_code();
                    if !matches!(code, Some(SQLITE_FULL | SQLITE_BUSY | SQLITE_LOCKED))
                        || attempt + 1 == control().storage_retry_limit
                    {
                        self.storage_unavailable.store(true, Ordering::SeqCst);
                        return Err(BrowserError::Storage(error));
                    }
                    self.host.sleep(control().storage_retry_interval_seconds);
                }
                other => return other,
            }
        }
        unreachable!("Validated storage retry limit must be positive")
    }

    /// Run `operation` inside `BEGIN IMMEDIATE`, committing whenever it returns Ok
    /// (Python's `with db:` commits early returns too) and rolling back on errors.
    fn immediate<T>(
        &self,
        operation: impl FnOnce(&Connection) -> BrowserResult<T>,
    ) -> BrowserResult<T> {
        let db = self.connect()?;
        db.execute_batch("BEGIN IMMEDIATE").map_err(storage)?;
        let result = operation(&db)?;
        db.execute_batch("COMMIT").map_err(storage)?;
        Ok(result)
    }

    pub fn is_storage_unavailable(&self) -> bool {
        self.storage_unavailable.load(Ordering::SeqCst)
    }

    pub fn set_storage_unavailable(&self, unavailable: bool) {
        self.storage_unavailable
            .store(unavailable, Ordering::SeqCst);
    }

    fn pending_pause(&self) -> Option<Value> {
        self.pending_pause
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    fn set_pending_pause(&self, value: Option<Value>) {
        *self
            .pending_pause
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = value;
    }

    /// Recover an existing selection only when original jobs identify each source exactly.
    pub fn recorded_engagement_sources(
        &self,
        recipient_id: &str,
        account_username: &str,
        event_ids: &[i64],
    ) -> BrowserResult<Vec<Value>> {
        self.retry_storage(|| {
            let recipient_id = validate_recipient_id(recipient_id).map_err(BrowserError::Value)?;
            let account_username =
                validate_account_username(account_username).map_err(BrowserError::Value)?;
            let mut unique = event_ids.to_vec();
            unique.sort_unstable();
            unique.dedup();
            if unique.len() != event_ids.len() {
                return Err(BrowserError::Value(
                    "Engagement source event IDs must be unique integers".to_owned(),
                ));
            }
            if event_ids.is_empty() {
                return Ok(Vec::new());
            }
            let db = self.connect()?;
            let placeholders = vec!["?"; event_ids.len()].join(",");
            let mut statement = db
                .prepare(&format!(
                    "SELECT payload FROM jobs WHERE kind='engagement' AND recipient_id=? \
                     AND account_username=? AND COALESCE(json_extract(payload,'$.dry_run'),0)=0 \
                     AND json_extract(payload,'$.event_id') IN ({placeholders})"
                ))
                .map_err(storage)?;
            let mut arguments: Vec<rusqlite::types::Value> = vec![
                rusqlite::types::Value::Text(recipient_id),
                rusqlite::types::Value::Text(account_username),
            ];
            arguments.extend(
                event_ids
                    .iter()
                    .map(|id| rusqlite::types::Value::Integer(*id)),
            );
            let payloads: Vec<String> = statement
                .query_map(params_from_iter(arguments), |row| row.get(0))
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)?;
            let mut sources: Vec<(i64, Vec<String>)> =
                event_ids.iter().map(|id| (*id, Vec::new())).collect();
            for payload in payloads {
                let payload: Value = serde_json::from_str(&payload).map_err(|_| {
                    BrowserError::Value("Stored engagement payload is invalid".to_owned())
                })?;
                let event_id = payload.get("event_id").and_then(Value::as_i64);
                let post_url = payload
                    .get("post_url")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let url = canonical_post_url(post_url)?;
                if let Some((_, urls)) = sources.iter_mut().find(|(id, _)| Some(*id) == event_id)
                    && !urls.contains(&url)
                {
                    urls.push(url);
                }
            }
            if sources.iter().any(|(_, urls)| urls.len() != 1) {
                return Err(BrowserError::Value(
                    "Original carousel sources cannot be recovered faithfully".to_owned(),
                ));
            }
            Ok(sources
                .into_iter()
                .map(|(event_id, urls)| json!({"post_url": urls[0], "event_id": event_id}))
                .collect())
        })
    }

    /// `get_setting(key)`: the stored JSON value, None when unset.
    pub fn get_setting(&self, key: &str) -> BrowserResult<Option<Value>> {
        if key == "paused"
            && let Some(pending) = self.pending_pause().filter(pyjson::truthy)
        {
            return Ok(Some(pending));
        }
        self.retry_storage(|| {
            let db = self.connect()?;
            let raw: Option<String> = db
                .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
                    row.get(0)
                })
                .optional()
                .map_err(storage)?;
            Ok(raw.map(|raw| serde_json::from_str(&raw).unwrap_or(Value::Null)))
        })
    }

    /// `get_setting(key, default)`.
    pub fn setting_or(&self, key: &str, default: Value) -> BrowserResult<Value> {
        Ok(self.get_setting(key)?.unwrap_or(default))
    }

    /// Whether the worker is paused (any truthy pause).
    pub fn paused(&self) -> BrowserResult<bool> {
        Ok(pyjson::truthy(
            &self.setting_or("paused", Value::Bool(false))?,
        ))
    }

    pub fn set_setting(&self, key: &str, value: Value) -> BrowserResult<()> {
        self.retry_storage(|| {
            let previous = if key == "paused" && pyjson::truthy(&value) {
                // A full disk must not erase an auth or uncertain-action safety hold.
                let previous = self.get_setting(key);
                self.set_pending_pause(Some(value.clone()));
                previous?
            } else if key == "paused" {
                self.get_setting(key)?
            } else {
                None
            };
            let db = self.connect()?;
            db.execute(UPSERT_SETTING, params![key, pyjson::dumps(&value, None)])
                .map_err(storage)?;
            drop(db);
            if key == "paused" {
                self.set_pending_pause(None);
                if !pyjson::equal(&previous.unwrap_or(Value::Null), &value) {
                    self.record_diagnostic(
                        if pyjson::truthy(&value) {
                            "paused"
                        } else {
                            "resumed"
                        },
                        None,
                        None,
                    );
                }
            }
            Ok(())
        })
    }

    /// Acquire or release a pause only while its observed owner is unchanged.
    pub fn compare_set_pause(&self, expected: &Value, value: &Value) -> BrowserResult<bool> {
        #[cfg(test)]
        if let Some(swapped) = compare_set_pause_hooks::run(self) {
            return Ok(swapped);
        }
        self.retry_storage(|| {
            if let Some(pending) = self.pending_pause().filter(pyjson::truthy)
                && !pyjson::equal(&pending, expected)
            {
                return Ok(false);
            }
            let swapped = self.immediate(|db| {
                let raw: Option<String> = db
                    .query_row("SELECT value FROM settings WHERE key='paused'", [], |row| {
                        row.get(0)
                    })
                    .optional()
                    .map_err(storage)?;
                let current = raw
                    .map(|raw| serde_json::from_str(&raw).unwrap_or(Value::Null))
                    .unwrap_or(Value::Bool(false));
                if !pyjson::equal(&current, expected) {
                    return Ok(false);
                }
                db.execute(
                    UPSERT_SETTING,
                    params!["paused", pyjson::dumps(value, None)],
                )
                .map_err(storage)?;
                Ok(true)
            })?;
            if !swapped {
                return Ok(false);
            }
            if pyjson::equal(&self.pending_pause().unwrap_or(Value::Null), expected) {
                self.set_pending_pause(None);
            }
            self.record_diagnostic(
                if pyjson::truthy(value) {
                    "paused"
                } else {
                    "resumed"
                },
                None,
                None,
            );
            Ok(true)
        })
    }

    /// Hold browser admission without changing a claim or its retry policy.
    ///
    /// A profile retrieval's 429 comes from Instagram's stricter profile endpoint, so it
    /// holds only retrievals, and a Following read's 429 or login wall holds only those
    /// reads; digests keep running and hold everything if they are limited too.
    pub fn defer_for_rate_limit(
        &self,
        job: Option<&BrowserJob>,
        reason: &str,
    ) -> BrowserResult<()> {
        self.retry_storage(|| {
            if reason.trim().is_empty() {
                return Err(BrowserError::Value("A rate limit requires a diagnostic reason".to_owned()));
            }
            let limited = self.immediate(|db| {
                let mut limited_job = None;
                if let Some(job) = job {
                    let row = db
                        .query_row(
                            "SELECT * FROM jobs WHERE id=? AND state='running' AND attempts=? AND started_at=?",
                            params![job.id, job.attempts, job.started_at],
                            BrowserJob::from_row,
                        )
                        .optional()
                        .map_err(storage)?;
                    match row {
                        Some(row) if job.state == "running" => limited_job = Some(row),
                        _ => return Ok(None),
                    }
                }
                self.write_rate_limit_state(db, self.host.time(), scope(limited_job.as_ref()))?;
                Ok(Some(limited_job))
            });
            let limited = match limited {
                Err(error) if error.is_storage() => {
                    self.pending_rate_limit.store(true, Ordering::SeqCst);
                    return Err(error);
                }
                other => other?,
            };
            let Some(limited_job) = limited else {
                return Ok(());
            };
            self.pending_rate_limit.store(false, Ordering::SeqCst);
            self.record_diagnostic("rate_limited", limited_job.as_ref(), Some(reason));
            Ok(())
        })
    }

    fn write_rate_limit_state(&self, db: &Connection, now: f64, scope: &str) -> BrowserResult<()> {
        let (deadline, mut backoff) = rate_limit_state(db, scope)?;
        if backoff == 0.0 {
            backoff = control().rate_limit_backoff_seconds;
        } else if now >= deadline {
            backoff = (backoff * 2.0).min(control().rate_limit_max_backoff_seconds);
        }
        let deadline = deadline.max(now + backoff);
        for (key, value) in [
            (format!("{scope}_rate_limit_until"), deadline),
            (format!("{scope}_rate_limit_backoff_seconds"), backoff),
        ] {
            db.execute(UPSERT_SETTING, params![key, pyjson::float_repr(value)])
                .map_err(storage)?;
        }
        Ok(())
    }

    /// Whether every claim is held, or with `retrieval` whether retrievals are.
    pub fn is_rate_limited(&self, now: Option<f64>, retrieval: bool) -> BrowserResult<bool> {
        if self.pending_rate_limit.load(Ordering::SeqCst) {
            return Ok(true);
        }
        let now = now.unwrap_or_else(|| self.host.time());
        self.retry_storage(|| {
            let db = self.connect()?;
            Ok(now < rate_limit_state(&db, BROWSER_SCOPE)?.0
                || (retrieval && now < rate_limit_state(&db, RETRIEVAL_SCOPE)?.0))
        })
    }

    fn claims_blocked(db: &Connection, now: f64) -> BrowserResult<bool> {
        let paused: Option<String> = db
            .query_row("SELECT value FROM settings WHERE key='paused'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(storage)?;
        Ok(paused.is_some_and(|paused| {
            pyjson::truthy(&serde_json::from_str(&paused).unwrap_or(Value::Null))
        }) || now < rate_limit_state(db, BROWSER_SCOPE)?.0)
    }

    /// Persist allowlisted diagnostics locally without delaying browser work on HTTP.
    pub fn record_diagnostic(&self, state: &str, job: Option<&BrowserJob>, reason: Option<&str>) {
        if self.write_diagnostic(state, job, reason).is_err() {
            // Diagnostic durability is secondary to the job transition already committed.
            tracing::warn!("Could not persist browser diagnostic ({state})");
        }
    }

    fn write_diagnostic(
        &self,
        state: &str,
        job: Option<&BrowserJob>,
        reason: Option<&str>,
    ) -> BrowserResult<()> {
        self.retry_storage(|| {
            let reason = match (reason, job) {
                (Some(reason), _) => Value::from(reason),
                (None, Some(job)) => job.error.clone().map_or(Value::Null, Value::from),
                (None, None) => self.setting_or("paused", Value::Bool(false))?,
            };
            let post_url = job.map(|job| {
                job.payload
                    .get("url")
                    .filter(|url| pyjson::truthy(url))
                    .or_else(|| job.payload.get("post_url"))
                    .cloned()
                    .unwrap_or(Value::Null)
            });
            let event = json!({
                "event": format!("Browser worker: {state}"),
                "sender_id": "instagram-browser-worker",
                "school": job.map(|job| job.school.clone()),
                "ig_account": job.map(|job| job.account_username.clone()),
                "post_url": post_url,
                "payload": {
                    "state": state,
                    "job_id": job.map(|job| job.id.clone()),
                    "kind": job.map(|job| job.kind.clone()),
                    "reason": reason,
                    "recorded_at": self.host.time(),
                },
            });
            let db = self.connect()?;
            db.execute(
                "INSERT INTO diagnostic_events VALUES (?,?,?)",
                params![
                    uuid::Uuid::new_v4().simple().to_string(),
                    pyjson::dumps(&event, None),
                    self.host.time()
                ],
            )
            .map_err(storage)?;
            Ok(())
        })
    }

    fn record_job_diagnostic(&self, state: &str, job_id: &str) {
        match self.get(job_id) {
            Ok(job) => self.record_diagnostic(state, job.as_ref(), None),
            Err(_) => tracing::warn!("Could not read browser job for diagnostic ({state})"),
        }
    }

    /// Keep unsent events durable when production logging is unavailable: send them
    /// oldest first through `publish`, stopping at the first that fails.
    pub fn publish_diagnostics(
        &self,
        should_stop: impl Fn() -> bool,
        mut publish: impl FnMut(&Value) -> bool,
    ) -> BrowserResult<()> {
        let events: Vec<(String, String)> = {
            let db = self.connect()?;
            let mut statement = db
                .prepare("SELECT id,event FROM diagnostic_events ORDER BY created_at LIMIT ?")
                .map_err(storage)?;
            statement
                .query_map([control().source_page_size as i64], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)?
        };
        for (id, event) in events {
            if should_stop() {
                break;
            }
            let event: Value = serde_json::from_str(&event).map_err(|_| {
                BrowserError::Value("Stored browser diagnostic is invalid".to_owned())
            })?;
            if !publish(&event) {
                break;
            }
            let db = self.connect()?;
            db.execute("DELETE FROM diagnostic_events WHERE id=?", [id])
                .map_err(storage)?;
        }
        Ok(())
    }

    pub fn account_excluded(&self, username: &str) -> BrowserResult<bool> {
        Ok(match self.setting_or("excluded_accounts", json!([]))? {
            Value::Array(accounts) => accounts
                .iter()
                .any(|account| account.as_str() == Some(username)),
            Value::String(accounts) => accounts.contains(username),
            Value::Object(accounts) => accounts.contains_key(username),
            _ => false,
        })
    }

    /// Reserve one password login for `username` at `now`: each account at most once a
    /// day (`account_login_at:<account>`) and `account_login_daily_limit` a day in all
    /// (`account_login_attempts`). False, recording nothing, when either is spent.
    pub fn reserve_account_login(&self, username: &str, now: f64) -> BrowserResult<bool> {
        self.reserve_login(username, now, &LoginReservation::default())
    }

    /// [`reserve_account_login`](Self::reserve_account_login) with `reservation`'s
    /// extra conditions, all checked and recorded in one transaction, since the
    /// worker's threads and `wat2do-lightpanda` reserve from the same budget.
    pub fn reserve_login(
        &self,
        username: &str,
        now: f64,
        reservation: &LoginReservation,
    ) -> BrowserResult<bool> {
        self.retry_storage(|| {
            self.immediate(|db| {
                let Some(mut spent) = account_logins_if_allowed(db, username, now)? else {
                    return Ok(false);
                };
                if spent.len() + reservation.keep >= control().account_login_daily_limit {
                    return Ok(false);
                }
                let mut first_logins = None;
                if let Some((key, limit)) = reservation.first_login {
                    let recent = recent_timestamps(&stored_setting(db, key)?, now);
                    if recent.len() >= limit {
                        return Ok(false);
                    }
                    first_logins = Some((key, recent));
                }
                spent.push(json!(now));
                write_setting(db, "account_login_attempts", &Value::from(spent))?;
                write_setting(db, &format!("account_login_at:{username}"), &json!(now))?;
                if let Some((key, mut recent)) = first_logins {
                    recent.push(json!(now));
                    write_setting(db, key, &Value::from(recent))?;
                }
                Ok(true)
            })
        })
    }

    /// Whether `reserve_account_login` would allow `username` a login at `now`,
    /// recording nothing.
    pub fn account_login_allowed(&self, username: &str, now: f64) -> BrowserResult<bool> {
        self.retry_storage(|| {
            Ok(account_logins_if_allowed(&self.connect()?, username, now)?.is_some())
        })
    }

    /// How many of the day's `account_login_daily_limit` logins are left at `now`.
    pub fn account_logins_left(&self, now: f64) -> BrowserResult<usize> {
        let spent = recent_timestamps(&self.setting_or("account_login_attempts", json!([]))?, now);
        Ok(control()
            .account_login_daily_limit
            .saturating_sub(spent.len()))
    }

    /// Choose a public bootstrap profile without claiming or switching an account.
    /// Digests Lightpanda reads never ask Brave for their account.
    pub fn peek_account_username(&self) -> BrowserResult<Option<String>> {
        self.retry_storage(|| {
            let db = self.connect()?;
            let lightpanda = lane_digest_arguments(&db, self.host.time())?;
            db.query_row(
                &format!(
                    "SELECT account_username FROM jobs WHERE state IN ('pending','running') \
                     AND {AVAILABLE_ACCOUNT_SQL} \
                     AND NOT (kind='digest' AND NOT {BRAVE_DIGEST_SQL}) \
                     ORDER BY created_at,id LIMIT 1"
                ),
                params_from_iter(lightpanda),
                |row| row.get(0),
            )
            .optional()
            .map_err(storage)
        })
    }

    pub fn enqueue_digest(
        &self,
        recipient_id: &str,
        account_username: &str,
        cache_ent_id: &str,
    ) -> BrowserResult<BrowserJob> {
        if !CACHE_ID_PATTERN.is_match(cache_ent_id) {
            return Err(BrowserError::Value(
                "Instagram cache ID is invalid".to_owned(),
            ));
        }
        let mut payload = Map::new();
        payload.insert("cache_ent_id".into(), cache_ent_id.into());
        self.enqueue("digest", "", recipient_id, account_username, payload)
    }

    pub fn enqueue_retrieval(
        &self,
        school: &str,
        recipient_id: &str,
        account_username: &str,
        url: &str,
        cutoff_days: i64,
    ) -> BrowserResult<String> {
        if !SCHOOL_PATTERN.is_match(school) || !(1..=1825).contains(&cutoff_days) {
            return Err(BrowserError::Value(
                "Instagram retrieval school or cutoff is invalid".to_owned(),
            ));
        }
        let mut payload = Map::new();
        payload.insert("url".into(), canonical_target_url(url)?.into());
        payload.insert("cutoff_days".into(), cutoff_days.into());
        Ok(self
            .enqueue("retrieval", school, recipient_id, account_username, payload)?
            .id)
    }

    /// Queue one page of `username`'s Following list for crawl `crawl_id`: the first page
    /// without `max_id`, then each page the previous one pointed to. Without `user_id`
    /// the read looks the account up first. `account_username` (the school's account)
    /// only names the job; the read runs as whichever account Brave shows.
    pub fn enqueue_following(
        &self,
        school: &str,
        account_username: &str,
        crawl_id: &str,
        username: &str,
        user_id: Option<&str>,
        max_id: Option<&str>,
    ) -> BrowserResult<BrowserJob> {
        if !SCHOOL_PATTERN.is_match(school) || !CACHE_ID_PATTERN.is_match(crawl_id) {
            return Err(BrowserError::Value(
                "Instagram Following read school or crawl is invalid".to_owned(),
            ));
        }
        let mut payload = Map::new();
        payload.insert("crawl".into(), crawl_id.into());
        payload.insert("username".into(), validate_list_owner(username)?.into());
        payload.insert(
            "user_id".into(),
            match user_id {
                Some(user_id) => validate_recipient_id(user_id)
                    .map_err(|_| BrowserError::Value("Instagram user ID is invalid".to_owned()))?
                    .into(),
                None => Value::Null,
            },
        );
        payload.insert(
            "max_id".into(),
            max_id
                .map(validate_cursor)
                .transpose()?
                .map_or(Value::Null, Value::from),
        );
        self.enqueue("following", school, "", account_username, payload)
    }

    pub fn enqueue_engagement(
        &self,
        school: &str,
        recipient_id: &str,
        account_username: &str,
        post_url: &str,
        event_id: Option<i64>,
        dry_run: bool,
    ) -> BrowserResult<String> {
        if !SCHOOL_PATTERN.is_match(school) {
            return Err(BrowserError::Value(
                "Instagram engagement school is invalid".to_owned(),
            ));
        }
        let mut payload = Map::new();
        payload.insert("post_url".into(), canonical_post_url(post_url)?.into());
        payload.insert("event_id".into(), event_id.map_or(Value::Null, Value::from));
        payload.insert("dry_run".into(), dry_run.into());
        Ok(self
            .enqueue(
                "engagement",
                school,
                recipient_id,
                account_username,
                payload,
            )?
            .id)
    }

    fn enqueue(
        &self,
        kind: &str,
        school: &str,
        recipient_id: &str,
        username: &str,
        payload: Map<String, Value>,
    ) -> BrowserResult<BrowserJob> {
        self.retry_storage(|| {
            // A Following read belongs to no recipient: it runs as whoever Brave shows.
            let recipient_id = if kind == "following" {
                String::new()
            } else {
                validate_recipient_id(recipient_id).map_err(BrowserError::Value)?
            };
            let username = validate_account_username(username).map_err(BrowserError::Value)?;
            let mut identity = vec![kind.to_owned(), recipient_id.clone(), username.clone()];
            match kind {
                "digest" => identity.push(pyjson::str(&payload["cache_ent_id"])),
                "retrieval" => {
                    identity.push(pyjson::str(&payload["url"]));
                    identity.push(pyjson::str(&payload["cutoff_days"]));
                }
                "following" => {
                    for key in ["crawl", "username", "max_id"] {
                        identity.push(pyjson::str(&payload[key]));
                    }
                }
                // p/ and reel/ can reference the same media. Dedupe by its shortcode.
                _ => identity.push(
                    payload["post_url"]
                        .as_str()
                        .unwrap_or_default()
                        .trim_end_matches('/')
                        .rsplit('/')
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                ),
            }
            if payload.get("dry_run").is_some_and(pyjson::truthy) {
                identity.push("inspect".to_owned());
                identity.push(uuid::Uuid::new_v4().simple().to_string());
            }
            let dedupe_key = hex::encode(Sha256::digest(pyjson::dumps(&Value::from(identity), None).as_bytes()));
            let (job, inserted) = self.immediate(|db| {
                let existing: Option<(String, String)> = db
                    .query_row("SELECT id,state FROM jobs WHERE dedupe_key=?", [&dedupe_key], |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })
                    .optional()
                    .map_err(storage)?;
                if let Some((id, state)) = existing {
                    // Digest and Following retries are reads. Engagement retries always
                    // require an explicit retry, because they may already have acted on
                    // Instagram. A Following read someone cancelled stays cancelled.
                    if (kind == "digest" && (state == "failed" || state == "cancelled"))
                        || (kind == "following" && state == "failed")
                    {
                        db.execute(
                            "UPDATE jobs SET state='pending',created_at=?,started_at=NULL,finished_at=NULL,error=NULL,result=NULL,attempts=0 WHERE id=?",
                            params![self.host.time(), id],
                        )
                        .map_err(storage)?;
                    }
                    return Ok((select_job(db, &id)?, false));
                }
                let job_id = uuid::Uuid::new_v4().simple().to_string();
                db.execute(
                    "INSERT INTO jobs(id,dedupe_key,kind,school,recipient_id,account_username,payload,created_at) VALUES (?,?,?,?,?,?,?,?)",
                    params![
                        job_id,
                        dedupe_key,
                        kind,
                        school,
                        recipient_id,
                        username,
                        pyjson::dumps(&Value::Object(payload.clone()), None),
                        self.host.time()
                    ],
                )
                .map_err(storage)?;
                Ok((select_job(db, &job_id)?, true))
            })?;
            if inserted {
                self.record_diagnostic("queued", Some(&job), None);
            }
            Ok(job)
        })
    }

    pub fn get(&self, job_id: &str) -> BrowserResult<Option<BrowserJob>> {
        self.retry_storage(|| {
            let db = self.connect()?;
            db.query_row(
                "SELECT * FROM jobs WHERE id=?",
                [job_id],
                BrowserJob::from_row,
            )
            .optional()
            .map_err(storage)
        })
    }

    pub fn claim_next(
        &self,
        now: Option<f64>,
        allow_engagement: bool,
    ) -> BrowserResult<Option<BrowserJob>> {
        if self.is_storage_unavailable() {
            return Ok(None);
        }
        self.retry_storage(|| {
            let now = now.unwrap_or_else(|| self.host.time());
            self.immediate(|db| {
                if Self::claims_blocked(db, now)? {
                    return Ok(None);
                }
                expire_pending_digests(db, now)?;
                let mut row = select_optional_job(
                    db,
                    &format!(
                        "SELECT * FROM jobs WHERE state='pending' AND kind='digest' \
                         AND {AVAILABLE_ACCOUNT_SQL} AND {BRAVE_DIGEST_SQL} \
                         ORDER BY created_at,id LIMIT 1"
                    ),
                    &lane_digest_arguments(db, now)?,
                )?;
                if row.is_none() && allow_engagement {
                    row = select_engagement(db, now, true)?;
                }
                if row.is_none() && now >= rate_limit_state(db, RETRIEVAL_SCOPE)?.0 {
                    row = select_optional_job(
                        db,
                        &format!(
                            "SELECT * FROM jobs WHERE state='pending' AND kind='retrieval' \
                             AND {AVAILABLE_ACCOUNT_SQL} ORDER BY created_at,id LIMIT 1"
                        ),
                        &[],
                    )?;
                }
                if row.is_none() && allow_engagement {
                    row = select_engagement(db, now, false)?;
                }
                if row.is_none() {
                    row = select_following(db, now)?;
                }
                let Some(row) = row else {
                    return Ok(None);
                };
                if row.kind == "following" {
                    let mut reads = recent_following_reads(db, now)?;
                    reads.push(json!(now));
                    write_setting(db, "following_reads", &Value::from(reads))?;
                }
                if row.kind == "engagement" {
                    db.execute(
                        UPSERT_SETTING,
                        params![
                            "engagement_school",
                            pyjson::dumps(&Value::from(row.school.clone()), None)
                        ],
                    )
                    .map_err(storage)?;
                }
                db.execute(
                    "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                    params![now, row.id],
                )
                .map_err(storage)?;
                Ok(Some(select_job(db, &row.id)?))
            })
        })
    }

    /// Atomically claim a compatible batch; never parallelize account switches.
    pub fn claim_companions(
        &self,
        first: &BrowserJob,
        limit: i64,
        allow_engagement: bool,
    ) -> BrowserResult<Vec<BrowserJob>> {
        // Engagement is serialized, and Following reads are paced one at a time.
        if self.is_storage_unavailable()
            || first.kind == "engagement"
            || first.kind == "following"
            || limit <= 0
        {
            return Ok(Vec::new());
        }
        self.retry_storage(|| {
            self.immediate(|db| {
                let now = self.host.time();
                if Self::claims_blocked(db, now)? {
                    return Ok(Vec::new());
                }
                expire_pending_digests(db, now)?;
                if first.kind == "retrieval"
                    && (now < rate_limit_state(db, RETRIEVAL_SCOPE)?.0
                        || db
                            .query_row(
                                &format!(
                                    "SELECT 1 FROM jobs WHERE state='pending' AND kind='digest' \
                                     AND {AVAILABLE_ACCOUNT_SQL} AND {BRAVE_DIGEST_SQL} LIMIT 1"
                                ),
                                params_from_iter(lane_digest_arguments(db, now)?),
                                |_| Ok(()),
                            )
                            .optional()
                            .map_err(storage)?
                            .is_some()
                        || (allow_engagement && select_engagement(db, now, true)?.is_some()))
                {
                    return Ok(Vec::new());
                }
                let mut sql = format!(
                    "SELECT * FROM jobs WHERE state='pending' AND kind=? AND {AVAILABLE_ACCOUNT_SQL} "
                );
                let mut arguments = vec![rusqlite::types::Value::Text(first.kind.clone())];
                if first.kind == "digest" {
                    sql.push_str("AND recipient_id=? AND account_username=?");
                    arguments.push(rusqlite::types::Value::Text(first.recipient_id.clone()));
                    arguments.push(rusqlite::types::Value::Text(first.account_username.clone()));
                }
                sql.push_str(" ORDER BY created_at,id LIMIT ?");
                arguments.push(rusqlite::types::Value::Integer(limit));
                let rows = select_jobs(db, &sql, &arguments)?;
                for row in &rows {
                    db.execute(
                        "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                        params![now, row.id],
                    )
                    .map_err(storage)?;
                }
                rows.iter().map(|row| select_job(db, &row.id)).collect()
            })
        })
    }

    /// Complete a claim or atomically schedule a safe read retry.
    pub fn finish(&self, claim: &BrowserJob, outcome: Finish) -> BrowserResult<()> {
        let finished = self.retry_storage(|| self.finish_once(claim, &outcome, None));
        if claim.kind == "retrieval" {
            // Queues a listed profile's posts without a polling loop.
            self.retrieval_finished.set();
        }
        finished
    }

    /// With `lane`, the claim is the Lightpanda lane's (`lightpanda::LaneRead`): it
    /// leaves the lane's running jobs, and its account's pace and hold are recorded in
    /// the same transaction instead of Brave's.
    fn finish_once(
        &self,
        claim: &BrowserJob,
        outcome: &Finish,
        lane: Option<&LaneRead>,
    ) -> BrowserResult<()> {
        let Finish {
            result,
            error,
            requeue,
            refund_rate_limit,
        } = outcome;
        let requeue = *requeue;
        if *refund_rate_limit
            && (!requeue
                || error.as_deref().is_none_or(|error| error.trim().is_empty())
                || result.is_some()
                || !read_only_kind(&claim.kind)
                || claim.state != "running"
                || claim.started_at.is_none()
                || claim.attempts <= 0)
        {
            return Err(BrowserError::Value(
                "A rate-limited claim refund requires a failed running safe read retry".to_owned(),
            ));
        }
        let result_truthy = result.as_ref().is_some_and(pyjson::truthy);
        let state = if requeue {
            "pending"
        } else if error.as_deref().is_some_and(|error| !error.is_empty()) {
            "failed"
        } else if result_truthy
            && result.as_ref().and_then(|result| result.get("status"))
                == Some(&json!("unsupported"))
        {
            "unsupported"
        } else {
            "succeeded"
        };
        let retried = self.immediate(|db| {
            if let Some(lane) = lane {
                lane.record(db, claim, self.host.time())?;
            }
            let Some(stored_job) = db
                .query_row("SELECT * FROM jobs WHERE id=?", [&claim.id], BrowserJob::from_row)
                .optional()
                .map_err(storage)?
            else {
                return Ok(None);
            };
            if stored_job.state != "running"
                || claim.state != "running"
                || stored_job.attempts != claim.attempts
                || stored_job.started_at != claim.started_at
            {
                return Ok(None);
            }
            let retry_job = if requeue {
                if stored_job.kind == "engagement" {
                    return Err(BrowserError::Value("Engagement cannot be automatically requeued".to_owned()));
                }
                Some(stored_job.clone())
            } else {
                None
            };
            let now = self.host.time();
            let changed = db
                .execute(
                    "UPDATE jobs SET state=?,result=?,error=?,finished_at=?,\
                     started_at=CASE WHEN ? THEN NULL ELSE started_at END,\
                     created_at=CASE WHEN ? AND kind!='digest' THEN ? ELSE created_at END,\
                     attempts=attempts-? \
                     WHERE id=? AND state='running' AND attempts=? AND started_at=?",
                    params![
                        state,
                        (result_truthy && !requeue).then(|| pyjson::dumps(result.as_ref().expect("truthy result"), None)),
                        if requeue { None } else { error.clone() },
                        if requeue { None } else { Some(now) },
                        requeue,
                        requeue,
                        now,
                        i64::from(*refund_rate_limit),
                        claim.id,
                        claim.attempts,
                        claim.started_at,
                    ],
                )
                .map_err(storage)?;
            if changed > 0 && stored_job.kind == "following" {
                delete_collected_following(db, now)?;
                if lane.is_none() {
                    pace_following(db, now)?;
                }
            }
            // The lane's reads pace and hold their own accounts, never Brave's.
            if changed > 0
                && lane.is_none()
                && state == "succeeded"
                && (read_only_kind(&stored_job.kind)
                    || (stored_job.kind == "engagement" && !stored_job.dry_run()))
            {
                // Any fresh success clears the shared hold; a retrieval or Following read
                // also clears its own.
                let mut scopes = vec![BROWSER_SCOPE];
                if scope(Some(&stored_job)) != BROWSER_SCOPE {
                    scopes.push(scope(Some(&stored_job)));
                }
                for scope in scopes {
                    let (deadline, backoff) = rate_limit_state(db, scope)?;
                    let recovered_at = deadline + control().rate_limit_recovery_seconds;
                    // One healthy route does not prove a recently limited route recovered.
                    // Keep escalation until a fresh verified job follows a quiet recovery window.
                    if backoff != 0.0
                        && let Some(started_at) = stored_job.started_at
                        && recovered_at <= started_at
                        && started_at <= now
                    {
                        db.execute(
                            "INSERT INTO settings VALUES (?,'0') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                            [format!("{scope}_rate_limit_backoff_seconds")],
                        )
                        .map_err(storage)?;
                    }
                }
            }
            Ok(retry_job.filter(|_| changed > 0))
        })?;
        if let Some(mut retry_job) = retried {
            retry_job.state = "pending".to_owned();
            retry_job.result = None;
            retry_job.error = error.clone();
            self.record_diagnostic("retrying", Some(&retry_job), None);
        }
        Ok(())
    }

    /// Called only after obtaining the singleton worker and exclusive browser locks.
    pub fn recover_interrupted(&self) -> BrowserResult<()> {
        self.retry_storage(|| {
            let newly_paused = self.immediate(|db| {
                if let Some(pending) = self.pending_pause().filter(pyjson::truthy) {
                    db.execute(UPSERT_SETTING, params!["paused", pyjson::dumps(&pending, None)])
                        .map_err(storage)?;
                }
                if self.pending_rate_limit.load(Ordering::SeqCst) {
                    self.write_rate_limit_state(db, self.host.time(), BROWSER_SCOPE)?;
                }
                let uncertain_action = db
                    .query_row(
                        "SELECT 1 FROM jobs WHERE kind='engagement' AND state='running' \
                         AND json_extract(payload,'$.dry_run') IS NOT 1 LIMIT 1",
                        [],
                        |_| Ok(()),
                    )
                    .optional()
                    .map_err(storage)?
                    .is_some();
                let paused: Option<String> = db
                    .query_row("SELECT value FROM settings WHERE key='paused'", [], |row| row.get(0))
                    .optional()
                    .map_err(storage)?;
                let paused = paused.is_some_and(|paused| {
                    pyjson::truthy(&serde_json::from_str(&paused).unwrap_or(Value::Null))
                });
                let mut newly_paused = false;
                if uncertain_action && !paused {
                    db.execute(
                        UPSERT_SETTING,
                        params![
                            "paused",
                            pyjson::dumps(&Value::from(
                                "Worker interrupted during engagement; inspect browser state before resuming"
                            ), None)
                        ],
                    )
                    .map_err(storage)?;
                    newly_paused = true;
                }
                // The lane's reads run on in its own thread; requeueing one would drop its
                // finish and read the page twice.
                db.execute(
                    "UPDATE jobs SET state='pending',started_at=NULL WHERE kind IN ('digest','retrieval','following') AND state='running' \
                     AND id NOT IN (SELECT value FROM json_each(?))",
                    [lane_running_jobs(db, self.host.time())?],
                )
                .map_err(storage)?;
                db.execute(
                    "UPDATE jobs SET state='failed',finished_at=?,error='Worker interrupted; inspect browser state before retrying' WHERE kind='engagement' AND state='running'",
                    [self.host.time()],
                )
                .map_err(storage)?;
                Ok(newly_paused)
            })?;
            self.set_pending_pause(None);
            self.pending_rate_limit.store(false, Ordering::SeqCst);
            self.set_storage_unavailable(false);
            if newly_paused {
                self.record_diagnostic("paused", None, None);
            }
            Ok(())
        })
    }

    pub fn retry(&self, job_id: &str) -> BrowserResult<()> {
        self.retry_storage(|| {
            let db = self.connect()?;
            let changed = db
                .execute(
                    "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND state IN ('failed','unsupported','cancelled')",
                    params![self.host.time(), job_id],
                )
                .map_err(storage)?;
            drop(db);
            if changed == 0 {
                return Err(BrowserError::Value(
                    "Only failed, unsupported, or cancelled jobs may be retried".to_owned(),
                ));
            }
            self.record_job_diagnostic("queued", job_id);
            Ok(())
        })
    }

    pub fn cancel(&self, job_id: &str) -> BrowserResult<()> {
        self.retry_storage(|| {
            let db = self.connect()?;
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND state='pending'",
                params![self.host.time(), job_id],
            )
            .map_err(storage)?;
            Ok(())
        })
    }

    /// A timed-out caller cannot cancel a newer submission of the same digest.
    pub fn cancel_pending_digest(&self, expected: &BrowserJob) -> BrowserResult<bool> {
        if expected.kind != "digest" {
            return Err(BrowserError::Value(
                "Caller cancellation requires its original digest submission".to_owned(),
            ));
        }
        self.retry_storage(|| {
            let db = self.connect()?;
            let changed = db
                .execute(
                    "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND kind='digest' \
                     AND state='pending' AND created_at=?",
                    params![self.host.time(), expected.id, expected.created_at],
                )
                .map_err(storage)?;
            Ok(changed > 0)
        })
    }

    /// Retrieve an idle target again and let its fresh result be enqueued again.
    pub fn retry_retrieval(&self, job_id: &str) -> BrowserResult<()> {
        self.retry_storage(|| {
            self.immediate(|db| {
                let changed = db
                    .execute(
                        "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,\
                         started_at=NULL,finished_at=NULL,attempts=0 WHERE id=? AND kind='retrieval' \
                         AND state IN ('pending','succeeded','failed','cancelled')",
                        params![self.host.time(), job_id],
                    )
                    .map_err(storage)?;
                if changed == 0 {
                    return Err(BrowserError::Value("Only an idle retrieval job may be retried".to_owned()));
                }
                db.execute("DELETE FROM settings WHERE key=?", [format!("profile_queued:{job_id}")])
                    .map_err(storage)?;
                Ok(())
            })?;
            self.record_job_diagnostic("queued", job_id);
            Ok(())
        })
    }

    pub fn retrieval_results(&self) -> BrowserResult<Vec<BrowserJob>> {
        self.retry_storage(|| {
            let db = self.connect()?;
            select_jobs(
                &db,
                "SELECT * FROM jobs WHERE kind='retrieval' AND state='succeeded' ORDER BY created_at,id",
                &[],
            )
        })
    }

    pub fn status(&self) -> BrowserResult<Value> {
        let db = self.connect()?;
        let groups = rows_as_objects(
            &db,
            "SELECT kind,school,state,COUNT(*) AS quantity FROM jobs GROUP BY kind,school,state ORDER BY kind,school,state",
        )?;
        let recent = rows_as_objects(
            &db,
            "SELECT id,kind,school,state,error,finished_at FROM jobs WHERE state IN ('failed','unsupported') ORDER BY finished_at DESC LIMIT 20",
        )?;
        drop(db);
        let until = self.setting_or("browser_rate_limit_until", json!(0))?;
        let remaining = pyjson::number(&until).unwrap_or(0.0) - self.host.time();
        let following_until = self.setting_or("following_rate_limit_until", json!(0))?;
        let following_reads = {
            let db = self.connect()?;
            recent_following_reads(&db, self.host.time())?.len()
        };
        let lightpanda = self.lightpanda_status(self.host.time())?;
        Ok(json!({
            "queues": groups,
            "recent_failures": recent,
            "worker": self.get_setting("worker")?,
            "paused": self.setting_or("paused", json!(false))?,
            "rate_limit": {
                "retry_at": if pyjson::truthy(&until) { until.clone() } else { Value::Null },
                "remaining_seconds": if remaining > 0.0 { json!(remaining) } else { json!(0) },
                "backoff_seconds": self.setting_or("browser_rate_limit_backoff_seconds", json!(0))?,
            },
            "following": {
                "paused": self.setting_or(FOLLOWING_PAUSED, json!(false))?,
                "held_until": if pyjson::truthy(&following_until) { following_until } else { Value::Null },
                "reads_last_hour": following_reads,
                "readers": self.following_readers(self.host.time())?,
            },
            "lightpanda": lightpanda,
            "source": self.get_setting("source_status")?,
            "profile_queue": self.get_setting("profile_queue_status")?,
        }))
    }

    /// The process-notification side: submit a digest and wait for the worker's result.
    pub fn resolve_digest(
        &self,
        recipient_id: &str,
        account_username: &str,
        cache_ent_id: &str,
    ) -> BrowserResult<DigestResolution> {
        let storage_unavailable = |error: BrowserError| {
            if error.is_storage()
                || matches!(&error, BrowserError::Other { type_name, .. } if type_name == "OSError")
            {
                BrowserError::digest("Instagram browser queue storage is unavailable")
            } else {
                error
            }
        };
        let submitted = match self.enqueue_digest(recipient_id, account_username, cache_ent_id) {
            Ok(submitted) => submitted,
            Err(error) if error.is_storage() || matches!(error, BrowserError::Value(_)) => {
                return Err(BrowserError::digest("Could not enqueue Instagram digest"));
            }
            Err(error) => return Err(storage_unavailable(error)),
        };
        // All waiters share the admission's expiry, matching claim_next. A late
        // duplicate caller cannot extend a pending digest's lifetime for others.
        let remaining = control().result_timeout_seconds.min(
            (submitted.created_at + control().result_timeout_seconds - self.host.time()).max(0.0),
        );
        let deadline = self.host.monotonic() + remaining;
        loop {
            let job = self.get(&submitted.id).map_err(storage_unavailable)?;
            if let Some(job) = &job {
                if job.state == "succeeded"
                    && let Some(result) =
                        job.result.as_ref().filter(|result| pyjson::truthy(result))
                {
                    return DigestResolution::from_value(result);
                }
                if job.state == "failed" || job.state == "cancelled" {
                    return Err(BrowserError::digest(
                        job.error
                            .clone()
                            .filter(|error| !error.is_empty())
                            .unwrap_or_else(|| "Instagram digest job was cancelled".to_owned()),
                    ));
                }
            }
            if self.host.monotonic() >= deadline {
                break;
            }
            let worker = self
                .setting_or("worker", json!({}))
                .map_err(storage_unavailable)?;
            let paused = self
                .setting_or("paused", json!(false))
                .map_err(storage_unavailable)?;
            let running = worker.get("running").is_some_and(pyjson::truthy);
            let heartbeat = worker
                .get("heartbeat")
                .and_then(pyjson::number)
                .unwrap_or(0.0);
            if paused != json!(WORKER_INSTALLATION_PAUSE)
                && (pyjson::truthy(&paused)
                    || !running
                    || self.host.time() - heartbeat
                        > control().job_timeout_seconds + control().request_timeout_seconds)
            {
                self.cancel_pending_digest(&submitted)
                    .map_err(storage_unavailable)?;
                let reason = match paused.as_str() {
                    Some(paused) if !paused.is_empty() => format!("Instagram browser worker is paused: {paused}"),
                    _ => "Instagram browser worker is unavailable or paused; inspect it on the Mac mini".to_owned(),
                };
                return Err(BrowserError::digest(reason));
            }
            self.host.sleep(control().worker_poll_interval_seconds);
        }
        self.cancel_pending_digest(&submitted)
            .map_err(storage_unavailable)?;
        Err(BrowserError::digest(
            "Instagram digest queue timed out; notification can be retried",
        ))
    }
}

/// Tests' stand-ins for a pause another process writes, or a lost acquisition, just as
/// a queue at that database compares and sets its pause.
#[cfg(test)]
pub(crate) mod compare_set_pause_hooks {
    use std::path::PathBuf;
    use std::sync::Mutex;

    use super::BrowserJobQueue;

    /// Runs first; `Some(result)` answers the call instead of the database.
    pub(crate) type Hook = Box<dyn FnMut(&BrowserJobQueue) -> Option<bool> + Send>;

    static HOOKS: Mutex<Vec<(PathBuf, Hook)>> = Mutex::new(Vec::new());

    /// Hook every `compare_set_pause` on the queue whose database is `database`.
    pub(crate) fn install(database: PathBuf, hook: Hook) {
        HOOKS.lock().unwrap().push((database, hook));
    }

    pub(super) fn run(queue: &BrowserJobQueue) -> Option<bool> {
        let mut hooks = HOOKS.lock().unwrap();
        let (_, hook) = hooks
            .iter_mut()
            .find(|(database, _)| *database == queue.database_path)?;
        hook(queue)
    }
}

/// How a claim ended: a result, an error, or a safe read retry.
#[derive(Debug, Clone, Default)]
pub struct Finish {
    pub result: Option<Value>,
    pub error: Option<String>,
    pub requeue: bool,
    pub refund_rate_limit: bool,
}

impl Finish {
    pub fn result(result: Value) -> Self {
        Self {
            result: Some(result),
            ..Self::default()
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            error: Some(error.into()),
            ..Self::default()
        }
    }
}

/// The timestamps in `attempts` (a stored JSON list) within the day before `now`.
pub(crate) fn recent_timestamps(attempts: &Value, now: f64) -> Vec<Value> {
    attempts
        .as_array()
        .map(|attempts| {
            attempts
                .iter()
                .filter(|at| pyjson::number(at).is_some_and(|at| now - at < 86_400.0))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn schema_tokens(sql: &str) -> Vec<String> {
    static IF_NOT_EXISTS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^(CREATE\s+(?:TABLE|INDEX))\s+IF\s+NOT\s+EXISTS\b").expect("valid regex")
    });
    static TOKEN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"'(?:''|[^'])*'|\w+|[^\s]").expect("valid regex"));
    let sql = IF_NOT_EXISTS.replace(sql.trim(), "$1");
    TOKEN
        .find_iter(&sql)
        .map(|token| {
            let token = token.as_str();
            if token.starts_with('\'') {
                token.to_owned()
            } else {
                token.to_lowercase()
            }
        })
        .collect()
}

/// `_rate_limit_state`: a scope's hold deadline and current backoff.
fn rate_limit_state(db: &Connection, scope: &str) -> BrowserResult<(f64, f64)> {
    let until_key = format!("{scope}_rate_limit_until");
    let interval_key = format!("{scope}_rate_limit_backoff_seconds");
    let mut statement = db
        .prepare("SELECT key,value FROM settings WHERE key IN (?,?)")
        .map_err(storage)?;
    let rows: Vec<(String, String)> = statement
        .query_map(params![until_key, interval_key], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    let (mut until, mut interval) = (0.0, 0.0);
    for (key, raw) in rows {
        let value = serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null);
        let is_interval = key == interval_key;
        let number = match &value {
            Value::Number(number) => number.as_f64().filter(|number| number.is_finite()),
            _ => None,
        };
        let valid = number.is_some_and(|number| {
            !is_interval
                || number == 0.0
                || (control().rate_limit_backoff_seconds..=control().rate_limit_max_backoff_seconds)
                    .contains(&number)
        });
        let Some(number) = number.filter(|_| valid) else {
            let name = if is_interval { "interval" } else { "timestamp" };
            return Err(BrowserError::Value(format!(
                "Browser rate limit {name} is invalid"
            )));
        };
        if is_interval {
            interval = number;
        } else {
            until = number;
        }
    }
    Ok((until, interval))
}

fn expire_pending_digests(db: &Connection, now: f64) -> BrowserResult<()> {
    db.execute(
        "UPDATE jobs SET state='cancelled',finished_at=?,error='Digest caller deadline expired' \
         WHERE kind='digest' AND state='pending' AND created_at<=?",
        params![now, now - control().result_timeout_seconds],
    )
    .map_err(storage)?;
    Ok(())
}

/// An aged post triggers a yield; complete the selected school's posts together.
fn select_engagement(
    db: &Connection,
    now: f64,
    require_waited: bool,
) -> BrowserResult<Option<BrowserJob>> {
    let cooldown: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key='next_engagement_at'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    if let Some(cooldown) = cooldown
        && serde_json::from_str::<Value>(&cooldown)
            .ok()
            .as_ref()
            .and_then(pyjson::number)
            .is_some_and(|cooldown| now < cooldown)
    {
        return Ok(None);
    }
    if require_waited
        && db
            .query_row(
                &format!(
                    "SELECT 1 FROM jobs WHERE state='pending' AND kind='engagement' \
                     AND {AVAILABLE_ACCOUNT_SQL} AND created_at<=? LIMIT 1"
                ),
                [now - control().engagement_max_wait_seconds],
                |_| Ok(()),
            )
            .optional()
            .map_err(storage)?
            .is_none()
    {
        return Ok(None);
    }
    let selected: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key='engagement_school'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?;
    let selected = selected
        .and_then(|selected| serde_json::from_str::<Value>(&selected).ok())
        .unwrap_or(Value::Null);
    select_optional_job(
        db,
        &format!(
            "SELECT * FROM jobs WHERE state='pending' AND kind='engagement' AND {AVAILABLE_ACCOUNT_SQL} \
             ORDER BY CASE WHEN school=? THEN 0 ELSE 1 END,created_at,id LIMIT 1"
        ),
        &[sql_value(&selected)],
    )
}

/// Jobs that only read Instagram, so a failed one may be retried safely.
pub(crate) fn read_only_kind(kind: &str) -> bool {
    matches!(kind, "digest" | "retrieval" | "following")
}

/// The oldest Following read once it may run: these reads are neither stopped
/// (`following_paused`) nor held, the last one was claimed at least an hour divided by
/// `following_requests_per_hour` ago, so the hour's reads are spread evenly, and its
/// own pause has passed. A list's next page waits the page pause, a new list the list
/// pause, both drawn when the previous read finished. A read runs as whichever account
/// Brave shows, so `excluded_accounts` never holds it.
fn select_following(db: &Connection, now: f64) -> BrowserResult<Option<BrowserJob>> {
    let spacing = 3_600.0 / control().following_requests_per_hour as f64;
    let last_read = recent_following_reads(db, now)?
        .iter()
        .filter_map(pyjson::number)
        .fold(f64::NEG_INFINITY, f64::max);
    if pyjson::truthy(&stored_setting(db, FOLLOWING_PAUSED)?)
        || now < rate_limit_state(db, FOLLOWING_SCOPE)?.0
        || now < last_read + spacing
    {
        return Ok(None);
    }
    let lane = if lane_reads_following(db, now)? {
        format!("AND NOT {KNOWN_LIST_SQL}")
    } else {
        String::new()
    };
    let Some(job) = select_optional_job(
        db,
        &format!(
            "SELECT * FROM jobs WHERE state='pending' AND kind='following' {lane} \
             ORDER BY created_at,id LIMIT 1"
        ),
        &[],
    )?
    else {
        return Ok(None);
    };
    let pause = if job.payload.get("max_id").is_some_and(pyjson::truthy) {
        "following_next_page_at"
    } else {
        "following_next_list_at"
    };
    let ready_at = pyjson::number(&stored_setting(db, pause)?).unwrap_or(0.0);
    Ok((now >= ready_at).then_some(job))
}

/// When the Following reads claimed within the hour before `now` were claimed.
fn recent_following_reads(db: &Connection, now: f64) -> BrowserResult<Vec<Value>> {
    Ok(match stored_setting(db, "following_reads")? {
        Value::Array(reads) => reads
            .into_iter()
            .filter(|at| pyjson::number(at).is_some_and(|at| now - at < 3_600.0))
            .collect(),
        _ => Vec::new(),
    })
}

/// After Brave's Following read: draw its pauses before the next page and the next list.
fn pace_following(db: &Connection, now: f64) -> BrowserResult<()> {
    let (page_at, list_at) = following_pauses(now);
    write_setting(db, "following_next_page_at", &json!(page_at))?;
    write_setting(db, "following_next_list_at", &json!(list_at))?;
    Ok(())
}

/// Delete finished Following reads the crawl has had time to collect.
fn delete_collected_following(db: &Connection, now: f64) -> BrowserResult<()> {
    db.execute(
        &format!("DELETE FROM jobs WHERE {FINISHED_FOLLOWING_SQL} AND finished_at<?"),
        [now - control().following_result_retention_seconds],
    )
    .map_err(storage)?;
    Ok(())
}

/// The day's account logins so far, or None once `username` may not log in again.
fn account_logins_if_allowed(
    db: &Connection,
    username: &str,
    now: f64,
) -> BrowserResult<Option<Vec<Value>>> {
    let attempts = recent_timestamps(&stored_setting(db, "account_login_attempts")?, now);
    let last = pyjson::number(&stored_setting(
        db,
        &format!("account_login_at:{username}"),
    )?)
    .unwrap_or(0.0);
    Ok(
        (attempts.len() < control().account_login_daily_limit && now - last >= 86_400.0)
            .then_some(attempts),
    )
}

/// Extra conditions on a login reservation.
#[derive(Debug, Default)]
pub struct LoginReservation {
    /// Leave at least this many of the day's logins unspent (for Brave's relogins).
    pub keep: usize,
    /// A first login on a new device also needs a place among the last day's
    /// timestamps in this setting, fewer than this many.
    pub first_login: Option<(&'static str, usize)>,
}

/// When the next page of a list, and the next list, may be read after a Following
/// read that finished at `now`: each a random pause in `following_*_delay_*` later.
fn following_pauses(now: f64) -> (f64, f64) {
    let control = control();
    let between = |low: f64, high: f64| low + fastrand::f64() * (high - low);
    (
        now + between(
            control.following_page_delay_min_seconds,
            control.following_page_delay_max_seconds,
        ),
        now + between(
            control.following_list_delay_min_seconds,
            control.following_list_delay_max_seconds,
        ),
    )
}

/// A setting read inside a transaction: its JSON value, null when unset or invalid.
fn stored_setting(db: &Connection, key: &str) -> BrowserResult<Value> {
    let raw: Option<String> = db
        .query_row("SELECT value FROM settings WHERE key=?", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(storage)?;
    Ok(raw
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Null))
}

fn write_setting(db: &Connection, key: &str, value: &Value) -> BrowserResult<()> {
    db.execute(UPSERT_SETTING, params![key, pyjson::dumps(value, None)])
        .map_err(storage)?;
    Ok(())
}

fn select_job(db: &Connection, id: &str) -> BrowserResult<BrowserJob> {
    db.query_row("SELECT * FROM jobs WHERE id=?", [id], BrowserJob::from_row)
        .map_err(storage)
}

fn select_optional_job(
    db: &Connection,
    sql: &str,
    arguments: &[rusqlite::types::Value],
) -> BrowserResult<Option<BrowserJob>> {
    db.query_row(sql, params_from_iter(arguments), BrowserJob::from_row)
        .optional()
        .map_err(storage)
}

fn select_jobs(
    db: &Connection,
    sql: &str,
    arguments: &[rusqlite::types::Value],
) -> BrowserResult<Vec<BrowserJob>> {
    let mut statement = db.prepare(sql).map_err(storage)?;
    let jobs = statement
        .query_map(params_from_iter(arguments), BrowserJob::from_row)
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    Ok(jobs)
}

/// `[dict(row) for row in db.execute(sql)]`.
fn rows_as_objects(db: &Connection, sql: &str) -> BrowserResult<Vec<Value>> {
    let mut statement = db.prepare(sql).map_err(storage)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    let rows = statement
        .query_map([], |row| {
            let mut object = Map::new();
            for (index, name) in names.iter().enumerate() {
                use rusqlite::types::ValueRef;
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(number) => json!(number),
                    ValueRef::Real(number) => json!(number),
                    ValueRef::Text(text) | ValueRef::Blob(text) => {
                        Value::from(String::from_utf8_lossy(text).into_owned())
                    }
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })
        .map_err(storage)?
        .collect::<Result<_, _>>()
        .map_err(storage)?;
    Ok(rows)
}

#[path = "browser_queue_lightpanda.rs"]
mod lightpanda;
pub use lightpanda::{AccountPace, LanePending, LaneRead};
use lightpanda::{
    BRAVE_DIGEST_SQL, KNOWN_LIST_SQL, lane_digest_arguments, lane_reads_following,
    lane_running_jobs,
};

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/browser_queue.rs"]
mod python_tests;
