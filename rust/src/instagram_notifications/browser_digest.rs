//! CacheEntID expansion through the one shared human-authenticated Brave session.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Value, json};

use super::browser_session::BrowserInstagramSession;
use super::errors::{BrowserError, BrowserResult, SessionKind};
use super::scripts;
use crate::controlbox::INSTAGRAM_DIGEST as CONTROL;

static CACHE_ID_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._:-]{1,255}$").expect("valid regex"));

/// Media identities recovered while one intended account was active.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigestResolution {
    pub account_username: String,
    pub media_ids: Vec<String>,
    pub page_count: i64,
}

impl DigestResolution {
    /// `dataclasses.asdict`, as stored in the job's result.
    pub fn to_value(&self) -> Value {
        json!({
            "account_username": self.account_username,
            "media_ids": self.media_ids,
            "page_count": self.page_count,
        })
    }

    /// Read a finished digest job's stored result.
    pub fn from_value(result: &Value) -> BrowserResult<Self> {
        let missing = |key: &str| BrowserError::other("KeyError", format!("'{key}'"));
        let account_username = result
            .get("account_username")
            .ok_or_else(|| missing("account_username"))?;
        let media_ids = result
            .get("media_ids")
            .ok_or_else(|| missing("media_ids"))?;
        let page_count = result
            .get("page_count")
            .ok_or_else(|| missing("page_count"))?;
        Ok(Self {
            account_username: crate::pyjson::str(account_username),
            media_ids: media_ids
                .as_array()
                .map(|ids| ids.iter().map(crate::pyjson::str).collect())
                .unwrap_or_default(),
            page_count: page_count.as_i64().unwrap_or_default(),
        })
    }
}

/// Resolve one digest while the worker owns the shared browser lock.
pub fn resolve(
    session: &mut BrowserInstagramSession,
    intended_recipient_id: &str,
    account_username: &str,
    cache_ent_id: &str,
) -> BrowserResult<DigestResolution> {
    let cache_id = cache_ent_id.trim();
    if !CACHE_ID_PATTERN.is_match(cache_id) {
        return Err(BrowserError::digest("Instagram digest cache ID is invalid"));
    }
    let queried = session
        .activate_account(intended_recipient_id, account_username)
        .and_then(|username| {
            let payload = session.query(
                &scripts::digest_query(cache_id, intended_recipient_id),
                true,
            )?;
            Ok((username, payload))
        });
    let (username, payload) = match queried {
        Ok(found) => found,
        Err(BrowserError::ReadCleanupPending {
            message,
            mut operation_error,
            completed_payload,
        }) => {
            let failed_reason = completed_payload
                .as_ref()
                .filter(|payload| payload.get("state") == Some(&json!("failed")))
                .map(|payload| payload.get("reason").cloned().unwrap_or(Value::Null));
            if let Some(reason) = failed_reason {
                if reason == json!("auth_required") {
                    operation_error =
                        Some(Box::new(BrowserError::digest(failure_message(&reason))));
                } else if operation_error.as_deref().is_none_or(|error| {
                    error.is(SessionKind::PageUnavailable)
                        || error.is(SessionKind::AutomationTransient)
                        || error.is_timeout()
                }) {
                    let failure = response_failure(&reason);
                    if failure.is(SessionKind::RateLimited) {
                        operation_error = Some(Box::new(failure));
                    }
                }
            }
            return Err(BrowserError::ReadCleanupPending {
                message,
                operation_error,
                completed_payload,
            });
        }
        Err(error)
            if error.is(SessionKind::AccountChanged)
                || error.is(SessionKind::RateLimited)
                || error.is(SessionKind::AutomationTransient)
                || error.is(SessionKind::PageUnavailable)
                || error.is(SessionKind::TabUnavailable) =>
        {
            return Err(error);
        }
        Err(error) if error.is_session() => return Err(BrowserError::digest(error.to_string())),
        Err(error) => return Err(error),
    };
    if payload.get("state") != Some(&json!("succeeded")) {
        return Err(response_failure(
            payload.get("reason").unwrap_or(&Value::Null),
        ));
    }
    let invalid = || BrowserError::digest("Instagram digest returned an invalid response");
    let (Some(Value::Array(raw_media_ids)), Some(Value::Number(page_count))) =
        (payload.get("media_ids"), payload.get("page_count"))
    else {
        return Err(invalid());
    };
    let page_count = page_count
        .as_i64()
        .filter(|count| (1..=CONTROL.maximum_pages).contains(count))
        .ok_or_else(invalid)?;
    let media_ids = raw_media_ids
        .iter()
        .map(canonical_media_id)
        .collect::<BrowserResult<Vec<_>>>()?;
    let mut unique = media_ids.clone();
    unique.sort();
    unique.dedup();
    if unique.len() != media_ids.len() {
        return Err(BrowserError::digest(
            "Instagram digest returned duplicate media IDs",
        ));
    }
    Ok(DigestResolution {
        account_username: username,
        media_ids,
        page_count,
    })
}

