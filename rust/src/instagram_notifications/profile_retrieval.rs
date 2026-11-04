//! Queue the posts of a manually requested Instagram profile.
//!
//! Listing a profile's recent posts is the one retrieval Brave still does, because it
//! needs the login. Each listed post joins the ingestion queue, where the
//! logged-out fetcher and the processor take over, as for any notified post.

use anyhow::Result;
use serde_json::{Value, json};

use super::browser_queue::BrowserJobQueue;
use super::browser_session::canonical_post_url;
use super::errors::BrowserError;
use crate::pyjson::truthy;

/// Queue each requested profile's listed posts through `queue_posts` (the
/// ingestion queue's `queue_instagram`), once per finished retrieval.
pub fn queue_retrieved_profiles(
    queue: &BrowserJobQueue,
    queue_posts: &dyn Fn(&[String], &str) -> Result<usize>,
) -> Result<Value> {
    let (mut queued, mut invalid) = (0usize, 0usize);
    for job in queue.retrieval_results()? {
        let key = format!("profile_queued:{}", job.id);
        if !queue
            .get_setting(&format!("profile_request:{}", job.id))?
            .as_ref()
            .is_some_and(truthy)
            || queue.account_excluded(&job.account_username)?
            || queue.get_setting(&key)?.as_ref().is_some_and(truthy)
        {
            continue;
        }
        let result = job
            .result
            .clone()
            .filter(truthy)
            .unwrap_or_else(|| json!({}));
        let target = job
            .payload
            .get("url")
            .ok_or_else(|| BrowserError::other("KeyError", "'url'"))?;
        let Some(Value::Array(posts)) = result
            .get("posts")
            .filter(|_| result.get("target_url") == Some(target))
        else {
            invalid += 1;
            continue;
        };
        let mut urls = Vec::new();
        for post in posts.iter().filter(|post| post.is_object()) {
            let url = post
                .get("url")
                .ok_or_else(|| BrowserError::other("KeyError", "'url'"))?;
            urls.push(canonical_post_url(url.as_str().unwrap_or_default())?);
        }
        queued += queue_posts(&urls, &job.school)?;
        queue.set_setting(&key, Value::Bool(true))?;
    }
    Ok(json!({"queued": queued, "invalid": invalid}))
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/profile_retrieval.rs"]
mod python_tests;
