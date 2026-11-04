//! Read public post details inside the existing, account-verified browser.
//!
//! Only public media fields leave the tab. Credentials and authenticated requests stay
//! inside Brave, using the shared request cancellation lifecycle.

use std::sync::LazyLock;

use chrono::{DateTime, Duration as ChronoDuration, FixedOffset, Utc};
use regex::Regex;
use serde_json::{Map, Value, json};

use super::browser_session::{BrowserInstagramSession, canonical_post_url};
use super::errors::{BrowserError, BrowserResult, SessionKind};
use super::scripts;
use crate::urls::urlsplit;

static PROFILE_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/([A-Za-z0-9._]{1,30})/?$").expect("valid regex"));
static OWNER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._]{1,30}$").expect("valid regex"));
const RESERVED: [&str; 7] = [
    "p", "reel", "reels", "accounts", "explore", "direct", "stories",
];
const ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Normalize a manual username, profile URL or exact post URL once at ingestion.
pub fn canonical_target_url(url: &str) -> BrowserResult<String> {
    let mut url = url.trim().to_owned();
    let username = url.strip_prefix('@').unwrap_or(&url).to_owned();
    if PROFILE_PATH.is_match(&format!("/{username}/")) {
        url = format!("https://www.instagram.com/{username}/");
    }
    let parsed = urlsplit(&url, "").map_err(BrowserError::Value)?;
    let host = parsed.hostname();
    if !matches!(host.as_deref(), Some("instagram.com" | "www.instagram.com"))
        || parsed.scheme != "https"
    {
        return Err(BrowserError::Value(
            "Retrieval requires an HTTPS Instagram profile or post URL".to_owned(),
        ));
    }
    if parsed.username().is_some_and(|name| !name.is_empty())
        || parsed
            .password()
            .is_some_and(|password| !password.is_empty())
        || parsed
            .port()
            .map_err(BrowserError::Value)?
            .is_some_and(|port| port != 0)
        || !parsed.query.is_empty()
        || !parsed.fragment.is_empty()
    {
        return Err(BrowserError::Value(
            "Instagram retrieval URL must not contain credentials or extra parameters".to_owned(),
        ));
    }
    if let Some(found) = PROFILE_PATH.captures(&parsed.path) {
        let name = found[1].to_lowercase();
        if !RESERVED.contains(&name.as_str()) {
            return Ok(format!("https://www.instagram.com/{name}/"));
        }
    }
    canonical_post_url(&url)
}

/// The numeric media ID a post URL's shortcode encodes.
pub fn media_id_from_url(url: &str) -> BrowserResult<String> {
    let canonical = canonical_post_url(url)?;
    let shortcode = canonical
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default();
    let invalid = || BrowserError::Value("Instagram post identity is invalid".to_owned());
    let mut value: u128 = 0;
    for character in shortcode.chars() {
        let digit = ALPHABET.find(character).ok_or_else(invalid)? as u128;
        value = value
            .checked_mul(64)
            .and_then(|value| value.checked_add(digit))
            .ok_or_else(invalid)?;
    }
    if value == 0 || value >= 10u128.pow(32) {
        return Err(invalid());
    }
    Ok(value.to_string())
}

fn active_account(session: &mut BrowserInstagramSession) -> BrowserResult<String> {
    // Capture the verified read itself instead of immediately rereading a loading DOM.
    let mut username = None;
    session.poll_until(|session| {
        session.current_page_path(true)?;
        username = session.current_account_username()?;
        Ok(username.is_some())
    })?;
    username.ok_or_else(|| {
        BrowserError::Timeout(
            "Instagram account identity did not settle before the deadline".to_owned(),
        )
    })
}

