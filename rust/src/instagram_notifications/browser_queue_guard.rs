//! The account guard: how much each school account may read Following lists, and its
//! breaker (`controlbox/instagram_account_guard.json`, read live).
//!
//! 2026-11-26: wat2do.sfu (21 followers) got Instagram's "Confirm you're human"
//! checkpoint after the follow crawl read hundreds of Following pages an hour with it
//! and kept asking every half hour through thousands of refusals; the crawl then moved
//! on to whichever account was left (Brave read 400 pages in 34 minutes as wat2do.udem).
//! So every account that reads Following lists, in its Lightpanda session or as the
//! account Brave shows, is guarded on its own, and the state lives in the queue
//! (`account_guard:<account>`), so a restart never forgets it:
//! - a refusal (an HTTP 429, a refused read, a page in place of the list's JSON) holds
//!   the account's Following reads for hours, each refusal in a row longer;
//! - each account reads at most a day's and an hour's share, smaller for accounts with
//!   few followers and for new accounts (follower counts in `account_guard_sizes`,
//!   refreshed from the daily stats runs by the worker);
//! - a login wall, an ended login, a security check or `breaker_refusal_streak`
//!   refusals in a row open the account's breaker: no automated traffic at all for it
//!   (no Following read, digest, like, Lightpanda session or login) until a person
//!   checks the account and resets it (`wat2do-browser account-guard --reset`, or
//!   `resume-account`).

use rusqlite::Connection;
use serde_json::{Map, Value, json};

use super::{BrowserJobQueue, storage, stored_setting, write_setting};
use crate::controlbox::{InstagramAccountGuard, instagram_account_guard};
use crate::instagram_notifications::browser_following::{
    FOLLOWING_HTTP_429, FOLLOWING_INVALID_JSON, FOLLOWING_LOGIN_WALL, FOLLOWING_REFUSED,
};
use crate::instagram_notifications::errors::BrowserResult;
use crate::pyjson;

const KEY_PREFIX: &str = "account_guard:";
/// Each account's followers and when it was first seen, from the stats runs.
pub(super) const SIZES: &str = "account_guard_sizes";
/// When the worker last tried to read the follower counts, and how long it waits
/// before trying again after a failure.
const SIZES_TRIED: &str = "account_guard_sizes_tried_at";
const SIZES_RETRY_SECONDS: f64 = 1_800.0;
/// The account Brave last read a Following list as, so its next read is guarded.
pub(super) const BRAVE_READER: &str = "following_reader";
const DAY: f64 = 86_400.0;
const HOUR: f64 = 3_600.0;

fn key(account: &str) -> String {
    format!("{KEY_PREFIX}{account}")
}

/// How a guarded account's request went.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// Instagram answered it.
    Read,
    /// Instagram refused it.
    Refused(String),
    /// Instagram wants a person: a login wall, an ended login or a security check.
    Checkpoint(String),
}

impl Outcome {
    /// What a failed request's error says about the account, if anything: only
    /// Instagram's own refusals count, never a read that did not reach it.
    pub fn of_failure(message: &str, logged_out: bool) -> Option<Self> {
        if logged_out {
            return Some(Self::Checkpoint("Instagram ended the login".to_owned()));
        }
        if message.contains(FOLLOWING_LOGIN_WALL) {
            return Some(Self::Checkpoint(FOLLOWING_LOGIN_WALL.to_owned()));
        }
        [
            FOLLOWING_HTTP_429,
            FOLLOWING_REFUSED,
            FOLLOWING_INVALID_JSON,
        ]
        .into_iter()
        .find(|refusal| message.contains(refusal))
        .map(|refusal| Self::Refused(refusal.to_owned()))
    }
}

/// Whether an account may read a Following list now.
#[derive(Debug, Clone, PartialEq)]
pub enum Gate {
    Open,
    /// Too soon after its last read for its hourly share.
    Paced,
    /// Its day's share is spent until then.
    Capped(f64),
    /// Held after a refusal until then.
    Held(f64),
    /// Its breaker is open, for this reason.
    Tripped(String),
}

impl Gate {
    /// Whether the account counts as a Following reader at all now (pacing aside).
    pub fn reads(&self) -> bool {
        matches!(self, Self::Open | Self::Paced)
    }
}

