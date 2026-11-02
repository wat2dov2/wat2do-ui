//! Environment settings, read from the process environment after loading
//! `backend/.env` (the working directory of every wat2do service).
//! Names, defaults and parsing match `backend/core/config.py` (pydantic-settings).

use std::sync::LazyLock;

use anyhow::{Context, Result};
use regex::Regex;

pub struct Settings {
    /// "development", "testing" or "production".
    pub environment: String,
    pub database_url: String,
    /// Base64 PKCS#8 DER of the EC P-256 key that signs our access tokens.
    pub auth_signing_key: String,
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
    pub email_unsubscribe_secret: String,
    /// Exact origins the API answers cross-origin requests from.
    pub cors_origins: Vec<String>,
    /// Trusted dynamic origins (school subdomains), matched in full.
    pub cors_origin_regex: Option<Regex>,
    pub cookie_domain: String,
    pub cookie_secure: bool,
    pub refresh_cookie_path: String,
    pub poster_visitor_cookie_path: String,
    pub frontend_url: String,
    /// `TRUSTED_PROXIES`: peers whose client-IP headers `client_ip` believes.
    pub trusted_proxies: Vec<String>,
    /// uvicorn's `FORWARDED_ALLOW_IPS`: peers whose `X-Forwarded-For` and
    /// `X-Forwarded-Proto` rewrite the request's client and scheme.
    pub forwarded_allow_ips: Vec<String>,
}

/// The defaults `core/config.py` uses when a variable is unset.
const DEFAULT_CORS_ORIGINS: &[&str] = &["http://localhost:3000"];
const DEFAULT_TRUSTED_PROXIES: &[&str] = &["127.0.0.1", "::1"];
/// uvicorn's own default for `FORWARDED_ALLOW_IPS`.
const DEFAULT_FORWARDED_ALLOW_IPS: &str = "127.0.0.1,::1";

impl Settings {
    fn load() -> Result<Self> {
        // A missing .env is fine: production-like runs pass real variables.
        let _ = dotenvy::dotenv();
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Build settings from `lookup` (the environment, or a map in tests).
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let optional = |name: &str| lookup(name).unwrap_or_default().trim().to_owned();
        let required = |name: &str| {
            let value = optional(name);
            anyhow::ensure!(!value.is_empty(), "{name} is not set");
            Ok(value)
        };
        let or_default = |name: &str, default: &str| {
            Some(optional(name))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| default.to_owned())
        };
        let list = |name: &str, default: &[&str]| -> Result<Vec<String>> {
            let raw = optional(name);
            if raw.is_empty() {
                return Ok(default.iter().map(|value| (*value).to_owned()).collect());
            }
            // pydantic-settings reads list fields as JSON.
            serde_json::from_str(&raw).with_context(|| format!("{name} must be a JSON list"))
        };
        let cors_origin_regex = Some(optional("CORS_ORIGIN_REGEX"))
            .filter(|pattern| !pattern.is_empty())
            .map(|pattern| {
                // Python matches with `re.fullmatch`.
                Regex::new(&format!("^(?:{pattern})$")).context("CORS_ORIGIN_REGEX is invalid")
            })
            .transpose()?;
        Ok(Self {
            environment: or_default("ENVIRONMENT", "development"),
            database_url: required("DATABASE_URL")?,
            auth_signing_key: optional("AUTH_SIGNING_KEY"),
            ingest_agent_database_url: optional("INGEST_AGENT_DATABASE_URL"),
            aws_region: or_default("AWS_REGION", "ca-central-1"),
            storage_bucket_name: optional("STORAGE_BUCKET_NAME"),
            storage_public_base_url: optional("STORAGE_PUBLIC_BASE_URL")
                .trim_end_matches('/')
                .to_owned(),
            event_feed_revalidation_url: optional("EVENT_FEED_REVALIDATION_URL"),
            event_feed_revalidation_secret: optional("EVENT_FEED_REVALIDATION_SECRET"),
            event_feed_revalidation_timeout_seconds: optional("EVENT_FEED_REVALIDATION_TIMEOUT")
                .parse()
                .unwrap_or(3.0),
            email_delivery_enabled: parse_bool(
                "EMAIL_DELIVERY_ENABLED",
                &optional("EMAIL_DELIVERY_ENABLED"),
                false,
            )?,
            email_from: or_default("EMAIL_FROM", "wat2do <notifications@wat2do.io>"),
            // Untrimmed, like Python: the signing key must match the API's byte for byte.
            email_unsubscribe_secret: lookup("EMAIL_UNSUBSCRIBE_SECRET").unwrap_or_default(),
            cors_origins: list("CORS_ORIGINS", DEFAULT_CORS_ORIGINS)?,
            cors_origin_regex,
            cookie_domain: optional("COOKIE_DOMAIN"),
            cookie_secure: parse_bool("COOKIE_SECURE", &optional("COOKIE_SECURE"), true)?,
            refresh_cookie_path: or_default("REFRESH_COOKIE_PATH", "/auth/refresh"),
            poster_visitor_cookie_path: or_default("POSTER_VISITOR_COOKIE_PATH", "/qr"),
            frontend_url: or_default("FRONTEND_URL", "http://localhost:3000"),
            trusted_proxies: list("TRUSTED_PROXIES", DEFAULT_TRUSTED_PROXIES)?,
            forwarded_allow_ips: or_default("FORWARDED_ALLOW_IPS", DEFAULT_FORWARDED_ALLOW_IPS)
                .split(',')
                .map(|host| host.trim().to_owned())
                .collect(),
        })
    }

    pub fn is_production(&self) -> bool {
        self.environment.eq_ignore_ascii_case("production")
    }

    /// `Settings.is_allowed_origin`: an exact configured origin or a full
    /// match of `CORS_ORIGIN_REGEX`.
    pub fn is_allowed_origin(&self, origin: Option<&str>) -> bool {
        let Some(origin) = origin.filter(|origin| !origin.is_empty()) else {
            return false;
        };
        self.cors_origins.iter().any(|allowed| allowed == origin)
            || self
                .cors_origin_regex
                .as_ref()
                .is_some_and(|regex| regex.is_match(origin))
    }
}

