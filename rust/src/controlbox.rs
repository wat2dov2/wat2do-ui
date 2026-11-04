//! Typed views of the `backend/controlbox/*.json` files the Rust services use.
//!
//! The JSON is embedded at compile time, so a binary runs with the settings of
//! the checkout it was built from; `core.controlbox` in Python validates the
//! complete files, and these structs read only the fields Rust needs.

use std::collections::HashMap;
use std::sync::LazyLock;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::constants::{
    NOTIFICATION_TYPE_EVENT_CHANGE, NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
};

fn parse<T: DeserializeOwned>(name: &str, json: &str) -> T {
    serde_json::from_str(json)
        .unwrap_or_else(|error| panic!("backend/controlbox/{name}.json: {error}"))
}

/// `controlbox/api_server.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiServer {
    pub python_port: u16,
    pub python_keep_alive_seconds: u64,
    pub python_probe_interval_milliseconds: u64,
    pub python_probe_timeout_seconds: f64,
    pub python_shutdown_seconds: u64,
    pub shutdown_drain_seconds: u64,
    pub upstream_idle_seconds: u64,
    pub database_connections: u32,
    pub database_idle_seconds: u64,
    pub database_acquire_seconds: f64,
    pub database_statement_timeout_milliseconds: u64,
}

/// `controlbox/authentication.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Authentication {
    pub session_cookie_days: i64,
    pub verification_token_minutes: i64,
    pub access_token_minutes: i64,
    /// Wrong six-digit codes an address may try per window.
    pub code_guess_limit: usize,
    pub code_guess_window_minutes: i64,
    /// A just-rotated refresh token still returns its successor for this long.
    pub refresh_token_reuse_seconds: i64,
    /// The `iss` of every access token we sign and accept.
    pub token_issuer: String,
    pub google_client_id: String,
    pub legacy_frontend_origins: Vec<String>,
}

/// `controlbox/contact.json`: who receives contact and sponsor messages, and their limits.
#[derive(Debug, Deserialize)]
pub struct Contact {
    pub recipient_emails: Vec<String>,
    pub maximum_message_length: usize,
    pub business_support: BusinessSupport,
    pub rate_limit: RateLimit,
}

/// The sponsor nomination field limits in `controlbox/contact.json`.
#[derive(Debug, Deserialize)]
pub struct BusinessSupport {
    pub business_name: usize,
}

/// The read retry policy in `controlbox/database.json`.
#[derive(Debug, Deserialize)]
pub struct Database {
    pub read_attempts: u32,
    pub read_backoff_initial_seconds: f64,
    pub read_backoff_max_seconds: f64,
    pub read_backoff_jitter_seconds: f64,
}

/// One limiter's budget in `controlbox/rate_limits.json`.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct RateLimit {
    pub maximum_requests: usize,
    pub window_seconds: u64,
}

/// The request budgets in `controlbox/rate_limits.json`.
#[derive(Debug, Deserialize)]
pub struct RateLimits {
    pub default: RateLimit,
    pub authentication: RateLimit,
    pub sensitive_authentication: RateLimit,
    pub token_refresh: RateLimit,
    pub anonymous_interactions: RateLimit,
    pub qr_scans: RateLimit,
    pub reports: RateLimit,
    pub submissions: RateLimit,
    pub calendar_feed: RateLimit,
    pub maximum_saved_clubs_per_user: i64,
}

/// `controlbox/ingestion.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ingestion {
    pub model: String,
    pub parallel_agents: usize,
    pub fetch_lanes: usize,
    pub fetch_impersonate: String,
    pub fetch_block_pause_seconds: u64,
    pub retry_backoff_seconds: u64,
    pub database_retry_seconds: f64,
    pub listener_probe_seconds: f64,
    pub directory_agents: usize,
    pub directory_items_per_run: usize,
    pub directory_horizon_days: u32,
    pub directory_listing_max_bytes: usize,
    pub directory_model_timeout_seconds: u64,
    pub directory_scrape_interval_seconds: u64,
    pub claim_lease_seconds: i32,
    pub max_attempts: i32,
    pub model_timeout_seconds: u64,
    pub max_images_per_item: usize,
    pub fetch_timeout_seconds: f64,
    pub club_logo_read_delay_seconds: f64,
    pub club_logo_retry_days: u64,
    pub launch_agent_timeout_seconds: f64,
}