/// One account's followers and when it was first seen.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Size {
    pub followers: u64,
    pub first_seen: f64,
}

/// One account's guard, as kept in the queue.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Guard {
    /// Refusals in a row.
    pub refusals: u32,
    pub held_until: f64,
    pub last_refusal_at: f64,
    /// When each refusal of the last day came, and the last one's reason.
    pub refusal_times: Vec<f64>,
    pub reason: Option<String>,
    pub last_read_at: f64,
    /// The current day's window and its reads.
    pub day_start: f64,
    pub day_reads: u32,
    pub tripped_at: Option<f64>,
    pub tripped_reason: Option<String>,
}

impl Guard {
    fn from_value(value: &Value) -> Self {
        let number = |key: &str| value.get(key).and_then(pyjson::number).unwrap_or(0.0);
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
        Self {
            refusals: number("refusals") as u32,
            held_until: number("held_until"),
            last_refusal_at: number("last_refusal_at"),
            refusal_times: match value.get("refusal_times") {
                Some(Value::Array(times)) => times.iter().filter_map(pyjson::number).collect(),
                _ => Vec::new(),
            },
            reason: text("reason"),
            last_read_at: number("last_read_at"),
            day_start: number("day_start"),
            day_reads: number("day_reads") as u32,
            tripped_at: value.get("tripped_at").and_then(pyjson::number),
            tripped_reason: text("tripped_reason"),
        }
    }

    pub fn to_value(&self) -> Value {
        json!({
            "refusals": self.refusals,
            "held_until": self.held_until,
            "last_refusal_at": self.last_refusal_at,
            "refusal_times": self.refusal_times,
            "reason": self.reason,
            "last_read_at": self.last_read_at,
            "day_start": self.day_start,
            "day_reads": self.day_reads,
            "tripped_at": self.tripped_at,
            "tripped_reason": self.tripped_reason,
        })
    }

    pub(super) fn read(db: &Connection, account: &str) -> BrowserResult<Self> {
        Ok(Self::from_value(&stored_setting(db, &key(account))?))
    }

    pub(super) fn write(&self, db: &Connection, account: &str) -> BrowserResult<()> {
        write_setting(db, &key(account), &self.to_value())
    }

    /// Whether the account may read a Following list at `now`, with its day's and
    /// hour's share (`allowance`).
    pub fn gate(&self, (daily, hourly): (f64, f64), now: f64) -> Gate {
        if let Some(reason) = self.tripped() {
            return Gate::Tripped(reason);
        }
        if now < self.held_until {
            return Gate::Held(self.held_until);
        }
        if self.day_start + DAY > now && f64::from(self.day_reads) >= daily {
            return Gate::Capped(self.day_start + DAY);
        }
        if now < self.last_read_at + HOUR / hourly {
            return Gate::Paced;
        }
        Gate::Open
    }

    /// Why the account's breaker is open, if it is.
    pub fn tripped(&self) -> Option<String> {
        self.tripped_at
            .map(|_| self.tripped_reason.clone().unwrap_or_default())
    }

    /// Count a Following read claimed at `now`.
    pub fn count_read(&mut self, now: f64) {
        if now >= self.day_start + DAY {
            self.day_start = now;
            self.day_reads = 0;
        }
        self.day_reads += 1;
        self.last_read_at = now;
    }

    /// Take a request's outcome in; true when it opened the breaker.
    pub fn record(&mut self, control: &InstagramAccountGuard, outcome: &Outcome, now: f64) -> bool {
        self.refusal_times.retain(|at| now - at < DAY);
        match outcome {
            Outcome::Read => {
                if now - self.last_refusal_at >= control.refusal_streak_reset_hours * HOUR {
                    self.refusals = 0;
                }
                false
            }
            Outcome::Refused(reason) => {
                self.refusals += 1;
                self.last_refusal_at = now;
                self.refusal_times.push(now);
                self.reason = Some(reason.clone());
                let hours = (control.refusal_hold_hours
                    * control
                        .refusal_backoff_factor
                        .powi(self.refusals.saturating_sub(1) as i32))
                .min(control.refusal_max_hold_hours);
                self.held_until = self.held_until.max(now + hours * HOUR);
                self.refusals >= control.breaker_refusal_streak
                    && self.trip(
                        &format!("{} refusals in a row ({reason})", self.refusals),
                        now,
                    )
            }
            Outcome::Checkpoint(reason) => {
                self.last_refusal_at = now;
                self.refusal_times.push(now);
                self.reason = Some(reason.clone());
                self.trip(reason, now)
            }
        }
    }

