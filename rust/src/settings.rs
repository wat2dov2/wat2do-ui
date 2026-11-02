//! Environment settings, read from the process environment after loading
//! `backend/.env` (the working directory of every wat2do service on the Mac).
//! Names match `backend/core/config.py`.

use std::sync::LazyLock;

use anyhow::{Context, Result};

pub struct Settings {
    pub database_url: String,
    pub supabase_url: String,
    pub supabase_secret_key: String,
    pub ingest_agent_database_url: String,
    pub aws_region: String,
    pub storage_bucket_name: String,
    pub storage_public_base_url: String,
    pub event_feed_revalidation_url: String,
    pub event_feed_revalidation_secret: String,
    pub event_feed_revalidation_timeout_seconds: f64,
}

fn optional(name: &str) -> String {
    std::env::var(name).unwrap_or_default().trim().to_owned()
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
            supabase_url: required("SUPABASE_URL")?,
            supabase_secret_key: required("SUPABASE_SECRET_KEY")?,
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