/// List a profile's recent posts, or read one post, as the verified logged-in account.
pub fn retrieve(
    session: &mut BrowserInstagramSession,
    url: &str,
    cutoff_days: i64,
) -> BrowserResult<Value> {
    let target = canonical_target_url(url)?;
    let target_path = urlsplit(&target, "").map_err(BrowserError::Value)?.path;
    let profile = PROFILE_PATH
        .captures(&target_path)
        .map(|found| found[1].to_owned());
    // Native navigation works even when Instagram's home renderer is blank. The native
    // owner refuses to leave a login/challenge recovery page.
    session.navigate(&target, true)?;
    let expected_path = target_path.trim_matches('/').to_owned();
    session.poll_until(|session| {
        let path = session.current_page_path(true)?;
        Ok(
            path.trim_matches('/') == expected_path
                && session.current_account_username()?.is_some(),
        )
    })?;
    let username = active_account(session)?;
    let endpoint = match &profile {
        Some(profile) => format!("/api/v1/users/web_profile_info/?username={profile}"),
        None => format!("/api/v1/media/{}/info/", media_id_from_url(&target)?),
    };
    let result = match session.query(
        &scripts::public_media_query(&endpoint, &username, profile.is_some()),
        true,
    ) {
        Ok(result) => result,
        Err(BrowserError::ReadCleanupPending {
            message,
            mut operation_error,
            completed_payload,
        }) => {
            if let Some(payload) = completed_payload
                .as_ref()
                .filter(|payload| payload.get("state") == Some(&json!("failed")))
                && operation_error.as_deref().is_none_or(|error| {
                    error.is(SessionKind::PageUnavailable)
                        || error.is(SessionKind::AutomationTransient)
                        || error.is_timeout()
                })
            {
                let failure = response_failure(payload.get("reason"), payload.get("http_status"));
                if failure.is(SessionKind::RateLimited) {
                    operation_error = Some(Box::new(failure));
                }
            }
            return Err(BrowserError::ReadCleanupPending {
                message,
                operation_error,
                completed_payload,
            });
        }
        Err(error) => return Err(error),
    };
    if result.get("state") != Some(&json!("succeeded")) {
        // Never persist server response text, request headers or browser internals.
        return Err(response_failure(
            result.get("reason"),
            result.get("http_status"),
        ));
    }
    if active_account(session)? != username {
        return Err(BrowserError::account_changed(
            "Instagram browser account changed during retrieval",
        ));
    }
    let posts = match result.get("posts") {
        Some(Value::Array(posts)) if profile.is_some() || posts.len() == 1 => posts,
        _ => {
            return Err(BrowserError::session(
                "Instagram retrieval returned incomplete media details",
            ));
        }
    };
    let mut checked = posts
        .iter()
        .map(validate_post)
        .collect::<BrowserResult<Vec<_>>>()?;
    if let Some(profile) = &profile {
        if checked.iter().any(|(post, _)| {
            post.get("ownerUsername")
                .and_then(Value::as_str)
                .map(str::to_lowercase)
                .as_deref()
                != Some(profile.as_str())
        }) {
            return Err(BrowserError::session(
                "Instagram profile returned a different post owner",
            ));
        }
        let now = DateTime::<Utc>::from_timestamp_micros((session.bridge.time() * 1e6) as i64)
            .unwrap_or_default();
        let cutoff = now - ChronoDuration::days(cutoff_days);
        checked.retain(|(_, timestamp)| *timestamp >= cutoff);
    } else {
        let url = checked[0]
            .0
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if media_id_from_url(url)? != media_id_from_url(&target)? {
            return Err(BrowserError::session(
                "Instagram retrieval returned a different media identity",
            ));
        }
    }
    let posts: Vec<Value> = checked
        .into_iter()
        .map(|(post, _)| Value::Object(post))
        .collect();
    Ok(json!({"account_username": username, "posts": posts, "target_url": target}))
}

fn response_failure(reason: Option<&Value>, http_status: Option<&Value>) -> BrowserError {
    let reason = reason.and_then(Value::as_str);
    if reason == Some("http_error")
        && let Some(status) = http_status
            .and_then(Value::as_i64)
            .filter(|status| (100..=599).contains(status))
        && http_status.is_some_and(|status| status.is_i64() || status.is_u64())
    {
        let message = format!("Instagram public media request failed with HTTP {status}");
        return if status == 429 {
            BrowserError::rate_limited(message)
        } else {
            BrowserError::page_unavailable(message)
        };
    }
    BrowserError::page_unavailable(match reason {
        Some("account_changed") => {
            "Instagram browser account changed during public media retrieval"
        }
        Some("http_error") => "Instagram public media request was rejected",
        Some("invalid_json") => "Instagram public media response was not valid JSON",
        Some("invalid_media") => "Instagram public media response did not contain a media list",
        Some("projection_failed") => "Instagram public media projection failed",
        Some("request_failed") => "Instagram public media request failed",
        _ => "Instagram public media retrieval failed",
    })
}