    /// Open the breaker; true when it was closed.
    pub fn trip(&mut self, reason: &str, now: f64) -> bool {
        if self.tripped_at.is_some() {
            return false;
        }
        self.tripped_at = Some(now);
        self.tripped_reason = Some(reason.to_owned());
        true
    }
}

/// An account's Following reads a day and an hour: a named override, else the large,
/// established account's share scaled down for few followers and a new account.
pub fn allowance(
    control: &InstagramAccountGuard,
    account: &str,
    size: Option<Size>,
    now: f64,
) -> (f64, f64) {
    let factor = scale(control, size, now);
    let daily = control
        .account_daily_following_reads
        .get(account)
        .copied()
        .unwrap_or(
            (control.daily_following_reads * factor).max(control.minimum_daily_following_reads),
        );
    (daily, (control.hourly_following_reads * factor).max(1.0))
}

/// How much of a large, established account's share an account gets. An account
/// whose size is unknown counts as the smallest and newest.
fn scale(control: &InstagramAccountGuard, size: Option<Size>, now: f64) -> f64 {
    let smallest = control
        .follower_tiers
        .iter()
        .map(|tier| tier.factor)
        .fold(1.0, f64::min);
    let Some(size) = size else {
        return smallest * control.new_account_factor;
    };
    let tier = control
        .follower_tiers
        .iter()
        .find(|tier| size.followers < tier.below)
        .map_or(1.0, |tier| tier.factor);
    let new = now - size.first_seen < control.new_account_days * DAY;
    tier * if new { control.new_account_factor } else { 1.0 }
}

pub(super) fn size(db: &Connection, account: &str) -> BrowserResult<Option<Size>> {
    let sizes = stored_setting(db, SIZES)?;
    Ok(sizes
        .get("accounts")
        .and_then(|accounts| accounts.get(account))
        .and_then(|size| {
            Some(Size {
                followers: size.get("followers").and_then(Value::as_u64)?,
                first_seen: size.get("first_seen").and_then(pyjson::number)?,
            })
        }))
}

/// Whether `account` may read a Following list at `now`.
pub(super) fn gate(db: &Connection, account: &str, now: f64) -> BrowserResult<Gate> {
    let control = instagram_account_guard();
    let allowance = allowance(&control, account, size(db, account)?, now);
    Ok(Guard::read(db, account)?.gate(allowance, now))
}

/// Count a Following read `account` was given at `now`.
pub(super) fn count_read(db: &Connection, account: &str, now: f64) -> BrowserResult<()> {
    let mut guard = Guard::read(db, account)?;
    guard.count_read(now);
    guard.write(db, account)
}

/// Take a request's outcome in for `account`.
pub(super) fn record(
    db: &Connection,
    account: &str,
    outcome: &Outcome,
    now: f64,
) -> BrowserResult<()> {
    let mut guard = Guard::read(db, account)?;
    if guard.record(&instagram_account_guard(), outcome, now) {
        tracing::error!(
            "{account}'s breaker opened: no automated Instagram traffic for it until a person checks \
             it and runs `wat2do-browser account-guard --account {account} --reset` ({})",
            guard.tripped_reason.as_deref().unwrap_or_default()
        );
    }
    guard.write(db, account)
}

/// Whether `account`'s breaker is open.
pub(super) fn tripped(db: &Connection, account: &str) -> BrowserResult<bool> {
    Ok(Guard::read(db, account)?.tripped_at.is_some())
}

impl BrowserJobQueue {
    /// Why `account`'s breaker is open, if it is.
    pub fn guard_tripped(&self, account: &str) -> BrowserResult<Option<String>> {
        self.retry_storage(|| Ok(Guard::read(&self.connect()?, account)?.tripped()))
    }

    /// Whether `account` may read a Following list now.
    pub fn following_gate(&self, account: &str) -> BrowserResult<Gate> {
        let now = self.host.time();
        self.retry_storage(|| gate(&self.connect()?, account, now))
    }

