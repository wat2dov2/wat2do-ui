//! Expand a notification digest (CacheEntID) into its media IDs in an account's
//! Lightpanda page.
//!
//! It runs the Brave worker's own digest script and checks the settled request with
//! the Brave resolver's checks, so the query, paging, `maximum_pages` and every
//! failure (and the worker's reaction to it) are the same in both browsers.

use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use super::browser::Page;
use crate::controlbox::instagram_browser;
use crate::instagram_notifications::browser_digest::{self, DigestResolution, checked_cache_id};
use crate::instagram_notifications::browser_session::request_result;
use crate::instagram_notifications::errors::{BrowserError, BrowserResult};
use crate::instagram_notifications::scripts;

const NOT_SETTLED: &str = "Instagram digest did not settle before the job timed out";

/// Resolve one digest in `page`, which is on Instagram as `recipient_id`.
pub async fn resolve(
    page: &mut impl Page,
    recipient_id: &str,
    account_username: &str,
    cache_ent_id: &str,
) -> BrowserResult<DigestResolution> {
    let cache_id = checked_cache_id(cache_ent_id)?;
    let control = instagram_browser();
    let payload = query(
        page,
        &scripts::digest_query(cache_id, recipient_id),
        Duration::from_secs_f64(control.poll_interval_seconds),
        Duration::from_secs_f64(control.job_timeout_seconds),
    )
    .await?;
    browser_digest::resolution(&payload, account_username.to_owned())
}

/// Lightpanda failing is a transient browser failure: the read can run again.
fn lightpanda(error: anyhow::Error) -> BrowserError {
    BrowserError::transient(format!("Lightpanda failed: {error:#}"))
}

/// Start the page's request, poll it every `poll` until it settles (cancelling it
/// after `timeout`) and clear it, reading its state as the Brave session does.
async fn query(
    page: &mut impl Page,
    source: &str,
    poll: Duration,
    timeout: Duration,
) -> BrowserResult<Map<String, Value>> {
    let started = page.evaluate(source).await.map_err(lightpanda)?;
    if started != "started" {
        return Err(BrowserError::transient(
            "Lightpanda did not start the digest query",
        ));
    }
    let deadline = Instant::now() + timeout;
    let settled = loop {
        tokio::time::sleep(poll).await;
        let state = page
            .evaluate(scripts::REQUEST_STATE)
            .await
            .map_err(lightpanda)?;
        if let Some((payload, true)) = request_result(state.as_str().unwrap_or("null"))? {
            break Ok(payload);
        }
        if Instant::now() >= deadline {
            page.evaluate(scripts::CANCEL_REQUEST)
                .await
                .map_err(lightpanda)?;
            break Err(BrowserError::Timeout(NOT_SETTLED.to_owned()));
        }
    };
    page.evaluate(scripts::CLEAR_REQUEST)
        .await
        .map_err(lightpanda)?;
    settled
}

#[cfg(test)]
#[path = "tests/digest.rs"]
mod tests;