/// The event image and video limits in `controlbox/uploads.json`.
#[derive(Debug, Deserialize)]
pub struct Uploads {
    pub event_image_allowed_mime_types: Vec<String>,
    pub event_image_max_size_bytes: usize,
    pub event_image_rendition_width_pixels: u32,
    pub event_image_rendition_quality: u8,
    pub event_video_max_size_bytes: usize,
    pub event_video_download_timeout_seconds: u64,
}

/// The directory image floor and Instagram's web app ID in `controlbox/scraping.json`.
#[derive(Debug, Deserialize)]
pub struct Scraping {
    pub directory_minimum_image_dimension_pixels: u32,
    pub instagram_web_app_id: String,
}

/// `controlbox/instagram_browser.json`, every field.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstagramBrowser {
    pub request_timeout_seconds: f64,
    pub apple_event_timeout_seconds: f64,
    pub navigation_interval_seconds: f64,
    pub rate_limit_backoff_seconds: f64,
    pub rate_limit_max_backoff_seconds: f64,
    pub rate_limit_recovery_seconds: f64,
    pub viewport_warm_timeout_seconds: f64,
    pub primary_minimum_viewport_width: u32,
    pub worker_window_height: u32,
    pub worker_window_idle_seconds: f64,
    pub worker_window_idle_wait_seconds: f64,
    pub login_recovery_timeout_seconds: f64,
    pub login_recovery_interval_seconds: f64,
    pub login_recovery_retry_seconds: f64,
    pub login_recovery_daily_limit: usize,
    pub account_login_daily_limit: usize,
    pub login_from_school: String,
    pub login_keychain_service: String,
    pub login_code_email: String,
    pub login_code_keychain_service: String,
    pub login_code_imap_host: String,
    pub login_code_wait_seconds: f64,
    pub interaction_timeout_seconds: f64,
    pub account_transition_grace_seconds: f64,
    pub secondary_cleanup_timeout_seconds: f64,
    pub poll_interval_seconds: f64,
    pub worker_poll_interval_seconds: f64,
    pub job_timeout_seconds: f64,
    pub result_timeout_seconds: f64,
    pub source_poll_interval_seconds: f64,
    pub source_page_size: usize,
    pub engagement_interval_seconds: f64,
    pub engagement_max_wait_seconds: f64,
    pub bootstrap_profile_school: String,
    /// School slug to the name Brave's account switcher shows, in the file's order.
    pub school_switcher_username_overrides: IndexMap<String, String>,
    pub actions: Vec<String>,
    pub parallel_tabs: usize,
    pub tab_health_interval_seconds: f64,
    pub profile_post_limit: usize,
    pub ingestion_retry_limit: i64,
    pub bridge_retry_limit: usize,
    pub storage_busy_timeout_seconds: f64,
    pub storage_retry_limit: usize,
    pub storage_retry_interval_seconds: f64,
    pub worker_log_max_bytes: u64,
    pub worker_log_backup_count: usize,
}

/// `controlbox/instagram_digest.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstagramDigest {
    pub endpoint_url: String,
    pub operation_name: String,
    pub client_doc_id: String,
    pub web_app_id: String,
    pub maximum_pages: i64,
}

/// `controlbox/notification_retry.json`, every field.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationRetry {
    pub schedule_hour: u32,
    pub schedule_minute: u32,
    pub launch_agent_timeout_seconds: f64,
    pub github_repo: String,
    pub workflow_name: String,
    pub lookback_hours: u32,
    pub login_first_school: String,
    pub reruns_per_day: usize,
    pub max_reruns_per_run: i64,
}

/// The campus seasons, map views and map geocoding in `controlbox/event_discovery.json`.
#[derive(Debug, Deserialize)]
pub struct EventDiscovery {
    /// How long an occurrence without an end stays listed after it starts.
    pub event_without_end_visibility_minutes: i64,
    pub campus_seasons: CampusSeasons,
    pub map_geocoding: MapGeocoding,
    pub views: EventViews,
}

