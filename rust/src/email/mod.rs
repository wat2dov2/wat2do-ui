//! Transactional email through Amazon SES (`services/email_service.py`).
//!
//! Nothing is sent unless `EMAIL_DELIVERY_ENABLED` is set: [`send`] then logs
//! the message and reports success, so the notification pipeline (claims,
//! delivery log writes, composition) runs end to end without AWS credentials.

pub mod layout;
mod mime;

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use aws_sdk_sesv2::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_sesv2::primitives::Blob;
use aws_sdk_sesv2::types::{Destination, EmailContent, RawMessage};
use regex::Regex;
use tokio::sync::OnceCell;

use crate::controlbox::EMAIL_DELIVERY;
use crate::settings::settings;

/// An image carried inside the message and referenced from HTML as
/// `cid:<content_id>`; Outlook blocks remote images from unfamiliar senders
/// but shows embedded ones.
#[derive(Debug, Clone, PartialEq)]
pub struct InlineImage {
    pub content_id: String,
    pub filename: String,
    pub content_type: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct EmailMessage {
    pub to: Vec<String>,
    pub subject: String,
    pub body_html: String,
    pub body_text: String,
    pub reply_to: Option<String>,
    /// Overrides `EMAIL_FROM`, e.g. the morning email comes from the team inbox.
    pub sender: Option<String>,
    /// Stable per-send key, logged so a dispatch can be traced to its
    /// notifications log row. SES has no idempotency key; the log's
    /// (user, type, target, channel) unique claim guarantees one dispatch.
    pub idempotency_key: Option<String>,
    pub headers: Vec<(String, String)>,
    /// Shared, because every recipient of a digest carries the same images.
    pub inline_images: Vec<Arc<InlineImage>>,
}

impl EmailMessage {
    /// The `From` address: the message's own sender or `EMAIL_FROM`.
    pub fn sender(&self) -> anyhow::Result<String> {
        Ok(match &self.sender {
            Some(sender) => sender.clone(),
            None => settings()?.email_from.clone(),
        })
    }

    /// The raw MIME message SES would send.
    pub fn to_mime(&self) -> anyhow::Result<Vec<u8>> {
        Ok(mime::build(self, &self.sender()?))
    }
}

#[derive(Debug)]
pub enum SendError {
    /// SES answered with this error code, e.g. `MessageRejected`.
    Rejected(String),
    /// SES could not be reached or did not answer in time.
    Timeout,
    Other(anyhow::Error),
}

impl std::fmt::Display for SendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(code) => write!(formatter, "SES rejected the message ({code})"),
            Self::Timeout => write!(formatter, "SES timed out"),
            Self::Other(error) => write!(formatter, "{error:#}"),
        }
    }
}

impl From<anyhow::Error> for SendError {
    fn from(error: anyhow::Error) -> Self {
        Self::Other(error)
    }
}

static LEGACY_WAT2DO_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)https?://(?:[a-z0-9-]+\.)*wat2do\.ca(?:[:/?#\s"'<]|$)"#).expect("valid regex")
});

/// Refuse anything still pointing at the retired wat2do.ca domain.
fn validate_v2_identity(message: &EmailMessage, sender: &str) -> anyhow::Result<()> {
    if sender.to_lowercase().contains("@wat2do.ca") {
        anyhow::bail!("EMAIL_FROM must use wat2do.io, not wat2do.ca");
    }
    if LEGACY_WAT2DO_URL.is_match(&message.body_html)
        || LEGACY_WAT2DO_URL.is_match(&message.body_text)
    {
        anyhow::bail!("Outbound email links must use wat2do.io, not wat2do.ca");
    }
    Ok(())
}

/// Send one email; `Ok` once SES accepts it (or, in dry-run mode, once logged).
pub async fn send(message: &EmailMessage) -> Result<(), SendError> {
    let sender = message.sender()?;
    validate_v2_identity(message, &sender)?;
    if !settings()?.email_delivery_enabled {
        tracing::info!(
            "[email][dry-run] to={:?} subject={:?} idempotency_key={}",
            message.to,
            message.subject,
            message.idempotency_key.as_deref().unwrap_or("None")
        );
        return Ok(());
    }
    let raw = mime::build(message, &sender);
    let result = ses()
        .await?
        .send_email()
        .destination(
            Destination::builder()
                .set_to_addresses(Some(message.to.clone()))
                .build(),
        )
        .content(
            EmailContent::builder()
                .raw(
                    RawMessage::builder()
                        .data(Blob::new(raw))
                        .build()
                        .map_err(anyhow::Error::from)?,
                )
                .build(),
        )
        .send()
        .await;
    match result {
        Ok(_) => Ok(()),
        Err(SdkError::ServiceError(error)) => Err(SendError::Rejected(
            error.err().code().unwrap_or("unknown").to_owned(),
        )),
        Err(SdkError::TimeoutError(_)) => Err(SendError::Timeout),
        Err(SdkError::DispatchFailure(failure)) if failure.is_timeout() || failure.is_io() => {
            Err(SendError::Timeout)
        }
        Err(error) => Err(SendError::Other(anyhow::Error::from(error))),
    }
}

/// `email_service.send_safely` as a FastAPI background task: send after the
/// response, logging (never raising) a failure.
pub fn send_in_background(message: EmailMessage) {
    tokio::spawn(async move {
        if let Err(error) = send(&message).await {
            tracing::error!(
                "Background email dispatch failed for subject={:?}: {error}",
                message.subject
            );
        }
    });
}

static SES: OnceCell<aws_sdk_sesv2::Client> = OnceCell::const_new();

async fn ses() -> anyhow::Result<&'static aws_sdk_sesv2::Client> {
    let region = settings()?.aws_region.clone();
    Ok(SES
        .get_or_init(|| async {
            let timeout = Duration::from_secs_f64(EMAIL_DELIVERY.provider_timeout_seconds);
            let config = aws_config::from_env()
                .region(aws_config::Region::new(region))
                .timeout_config(
                    aws_config::timeout::TimeoutConfig::builder()
                        .connect_timeout(timeout)
                        .read_timeout(timeout)
                        .build(),
                )
                .load()
                .await;
            aws_sdk_sesv2::Client::new(&config)
        })
        .await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(body_html: &str, body_text: &str) -> EmailMessage {
        EmailMessage {
            to: vec!["student@uwaterloo.ca".to_owned()],
            subject: "Wat2do update".to_owned(),
            body_html: body_html.to_owned(),
            body_text: body_text.to_owned(),
            ..EmailMessage::default()
        }
    }

    #[test]
    fn legacy_sender_and_links_are_refused() {
        let ok = message("<p>Hello</p>", "Hello");
        assert!(validate_v2_identity(&ok, "wat2do <notifications@wat2do.io>").is_ok());
        let error = validate_v2_identity(&ok, "wat2do <notifications@WAT2DO.ca>").unwrap_err();
        assert!(error.to_string().contains("EMAIL_FROM must use wat2do.io"));
        for (html, text) in [
            (
                r#"<a href="https://uwaterloo.wat2do.ca/events/42">View</a>"#,
                "",
            ),
            ("", "View: https://wat2do.ca/events/42"),
            ("", "View: http://wat2do.ca"),
        ] {
            let error = validate_v2_identity(&message(html, text), "team@wat2do.io").unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("Outbound email links must use wat2do.io")
            );
        }
        // A longer domain that merely starts with wat2do.ca is not the legacy site.
        assert!(
            validate_v2_identity(&message("https://wat2do.cards/x", ""), "a@wat2do.io").is_ok()
        );
    }
}
