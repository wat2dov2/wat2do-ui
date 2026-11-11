//! The queue's side of the worker's Lightpanda lane (`crate::lightpanda::lane`).
//!
//! The lane says which accounts it serves in the `lightpanda_lane` setting, refreshed
//! with a heartbeat. While that heartbeat is fresh (`lane_stale_seconds`):
//! - a digest whose account the lane names goes to that account's Lightpanda session,
//!   and Brave reads every other digest;
//! - Following reads go to the lane whenever it names any account, and Brave reads
//!   them only when it names none, except a read whose list owner's ID is unknown,
//!   which only Brave can look up.
//!
//! Each account reads at most `following_requests_per_hour` Following pages an hour,
//! with Brave's pauses before a list's next page and a new list, and a 429 or refusal
//! on one account's read holds that account alone (`lightpanda_account:<account>`).

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use super::{
    AVAILABLE_ACCOUNT_SQL, BrowserJob, BrowserJobQueue, FOLLOWING_PAUSED, Finish,
    expire_pending_digests, following_pauses, select_job, select_optional_job, storage,
    stored_setting, write_setting,
};
use crate::controlbox::{INSTAGRAM_LIGHTPANDA, instagram_browser as control};
use crate::instagram_notifications::errors::BrowserResult;
use crate::pyjson;

/// What the lane serves, with its heartbeat.
const LIGHTPANDA_LANE: &str = "lightpanda_lane";

/// The jobs the lane is running, so Brave's recovery leaves them to it.
const LANE_JOBS: &str = "lightpanda_jobs";

/// Brave's digests: none whose account the lane serves, unless it has waited
/// `lane_digest_wait_seconds` for the lane. Bound to [`lane_digest_arguments`].
pub(super) const BRAVE_DIGEST_SQL: &str =
    "(account_username NOT IN (SELECT value FROM json_each(?)) OR created_at<=?)";

/// A Following read whose list owner's Instagram ID is known. Instagram answers a
/// lookup by name (`web_profile_info`) only to a full browser, so Lightpanda reads only
/// these, and Brave the rest.
pub(super) const KNOWN_LIST_SQL: &str = "json_extract(payload,'$.user_id') IS NOT NULL";

fn account_key(account: &str) -> String {
    format!("lightpanda_account:{account}")
}

/// One account's Following pace and hold in Lightpanda.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct AccountPace {
    /// When its Following reads of the last hour were claimed.
    pub reads: Vec<f64>,
    pub next_page_at: f64,
    pub next_list_at: f64,
    /// Nothing is read in this account's session before then.
    pub held_until: f64,
    /// The last hold's length; 0 once the account has read well since.
    pub backoff: f64,
}

impl AccountPace {
    fn read(db: &Connection, account: &str, now: f64) -> BrowserResult<Self> {
        let stored = stored_setting(db, &account_key(account))?;
        let number = |key: &str| stored.get(key).and_then(pyjson::number).unwrap_or(0.0);
        let reads = match stored.get("reads") {
            Some(Value::Array(reads)) => reads
                .iter()
                .filter_map(pyjson::number)
                .filter(|at| now - at < 3_600.0)
                .collect(),
            _ => Vec::new(),
        };
        Ok(Self {
            reads,
            next_page_at: number("next_page_at"),
            next_list_at: number("next_list_at"),
            held_until: number("held_until"),
            backoff: number("backoff"),
        })
    }

    fn write(&self, db: &Connection, account: &str) -> BrowserResult<()> {
        write_setting(db, &account_key(account), &self.to_value())
    }

    pub fn to_value(&self) -> Value {
        json!({
            "reads": self.reads,
            "next_page_at": self.next_page_at,
            "next_list_at": self.next_list_at,
            "held_until": self.held_until,
            "backoff": self.backoff,
        })
    }

    /// Whether the account may take `job`, a Following read, at `now`.
    fn may_read(&self, job: &BrowserJob, now: f64) -> bool {
        let spacing = 3_600.0 / control().following_requests_per_hour as f64;
        let last = self.reads.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let ready_at = if job.payload.get("max_id").is_some_and(pyjson::truthy) {
            self.next_page_at
        } else {
            self.next_list_at
        };
        now >= last + spacing && now >= ready_at
    }

    /// Hold the account: the first hold lasts `rate_limit_backoff_seconds`, and one
    /// within `rate_limit_recovery_seconds` of the last doubles it, up to the maximum.
    fn hold(&mut self, now: f64) {
        let control = control();
        self.backoff =
            if self.backoff > 0.0 && now < self.held_until + control.rate_limit_recovery_seconds {
                (self.backoff * 2.0).min(control.rate_limit_max_backoff_seconds)
            } else {
                control.rate_limit_backoff_seconds
            };
        self.held_until = self.held_until.max(now + self.backoff);
    }
}