/// The map views' campus centers (`[longitude, latitude]` per school).
#[derive(Debug, Deserialize)]
pub struct EventViews {
    pub map_campus_centers: HashMap<String, (f64, f64)>,
}

#[derive(Debug, Deserialize)]
pub struct CampusSeasons {
    pub definitions: HashMap<String, SeasonDefinition>,
    pub schools: HashMap<String, SchoolSeasons>,
}

#[derive(Debug, Deserialize)]
pub struct SeasonDefinition {
    /// Per language, in the file's order (the schools API lists them so).
    pub labels: IndexMap<String, String>,
    pub instructions: String,
}

#[derive(Debug, Deserialize)]
pub struct SchoolSeasons {
    pub instructions: String,
    pub seasons: Vec<SchoolSeason>,
}

#[derive(Debug, Deserialize)]
pub struct SchoolSeason {
    pub id: String,
    pub instructions: String,
    pub display_windows: Vec<DisplayWindow>,
}

/// When a season shows as a discovery filter; `filter_id` names a narrower
/// filter (Thanksgiving within holidays) that shares the season's tagging.
#[derive(Debug, Deserialize)]
pub struct DisplayWindow {
    pub start_date: chrono::NaiveDate,
    pub end_date: chrono::NaiveDate,
    #[serde(default)]
    pub filter_id: Option<String>,
}

/// `controlbox/club_management.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClubManagement {
    pub directory_page_size: u32,
    pub invite_expiration_days: i64,
    pub initial_render_count: u32,
    /// Python's cache of a school's clubs for name lookups; the events routes
    /// also reuse school lookups and directory logos this long.
    pub school_lookup_cache_seconds: f64,
}

/// The server-side limits in `controlbox/discovery_queries.json`.
#[derive(Debug, Deserialize)]
pub struct DiscoveryQueries {
    pub excluded_account_emails: Vec<String>,
    pub maximum_search_length: usize,
    pub maximum_page_url_length: usize,
    pub maximum_filters_bytes: usize,
    pub rate_limit: RateLimit,
}

/// `controlbox/promoter_program.json` (Python's `PromoterProgramControl`
/// validates it; the fields Rust reads are here).
#[derive(Debug, Clone, Deserialize)]
pub struct PromoterProgram {
    pub enabled: bool,
    pub rate_cents: i64,
    pub maximum_active_posters: i64,
    pub landing_confirmation_seconds: i64,
    pub confirmation_token_minutes: i64,
    pub quiet_poster_days: i64,
    pub map_coordinate_decimal_places: i32,
    /// The most confirmed visitors a map cell may have to read as none, low and medium.
    pub map_visitor_bucket_maximums: [i64; 3],
    pub risk_rules_version: String,
    pub rapid_distinct_visitors: usize,
    pub rapid_window_seconds: i64,
    pub rapid_rule_points: i64,
    pub hold_score_threshold: i64,
    pub tos_version: String,
    pub approved_templates: Vec<PromoterTemplate>,
}

/// One approved poster template of the promoter program.
#[derive(Debug, Clone, Deserialize)]
pub struct PromoterTemplate {
    pub id: String,
    pub asset_path: String,
    /// "global" or one school's slug.
    pub eligible_school: String,
    pub available_for_creation: bool,
}

/// `controlbox/positions.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Positions {
    /// An undated position stays listed this many months after it is added.
    pub undated_visibility_months: u32,
}

/// Map location lookups with OpenStreetMap's Nominatim (`map_location_service`).
#[derive(Debug, Deserialize)]
pub struct MapGeocoding {
    pub search_url: String,
    pub user_agent: String,
    pub request_interval_seconds: f64,
    pub request_timeout_seconds: f64,
    pub search_radius_degrees: f64,
    pub candidate_count: u32,
    pub not_found_retry_days: i64,
    pub claim_lease_seconds: i32,
    pub idle_poll_seconds: f64,
    pub feed_refresh_seconds: f64,
    /// Per school, building name to `[longitude, latitude]`, in the file's order.
    pub known_places: HashMap<String, IndexMap<String, (f64, f64)>>,
    /// Per school, building code to building name, in the file's order.
    pub building_codes: HashMap<String, IndexMap<String, String>>,
}

