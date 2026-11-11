//! Pinned Brave tabs shared by one worker, with serialized account switches.
//!
//! Credentials remain in Brave. Account verification returns only a username and a
//! boolean recipient match; no cookies cross the browser boundary.

mod bridge;
mod runner;
mod session;
mod tab_pool;

use std::sync::LazyLock;

use regex::Regex;

pub use bridge::{
    Bridge, OSASCRIPT, TAB_CLOSED, TAB_LOADING, TIMED_OUT, is_ascii_digits, make_interruptible,
    request_stop, stop_requested, with_job_deadline,
};
pub use runner::{JavascriptRunner, PinnedRunner};
pub use session::{
    ACCOUNT_UNAVAILABLE, BrowserInstagramSession, CANCELLATION_UNCONFIRMED, LOGGED_OUT_PAUSE,
    request_result,
};
pub use tab_pool::{BrowserTabPool, TabPool};

use super::errors::{BrowserError, BrowserResult};
use crate::urls::urlsplit;

static USERNAME_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._]{1,30}$").expect("valid regex"));
pub(crate) static WAT2DO_ACCOUNT_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:wat2do[.][a-z0-9_]+|[a-z0-9._]+[.]wat2do[.]io|(?:[a-z0-9._]+[.])?wat2do[.]ca)$",
    )
    .expect("valid regex")
});
static POST_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/(?:p|reel)/([A-Za-z0-9_-]+)/?$").expect("valid regex"));

/// Resolve the current account name from its immutable school mapping.
pub fn school_account_username(school_slug: &str) -> Result<String, String> {
    validate_account_username(&format!("wat2do.{school_slug}"))
}

/// Normalize one configured school account at every browser admission path.
pub fn validate_account_username(value: &str) -> Result<String, String> {
    let username = value.trim().to_lowercase();
    if !USERNAME_PATTERN.is_match(&username) || !WAT2DO_ACCOUNT_PATTERN.is_match(&username) {
        return Err("Instagram browser account username is invalid".to_owned());
    }
    Ok(username)
}

/// Only allow an Instagram post/reel permalink, never arbitrary navigation.
pub fn canonical_post_url(post_url: &str) -> BrowserResult<String> {
    let invalid = || BrowserError::session("Instagram engagement post URL is invalid");
    let parsed = urlsplit(post_url.trim(), "").map_err(|_| invalid())?;
    if parsed.scheme != "https"
        || !["instagram.com", "www.instagram.com"].contains(&parsed.netloc.as_str())
        || !POST_PATH.is_match(&parsed.path)
    {
        return Err(invalid());
    }
    Ok(format!(
        "https://www.instagram.com{}/",
        parsed.path.trim_end_matches('/')
    ))
}

/// `_account_profile_url`: a logged-in account's public profile.
pub fn account_profile_url(username: &str) -> BrowserResult<String> {
    if !USERNAME_PATTERN.is_match(username) {
        return Err(BrowserError::session(
            "Instagram browser profile username is invalid",
        ));
    }
    Ok(format!("https://www.instagram.com/{username}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn school_accounts_and_post_urls_are_canonical() {
        assert_eq!(school_account_username("ubc").unwrap(), "wat2do.ubc");
        assert_eq!(
            validate_account_username(" Wat2Do.UBC ").unwrap(),
            "wat2do.ubc"
        );
        assert_eq!(
            validate_account_username("ubc.wat2do.io").unwrap(),
            "ubc.wat2do.io"
        );
        assert_eq!(validate_account_username("wat2do.ca").unwrap(), "wat2do.ca");
        assert!(validate_account_username("someone").is_err());
        assert!(school_account_username("this-is-not-valid").is_err());
        assert_eq!(
            canonical_post_url(" https://instagram.com/reel/AbC_-1?igsh=x ").unwrap(),
            "https://www.instagram.com/reel/AbC_-1/"
        );
        assert!(canonical_post_url("http://www.instagram.com/p/x/").is_err());
        assert!(canonical_post_url("https://evil.com/p/x/").is_err());
        assert!(canonical_post_url("https://www.instagram.com/user/p/x/").is_err());
        assert!(account_profile_url("bad name").is_err());
    }
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "../tests/browser_session.rs"]
mod python_tests;
