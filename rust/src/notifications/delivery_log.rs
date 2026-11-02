//! Retryable delivery claims and their terminal status
//! (`services/notifications/delivery_log.py`), plus the render-only outbox
//! that writes each message to disk instead.
//!
//! `claim_notification_delivery` inserts one `notifications_log` row per user,
//! type, target and channel, so a repeated or overlapping run sends nothing
//! twice; a failed row, or a pending one left by a crash, can be claimed again.

use std::path::PathBuf;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::constants::{NOTIFICATION_STATUS_FAILED, NOTIFICATION_STATUS_SENT};
use crate::email::{self, EmailMessage, SendError};

/// SES errors worth another attempt; every other rejection is final.
const RETRYABLE_SES_ERRORS: [&str; 3] = [
    "TooManyRequestsException",
    "InternalServiceErrorException",
    "ServiceUnavailable",
];

/// Attempts to record a delivery's status, and the pause before each retry.
const RECORD_ATTEMPTS: u32 = 3;
const RECORD_PAUSE: std::time::Duration = std::time::Duration::from_secs(2);

/// Run `operation` up to `attempts` times, pausing between tries.
async fn retry<F, Fut>(attempts: u32, pause: std::time::Duration, mut operation: F) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut tries = 0;
    loop {
        tries += 1;
        match operation().await {
            Ok(()) => return Ok(()),
            Err(error) if tries >= attempts => return Err(error),
            Err(_) => tokio::time::sleep(pause).await,
        }
    }
}

/// Where claimed messages go.
pub struct Outbox {
    pool: PgPool,
    render_to: Option<PathBuf>,
}

impl Outbox {
    /// Claim each delivery in `notifications_log` and send it.
    pub fn live(pool: PgPool) -> Self {
        Self {
            pool,
            render_to: None,
        }
    }