/// Return the advisory shortfall while rejecting impossible over-counts.
pub fn digest_media_count_shortfall(
    actual_count: i64,
    advertised_count: Option<i64>,
) -> BrowserResult<i64> {
    let Some(advertised_count) = advertised_count else {
        return Ok(0);
    };
    if actual_count > advertised_count {
        return Err(BrowserError::digest(
            "Instagram digest resolved more media IDs than advertised",
        ));
    }
    Ok(advertised_count - actual_count)
}

fn canonical_media_id(raw_media_id: &Value) -> BrowserResult<String> {
    let invalid = || BrowserError::digest("Instagram digest returned an invalid media ID");
    let text = match raw_media_id {
        Value::String(text) => text.clone(),
        Value::Number(number) if number.is_i64() || number.is_u64() => number.to_string(),
        _ => return Err(invalid()),
    };
    let media_id = text.trim().split('_').next().unwrap_or_default();
    if !(1..=32).contains(&media_id.len())
        || !media_id.bytes().all(|byte| byte.is_ascii_digit())
        || media_id.starts_with('0')
    {
        return Err(invalid());
    }
    Ok(media_id.to_owned())
}

fn failure_message(reason: &Value) -> &'static str {
    match reason.as_str() {
        Some("account_changed") => "Instagram browser account changed during the digest request",
        Some("auth_required") => "Instagram browser account requires human reauthorization",
        Some("account_unavailable") => "Matching Instagram browser account is unavailable",
        Some("account_directory_failed") => "Instagram browser account directory is unavailable",
        Some("temporarily_unavailable") => "Instagram digest is temporarily unavailable",
        Some("rate_limited") => "Instagram digest is rate limited (HTTP 429)",
        Some("query_rejected") => "Instagram digest query was rejected",
        Some("page_limit") => "Instagram digest did not reach its terminal page",
        Some("invalid_response") => "Instagram digest returned an invalid response",
        Some("request_failed") => "Instagram digest request failed",
        _ => "Instagram browser automation failed",
    }
}

fn response_failure(reason: &Value) -> BrowserError {
    let message = failure_message(reason);
    match reason.as_str() {
        Some("account_changed") => BrowserError::account_changed(message),
        Some("rate_limited") => BrowserError::rate_limited(message),
        Some("temporarily_unavailable" | "request_failed") => {
            BrowserError::page_unavailable(message)
        }
        _ => BrowserError::digest(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortfall_is_advisory_but_over_counts_fail() {
        assert_eq!(digest_media_count_shortfall(2, None).unwrap(), 0);
        assert_eq!(digest_media_count_shortfall(2, Some(5)).unwrap(), 3);
        assert_eq!(
            digest_media_count_shortfall(3, Some(2))
                .unwrap_err()
                .to_string(),
            "Instagram digest resolved more media IDs than advertised"
        );
    }

    #[test]
    fn media_ids_are_canonical() {
        assert_eq!(canonical_media_id(&json!(" 123_456 ")).unwrap(), "123");
        assert_eq!(canonical_media_id(&json!(987)).unwrap(), "987");
        for invalid in [
            json!("0123"),
            json!(""),
            json!(true),
            json!(1.5),
            json!("12a"),
            json!("1".repeat(33)),
        ] {
            assert!(canonical_media_id(&invalid).is_err(), "{invalid}");
        }
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/browser_digest.rs"]
mod python_tests;
