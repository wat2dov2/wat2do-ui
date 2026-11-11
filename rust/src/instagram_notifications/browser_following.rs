//! Read one page of an account's Following list inside the existing, logged-in browser.
//!
//! The follow crawl (`backend/services/instagram_follow/crawl.py`) reads each club's
//! list one page per job, so a digest never waits behind a whole list and the queue
//! paces every request. A read runs as whichever account Brave shows and never switches
//! accounts. Only each listed account's username, display name, ID and privacy leave
//! the tab; credentials and the authenticated request stay inside Brave.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value, json};

use super::browser_ingestion::{active_account, settled_read};
use super::browser_session::BrowserInstagramSession;
use super::errors::{BrowserError, BrowserResult};
use super::scripts;
use crate::schools::validate_recipient_id;

static LIST_OWNER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9._]{1,30}$").expect("valid regex"));
/// Instagram's opaque page cursor: a number or a base64-like token.
static CURSOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._:=|+/-]{1,1024}$").expect("valid regex"));
/// Display names are short on Instagram; anything longer is cut, never stored whole.
const NAME_LIMIT: usize = 200;

/// The account whose list is read, as Instagram spells it: lowercase.
pub fn validate_list_owner(username: &str) -> BrowserResult<String> {
    let username = username.trim().to_lowercase();
    if !LIST_OWNER.is_match(&username) {
        return Err(BrowserError::Value(
            "Instagram Following list owner is invalid".to_owned(),
        ));
    }
    Ok(username)
}

/// A page cursor Instagram handed out, passed back unchanged.
pub fn validate_cursor(cursor: &str) -> BrowserResult<String> {
    if !CURSOR.is_match(cursor) {
        return Err(BrowserError::Value(
            "Instagram Following page cursor is invalid".to_owned(),
        ));
    }
    Ok(cursor.to_owned())
}

/// Read the page of `username`'s Following list that `max_id` names (the first without
/// one), looking the account's ID up first when `user_id` is unknown.
///
/// A list Instagram plainly will not show this viewer (a gone account, or one private
/// to it) is `hidden`. A 429, a login wall or any other refusal (feedback, spam, an
/// unexpected 4xx) is a rate limit, which holds only Following reads. A listed account
/// that is not a valid name and ID is dropped and counted in `invalid`.
pub fn read_page(
    session: &mut BrowserInstagramSession,
    username: &str,
    user_id: Option<&str>,
    max_id: Option<&str>,
) -> BrowserResult<Value> {
    // Checked when queued; a failed check here is a bad job, never a reason to pause.
    let username = validate_list_owner(username)
        .map_err(|_| BrowserError::session("Instagram Following list owner is invalid"))?;
    let account = active_account(session)?;
    let result = settled_read(
        session,
        &scripts::following_query(&account, &username, user_id, max_id),
        response_failure,
    )?;
    if active_account(session)? != account {
        return Err(BrowserError::account_changed(
            "Instagram browser account changed during a Following read",
        ));
    }
    page(&result, &account, &username, user_id)
}

/// The settled page `result` of `username`'s list, read as `account`, with only the
/// fields the crawl keeps.
pub fn page(
    result: &Map<String, Value>,
    account: &str,
    username: &str,
    user_id: Option<&str>,
) -> BrowserResult<Value> {
    if result.get("hidden") == Some(&json!(true)) {
        return Ok(json!({"account_username": account, "username": username, "hidden": true}));
    }
    let invalid = || BrowserError::session("Instagram Following read returned an invalid page");
    let listed_id = result
        .get("user_id")
        .and_then(Value::as_str)
        .and_then(|id| validate_recipient_id(id).ok())
        .filter(|id| user_id.is_none_or(|known| known == id))
        .ok_or_else(invalid)?;
    let Some(Value::Array(listed)) = result.get("users") else {
        return Err(invalid());
    };
    let users: Vec<Value> = listed.iter().filter_map(listed_account).collect();
    let next_max_id = match result.get("next_max_id") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::String(cursor)) => Value::from(validate_cursor(cursor).map_err(|_| invalid())?),
        Some(_) => return Err(invalid()),
    };
    Ok(json!({
        "account_username": account,
        "username": username,
        "user_id": listed_id,
        "invalid": listed.len() - users.len(),
        "users": users,
        "next_max_id": next_max_id,
    }))
}

/// One listed account with exactly the fields the crawl keeps, or None when invalid.
fn listed_account(user: &Value) -> Option<Value> {
    let Value::Object(user) = user else {
        return None;
    };
    let username = user.get("username")?.as_str()?;
    let name = user.get("full_name")?.as_str()?;
    let pk = user.get("pk")?.as_str()?;
    let private = user.get("is_private")?.as_bool()?;
    if !LIST_OWNER.is_match(username) || validate_recipient_id(pk).is_err() {
        return None;
    }
    let mut account = Map::new();
    account.insert("username".into(), username.into());
    account.insert(
        "full_name".into(),
        name.chars().take(NAME_LIMIT).collect::<String>().into(),
    );
    account.insert("pk".into(), pk.into());
    account.insert("is_private".into(), private.into());
    Some(Value::Object(account))
}

/// A failed read's sanitized error: only the page's fixed reason and HTTP status.
pub fn response_failure(payload: &Map<String, Value>) -> BrowserError {
    let status = payload
        .get("http_status")
        .filter(|status| status.is_i64() || status.is_u64())
        .and_then(Value::as_i64)
        .filter(|status| (100..=599).contains(status));
    match (payload.get("reason").and_then(Value::as_str), status) {
        (Some("http_error"), Some(429)) => {
            BrowserError::rate_limited("Instagram Following read failed with HTTP 429")
        }
        (Some("login_required"), _) => {
            BrowserError::rate_limited("Instagram asked for a login on a Following read")
        }
        (Some("blocked"), _) => BrowserError::rate_limited("Instagram refused a Following read"),
        (Some("http_error"), Some(status)) => BrowserError::page_unavailable(format!(
            "Instagram Following read failed with HTTP {status}"
        )),
        (Some("account_changed"), _) => BrowserError::page_unavailable(
            "Instagram browser account changed during a Following read",
        ),
        (Some("invalid_json"), _) => {
            BrowserError::page_unavailable("Instagram Following response was not valid JSON")
        }
        (Some("invalid_response"), _) => {
            BrowserError::session("Instagram Following response did not contain an account list")
        }
        _ => BrowserError::page_unavailable("Instagram Following read failed"),
    }
}

#[cfg(test)]
#[path = "tests/browser_following.rs"]
mod tests;