/// `controlbox/public_attendance.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicAttendance {
    pub maximum_display_names: usize,
}

/// `controlbox/interaction_ingestion.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InteractionIngestion {
    pub default_query_limit: usize,
    pub maximum_batch_size: usize,
    pub maximum_metadata_bytes: usize,
    pub maximum_duplicates_per_window: usize,
    pub deduplication_window_minutes: i64,
    pub maximum_user_interactions_per_window: usize,
    pub maximum_anonymous_clicks_per_ip_per_event: usize,
}

/// `controlbox/morning_email.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MorningEmail {
    pub local_send_hour: u32,
    /// Catch-up for skipped scheduled runs: send any time from `local_send_hour`
    /// through this hour, once per local day.
    pub last_local_send_hour: u32,
    pub new_event_window_hours: i64,
    pub provider_attempts: u32,
    pub card_image_px: u32,
    pub image_download_concurrency: usize,
    pub club_logo_px: u32,
}

/// `controlbox/event_reminder.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventReminder {
    pub lead_minutes: i64,
    pub early_tolerance_minutes: i64,
    pub late_tolerance_minutes: i64,
    pub provider_attempts: u32,
}

/// The sending and image limits in `controlbox/email_delivery.json`.
#[derive(Debug, Deserialize)]
pub struct EmailDelivery {
    pub provider_timeout_seconds: f64,
    pub team_sender: String,
    pub image_timeout_seconds: f64,
    pub image_max_bytes: usize,
    pub image_quality: u8,
    pub hero_image_px: u32,
}

/// `controlbox/notification_defaults.json`: whether a type is on before a user chooses.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationDefaults {
    pub morning_email: bool,
    pub event_reminder: bool,
    pub event_change: bool,
}

impl NotificationDefaults {
    /// `NOTIFICATION_DEFAULT_ENABLED.get(notification_type, False)`.
    pub fn enabled(&self, notification_type: &str) -> bool {
        match notification_type {
            NOTIFICATION_TYPE_MORNING_EMAIL => self.morning_email,
            NOTIFICATION_TYPE_EVENT_REMINDER => self.event_reminder,
            NOTIFICATION_TYPE_EVENT_CHANGE => self.event_change,
            _ => false,
        }
    }
}

pub static API_SERVER: LazyLock<ApiServer> = LazyLock::new(|| {
    parse(
        "api_server",
        include_str!("../../backend/controlbox/api_server.json"),
    )
});
pub static AUTHENTICATION: LazyLock<Authentication> = LazyLock::new(|| {
    parse(
        "authentication",
        include_str!("../../backend/controlbox/authentication.json"),
    )
});
pub static CONTACT: LazyLock<Contact> = LazyLock::new(|| {
    parse(
        "contact",
        include_str!("../../backend/controlbox/contact.json"),
    )
});
pub static DATABASE: LazyLock<Database> = LazyLock::new(|| {
    parse(
        "database",
        include_str!("../../backend/controlbox/database.json"),
    )
});
pub static RATE_LIMITS: LazyLock<RateLimits> = LazyLock::new(|| {
    parse(
        "rate_limits",
        include_str!("../../backend/controlbox/rate_limits.json"),
    )
});
pub static INGESTION: LazyLock<Ingestion> = LazyLock::new(|| {
    parse(
        "ingestion",
        include_str!("../../backend/controlbox/ingestion.json"),
    )
});
pub static UPLOADS: LazyLock<Uploads> = LazyLock::new(|| {
    parse(
        "uploads",
        include_str!("../../backend/controlbox/uploads.json"),
    )
});
pub static SCRAPING: LazyLock<Scraping> = LazyLock::new(|| {
    parse(
        "scraping",
        include_str!("../../backend/controlbox/scraping.json"),
    )
});
pub static INSTAGRAM_BROWSER: LazyLock<InstagramBrowser> = LazyLock::new(|| {
    parse(
        "instagram_browser",
        include_str!("../../backend/controlbox/instagram_browser.json"),
    )
});
pub static INSTAGRAM_DIGEST: LazyLock<InstagramDigest> = LazyLock::new(|| {
    parse(
        "instagram_digest",
        include_str!("../../backend/controlbox/instagram_digest.json"),
    )
});
pub static NOTIFICATION_RETRY: LazyLock<NotificationRetry> = LazyLock::new(|| {
    parse(
        "notification_retry",
        include_str!("../../backend/controlbox/notification_retry.json"),
    )
});
pub static EVENT_DISCOVERY: LazyLock<EventDiscovery> = LazyLock::new(|| {
    parse(
        "event_discovery",
        include_str!("../../backend/controlbox/event_discovery.json"),
    )
});

