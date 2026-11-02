//! Environment settings, read from the process environment after loading
//! `backend/.env` (the working directory of every wat2do service on the Mac).
//! Names match `backend/core/config.py`.

use std::sync::LazyLock;

use anyhow::{Context, Result};

pub struct Settings {
    pub database_url: String,
    pub ingest_agent_database_url: String,
    pub aws_region: String,
    pub storage_bucket_name: String,
    pub storage_public_base_url: String,
    pub event_feed_revalidation_url: String,
    pub event_feed_revalidation_secret: String,
    pub event_feed_revalidation_timeout_seconds: f64,
    /// False sends nothing: each email is logged and counted as delivered.
    pub email_delivery_enabled: bool,
    pub email_from: String,
    pub frontend_url: String,
    pub email_unsubscribe_secret: String,
}

fn optional(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_owned()
}

/// Pydantic's boolean parsing, so a value Python accepts means the same here.
fn flag(name: &str) -> Result<bool> {
    match optional(name).to_lowercase().as_str() {
        "" | "0" | "off" | "f" | "false" | "n" | "no" => Ok(false),
        "1" | "on" | "t" | "true" | "y" | "yes" => Ok(true),
        other => anyhow::bail!("{name} is not a boolean: {other:?}"),
    }
}

fn required(name: &str) -> Result<String> {
    let value = optional(name);
    anyhow::ensure!(!value.is_empty(), "{name} is not set");
    Ok(value)
}

impl Settings {
    fn load() -> Result<Self> {
        // A missing .env is fine: production-like runs pass real variables.
        let _ = dotenvy::dotenv();
        Ok(Self {
            database_url: required("DATABASE_URL")?,
            ingest_agent_database_url: optional("INGEST_AGENT_DATABASE_URL"),
            aws_region: Some(optional("AWS_REGION"))
                .filter(|region| !region.is_empty())
                .unwrap_or_else(|| "ca-central-1".to_owned()),
            storage_bucket_name: optional("STORAGE_BUCKET_NAME"),
            storage_public_base_url: optional("STORAGE_PUBLIC_BASE_URL")
                .trim_end_matches('/')
                .to_owned(),
            event_feed_revalidation_url: optional("EVENT_FEED_REVALIDATION_URL"),
            event_feed_revalidation_secret: optional("EVENT_FEED_REVALIDATION_SECRET"),
            event_feed_revalidation_timeout_seconds: optional("EVENT_FEED_REVALIDATION_TIMEOUT")
                .parse()
                .unwrap_or(3.0),
            email_delivery_enabled: flag("EMAIL_DELIVERY_ENABLED")?,
            email_from: Some(optional("EMAIL_FROM"))
                .filter(|sender| !sender.is_empty())
                .unwrap_or_else(|| "wat2do <notifications@wat2do.io>".to_owned()),
            frontend_url: Some(optional("FRONTEND_URL"))
                .filter(|url| !url.is_empty())
                .unwrap_or_else(|| "http://localhost:3000".to_owned()),
            // Untrimmed, like Python: the signing key must match the API's byte for byte.
            email_unsubscribe_secret: std::env::var("EMAIL_UNSUBSCRIBE_SECRET").unwrap_or_default(),
        })
    }
}

static SETTINGS: LazyLock<Result<Settings, String>> =
    LazyLock::new(|| Settings::load().map_err(|error| format!("{error:#}")));

/// The loaded settings; the first call reads `.env`.
pub fn settings() -> Result<&'static Settings> {
    SETTINGS
        .as_ref()
        .map_err(|error| anyhow::anyhow!("{error}"))
        .context("invalid settings")
}
