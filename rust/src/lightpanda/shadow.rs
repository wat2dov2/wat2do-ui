//! Shadow mode: replay the digests Brave resolved in each account's Lightpanda and
//! compare the media IDs, one account at a time, to check the sessions by hand.
//!
//! It reads the worker's jobs database read-only, sends only the digest query Brave
//! already sent, and records nothing in the worker's queue; only a login it is asked
//! to make spends the shared login budget. A 429 stops the whole run.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Context;
use indexmap::IndexMap;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use super::Lightpanda;
use super::digest;
use super::login::{self, LoginResult};
use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;
use crate::instagram_notifications::browser_digest::DigestResolution;
use crate::instagram_notifications::browser_queue::{BrowserJobQueue, default_state_directory};
use crate::instagram_notifications::browser_session::Bridge;
use crate::instagram_notifications::errors::{BrowserResult, SessionKind};

/// A digest Brave resolved, as its job recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct BraveDigest {
    pub job_id: String,
    pub account_username: String,
    pub recipient_id: String,
    pub cache_ent_id: String,
    pub media_ids: Vec<String>,
    pub page_count: i64,
    pub created_at: f64,
    /// From claim to finish: Brave's wall time for the job.
    pub seconds: Option<f64>,
}

/// The digests Brave resolved since `since` (Unix seconds), newest first, read from
/// the worker's `jobs.sqlite3` without writing to it. Jobs whose payload or result is
/// not the expected shape are left out.
pub fn recent_digests(database: &Path, since: f64) -> anyhow::Result<Vec<BraveDigest>> {
    let db = read_only(database)?;
    let mut statement = db.prepare(
        "SELECT id, account_username, recipient_id, payload, result, created_at, \
         started_at, finished_at FROM jobs WHERE kind='digest' AND state='succeeded' \
         AND created_at >= ?1 ORDER BY created_at DESC",
    )?;
    let rows = statement.query_map([since], |row| {
        let json = |index: usize| -> rusqlite::Result<Value> {
            let text: Option<String> = row.get(index)?;
            Ok(text
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or(Value::Null))
        };
        let started: Option<f64> = row.get(6)?;
        let finished: Option<f64> = row.get(7)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            json(3)?,
            json(4)?,
            row.get::<_, f64>(5)?,
            started
                .zip(finished)
                .map(|(started, finished)| finished - started),
        ))
    })?;
    let mut digests = Vec::new();
    for row in rows {
        let (job_id, account_username, recipient_id, payload, result, created_at, seconds) = row?;
        let (Some(cache_ent_id), Ok(resolution)) = (
            payload.get("cache_ent_id").and_then(Value::as_str),
            DigestResolution::from_value(&result),
        ) else {
            continue;
        };
        digests.push(BraveDigest {
            job_id,
            account_username,
            recipient_id,
            cache_ent_id: cache_ent_id.to_owned(),
            media_ids: resolution.media_ids,
            page_count: resolution.page_count,
            created_at,
            seconds,
        });
    }
    Ok(digests)
}

/// When the worker holds Instagram requests until after a 429 (Unix seconds).
fn rate_limit_hold(database: &Path) -> anyhow::Result<f64> {
    let held: Option<String> = read_only(database)?
        .query_row(
            "SELECT value FROM settings WHERE key='browser_rate_limit_until'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(held
        .and_then(|held| serde_json::from_str::<Value>(&held).ok())
        .and_then(|held| held.as_f64())
        .unwrap_or(0.0))
}

fn read_only(database: &Path) -> anyhow::Result<Connection> {
    Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("the worker database {} is unavailable", database.display()))
}

/// One replayed digest against Brave's result.
#[derive(Debug, Serialize, PartialEq)]
pub struct DigestComparison {
    pub job_id: String,
    pub age_hours: f64,
    pub brave_media: usize,
    pub brave_pages: i64,
    pub brave_seconds: Option<f64>,
    pub lightpanda_media: Option<usize>,
    pub lightpanda_pages: Option<i64>,
    pub lightpanda_seconds: f64,
    /// In Brave's result but not Lightpanda's.
    pub missing: Vec<String>,
    /// In Lightpanda's result but not Brave's.
    pub extra: Vec<String>,
    pub same_order: bool,
    pub error: Option<String>,
}