pub static CLUB_MANAGEMENT: LazyLock<ClubManagement> = LazyLock::new(|| {
    parse(
        "club_management",
        include_str!("../../backend/controlbox/club_management.json"),
    )
});
pub static DISCOVERY_QUERIES: LazyLock<DiscoveryQueries> = LazyLock::new(|| {
    parse(
        "discovery_queries",
        include_str!("../../backend/controlbox/discovery_queries.json"),
    )
});
pub static PROMOTER_PROGRAM: LazyLock<PromoterProgram> = LazyLock::new(|| {
    parse(
        "promoter_program",
        include_str!("../../backend/controlbox/promoter_program.json"),
    )
});
pub static POSITIONS: LazyLock<Positions> = LazyLock::new(|| {
    parse(
        "positions",
        include_str!("../../backend/controlbox/positions.json"),
    )
});
pub static MORNING_EMAIL: LazyLock<MorningEmail> = LazyLock::new(|| {
    parse(
        "morning_email",
        include_str!("../../backend/controlbox/morning_email.json"),
    )
});
pub static EVENT_REMINDER: LazyLock<EventReminder> = LazyLock::new(|| {
    parse(
        "event_reminder",
        include_str!("../../backend/controlbox/event_reminder.json"),
    )
});
pub static EMAIL_DELIVERY: LazyLock<EmailDelivery> = LazyLock::new(|| {
    parse(
        "email_delivery",
        include_str!("../../backend/controlbox/email_delivery.json"),
    )
});
pub static NOTIFICATION_DEFAULTS: LazyLock<NotificationDefaults> = LazyLock::new(|| {
    parse(
        "notification_defaults",
        include_str!("../../backend/controlbox/notification_defaults.json"),
    )
});
pub static PUBLIC_ATTENDANCE: LazyLock<PublicAttendance> = LazyLock::new(|| {
    parse(
        "public_attendance",
        include_str!("../../backend/controlbox/public_attendance.json"),
    )
});
pub static INTERACTION_INGESTION: LazyLock<InteractionIngestion> = LazyLock::new(|| {
    parse(
        "interaction_ingestion",
        include_str!("../../backend/controlbox/interaction_ingestion.json"),
    )
});

/// `controlbox/instagram_browser.json`. A test may replace it for itself and the
/// threads the code under test starts (see [`InheritedControls`]).
#[cfg(not(test))]
pub fn instagram_browser() -> &'static InstagramBrowser {
    &INSTAGRAM_BROWSER
}

/// `controlbox/notification_retry.json`, replaceable like [`instagram_browser`].
#[cfg(not(test))]
pub fn notification_retry() -> &'static NotificationRetry {
    &NOTIFICATION_RETRY
}

#[cfg(test)]
pub fn instagram_browser() -> std::sync::Arc<InstagramBrowser> {
    overrides::BROWSER
        .with(|current| current.borrow().clone())
        .unwrap_or_else(|| overrides::DEFAULT_BROWSER.clone())
}

#[cfg(test)]
pub fn notification_retry() -> std::sync::Arc<NotificationRetry> {
    overrides::RETRY
        .with(|current| current.borrow().clone())
        .unwrap_or_else(|| overrides::DEFAULT_RETRY.clone())
}