    /// Claim nothing and send nothing: write each message under `directory`.
    pub fn render_only(pool: PgPool, directory: PathBuf) -> Self {
        Self {
            pool,
            render_to: Some(directory),
        }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Claim a new, failed or stale delivery; None when it is already sent or owned.
    pub async fn claim(
        &self,
        user_id: Uuid,
        notification_type: &str,
        target_id: &str,
    ) -> Result<Option<Uuid>> {
        if self.render_to.is_some() {
            return Ok(Some(Uuid::nil()));
        }
        let row: Option<(Option<Uuid>, Option<bool>)> = sqlx::query_as(
            "SELECT id, claimed FROM public.claim_notification_delivery($1, $2, $3, NULL)",
        )
        .bind(user_id)
        .bind(notification_type)
        .bind(target_id)
        .fetch_optional(&self.pool)
        .await
        .context("could not claim the delivery")?;
        Ok(match row {
            Some((Some(id), Some(true))) => Some(id),
            _ => None,
        })
    }

    /// Send one claimed notification and record its terminal status.
    /// Returns whether it was sent.
    pub async fn deliver(
        &self,
        row_id: Uuid,
        message: &EmailMessage,
        provider_attempts: u32,
        log_context: &str,
    ) -> Result<bool> {
        if let Some(directory) = &self.render_to {
            write_rendered(directory, message)?;
            return Ok(true);
        }
        match attempt(provider_attempts, log_context, || email::send(message)).await {
            Ok(()) => {
                // SES has the message: the row must never become failed, which
                // would send it again. A row left pending is reclaimed only after
                // the claim's stale threshold.
                let recorded =
                    retry(RECORD_ATTEMPTS, RECORD_PAUSE, || self.mark_sent(row_id)).await;
                if let Err(error) = recorded {
                    tracing::error!(
                        "Notification {log_context} was sent but not recorded as sent; \
                         its row stays pending ({error:#})"
                    );
                }
                Ok(true)
            }
            Err(failure_category) => {
                let recorded = retry(RECORD_ATTEMPTS, RECORD_PAUSE, || {
                    self.mark_failed(row_id, &failure_category)
                })
                .await;
                if let Err(error) = recorded {
                    tracing::error!(
                        "Notification {log_context} failed ({failure_category}) and could not be \
                         recorded; its row stays pending ({error:#})"
                    );
                }
                Ok(false)
            }
        }
    }

    async fn mark_sent(&self, row_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE public.notifications_log SET status = $2, sent_at = now() WHERE id = $1",
        )
        .bind(row_id)
        .bind(NOTIFICATION_STATUS_SENT)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_failed(&self, row_id: Uuid, failure_category: &str) -> Result<()> {
        sqlx::query(
            "UPDATE public.notifications_log SET status = $2, failure_category = $3 WHERE id = $1",
        )
        .bind(row_id)
        .bind(NOTIFICATION_STATUS_FAILED)
        .bind(failure_category)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

/// Up to `attempts` sends, retrying only timeouts and SES throttling or outages.
/// Returns the failure category to record when none succeeded.
async fn attempt<F, Fut>(attempts: u32, log_context: &str, mut send: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), SendError>>,
{
    let mut failure_category = "provider_error".to_owned();
    for _ in 0..attempts {
        match send().await {
            Ok(()) => return Ok(()),
            Err(SendError::Rejected(code)) => {
                failure_category = format!("ses_{}", code.to_lowercase());
                if !RETRYABLE_SES_ERRORS.contains(&code.as_str()) {
                    tracing::warn!("SES rejected notification {log_context} ({code})");
                    break;
                }
            }
            Err(SendError::Timeout) => failure_category = "ses_timeout".to_owned(),
            Err(SendError::Other(error)) => {
                tracing::warn!("Notification provider failure {log_context}: {error:#}");
                break;
            }
        }
    }
    Err(failure_category)
}

/// One directory per message, named by its idempotency key: the raw MIME
/// message, both bodies, its headers, and each inline image.
fn write_rendered(directory: &std::path::Path, message: &EmailMessage) -> Result<()> {
    let key = message.idempotency_key.as_deref().unwrap_or("message");
    let directory = directory.join(key.replace([':', '/'], "_"));
    std::fs::create_dir_all(&directory)?;
    std::fs::write(directory.join("message.eml"), message.to_mime()?)?;
    std::fs::write(directory.join("body.html"), &message.body_html)?;
    std::fs::write(directory.join("body.txt"), &message.body_text)?;
    let images: Vec<serde_json::Value> = message
        .inline_images
        .iter()
        .map(|image| {
            serde_json::json!({
                "content_id": image.content_id,
                "filename": image.filename,
                "content_type": image.content_type,
                "bytes": image.content.len(),
                "sha256": format!("{:x}", Sha256::digest(&image.content)),
            })
        })
        .collect();
    let meta = serde_json::json!({
        "to": message.to,
        "from": message.sender()?,
        "subject": message.subject,
        "headers": message.headers,
        "idempotency_key": message.idempotency_key,
        "inline_images": images,
    });
    std::fs::write(
        directory.join("meta.json"),
        serde_json::to_vec_pretty(&meta)?,
    )?;
    for image in &message.inline_images {
        std::fs::write(directory.join(&image.filename), &image.content)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    async fn run(outcomes: Vec<Result<(), SendError>>) -> (Result<(), String>, usize) {
        let outcomes = RefCell::new(outcomes.into_iter());
        let calls = RefCell::new(0);
        let result = attempt(3, "test", || {
            *calls.borrow_mut() += 1;
            let next = outcomes.borrow_mut().next().expect("no more outcomes");
            async move { next }
        })
        .await;
        (result, calls.into_inner())
    }

    #[tokio::test]
    async fn status_writes_are_retried_then_given_up() {
        let calls = RefCell::new(0);
        let flaky = retry(3, std::time::Duration::ZERO, || {
            *calls.borrow_mut() += 1;
            let fail = *calls.borrow() < 3;
            async move {
                if fail {
                    anyhow::bail!("connection reset")
                }
                Ok(())
            }
        })
        .await;
        assert!(flaky.is_ok());
        assert_eq!(calls.replace(0), 3);
        let down = retry(3, std::time::Duration::ZERO, || {
            *calls.borrow_mut() += 1;
            async { anyhow::bail!("database down") }
        })
        .await;
        assert!(down.is_err());
        assert_eq!(calls.into_inner(), 3);
    }

    #[tokio::test]
    async fn timeouts_and_throttling_are_retried_until_sent() {
        let (result, calls) = run(vec![
            Err(SendError::Timeout),
            Err(SendError::Rejected("TooManyRequestsException".to_owned())),
            Ok(()),
        ])
        .await;
        assert_eq!((result, calls), (Ok(()), 3));
    }

    #[tokio::test]
    async fn a_terminal_rejection_is_not_retried() {
        let (result, calls) =
            run(vec![Err(SendError::Rejected("MessageRejected".to_owned()))]).await;
        assert_eq!((result, calls), (Err("ses_messagerejected".to_owned()), 1));
    }

    #[tokio::test]
    async fn exhausted_retries_keep_the_last_category() {
        let (result, calls) = run(vec![
            Err(SendError::Rejected("ServiceUnavailable".to_owned())),
            Err(SendError::Rejected("ServiceUnavailable".to_owned())),
            Err(SendError::Timeout),
        ])
        .await;
        assert_eq!((result, calls), (Err("ses_timeout".to_owned()), 3));
    }

    #[tokio::test]
    async fn any_other_failure_stops_with_the_category_so_far() {
        let (result, calls) = run(vec![
            Err(SendError::Timeout),
            Err(SendError::Other(anyhow::anyhow!("bad sender"))),
        ])
        .await;
        assert_eq!((result, calls), (Err("ses_timeout".to_owned()), 2));
        let (result, _) = run(vec![Err(SendError::Other(anyhow::anyhow!("x")))]).await;
        assert_eq!(result, Err("provider_error".to_owned()));
    }
}
