//! Process exact Instagram posts from a forwarded Android notification
//! (the `process-notification` GitHub workflow's job).
//!
//! A digest notification ("account posted and N others") is expanded through the
//! Mac's browser worker first; if that cannot complete, nothing is recorded, so the
//! workflow can be rerun. The ledger then queues each post for ingestion.

use serde_json::{Map, Value};

use super::browser_digest::{DigestResolution, digest_media_count_shortfall};
use super::browser_session::school_account_username;
use super::errors::{BrowserError, BrowserResult};
use super::ledger::{MaterializedMedia, NotificationRecord};
use crate::schools::validate_recipient_id;

const IG_ACTION_KEY: &str = "com.instagram.android.igns.logging.ig_action";
const PUSH_CATEGORY_KEY: &str = "com.instagram.android.igns.logging.push_category";
const PUSH_ID_KEY: &str = "com.instagram.android.igns.logging.push_id";
const RECIPIENT_ID_KEY: &str = "com.instagram.android.igns.logging.intended_recipient_id";
const MEDIA_QUERY_KEYS: [&str; 2] = ["media_list", "media_id"];
const CACHE_ID_KEY: &str = "cache_ent_id";
const TOTAL_MEDIA_COUNT_KEY: &str = "total_non_mmc_media_count";
const ACTIONABLE_CATEGORIES: [&str; 2] = ["post", "subscription_daily_digest"];
const ACTIONABLE_ACTION_PATH: &str = "clips_home";
const SHORTCODE_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// How loudly a line is logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warning,
    Error,
}

/// What the job reaches outside itself: the database, the browser worker's queue and the host.
pub trait NotificationServices {
    /// The school (ID and slug) whose Instagram account is `recipient_id`.
    fn school_for_recipient(&mut self, recipient_id: &str)
    -> anyhow::Result<Option<(i32, String)>>;
    /// Expand a CacheEntID through the browser worker's queue.
    fn resolve_digest(
        &mut self,
        recipient_id: &str,
        account_username: &str,
        cache_ent_id: &str,
    ) -> BrowserResult<DigestResolution>;
    /// Record the notification's media in the ledger: its ID and how many posts were new.
    fn record(&mut self, record: &NotificationRecord) -> anyhow::Result<(String, i64)>;
    /// Whether this is the browser-capable Mac.
    fn is_mac(&self) -> bool;
}

/// A notification that cannot be processed, with a message safe for workflow logs.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PayloadError(String);