/// [`BRAVE_DIGEST_SQL`]'s arguments: the accounts whose digests the lane reads (none
/// once its heartbeat is stale), and the newest a digest may be for Brave to take it
/// from the lane anyway.
pub(super) fn lane_digest_arguments(
    db: &Connection,
    now: f64,
) -> BrowserResult<Vec<rusqlite::types::Value>> {
    use rusqlite::types::Value as Sql;
    Ok(vec![
        Sql::Text(Value::from(lane_accounts(db, now, "digests")?).to_string()),
        Sql::Real(now - INSTAGRAM_LIGHTPANDA.lane_digest_wait_seconds),
    ])
}

/// The jobs the lane is running, as a JSON array, while it says it runs; none once its
/// heartbeat is stale.
pub(super) fn lane_running_jobs(db: &Connection, now: f64) -> BrowserResult<String> {
    let jobs = if lane_fresh(db, now)? {
        stored_setting(db, LANE_JOBS)?
    } else {
        Value::Null
    };
    Ok(match jobs {
        Value::Array(jobs) => Value::Array(jobs),
        _ => json!([]),
    }
    .to_string())
}

fn lane_fresh(db: &Connection, now: f64) -> BrowserResult<bool> {
    let lane = stored_setting(db, LIGHTPANDA_LANE)?;
    Ok(lane
        .get("heartbeat")
        .and_then(pyjson::number)
        .is_some_and(|heartbeat| now - heartbeat <= INSTAGRAM_LIGHTPANDA.lane_stale_seconds))
}

/// How a read in the lane ended, recorded with its finish: it leaves the lane's
/// running jobs, a Following read draws its account's next pauses, and `held` holds
/// the account, while a read that went well after a quiet recovery window ends the
/// escalation.
pub struct LaneRead {
    pub account: String,
    pub held: bool,
}

impl LaneRead {
    pub(super) fn record(&self, db: &Connection, job: &BrowserJob, now: f64) -> BrowserResult<()> {
        if let Value::Array(mut running) = stored_setting(db, LANE_JOBS)? {
            running.retain(|id| id.as_str() != Some(job.id.as_str()));
            write_setting(db, LANE_JOBS, &Value::Array(running))?;
        }
        let mut pace = AccountPace::read(db, &self.account, now)?;
        if job.kind == "following" {
            (pace.next_page_at, pace.next_list_at) = following_pauses(now);
        }
        if self.held {
            pace.hold(now);
        } else if job.started_at.is_some_and(|started| {
            started >= pace.held_until + control().rate_limit_recovery_seconds
        }) {
            pace.backoff = 0.0;
        }
        pace.write(db, &self.account)
    }
}

/// Whether the lane reads Following lists, so Brave leaves them to it.
pub(super) fn lane_reads_following(db: &Connection, now: f64) -> BrowserResult<bool> {
    Ok(!lane_accounts(db, now, "following")?.is_empty())
}

fn lane_accounts(db: &Connection, now: f64, key: &str) -> BrowserResult<Vec<String>> {
    if !lane_fresh(db, now)? {
        return Ok(Vec::new());
    }
    Ok(match stored_setting(db, LIGHTPANDA_LANE)?.get(key) {
        Some(Value::Array(accounts)) => accounts
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    })
}

/// What waits for the lane.
#[derive(Debug, Default, PartialEq)]
pub struct LanePending {
    pub digests: HashSet<String>,
    pub following: bool,
}

impl BrowserJobQueue {
    /// Say which accounts the lane serves: whose digests it reads, and which may read
    /// Following lists. Empty lists hand everything back to Brave at once.
    pub fn set_lightpanda_lane(
        &self,
        digests: &[String],
        following: &[String],
        sessions: usize,
    ) -> BrowserResult<()> {
        self.set_setting(
            LIGHTPANDA_LANE,
            json!({
                "heartbeat": self.host.time(),
                "digests": digests,
                "following": following,
                "sessions": sessions,
            }),
        )
    }

    /// Forget what a lane that is no longer running said and ran, before the worker
    /// recovers its queue at start: those jobs are Brave's recovery's again.
    pub fn reset_lightpanda_lane(&self) -> BrowserResult<()> {
        self.set_setting(LIGHTPANDA_LANE, Value::Null)?;
        self.set_setting(LANE_JOBS, json!([]))
    }

    /// Finish the lane's claim, recording its account's pace and hold with it.
    pub fn finish_lightpanda(
        &self,
        claim: &BrowserJob,
        outcome: Finish,
        read: &LaneRead,
    ) -> BrowserResult<()> {
        self.retry_storage(|| self.finish_once(claim, &outcome, Some(read)))
    }

    /// The account's Following pace and hold.
    pub fn lightpanda_pace(&self, account: &str) -> BrowserResult<AccountPace> {
        let now = self.host.time();
        self.retry_storage(|| AccountPace::read(&self.connect()?, account, now))
    }