/// The controls a thread runs with, carried into the threads it starts.
pub struct InheritedControls {
    #[cfg(test)]
    browser: Option<std::sync::Arc<InstagramBrowser>>,
    #[cfg(test)]
    retry: Option<std::sync::Arc<NotificationRetry>>,
}

impl InheritedControls {
    pub fn capture() -> Self {
        Self {
            #[cfg(test)]
            browser: overrides::BROWSER.with(|current| current.borrow().clone()),
            #[cfg(test)]
            retry: overrides::RETRY.with(|current| current.borrow().clone()),
        }
    }

    pub fn install(self) {
        #[cfg(test)]
        {
            overrides::BROWSER.with(|current| *current.borrow_mut() = self.browser);
            overrides::RETRY.with(|current| *current.borrow_mut() = self.retry);
        }
    }
}

/// Per-test replacements of the controls.
#[cfg(test)]
pub mod overrides {
    use std::cell::RefCell;
    use std::sync::{Arc, LazyLock};

    use super::{INSTAGRAM_BROWSER, InstagramBrowser, NOTIFICATION_RETRY, NotificationRetry};

    pub(super) static DEFAULT_BROWSER: LazyLock<Arc<InstagramBrowser>> =
        LazyLock::new(|| Arc::new(INSTAGRAM_BROWSER.clone()));
    pub(super) static DEFAULT_RETRY: LazyLock<Arc<NotificationRetry>> =
        LazyLock::new(|| Arc::new(NOTIFICATION_RETRY.clone()));

    thread_local! {
        pub(super) static BROWSER: RefCell<Option<Arc<InstagramBrowser>>> = const { RefCell::new(None) };
        pub(super) static RETRY: RefCell<Option<Arc<NotificationRetry>>> = const { RefCell::new(None) };
    }

    /// Change this test's `instagram_browser` controls.
    pub fn instagram_browser(change: impl FnOnce(&mut InstagramBrowser)) {
        let mut control = (*super::instagram_browser()).clone();
        change(&mut control);
        BROWSER.with(|current| *current.borrow_mut() = Some(Arc::new(control)));
    }

    /// Change this test's `notification_retry` controls.
    pub fn notification_retry(change: impl FnOnce(&mut NotificationRetry)) {
        let mut control = (*super::notification_retry()).clone();
        change(&mut control);
        RETRY.with(|current| *current.borrow_mut() = Some(Arc::new(control)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_control_file_parses() {
        assert!(API_SERVER.database_connections > 0);
        assert!(AUTHENTICATION.access_token_minutes > 0);
        assert!(!CONTACT.recipient_emails.is_empty());
        assert!(CONTACT.business_support.business_name > 0);
        assert!(DATABASE.read_attempts > 0);
        assert!(RATE_LIMITS.default.maximum_requests > 0);
        assert!(INGESTION.parallel_agents > 0);
        assert!(UPLOADS.event_image_max_size_bytes > 0);
        assert!(SCRAPING.directory_minimum_image_dimension_pixels > 0);
        assert!(!EVENT_DISCOVERY.campus_seasons.schools.is_empty());
        assert!(MORNING_EMAIL.local_send_hour <= MORNING_EMAIL.last_local_send_hour);
        assert!(EVENT_REMINDER.lead_minutes > 0);
        assert!(!EMAIL_DELIVERY.team_sender.is_empty());
        assert!(CLUB_MANAGEMENT.invite_expiration_days > 0);
        assert!(DISCOVERY_QUERIES.maximum_filters_bytes > 0);
        assert!(!PROMOTER_PROGRAM.tos_version.is_empty());
        assert!(POSITIONS.undated_visibility_months > 0);
        assert!(!NOTIFICATION_DEFAULTS.enabled("unknown_type"));

        assert!(INSTAGRAM_BROWSER.parallel_tabs >= 2);
        assert!(!SCRAPING.instagram_web_app_id.is_empty());
        assert!(INSTAGRAM_DIGEST.maximum_pages > 0);
        assert!(NOTIFICATION_RETRY.max_reruns_per_run > 0);
        assert!(PUBLIC_ATTENDANCE.maximum_display_names > 0);
        assert!(INTERACTION_INGESTION.maximum_batch_size > 0);
    }
}
