//! The login ramp: the worker logs one more school account in to Lightpanda at most
//! every `ramp_interval_minutes`, within the daily login budget it shares with Brave
//! and `new_login_daily_limit` first logins a day.
//!
//! Accounts whose Lightpanda login Instagram ended go first (their device is known, so
//! they spend no first-login place), then the accounts with the most digests in the
//! last `ramp_lookback_days`, then `ramp_last_accounts` in their listed order. An
//! account paused for a person, excluded, or whose login could not be tried (no
//! Keychain password, no login form) is left out, the last for a day.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use super::Lightpanda;
use super::login::{self, LoginResult};
use crate::controlbox::INSTAGRAM_LIGHTPANDA as CONTROL;
use crate::instagram_notifications::browser_queue::BrowserJobQueue;
use crate::instagram_notifications::browser_session::{Bridge, validate_account_username};
use crate::pyjson;

const SKIPPED_FOR_SECONDS: f64 = 86_400.0;

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
    let result = login::log_in(lightpanda, queue, bridge, &candidate.account).await?;
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