    /// Claim the next job `account`'s Lightpanda session may run: its oldest digest
    /// (with `digests`), else the oldest Following read once the account's pace allows
    /// (with `following`). Never while the account is held; Brave's pause and holds are
    /// Brave's own and never stop it.
    pub fn claim_lightpanda(
        &self,
        account: &str,
        digests: bool,
        following: bool,
    ) -> BrowserResult<Option<BrowserJob>> {
        if self.is_storage_unavailable() || !(digests || following) {
            return Ok(None);
        }
        self.retry_storage(|| {
            let now = self.host.time();
            self.immediate(|db| {
                let mut pace = AccountPace::read(db, account, now)?;
                if now < pace.held_until {
                    return Ok(None);
                }
                expire_pending_digests(db, now)?;
                let mut row = None;
                if digests {
                    row = select_optional_job(
                        db,
                        &format!(
                            "SELECT * FROM jobs WHERE state='pending' AND kind='digest' \
                             AND account_username=? AND {AVAILABLE_ACCOUNT_SQL} \
                             ORDER BY created_at,id LIMIT 1"
                        ),
                        &[rusqlite::types::Value::Text(account.to_owned())],
                    )?;
                }
                if row.is_none()
                    && following
                    && !pyjson::truthy(&stored_setting(db, FOLLOWING_PAUSED)?)
                {
                    row = select_optional_job(
                        db,
                        &format!(
                            "SELECT * FROM jobs WHERE state='pending' AND kind='following' \
                             AND {KNOWN_LIST_SQL} ORDER BY created_at,id LIMIT 1"
                        ),
                        &[],
                    )?
                    .filter(|job| pace.may_read(job, now));
                }
                let Some(row) = row else {
                    return Ok(None);
                };
                if row.kind == "following" {
                    pace.reads.push(now);
                    pace.write(db, account)?;
                }
                let mut running = match stored_setting(db, LANE_JOBS)? {
                    Value::Array(running) => running,
                    _ => Vec::new(),
                };
                running.push(Value::from(row.id.clone()));
                write_setting(db, LANE_JOBS, &Value::Array(running))?;
                db.execute(
                    "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                    params![now, row.id],
                )
                .map_err(storage)?;
                Ok(Some(select_job(db, &row.id)?))
            })
        })
    }

    /// Each account's digests queued since `since`, the most first.
    pub fn digest_counts(&self, since: f64) -> BrowserResult<Vec<(String, i64)>> {
        self.retry_storage(|| {
            let db = self.connect()?;
            let mut statement = db
                .prepare(
                    "SELECT account_username,COUNT(*) AS digests FROM jobs \
                     WHERE kind='digest' AND created_at>=? \
                     GROUP BY account_username ORDER BY digests DESC,account_username",
                )
                .map_err(storage)?;
            statement
                .query_map([since], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)
        })
    }

    /// What waits for the lane, read without a write lock so an idle lane never
    /// takes one: the accounts with a digest waiting, and whether a Following read
    /// it may take waits.
    pub fn lightpanda_pending(&self) -> BrowserResult<LanePending> {
        self.retry_storage(|| {
            let db = self.connect()?;
            let mut statement = db
                .prepare(
                    "SELECT DISTINCT account_username FROM jobs \
                     WHERE state='pending' AND kind='digest'",
                )
                .map_err(storage)?;
            let digests = statement
                .query_map([], |row| row.get(0))
                .map_err(storage)?
                .collect::<Result<_, _>>()
                .map_err(storage)?;
            let following = db
                .query_row(
                    &format!(
                        "SELECT 1 FROM jobs WHERE state='pending' AND kind='following' \
                         AND {KNOWN_LIST_SQL} LIMIT 1"
                    ),
                    [],
                    |_| Ok(()),
                )
                .optional()
                .map_err(storage)?
                .is_some();
            Ok(LanePending { digests, following })
        })
    }

    /// How many Following reads may run at once: one per account the lane reads them
    /// with, up to `max_sessions`, or Brave's one.
    pub(super) fn following_readers(&self, now: f64) -> BrowserResult<usize> {
        let following = lane_accounts(&self.connect()?, now, "following")?;
        Ok(following.len().clamp(1, INSTAGRAM_LIGHTPANDA.max_sessions))
    }

    /// The lane as it last said, and each account it holds, for `status`.
    pub(super) fn lightpanda_status(&self, now: f64) -> BrowserResult<Value> {
        let db = self.connect()?;
        let lane = stored_setting(&db, LIGHTPANDA_LANE)?;
        let mut statement = db
            .prepare("SELECT key FROM settings WHERE key LIKE 'lightpanda_account:%' ORDER BY key")
            .map_err(storage)?;
        let keys: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        let mut held = serde_json::Map::new();
        for key in keys {
            let account = key.trim_start_matches("lightpanda_account:");
            let pace = AccountPace::read(&db, account, now)?;
            if pace.held_until > now {
                held.insert(account.to_owned(), json!(pace.held_until));
            }
        }
        Ok(json!({
            "running": lane_fresh(&db, now)?,
            "lane": lane,
            "held_until": held,
        }))
    }
}

#[cfg(test)]
#[path = "tests/browser_queue_lightpanda.rs"]
mod tests;