impl DigestComparison {
    fn matched(&self) -> bool {
        self.error.is_none() && self.missing.is_empty() && self.extra.is_empty()
    }
}

#[derive(Debug, Serialize, Default)]
pub struct AccountReport {
    pub account: String,
    /// How the account came to be logged in, or why it was not compared.
    pub login: String,
    pub compared: usize,
    pub matched: usize,
    /// Launching Lightpanda and loading Instagram.
    pub startup_seconds: Option<f64>,
    pub peak_rss_mb: Option<f64>,
    pub digests: Vec<DigestComparison>,
    /// Lightpanda did not shut down cleanly, so its cookies may not have been saved.
    pub close_error: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct ShadowReport {
    pub lightpanda_version: String,
    pub started_at: f64,
    pub accounts: Vec<AccountReport>,
    /// Why the run ended early, if it did.
    pub stopped: Option<String>,
}

/// How shadow mode may log accounts in: the worker's queue (the shared budget, the
/// ramp and the pauses) and the Mac's Keychain and Gmail.
pub type Login<'a> = (&'a BrowserJobQueue, Arc<Bridge>);

/// Compare `accounts` (empty: every account with Brave digests from the last
/// `lookback_hours` whose jar holds a login) against the worker's database at
/// `database`. With `login`, an account whose jar holds no login is logged in first,
/// within the budget and ramp.
pub async fn run(
    lightpanda: &Lightpanda,
    database: &Path,
    accounts: &[String],
    lookback_hours: f64,
    login: Option<Login<'_>>,
    now: &dyn Fn() -> f64,
) -> anyhow::Result<ShadowReport> {
    let started_at = now();
    let mut report = ShadowReport {
        lightpanda_version: CONTROL.version.clone(),
        started_at,
        ..ShadowReport::default()
    };
    if started_at < rate_limit_hold(database)? {
        report.stopped = Some("the worker is holding Instagram requests after a 429".into());
        return Ok(report);
    }
    let since = started_at - lookback_hours * 3_600.0;
    let by_account = by_account(recent_digests(database, since)?);
    let accounts: Vec<String> = if accounts.is_empty() {
        by_account
            .keys()
            .filter(|account| lightpanda.jar(account).is_ok_and(|jar| jar.holds_session()))
            .cloned()
            .collect()
    } else {
        accounts.to_vec()
    };
    for (index, account) in accounts.iter().enumerate() {
        if index > 0 {
            tokio::time::sleep(Duration::from_secs_f64(
                CONTROL.shadow_account_pause_seconds,
            ))
            .await;
        }
        let jobs = by_account
            .get(account)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (account_report, stop) = compare_account(
            lightpanda,
            login.clone(),
            account,
            jobs,
            lookback_hours,
            now,
        )
        .await?;
        report.accounts.push(account_report);
        if stop.is_some() {
            report.stopped = stop;
            break;
        }
    }
    Ok(report)
}

/// Keep `report` beside the jars, named by when it ran.
pub fn save(report: &ShadowReport) -> anyhow::Result<PathBuf> {
    let directory = default_state_directory().join("lightpanda/shadow");
    std::fs::create_dir_all(&directory)?;
    let started = chrono::DateTime::from_timestamp(report.started_at as i64, 0).unwrap_or_default();
    let path = directory.join(format!("{}.json", started.format("%Y%m%dT%H%M%SZ")));
    std::fs::write(&path, serde_json::to_string_pretty(report)?)?;
    Ok(path)
}