impl From<BrowserError> for PayloadError {
    fn from(error: BrowserError) -> Self {
        Self(error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedNotification {
    action_path: String,
    explicit_media: Vec<MaterializedMedia>,
    cache_ent_id: Option<String>,
    total_media_count: Option<i64>,
}

/// Convert a numeric Instagram media ID to its base64 shortcode.
pub fn shortcode_from_media_id(media_id: u128) -> String {
    let mut media_id = media_id;
    let mut shortcode = Vec::new();
    while media_id > 0 {
        shortcode.push(SHORTCODE_ALPHABET[(media_id % 64) as usize]);
        media_id /= 64;
    }
    shortcode.reverse();
    String::from_utf8(shortcode).expect("the alphabet is ASCII")
}

fn media_target(media_id: &str) -> MaterializedMedia {
    let numeric: u128 = media_id
        .parse()
        .expect("validated media IDs are at most 32 digits");
    MaterializedMedia {
        media_id: media_id.to_owned(),
        source_url: format!(
            "https://www.instagram.com/p/{}/",
            shortcode_from_media_id(numeric)
        ),
    }
}

/// `urllib.parse.parse_qs(query, keep_blank_values=True)`, as ordered pairs.
fn parse_query(query: &str) -> Vec<(String, String)> {
    url::form_urlencoded::parse(query.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

fn query_values<'a>(query: &'a [(String, String)], key: &'a str) -> impl Iterator<Item = &'a str> {
    query
        .iter()
        .filter(move |(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

fn action_query(
    payload: &Map<String, Value>,
) -> Result<(String, Vec<(String, String)>), PayloadError> {
    let action = match payload.get(IG_ACTION_KEY) {
        None => "",
        Some(Value::String(action)) => action.as_str(),
        Some(_) => return Err(PayloadError("Notification action must be a string.".into())),
    };
    Ok(match action.split_once('?') {
        Some((path, query)) => (path.to_owned(), parse_query(query)),
        None => (action.to_owned(), Vec::new()),
    })
}

fn metadata_value(
    payload: &Map<String, Value>,
    query: &[(String, String)],
    key: &str,
) -> Result<Option<String>, PayloadError> {
    let empty = || PayloadError(format!("Notification {key} cannot be empty."));
    let mut values = Vec::new();
    for value in query_values(query, key) {
        let normalized = value.trim();
        if normalized.is_empty() {
            return Err(empty());
        }
        values.push(normalized.to_owned());
    }
    if let Some(value) = payload.get(key) {
        let text = match value {
            Value::String(text) => text.clone(),
            Value::Number(number) if number.is_i64() || number.is_u64() => number.to_string(),
            _ => {
                return Err(PayloadError(format!(
                    "Notification {key} has an invalid type."
                )));
            }
        };
        let normalized = text.trim();
        if normalized.is_empty() {
            return Err(empty());
        }
        values.push(normalized.to_owned());
    }
    let Some(first) = values.first() else {
        return Ok(None);
    };
    if values.iter().any(|value| value != first) {
        return Err(PayloadError(format!("Notification {key} values conflict.")));
    }
    Ok(Some(first.clone()))
}

fn parse_media_id(raw: &str) -> Result<String, PayloadError> {
    let invalid = || PayloadError("Notification contains an invalid media ID.".into());
    let media_id = raw.trim().split('_').next().unwrap_or_default();
    if media_id.is_empty()
        || media_id.len() > 32
        || !media_id.bytes().all(|byte| byte.is_ascii_digit())
        || media_id.starts_with('0')
    {
        return Err(invalid());
    }
    Ok(media_id.to_owned())
}

fn parse_notification(payload: &Map<String, Value>) -> Result<ParsedNotification, PayloadError> {
    let (action_path, query) = action_query(payload)?;
    let mut explicit_media: Vec<MaterializedMedia> = Vec::new();
    for key in MEDIA_QUERY_KEYS {
        for value in query_values(&query, key) {
            for raw in value.split(',') {
                let media_id = parse_media_id(raw)?;
                if !explicit_media.iter().any(|item| item.media_id == media_id) {
                    explicit_media.push(media_target(&media_id));
                }
            }
        }
    }
    let cache_ent_id = metadata_value(payload, &query, CACHE_ID_KEY)?;
    if cache_ent_id
        .as_ref()
        .is_some_and(|id| id.chars().count() > 255)
    {
        return Err(PayloadError("Notification cache_ent_id is invalid.".into()));
    }
    let total_media_count = metadata_value(payload, &query, TOTAL_MEDIA_COUNT_KEY)?
        .map(|count| {
            count
                .parse::<i64>()
                .ok()
                .filter(|_| count.bytes().all(|byte| byte.is_ascii_digit()))
                .ok_or_else(|| {
                    PayloadError("Notification total_non_mmc_media_count is invalid.".into())
                })
        })
        .transpose()?;
    Ok(ParsedNotification {
        action_path,
        explicit_media,
        cache_ent_id,
        total_media_count,
    })
}

fn required_payload_text(
    payload: &Map<String, Value>,
    key: &str,
    label: &str,
    maximum_length: usize,
) -> Result<String, PayloadError> {
    match payload.get(key) {
        Some(Value::String(value))
            if !value.trim().is_empty() && value.trim().chars().count() <= maximum_length =>
        {
            Ok(value.trim().to_owned())
        }
        _ => Err(PayloadError(format!(
            "Actionable notification requires a valid {label}."
        ))),
    }
}

fn resolve_recipient(
    payload: &Map<String, Value>,
    intended_recipient_id: &str,
) -> Result<String, PayloadError> {
    let intended = validate_recipient_id(intended_recipient_id.trim()).map_err(|_| {
        PayloadError("Actionable notification requires a valid intended recipient ID.".into())
    })?;
    match payload.get(RECIPIENT_ID_KEY) {
        None | Some(Value::Null) => Ok(intended),
        Some(Value::String(recipient)) if recipient.trim() == intended => Ok(intended),
        Some(_) => Err(PayloadError(
            "Notification intended recipient does not match workflow routing.".into(),
        )),
    }
}

fn is_supported_category(payload: &Map<String, Value>) -> bool {
    payload
        .get(PUSH_CATEGORY_KEY)
        .and_then(Value::as_str)
        .is_some_and(|category| ACTIONABLE_CATEGORIES.contains(&category))
}

fn validate_actionable(notification: &ParsedNotification) -> Result<(), PayloadError> {
    if notification.action_path != ACTIONABLE_ACTION_PATH {
        return Err(PayloadError(
            "Actionable notification has an unsupported Instagram action.".into(),
        ));
    }
    if notification.explicit_media.is_empty() && notification.cache_ent_id.is_none() {
        return Err(PayloadError(
            "Actionable notification contains no Instagram media identity.".into(),
        ));
    }
    Ok(())
}

fn materialize_media(
    notification: &ParsedNotification,
    intended_recipient_id: &str,
    account_username: &str,
    services: &mut dyn NotificationServices,
    log: &mut dyn FnMut(Level, String),
) -> Result<Vec<MaterializedMedia>, PayloadError> {
    let mut materialized = notification.explicit_media.clone();
    let count = |media: &[MaterializedMedia]| media.len() as i64;
    let mut shortfall =
        digest_media_count_shortfall(count(&materialized), notification.total_media_count)?;
    if let Some(cache_ent_id) = &notification.cache_ent_id
        && (notification.total_media_count.is_none() || shortfall != 0)
    {
        if !services.is_mac() {
            return Err(PayloadError(
                "CacheEntID expansion requires the browser-capable Mac runner".into(),
            ));
        }
        let resolution =
            services.resolve_digest(intended_recipient_id, account_username, cache_ent_id)?;
        for raw in &resolution.media_ids {
            let media_id = parse_media_id(raw)?;
            if !materialized.iter().any(|item| item.media_id == media_id) {
                materialized.push(media_target(&media_id));
            }
        }
        shortfall =
            digest_media_count_shortfall(count(&materialized), notification.total_media_count)?;
        log(
            Level::Info,
            format!(
                "Expanded Instagram digest through {} to {} exact media target(s).",
                resolution.account_username,
                materialized.len()
            ),
        );
    }
    if shortfall != 0 {
        log(
            Level::Warning,
            format!(
                "Instagram returned {} of {} advertised media items; processing all media available from the terminal digest page.",
                materialized.len(),
                notification.total_media_count.unwrap_or_default()
            ),
        );
    }
    Ok(materialized)
}

/// What the run printed for GitHub, beside its log lines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Processed {
    pub exit_code: i32,
    /// The success line for a `::notice::` annotation.
    pub notice: Option<String>,
}

/// Process `NOTIFICATION_JSON` routed to `INTENDED_RECIPIENT_ID`.
pub fn process(
    notification_json: &str,
    intended_recipient_id: &str,
    services: &mut dyn NotificationServices,
    log: &mut dyn FnMut(Level, String),
) -> Processed {
    let failed = Processed {
        exit_code: 1,
        notice: None,
    };
    let payload_text = notification_json.trim();
    if payload_text.is_empty() {
        log(
            Level::Error,
            "NOTIFICATION_JSON environment variable is empty or not set.".into(),
        );
        return failed;
    }
    let payload: Value = match serde_json::from_str(payload_text) {
        Ok(payload) => payload,
        Err(error) => {
            log(
                Level::Error,
                format!("Failed to decode NOTIFICATION_JSON: {error}"),
            );
            return failed;
        }
    };
    let Value::Object(payload) = payload else {
        log(
            Level::Error,
            "NOTIFICATION_JSON must contain a JSON object.".into(),
        );
        return failed;
    };
    if !is_supported_category(&payload) {
        log(
            Level::Info,
            "Ignoring unsupported Instagram notification.".into(),
        );
        return Processed {
            exit_code: 0,
            notice: None,
        };
    }
    let notification = match parse_notification(&payload)
        .and_then(|parsed| validate_actionable(&parsed).map(|()| parsed))
    {
        Ok(notification) => notification,
        Err(PayloadError(message)) => {
            log(Level::Error, message);
            return failed;
        }
    };
    let routed = (|| -> Result<Result<_, PayloadError>, anyhow::Error> {
        let routing = (|| {
            let recipient = resolve_recipient(&payload, intended_recipient_id)?;
            let push_id = required_payload_text(&payload, PUSH_ID_KEY, "push ID", 255)?;
            let push_category =
                required_payload_text(&payload, PUSH_CATEGORY_KEY, "push category", 100)?;
            Ok((recipient, push_id, push_category))
        })();
        let (recipient, push_id, push_category) = match routing {
            Ok(routing) => routing,
            Err(error) => return Ok(Err(error)),
        };
        let Some((school_id, slug)) = services.school_for_recipient(&recipient)? else {
            return Ok(Err(PayloadError(
                "No school mapping exists for the notification recipient.".into(),
            )));
        };
        let username = school_account_username(&slug).map_err(anyhow::Error::msg)?;
        Ok(Ok((recipient, push_id, push_category, school_id, username)))
    })();
    let (recipient, push_id, push_category, school_id, username) = match routed {
        Ok(Ok(routing)) => routing,
        Ok(Err(PayloadError(message))) => {
            log(Level::Error, message);
            return failed;
        }
        // Do not expose database or upstream internals.
        Err(_) => {
            log(
                Level::Error,
                "Instagram notification routing failed unexpectedly.".into(),
            );
            return failed;
        }
    };
    let media = match materialize_media(&notification, &recipient, &username, services, log) {
        Ok(media) => media,
        Err(PayloadError(message)) => {
            log(Level::Error, message);
            return failed;
        }
    };
    let record = NotificationRecord {
        school_id,
        intended_recipient_id: recipient,
        push_id,
        push_category,
        cache_ent_id: notification.cache_ent_id.clone(),
        total_non_mmc_media_count: notification.total_media_count,
        media: media.clone(),
    };
    let newly_inserted_count = match services.record(&record) {
        Ok((_, newly_inserted_count)) => newly_inserted_count,
        // Database details must not enter workflow output.
        Err(_) => {
            log(
                Level::Error,
                "Instagram notification ledger recording failed.".into(),
            );
            return failed;
        }
    };
    let message = format!(
        "Successfully queued {newly_inserted_count} new Instagram posts (ignored {} duplicates) to the ledger.",
        media.len() as i64 - newly_inserted_count
    );
    log(Level::Info, message.clone());
    Processed {
        exit_code: 0,
        notice: Some(message),
    }
}

/// The real services: Postgres through `DATABASE_URL` and the worker's local queue.
#[derive(Default)]
pub struct LiveServices {
    db: Option<crate::db::BlockingPool>,
}

impl LiveServices {
    fn database(&mut self) -> anyhow::Result<&crate::db::BlockingPool> {
        if self.db.is_none() {
            self.db = Some(crate::db::BlockingPool::connect(2)?);
        }
        Ok(self.db.as_ref().expect("connected above"))
    }
}

impl NotificationServices for LiveServices {
    fn school_for_recipient(
        &mut self,
        recipient_id: &str,
    ) -> anyhow::Result<Option<(i32, String)>> {
        let recipient_id = recipient_id.to_owned();
        let school = self.database()?.run(|pool| async move {
            crate::schools::routing_by_recipient_id(&pool, &recipient_id).await
        })?;
        Ok(school.map(|school| (school.id, school.slug)))
    }

    fn resolve_digest(
        &mut self,
        recipient_id: &str,
        account_username: &str,
        cache_ent_id: &str,
    ) -> BrowserResult<DigestResolution> {
        let queue =
            super::browser_queue::BrowserJobQueue::open(None, crate::host::RealHost::shared())
                .map_err(|_| {
                    BrowserError::digest("Instagram browser queue storage is unavailable")
                })?;
        queue.resolve_digest(recipient_id, account_username, cache_ent_id)
    }

    fn record(&mut self, record: &NotificationRecord) -> anyhow::Result<(String, i64)> {
        let record = record.clone();
        self.database()?.run(|pool| async move {
            super::ledger::record_notification_media(&pool, &record).await
        })
    }

    fn is_mac(&self) -> bool {
        cfg!(target_os = "macos")
    }
}

/// Lines logged at ERROR, flushed as one workflow annotation at exit
/// (`core.logging.GitHubActionErrorHandler`): GitHub keeps ten annotations per step.
pub fn error_annotation(errors: &[String]) -> Option<String> {
    if errors.is_empty() {
        return None;
    }
    let compacted: Vec<String> = errors
        .iter()
        .map(|message| message.replace('\n', " "))
        .collect();
    Some(format!("::error::{}", compacted.join(" \\n")))
}

/// The Python suite's cases, ported.
#[cfg(test)]
#[path = "tests/process_notification.rs"]
mod python_tests;