/// Python's `datetime.fromisoformat` for the timestamps the page projects, which must
/// carry a timezone.
fn aware_timestamp(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .or_else(|| DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f%:z").ok())
}

fn validate_post(post: &Value) -> BrowserResult<(Map<String, Value>, DateTime<Utc>)> {
    let Value::Object(post) = post else {
        return Err(BrowserError::session(
            "Instagram retrieval returned invalid post data",
        ));
    };
    let omitted =
        || BrowserError::session("Instagram retrieval omitted required caption or media fields");
    let url = post.get("url").ok_or_else(omitted)?;
    let Value::String(url) = url else {
        return Err(BrowserError::other(
            "AttributeError",
            "Instagram post URL is not text",
        ));
    };
    canonical_post_url(url)?;
    let owner_valid = post
        .get("ownerUsername")
        .ok_or_else(omitted)?
        .as_str()
        .is_some_and(|owner| OWNER.is_match(owner));
    if !owner_valid {
        return Err(omitted());
    }
    let timestamp = post
        .get("timestamp")
        .ok_or_else(omitted)?
        .as_str()
        .and_then(aware_timestamp)
        .ok_or_else(omitted)?;
    if !post.get("caption").ok_or_else(omitted)?.is_string()
        || !post.get("coauthors").ok_or_else(omitted)?.is_array()
    {
        return Err(omitted());
    }
    let children = post.get("childPosts").cloned().unwrap_or(json!([]));
    let children_empty = !crate::pyjson::truthy(&children);
    if post.get("type") == Some(&json!("Sidecar")) && children_empty {
        return Err(omitted());
    }
    let media: Vec<Value> = if children_empty {
        vec![Value::Object(post.clone())]
    } else {
        match children {
            Value::Array(children) => children,
            _ => return Err(omitted()),
        }
    };
    for item in &media {
        let Value::Object(item) = item else {
            return Err(omitted());
        };
        if !public_media_url(item.get("displayUrl"))? {
            return Err(omitted());
        }
        let video = item
            .get("videoUrl")
            .filter(|video| crate::pyjson::truthy(video));
        if item.get("type") == Some(&json!("Video")) && video.is_none() {
            return Err(omitted());
        }
        if video.is_some() && !public_media_url(video)? {
            return Err(omitted());
        }
    }
    Ok((post.clone(), timestamp.with_timezone(&Utc)))
}

fn public_media_url(value: Option<&Value>) -> BrowserResult<bool> {
    let Some(Value::String(value)) = value else {
        return Ok(false);
    };
    let omitted =
        || BrowserError::session("Instagram retrieval omitted required caption or media fields");
    let parsed = urlsplit(value, "").map_err(|_| omitted())?;
    let host = parsed.hostname().unwrap_or_default();
    Ok(parsed.scheme == "https"
        && (host.ends_with(".cdninstagram.com") || host.ends_with(".fbcdn.net"))
        && parsed.username().is_none_or(|name| name.is_empty())
        && parsed.password().is_none_or(|password| password.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_normalized_once() {
        assert_eq!(
            canonical_target_url("@Some.Club").unwrap(),
            "https://www.instagram.com/some.club/"
        );
        assert_eq!(
            canonical_target_url("https://instagram.com/Some.Club").unwrap(),
            "https://www.instagram.com/some.club/"
        );
        assert_eq!(
            canonical_target_url("https://www.instagram.com/p/AbC/").unwrap(),
            "https://www.instagram.com/p/AbC/"
        );
        assert!(canonical_target_url("http://www.instagram.com/club/").is_err());
        assert!(canonical_target_url("https://www.instagram.com/club/?x=1").is_err());
        assert!(canonical_target_url("https://user@www.instagram.com/club/").is_err());
        assert!(canonical_target_url("https://www.instagram.com/explore/").is_err());
    }

    #[test]
    fn shortcodes_decode_to_media_ids() {
        assert_eq!(
            media_id_from_url("https://www.instagram.com/p/B/").unwrap(),
            "1"
        );
        assert_eq!(
            media_id_from_url("https://www.instagram.com/p/BA/").unwrap(),
            "64"
        );
        assert!(media_id_from_url("https://www.instagram.com/p/A/").is_err());
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/browser_ingestion.rs"]
mod python_tests;