/// One paragraph per account for the terminal.
pub fn summary(report: &ShadowReport) -> String {
    let mut out = String::new();
    for account in &report.accounts {
        out.push_str(&format!("{}: {}\n", account.account, account.login));
        if account.compared == 0 {
            continue;
        }
        let lightpanda: Vec<f64> = account
            .digests
            .iter()
            .map(|digest| digest.lightpanda_seconds)
            .collect();
        let brave: Vec<f64> = account
            .digests
            .iter()
            .filter_map(|digest| digest.brave_seconds)
            .collect();
        out.push_str(&format!(
            "  {}/{} digests match; startup {:.1} s; digest {:.1} s on average (Brave {:.1} s); peak {:.0} MB\n",
            account.matched,
            account.compared,
            account.startup_seconds.unwrap_or_default(),
            average(&lightpanda),
            average(&brave),
            account.peak_rss_mb.unwrap_or_default(),
        ));
        for digest in &account.digests {
            out.push_str(&format!(
                "  job {}: Brave {} items in {} pages, Lightpanda {} in {}{}{}{}\n",
                digest.job_id,
                digest.brave_media,
                digest.brave_pages,
                digest
                    .lightpanda_media
                    .map_or("-".into(), |count| count.to_string()),
                digest
                    .lightpanda_pages
                    .map_or("-".into(), |count| count.to_string()),
                if digest.missing.is_empty() {
                    String::new()
                } else {
                    format!(", missing {}", digest.missing.len())
                },
                if digest.extra.is_empty() {
                    String::new()
                } else {
                    format!(", extra {}", digest.extra.len())
                },
                digest
                    .error
                    .as_ref()
                    .map_or(String::new(), |error| format!(", failed: {error}")),
            ));
        }
    }
    if let Some(stopped) = &report.stopped {
        out.push_str(&format!("Stopped early: {stopped}\n"));
    }
    out
}

fn average(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / values.len() as f64
}

/// Each account's newest `shadow_jobs_per_account` digests, accounts by their newest.
fn by_account(digests: Vec<BraveDigest>) -> IndexMap<String, Vec<BraveDigest>> {
    let mut accounts: IndexMap<String, Vec<BraveDigest>> = IndexMap::new();
    for digest in digests {
        let jobs = accounts.entry(digest.account_username.clone()).or_default();
        if jobs.len() < CONTROL.shadow_jobs_per_account {
            jobs.push(digest);
        }
    }
    accounts
}

/// Replay one account's digests; the second value stops the whole run.
async fn compare_account(
    lightpanda: &Lightpanda,
    login: Option<Login<'_>>,
    account: &str,
    jobs: &[BraveDigest],
    lookback_hours: f64,
    now: &dyn Fn() -> f64,
) -> anyhow::Result<(AccountReport, Option<String>)> {
    let mut report = AccountReport {
        account: account.to_owned(),
        ..AccountReport::default()
    };
    if jobs.is_empty() {
        report.login = format!(
            "not compared: Brave resolved no digests for it in the last {lookback_hours} h"
        );
        return Ok((report, None));
    }
    let login = if lightpanda.jar(account)?.holds_session() {
        Ok("already logged in".to_owned())
    } else if let Some((queue, bridge)) = login {
        match login::log_in(lightpanda, queue, bridge, account, 0).await? {
            LoginResult::AlreadyLoggedIn => Ok("already logged in".to_owned()),
            LoginResult::LoggedIn { new_device } => Ok(format!(
                "logged in by the worker (new device: {new_device})"
            )),
            LoginResult::Skipped(reason) => Err(format!("not compared: login skipped, {reason}")),
            LoginResult::Paused(reason) => {
                Err(format!("not compared: paused for a person, {reason}"))
            }
        }
    } else {
        Err("not compared: not logged in to Lightpanda".to_owned())
    };
    match login {
        Ok(login) => report.login = login,
        Err(login) => {
            report.login = login;
            return Ok((report, None));
        }
    }
    let started = Instant::now();
    let mut browser = lightpanda.open(account).await?;
    report.startup_seconds = Some(started.elapsed().as_secs_f64());
    let mut stop = None;
    if !browser.has_session().await? {
        report.login = "not compared: Instagram logged the Lightpanda session out".into();
    } else {
        for (index, job) in jobs.iter().enumerate() {
            if index > 0 {
                tokio::time::sleep(Duration::from_secs_f64(CONTROL.shadow_digest_pause_seconds))
                    .await;
            }
            let started = Instant::now();
            let resolved =
                digest::resolve(&mut browser, &job.recipient_id, account, &job.cache_ent_id).await;
            let seconds = started.elapsed().as_secs_f64();
            let rate_limited = resolved
                .as_ref()
                .is_err_and(|error| error.is(SessionKind::RateLimited));
            let failed = resolved.is_err();
            report.digests.push(compare(job, resolved, seconds, now()));
            report.peak_rss_mb = Some(browser.peak_rss_kib() as f64 / 1024.0);
            if rate_limited {
                stop = Some(format!("Instagram answered 429 for {account}"));
                break;
            }
            if failed && !browser.has_session().await? {
                report.login = "Instagram logged the Lightpanda session out".into();
                break;
            }
        }
    }
    report.peak_rss_mb = Some(browser.peak_rss_kib() as f64 / 1024.0);
    report.close_error = browser
        .close()
        .await
        .err()
        .map(|error| format!("{error:#}"));
    report.compared = report.digests.len();
    report.matched = report
        .digests
        .iter()
        .filter(|digest| digest.matched())
        .count();
    Ok((report, stop))
}