    /// Open `account`'s breaker for `reason` (a person, or a login that hit a security
    /// check).
    pub fn trip_guard(&self, account: &str, reason: &str) -> BrowserResult<()> {
        let now = self.host.time();
        self.retry_storage(|| {
            self.immediate(|db| record(db, account, &Outcome::Checkpoint(reason.to_owned()), now))
        })
    }

    /// A person checked `account`: close its breaker and forget its refusals and holds.
    /// The day's reads still count.
    pub fn reset_guard(&self, account: &str) -> BrowserResult<()> {
        self.retry_storage(|| {
            self.immediate(|db| {
                let guard = Guard::read(db, account)?;
                Guard {
                    day_start: guard.day_start,
                    day_reads: guard.day_reads,
                    last_read_at: guard.last_read_at,
                    ..Guard::default()
                }
                .write(db, account)
            })
        })
    }

    /// Keep each account's followers and first stats run, for the guard's shares.
    pub fn set_account_sizes(&self, sizes: &[(String, u64, f64)]) -> BrowserResult<()> {
        let accounts: Map<String, Value> = sizes
            .iter()
            .map(|(account, followers, first_seen)| {
                (
                    account.clone(),
                    json!({"followers": followers, "first_seen": first_seen}),
                )
            })
            .collect();
        self.set_setting(
            SIZES,
            json!({"checked_at": self.host.time(), "accounts": accounts}),
        )
    }

    /// Whether the follower counts are due a refresh (`size_refresh_hours` old, and no
    /// try in the last `SIZES_RETRY_SECONDS`); a due turn is recorded as tried, so a
    /// database that keeps failing is asked only that often.
    pub fn take_account_sizes_turn(&self) -> BrowserResult<bool> {
        let now = self.host.time();
        let refresh = instagram_account_guard().size_refresh_hours * HOUR;
        self.retry_storage(|| {
            self.immediate(|db| {
                let stamp = |key: &str| -> BrowserResult<f64> {
                    Ok(pyjson::number(&stored_setting(db, key)?).unwrap_or(0.0))
                };
                let checked = stored_setting(db, SIZES)?
                    .get("checked_at")
                    .and_then(pyjson::number)
                    .unwrap_or(0.0);
                if now - checked < refresh || now - stamp(SIZES_TRIED)? < SIZES_RETRY_SECONDS {
                    return Ok(false);
                }
                write_setting(db, SIZES_TRIED, &json!(now))?;
                Ok(true)
            })
        })
    }

    /// Every guarded account (or only `account`): breaker, hold, refusals in the last
    /// hour and day, and the day's reads against its share.
    pub fn guard_status(&self, account: Option<&str>) -> BrowserResult<Value> {
        let now = self.host.time();
        let control = instagram_account_guard();
        self.retry_storage(|| {
            let db = self.connect()?;
            let accounts: Vec<String> = match account {
                Some(account) => vec![account.to_owned()],
                None => {
                    let mut statement = db
                        .prepare("SELECT key FROM settings WHERE key LIKE 'account_guard:%' ORDER BY key")
                        .map_err(storage)?;
                    statement
                        .query_map([], |row| row.get::<_, String>(0))
                        .map_err(storage)?
                        .map(|key| key.map(|key| key[KEY_PREFIX.len()..].to_owned()))
                        .collect::<Result<_, _>>()
                        .map_err(storage)?
                }
            };
            let mut status = Map::new();
            for account in accounts {
                let guard = Guard::read(&db, &account)?;
                let size = size(&db, &account)?;
                let in_day = guard.day_start + DAY > now;
                status.insert(
                    account.clone(),
                    json!({
                        "tripped": guard.tripped(),
                        "tripped_at": guard.tripped_at,
                        "held_until": (guard.held_until > now).then_some(guard.held_until),
                        "refusals_in_a_row": guard.refusals,
                        "refusals_last_hour": guard.refusal_times.iter().filter(|at| now - **at < HOUR).count(),
                        "refusals_last_day": guard.refusal_times.iter().filter(|at| now - **at < DAY).count(),
                        "last_refusal": guard.reason,
                        "reads_today": if in_day { guard.day_reads } else { 0 },
                        "daily_share": allowance(&control, &account, size, now).0.floor(),
                        "followers": size.map(|size| size.followers),
                    }),
                );
            }
            Ok(Value::Object(status))
        })
    }
}

#[cfg(test)]
#[path = "tests/browser_queue_guard.rs"]
mod tests;