/// pydantic's lax boolean parsing of a string.
fn parse_bool(name: &str, raw: &str, default: bool) -> Result<bool> {
    match raw.to_ascii_lowercase().as_str() {
        "" => Ok(default),
        "1" | "on" | "t" | "true" | "y" | "yes" => Ok(true),
        "0" | "off" | "f" | "false" | "n" | "no" => Ok(false),
        _ => anyhow::bail!("{name} must be a boolean"),
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

#[cfg(test)]
pub(crate) fn test_settings(overrides: &[(&str, &str)]) -> Settings {
    let mut values: std::collections::HashMap<String, String> = [
        ("DATABASE_URL", "postgres://localhost/wat2do".to_owned()),
        (
            "AUTH_SIGNING_KEY",
            crate::api::auth::test_tokens::signing_key(),
        ),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value))
    .collect();
    for (name, value) in overrides {
        values.insert((*name).to_owned(), (*value).to_owned());
    }
    Settings::from_lookup(|name| values.get(name).cloned()).expect("valid test settings")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revalidation_url_and_secret_are_stripped_like_python() {
        // event_feed_revalidation.py strips both before use.
        let settings = test_settings(&[
            (
                "EVENT_FEED_REVALIDATION_URL",
                "  https://wat2do.io/api/revalidate \n",
            ),
            ("EVENT_FEED_REVALIDATION_SECRET", "\tsecret  "),
        ]);
        assert_eq!(
            settings.event_feed_revalidation_url,
            "https://wat2do.io/api/revalidate"
        );
        assert_eq!(settings.event_feed_revalidation_secret, "secret");
        let blank = test_settings(&[("EVENT_FEED_REVALIDATION_URL", "   ")]);
        assert!(blank.event_feed_revalidation_url.is_empty());
    }

    #[test]
    fn defaults_match_core_config() {
        let settings = test_settings(&[]);
        assert_eq!(settings.environment, "development");
        assert!(!settings.is_production());
        assert_eq!(settings.cors_origins, ["http://localhost:3000"]);
        assert!(settings.cors_origin_regex.is_none());
        assert!(settings.cookie_secure);
        assert_eq!(settings.refresh_cookie_path, "/auth/refresh");
        assert_eq!(settings.poster_visitor_cookie_path, "/qr");
        assert_eq!(settings.trusted_proxies, ["127.0.0.1", "::1"]);
        assert_eq!(settings.forwarded_allow_ips, ["127.0.0.1", "::1"]);
    }

    #[test]
    fn is_production_ignores_case() {
        assert!(test_settings(&[("ENVIRONMENT", "Production")]).is_production());
        assert!(test_settings(&[("ENVIRONMENT", "production")]).is_production());
        assert!(!test_settings(&[("ENVIRONMENT", "testing")]).is_production());
    }

    #[test]
    fn lists_are_json_and_booleans_are_lax() {
        let settings = test_settings(&[
            (
                "CORS_ORIGINS",
                r#"["https://wat2do.io","https://www.wat2do.io"]"#,
            ),
            ("COOKIE_SECURE", "False"),
            ("TRUSTED_PROXIES", r#"["10.0.0.0/8"]"#),
        ]);
        assert_eq!(
            settings.cors_origins,
            ["https://wat2do.io", "https://www.wat2do.io"]
        );
        assert!(!settings.cookie_secure);
        assert_eq!(settings.trusted_proxies, ["10.0.0.0/8"]);
        let lookup = |name: &str| match name {
            "CORS_ORIGINS" => Some("https://wat2do.io".to_owned()),
            _ => Some("x".to_owned()),
        };
        assert!(Settings::from_lookup(lookup).is_err());
    }

    #[test]
    fn allowed_origins_match_exactly_or_by_full_regex() {
        let settings = test_settings(&[
            ("CORS_ORIGINS", r#"["https://wat2do.io"]"#),
            ("CORS_ORIGIN_REGEX", "^https://[a-z0-9-]+[.]wat2do.io$"),
        ]);
        assert!(settings.is_allowed_origin(Some("https://wat2do.io")));
        assert!(settings.is_allowed_origin(Some("https://uwaterloo.wat2do.io")));
        assert!(!settings.is_allowed_origin(Some("https://uwaterloo.wat2do.io.evil.com")));
        assert!(!settings.is_allowed_origin(Some("https://wat2do.io/")));
        assert!(!settings.is_allowed_origin(Some("")));
        assert!(!settings.is_allowed_origin(None));
        let unanchored = test_settings(&[("CORS_ORIGIN_REGEX", "https://a[.]io")]);
        assert!(!unanchored.is_allowed_origin(Some("https://a.io.evil")));
        assert!(unanchored.is_allowed_origin(Some("https://a.io")));
    }
}