/// Lightpanda's media IDs for `job` against Brave's.
fn compare(
    job: &BraveDigest,
    resolved: BrowserResult<DigestResolution>,
    seconds: f64,
    now: f64,
) -> DigestComparison {
    let mut comparison = DigestComparison {
        job_id: job.job_id.clone(),
        age_hours: ((now - job.created_at) / 3_600.0 * 10.0).round() / 10.0,
        brave_media: job.media_ids.len(),
        brave_pages: job.page_count,
        brave_seconds: job.seconds,
        lightpanda_media: None,
        lightpanda_pages: None,
        lightpanda_seconds: (seconds * 100.0).round() / 100.0,
        missing: Vec::new(),
        extra: Vec::new(),
        same_order: false,
        error: None,
    };
    match resolved {
        Ok(DigestResolution {
            media_ids,
            page_count,
            ..
        }) => {
            let brave: HashSet<&String> = job.media_ids.iter().collect();
            let found: HashSet<&String> = media_ids.iter().collect();
            comparison.missing = job
                .media_ids
                .iter()
                .filter(|id| !found.contains(id))
                .cloned()
                .collect();
            comparison.extra = media_ids
                .iter()
                .filter(|id| !brave.contains(id))
                .cloned()
                .collect();
            comparison.same_order = media_ids == job.media_ids;
            comparison.lightpanda_media = Some(media_ids.len());
            comparison.lightpanda_pages = Some(page_count);
        }
        Err(failure) => comparison.error = Some(failure.to_string()),
    }
    comparison
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instagram_notifications::errors::BrowserError;
    use crate::instagram_notifications::test_support::{FakeHost, queue};

    fn job(id: &str, account: &str, media: &[&str]) -> BraveDigest {
        BraveDigest {
            job_id: id.into(),
            account_username: account.into(),
            recipient_id: "41553815702".into(),
            cache_ent_id: format!("cache-{id}"),
            media_ids: media.iter().map(|id| id.to_string()).collect(),
            page_count: 2,
            created_at: 0.0,
            seconds: Some(9.5),
        }
    }

    fn found(values: &[&str], page_count: i64) -> BrowserResult<DigestResolution> {
        Ok(DigestResolution {
            account_username: "wat2do.mun".into(),
            media_ids: values.iter().map(|id| id.to_string()).collect(),
            page_count,
        })
    }

    #[test]
    fn identical_results_match_in_order() {
        let comparison = compare(
            &job("a", "wat2do.mun", &["1", "2"]),
            found(&["1", "2"], 2),
            1.234,
            7_200.0,
        );
        assert!(comparison.matched());
        assert!(comparison.same_order);
        assert_eq!(comparison.age_hours, 2.0);
        assert_eq!(comparison.lightpanda_seconds, 1.23);
        assert_eq!(comparison.lightpanda_pages, Some(2));
    }

    #[test]
    fn missing_and_extra_items_are_listed_and_order_is_reported() {
        let comparison = compare(
            &job("a", "wat2do.mun", &["1", "2", "3"]),
            found(&["3", "1", "4"], 1),
            1.0,
            0.0,
        );
        assert!(!comparison.matched());
        assert_eq!(comparison.missing, ["2"]);
        assert_eq!(comparison.extra, ["4"]);
        assert!(!comparison.same_order);
        let reordered = compare(
            &job("b", "wat2do.mun", &["1", "2"]),
            found(&["2", "1"], 1),
            1.0,
            0.0,
        );
        assert!(reordered.matched());
        assert!(!reordered.same_order);
    }

    #[test]
    fn a_failed_replay_never_matches() {
        let comparison = compare(
            &job("a", "wat2do.mun", &[]),
            Err(BrowserError::rate_limited(
                "Instagram digest is rate limited (HTTP 429)",
            )),
            1.0,
            0.0,
        );
        assert!(!comparison.matched());
        assert_eq!(
            comparison.error.as_deref(),
            Some("Instagram digest is rate limited (HTTP 429)")
        );
        assert_eq!(comparison.lightpanda_media, None);
    }

    #[test]
    fn accounts_keep_their_newest_digests_up_to_the_limit() {
        let per_account = CONTROL.shadow_jobs_per_account;
        let mut digests = Vec::new();
        for index in 0..per_account + 2 {
            digests.push(job(&format!("ubc-{index}"), "wat2do.ubc", &[]));
        }
        digests.insert(1, job("mun-0", "wat2do.mun", &[]));
        let grouped = by_account(digests);
        assert_eq!(
            grouped.keys().collect::<Vec<_>>(),
            ["wat2do.ubc", "wat2do.mun"]
        );
        assert_eq!(grouped["wat2do.ubc"].len(), per_account);
        assert_eq!(grouped["wat2do.ubc"][0].job_id, "ubc-0");
        assert_eq!(grouped["wat2do.mun"].len(), 1);
    }

    #[test]
    fn brave_digests_and_its_rate_limit_hold_are_read_without_writing() {
        let state = tempfile::tempdir().unwrap();
        let worker = queue(state.path(), &FakeHost::idle());
        let result =
            r#"{"account_username": "wat2do.mun", "media_ids": ["111", "222"], "page_count": 1}"#;
        {
            let db = Connection::open(&worker.database_path).unwrap();
            for (id, kind, state, payload, result, created) in [
                (
                    "old",
                    "digest",
                    "succeeded",
                    r#"{"cache_ent_id": "c0"}"#,
                    Some(result),
                    100.0,
                ),
                (
                    "a",
                    "digest",
                    "succeeded",
                    r#"{"cache_ent_id": "c1"}"#,
                    Some(result),
                    1_000.0,
                ),
                (
                    "b",
                    "digest",
                    "succeeded",
                    r#"{"cache_ent_id": "c2"}"#,
                    Some(result),
                    2_000.0,
                ),
                (
                    "failed",
                    "digest",
                    "failed",
                    r#"{"cache_ent_id": "c3"}"#,
                    None,
                    3_000.0,
                ),
                (
                    "other",
                    "engagement",
                    "succeeded",
                    r#"{"cache_ent_id": "c4"}"#,
                    Some(result),
                    3_000.0,
                ),
                ("odd", "digest", "succeeded", "{}", Some(result), 3_000.0),
            ] {
                db.execute(
                    "INSERT INTO jobs (id, dedupe_key, kind, school, recipient_id, \
                     account_username, payload, state, created_at, started_at, finished_at, \
                     result) VALUES (?1, ?1, ?2, 'mun', '41553815702', 'wat2do.mun', ?3, ?4, \
                     ?5, ?5 + 1, ?5 + 4.5, ?6)",
                    (id, kind, payload, state, created, result),
                )
                .unwrap();
            }
        }
        let digests = recent_digests(&worker.database_path, 500.0).unwrap();
        let ids: Vec<_> = digests
            .iter()
            .map(|digest| digest.job_id.as_str())
            .collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(digests[0].cache_ent_id, "c2");
        assert_eq!(digests[0].media_ids, ["111", "222"]);
        assert_eq!(digests[0].recipient_id, "41553815702");
        assert_eq!(digests[0].seconds, Some(3.5));
        assert_eq!(rate_limit_hold(&worker.database_path).unwrap(), 0.0);
        worker
            .set_setting(
                "browser_rate_limit_until",
                serde_json::json!(1_800_000_120.5),
            )
            .unwrap();
        assert_eq!(
            rate_limit_hold(&worker.database_path).unwrap(),
            1_800_000_120.5
        );
        // A missing database is reported, never created.
        let missing = state.path().join("missing.sqlite3");
        assert!(recent_digests(&missing, 0.0).is_err());
        assert!(!missing.exists());
    }
}
