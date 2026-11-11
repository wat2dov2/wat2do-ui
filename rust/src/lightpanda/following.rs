//! Read one page of an account's Following list in a school account's Lightpanda
//! session, for the follow crawl.
//!
//! It runs the Brave worker's own Following script and checks, so the request, the
//! fields kept and every refusal (and the reaction to it) are the same in both
//! browsers; only the account check differs, by the session's user ID instead of the
//! page's navigation.

use std::time::Duration;

use serde_json::{Value, json};

use super::browser::Page;
use super::digest::query;
use crate::controlbox::instagram_browser;
use crate::instagram_notifications::browser_following::{self, validate_list_owner};
use crate::instagram_notifications::errors::{BrowserError, BrowserResult};
use crate::instagram_notifications::scripts;

/// Read the page of `username`'s Following list that `max_id` names (the first without
/// one) in `page`, which is logged in to Instagram as `account`, user `recipient_id`.
pub async fn read_page(
    page: &mut impl Page,
    account: &str,
    recipient_id: &str,
    username: &str,
    user_id: Option<&str>,
    max_id: Option<&str>,
) -> BrowserResult<Value> {
    // Checked when queued; a failed check here is a bad job, never a hold.
    let username = validate_list_owner(username)
        .map_err(|_| BrowserError::session("Instagram Following list owner is invalid"))?;
    let control = instagram_browser();
    let payload = query(
        page,
        &scripts::following_query_as_recipient(recipient_id, &username, user_id, max_id),
        Duration::from_secs_f64(control.poll_interval_seconds),
        Duration::from_secs_f64(control.job_timeout_seconds),
    )
    .await?;
    if payload.get("state") != Some(&json!("succeeded")) {
        return Err(browser_following::response_failure(&payload));
    }
    browser_following::page(&payload, account, &username, user_id)
}

#[cfg(test)]
#[path = "tests/following.rs"]
mod tests;
