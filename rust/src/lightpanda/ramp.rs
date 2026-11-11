//! The login ramp: the worker logs one more school account in to Lightpanda at most
//! every `ramp_interval_minutes`, within the daily login budget it shares with Brave
//! and `new_login_daily_limit` first logins a day.
//!
//! It never spends the day's last `ramp_reserved_logins` logins, which Brave's own
//! relogins need, and its next turn is kept in the queue, so a restart never brings it
//! forward.
//!
//! Accounts whose Lightpanda login Instagram ended go first (their device is known, so
//! they spend no first-login place), then the accounts with the most digests in the
//! last `ramp_lookback_days`, then `ramp_last_accounts` in their listed order. An
//! account paused for a person, excluded, or whose login could not be tried (no
//! Keychain password, no login form) is left out, the last for a day.

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Value, json};

use super::Lightpanda;
use super::login::{self, LoginResult};
use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;
use crate::instagram_notifications::browser_queue::BrowserJobQueue;
use crate::instagram_notifications::browser_session::{Bridge, validate_account_username};
use crate::pyjson;

const SKIPPED_FOR_SECONDS: f64 = 86_400.0;
/// When the ramp may next log an account in, kept in the worker's settings so a
/// restart never brings it forward.
const NEXT_AT: &str = "lightpanda_ramp_at";
/// The first ramp waits this long after the lane first runs.
const FIRST_DELAY_SECONDS: f64 = 300.0;

/// Whether the ramp is due at `now`; when it is, the next one is scheduled
/// `ramp_interval_minutes` on, so each due ramp is taken once.
pub fn take_turn(queue: &BrowserJobQueue, now: f64) -> anyhow::Result<bool> {
    let Some(next_at) = pyjson::number(&queue.setting_or(NEXT_AT, Value::Null)?) else {
        queue.set_setting(NEXT_AT, json!(now + FIRST_DELAY_SECONDS))?;
        return Ok(false);
    };
    if now < next_at {
        return Ok(false);
    }
    queue.set_setting(NEXT_AT, json!(now + CONTROL.ramp_interval_minutes * 60.0))?;
    Ok(true)
}

fn skipped_key(account: &str) -> String {
    format!("lightpanda_ramp_skipped:{account}")
}

/// One account the ramp would log in, in order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Candidate {
    pub account: String,
    /// Its digests in the lookback window.
    pub digests: i64,
    /// It had a Lightpanda login before, so it is not a new device.
    pub relogin: bool,
}

/// Every account the ramp would log in, in order.
pub fn plan(
    queue: &BrowserJobQueue,
    lightpanda: &Lightpanda,
    now: f64,
) -> anyhow::Result<Vec<Candidate>> {
    let since = now - CONTROL.ramp_lookback_days * 86_400.0;
    let mut candidates = Vec::new();
    for (account, digests) in queue.digest_counts(since)? {
        if validate_account_username(&account).as_deref() != Ok(account.as_str()) {
            continue;
        }
        let jar = lightpanda.jar(&account)?;
        let skipped = pyjson::number(&queue.setting_or(&skipped_key(&account), json!(0))?)
            .is_some_and(|at| now - at < SKIPPED_FOR_SECONDS);
        if jar.holds_session()
            || skipped
            || login::paused(queue, &account)?.is_some()
            || queue.account_excluded(&account)?
        {
            continue;
        }
        candidates.push(Candidate {
            account,
            digests,
            relogin: !jar.is_new_device(),
        });
    }
    Ok(order(candidates))
}

/// Relogins first, then the most digests, then `ramp_last_accounts` in their order.
fn order(mut candidates: Vec<Candidate>) -> Vec<Candidate> {
    let last = |candidate: &Candidate| {
        CONTROL
            .ramp_last_accounts
            .iter()
            .position(|account| *account == candidate.account)
    };
    candidates.sort_by(|a, b| {
        (last(a), !a.relogin, -a.digests, &a.account).cmp(&(
            last(b),
            !b.relogin,
            -b.digests,
            &b.account,
        ))
    });
    candidates
}

/// The first planned account today's budget lets log in: the shared daily logins, and
/// for a new device a first-login place.
pub fn next(
    queue: &BrowserJobQueue,
    lightpanda: &Lightpanda,
    now: f64,
) -> anyhow::Result<Option<Candidate>> {
    if queue.account_logins_left(now)? <= CONTROL.ramp_reserved_logins {
        return Ok(None);
    }
    let ramp_full = login::ramp_full(queue, now)?;
    for candidate in plan(queue, lightpanda, now)? {
        if (candidate.relogin || !ramp_full)
            && queue.account_login_allowed(&candidate.account, now)?
        {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

/// Log the next account in, if any may; its name and how the login went.
pub async fn step(
    lightpanda: &Lightpanda,
    queue: &BrowserJobQueue,
    bridge: Arc<Bridge>,
) -> anyhow::Result<Option<(String, LoginResult)>> {
    let now = bridge.time();
    let Some(candidate) = next(queue, lightpanda, now)? else {
        return Ok(None);
    };
    let result = login::log_in(
        lightpanda,
        queue,
        bridge,
        &candidate.account,
        CONTROL.ramp_reserved_logins,
    )
    .await?;
    if matches!(result, LoginResult::Skipped(_)) {
        queue.set_setting(&skipped_key(&candidate.account), json!(now))?;
    }
    Ok(Some((candidate.account, result)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(account: &str, digests: i64, relogin: bool) -> Candidate {
        Candidate {
            account: account.to_owned(),
            digests,
            relogin,
        }
    }

    #[test]
    fn a_turn_comes_once_per_interval_and_survives_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let host = crate::instagram_notifications::test_support::FakeHost::idle();
        let queue = crate::instagram_notifications::test_support::queue(directory.path(), &host);
        let now = 1_800_000_000.0;
        assert!(!take_turn(&queue, now).unwrap());
        // A restart a minute later does not bring the first turn forward.
        assert!(!take_turn(&queue, now + 60.0).unwrap());
        assert!(take_turn(&queue, now + FIRST_DELAY_SECONDS).unwrap());
        assert!(!take_turn(&queue, now + FIRST_DELAY_SECONDS + 1.0).unwrap());
        let interval = CONTROL.ramp_interval_minutes * 60.0;
        assert!(take_turn(&queue, now + FIRST_DELAY_SECONDS + interval).unwrap());
    }

    #[test]
    fn relogins_then_the_busiest_accounts_then_the_last_ones() {
        let ordered = order(vec![
            candidate("wat2do.utm", 90, false),
            candidate("wat2do.ubc", 10, false),
            candidate("wat2do.guelph", 50, true),
            candidate("wat2do.mcgill", 40, false),
            candidate("wat2do.udem", 40, false),
            candidate("wat2do.ualberta", 1, true),
        ]);
        let accounts: Vec<&str> = ordered.iter().map(|c| c.account.as_str()).collect();
        assert_eq!(
            accounts,
            [
                "wat2do.ualberta",
                "wat2do.mcgill",
                "wat2do.udem",
                "wat2do.ubc",
                "wat2do.guelph",
                "wat2do.utm"
            ]
        );
    }
}
