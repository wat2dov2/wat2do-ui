//! `/qr`: posters (QR codes), their privacy-preserving scans, promoter
//! earnings and the public campus coverage map (`routers/qr.py`,
//! `services/qr_code_service.py`, `services/poster_payout_service.py`).
//!
//! `scans` records and confirms scans; `posters` creates, edits and deletes
//! posters; this module holds the reads.
//!
//! Promoter privacy: a promoter sees only aggregate earnings of their own
//! posters. Raw promoter scans and their risk flags are admin-only, the map
//! shows rounded cells and visitor buckets with no owner or poster id, and a
//! scan exposes only the first 16 characters of its keyed visitor hash.

pub mod posters;
pub mod scans;

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{ClubOwnerOrAdmin, DbUser, User, require_club_owner_or_admin};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::PROMOTER_ENROLLMENT_REQUIRED;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::routes::users::get_user;
use crate::api::validation::{Length, QueryParams, Validator};
use crate::constants::MAX_SCHOOL_LENGTH;
use crate::controlbox::PROMOTER_PROGRAM;
use crate::db::read_with_retry;
use crate::poster_payouts::{earnings_rows, month_bounds};
use crate::schools::{name_pattern, normalize_slug, school_id_sql};

pub const DESTINATION_TYPES: &[&str] = &["event", "events-list", "custom-url"];
pub const PROGRAMS: &[&str] = &["standard", "promoter"];

/// A poster as the API returns it (`QrCodeResponse`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct QrCodeResponse {
    pub id: String,
    pub name: String,
    #[schema(required = true)]
    pub description: Option<String>,
    #[schema(value_type = QrDestinationType, inline)]
    pub destination_type: String,
    #[schema(required = true)]
    pub destination_id: Option<String>,
    #[schema(required = true)]
    #[schema(value_type = Option<FiltersSchema>, inline)]
    #[serde(serialize_with = "json::option_value")]
    pub filters: Option<Value>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub is_active: bool,
    #[schema(value_type = QrProgram, inline)]
    pub program: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub latest_scan: Option<DateTime<Utc>>,
    pub poster_template_id: Option<String>,
    #[schema(required = true)]
    pub image_url: Option<String>,
    #[serde(serialize_with = "json::float")]
    pub latitude: f64,
    #[serde(serialize_with = "json::float")]
    pub longitude: f64,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
pub enum QrDestinationType {
    #[serde(rename = "event")]
    Event,
    #[serde(rename = "events-list")]
    EventsList,
    #[serde(rename = "custom-url")]
    CustomUrl,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum QrProgram {
    Standard,
    Promoter,
}

/// `dict | list | None`: a poster's filters, as the OpenAPI schema shows them.
#[allow(dead_code)]
#[derive(ToSchema)]
#[serde(untagged)]
pub enum FiltersSchema {
    Object(std::collections::HashMap<String, serde_json::Value>),
    List(Vec<serde_json::Value>),
}

/// `str | int | None`: a destination id, as the OpenAPI schema shows it.
#[allow(dead_code)]
#[derive(ToSchema)]
#[serde(untagged)]
pub enum DestinationIdSchema {
    Text(String),
    Integer(i64),
}

crate::paginated_schema!(
    PaginatedQrCodes,
    PaginatedResponse_QrCodeResponse_,
    QrCodeResponse
);

/// The columns `QrCodeResponse::from_row` reads, for `qr_codes q` joined to `schools s`.
pub const QR_COLUMNS: &str = "q.id, q.name, q.description, q.destination_type, q.destination_id, \
     q.filters, q.created_at, q.created_by::text AS created_by, q.is_active, q.program, \
     q.latest_scan, q.poster_template_id, q.image_url, q.latitude, q.longitude, \
     NULLIF(s.slug, '') AS school";
pub const QR_JOINS: &str = "LEFT JOIN public.schools s ON s.id = q.school_id";

/// `_qr_code_response`: the poster's school slug is shown inside its
/// filters (last), where the poster editor reads it.
pub fn with_school(filters: Option<Value>, school: Option<&str>) -> Option<Value> {
    match filters {
        Some(Value::Object(mut entries)) => {
            entries.shift_remove("school");
            if let Some(school) = school {
                entries.insert("school".into(), Value::String(school.to_owned()));
            }
            Some(Value::Object(entries))
        }
        other => other,
    }
}

impl QrCodeResponse {
    pub fn from_row(row: &PgRow) -> anyhow::Result<Self> {
        let school: Option<String> = row.try_get("school")?;
        let filters = row
            .try_get::<Option<sqlx::types::Json<Value>>, _>("filters")?
            .map(|json| json.0);
        let required = |name: &str| -> anyhow::Result<f64> {
            row.try_get::<Option<f64>, _>(name)?
                .ok_or_else(|| anyhow::anyhow!("poster has no {name}"))
        };
        Ok(Self {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            destination_type: row.try_get("destination_type")?,
            destination_id: row.try_get("destination_id")?,
            filters: with_school(filters, school.as_deref()),
            created_at: row
                .try_get::<Option<DateTime<Utc>>, _>("created_at")?
                .ok_or_else(|| anyhow::anyhow!("poster has no created_at"))?,
            created_by: row.try_get("created_by")?,
            is_active: row.try_get("is_active")?,
            program: row.try_get("program")?,
            latest_scan: row.try_get("latest_scan")?,
            poster_template_id: row.try_get("poster_template_id")?,
            image_url: row.try_get("image_url")?,
            latitude: required("latitude")?,
            longitude: required("longitude")?,
        })
    }
}

/// `get_qr_code_by_id`.
pub async fn get_qr_code(db: &sqlx::PgPool, id: &str) -> Result<Option<QrCodeResponse>, ApiError> {
    let sql = format!("SELECT {QR_COLUMNS} FROM public.qr_codes q {QR_JOINS} WHERE q.id = $1");
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(db)).await?;
    Ok(row.as_ref().map(QrCodeResponse::from_row).transpose()?)
}

/// `school_service.get_school(slug)`: the id of the school with this slug.
pub async fn school_id_by_slug(db: &sqlx::PgPool, slug: &str) -> Result<Option<i32>, ApiError> {
    if slug.is_empty() {
        return Ok(None);
    }
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, i32>("SELECT id FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(slug)
            .fetch_optional(db)
    })
    .await?)
}

/// `school_service.get_school_id`: by slug, else by name.
pub async fn school_id(db: &sqlx::PgPool, value: &str) -> Result<Option<i32>, ApiError> {
    let sql = format!("SELECT {}", school_id_sql("$1", "$2"));
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, Option<i32>>(&sql)
            .bind(normalize_slug(value))
            .bind(name_pattern(value))
            .fetch_one(db)
    })
    .await?)
}

/// The filters of `GET /qr/`.
#[derive(Debug, Default)]
struct ListFilters {
    created_by: Option<Uuid>,
    school_id: Option<i32>,
    program: Option<String>,
    is_active: Option<bool>,
    latest_scan_before: Option<DateTime<Utc>>,
    latest_scan_after: Option<DateTime<Utc>>,
    never_scanned: Option<bool>,
}

/// `list_qr_codes`: newest first.
async fn list_qr_codes(
    db: &sqlx::PgPool,
    filters: &ListFilters,
    pagination: Pagination,
) -> Result<(Vec<QrCodeResponse>, i64), ApiError> {
    let sql = format!(
        "WITH matched AS ( \
             SELECT q.id, q.created_at FROM public.qr_codes q \
             WHERE ($3::uuid IS NULL OR q.created_by = $3) \
               AND ($4::int IS NULL OR q.school_id = $4) \
               AND ($5::text IS NULL OR q.program = $5) \
               AND ($6::bool IS NULL OR q.is_active = $6) \
               AND ($7::timestamptz IS NULL OR q.latest_scan < $7) \
               AND ($8::timestamptz IS NULL OR q.latest_scan >= $8) \
               AND ($9::bool IS NULL OR (q.latest_scan IS NULL) = $9)), \
         page AS (SELECT id, created_at FROM matched ORDER BY created_at DESC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, listed.* \
         FROM (SELECT 1) AS one LEFT JOIN ( \
             SELECT {QR_COLUMNS} FROM page JOIN public.qr_codes q ON q.id = page.id {QR_JOINS} \
         ) AS listed ON true \
         ORDER BY listed.created_at DESC"
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(filters.created_by)
            .bind(filters.school_id)
            .bind(&filters.program)
            .bind(filters.is_active)
            .bind(filters.latest_scan_before)
            .bind(filters.latest_scan_after)
            .bind(filters.never_scanned)
            .fetch_all(db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            items.push(QrCodeResponse::from_row(row)?);
        }
    }
    Ok((items, total))
}

#[utoipa::path(
    get,
    path = "/qr/",
    tag = "qr",
    operation_id = "list_qr_codes_qr__get",
    summary = "List Qr Codes",
    description = "List manageable QR codes with explicit active-state and recency filters.",
    params(
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("program" = inline(Option<QrProgram>), Query, nullable),
        ("is_active" = Option<bool>, Query, nullable),
        ("latest_scan_before" = Option<String>, Query, nullable, format = DateTime),
        ("latest_scan_after" = Option<String>, Query, nullable, format = DateTime),
        ("never_scanned" = Option<bool>, Query, nullable),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedQrCodes),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_qr_codes_route(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    query: QueryParams,
) -> Result<Json<Paginated<QrCodeResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let mut filters = ListFilters {
        program: check.query(&query, "program").optional_choice(PROGRAMS),
        is_active: check.query(&query, "is_active").optional_bool(),
        latest_scan_before: check
            .query(&query, "latest_scan_before")
            .optional_datetime(),
        latest_scan_after: check.query(&query, "latest_scan_after").optional_datetime(),
        never_scanned: check.query(&query, "never_scanned").optional_bool(),
        ..ListFilters::default()
    };
    check.finish()?;
    if !user.is_admin() {
        // Enrolled promoters manage their own posters; anyone else must run a club.
        if !is_enrolled_promoter(&state.db, &user).await? {
            require_club_owner_or_admin(&state.db, &user).await?;
        }
        filters.created_by = Some(user.id);
    }
    if let Some(school) = school.filter(|school| !school.is_empty()) {
        match school_id(&state.db, &school).await? {
            Some(id) => filters.school_id = Some(id),
            None => return Ok(Json(Paginated::new(Vec::new(), 0, pagination))),
        }
    }
    let (items, total) = list_qr_codes(&state.db, &filters, pagination).await?;
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// Whether the user has accepted the promoter terms.
async fn is_enrolled_promoter(db: &sqlx::PgPool, user: &User) -> Result<bool, ApiError> {
    Ok(get_user(db, user.id)
        .await?
        .is_some_and(|profile| profile.promoter_tos_accepted_at.is_some()))
}

/// `QrCodeScanResponse`: one scan, with only a short visitor reference.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct QrCodeScanResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub qr_code_id: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub scanned_at: DateTime<Utc>,
    pub visitor_reference: String,
    #[schema(required = true)]
    pub browser_family: Option<String>,
    #[schema(required = true)]
    pub os_family: Option<String>,
    #[schema(required = true)]
    pub asn: Option<i64>,
    #[schema(required = true)]
    pub country: Option<String>,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub landing_confirmed_at: Option<DateTime<Utc>>,
    pub risk_score: i64,
    #[schema(value_type = Vec<std::collections::HashMap<String, serde_json::Value>>)]
    #[serde(serialize_with = "json::value")]
    pub risk_flags: Value,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub risk_evaluated_at: Option<DateTime<Utc>>,
    #[schema(required = true)]
    pub risk_rules_version: Option<String>,
}

crate::paginated_schema!(
    PaginatedQrScans,
    PaginatedResponse_QrCodeScanResponse_,
    QrCodeScanResponse
);

impl QrCodeScanResponse {
    fn from_row(row: &PgRow) -> anyhow::Result<Self> {
        let dedupe_hash: String = row.try_get("dedupe_hash")?;
        let risk_flags = row.try_get::<sqlx::types::Json<Value>, _>("risk_flags")?.0;
        anyhow::ensure!(
            risk_flags
                .as_array()
                .is_some_and(|flags| flags.iter().all(Value::is_object)),
            "risk_flags is not a list of objects"
        );
        Ok(Self {
            id: row.try_get("id")?,
            qr_code_id: row.try_get("qr_code_id")?,
            scanned_at: row.try_get("scanned_at")?,
            visitor_reference: dedupe_hash.chars().take(16).collect(),
            browser_family: row.try_get("browser_family")?,
            os_family: row.try_get("os_family")?,
            asn: row.try_get("asn")?,
            country: row.try_get("country")?,
            landing_confirmed_at: row.try_get("landing_confirmed_at")?,
            risk_score: i64::from(row.try_get::<i32, _>("risk_score")?),
            risk_flags,
            risk_evaluated_at: row.try_get("risk_evaluated_at")?,
            risk_rules_version: row.try_get("risk_rules_version")?,
        })
    }
}

#[utoipa::path(
    get,
    path = "/qr/scans",
    tag = "qr",
    operation_id = "list_scans_qr_scans_get",
    summary = "List Scans",
    params(
        ("qr_code_id" = Option<String>, Query, nullable, max_length = 128),
        ("from_time" = Option<String>, Query, nullable, format = DateTime),
        ("to_time" = Option<String>, Query, nullable, format = DateTime),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedQrScans),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_scans(
    State(state): State<AppState>,
    ClubOwnerOrAdmin(user): ClubOwnerOrAdmin,
    query: QueryParams,
) -> Result<Json<Paginated<QrCodeScanResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let qr_code_id = check
        .query(&query, "qr_code_id")
        .optional_string(Length::default().max(128))
        .filter(|id| !id.is_empty());
    let from_time = check.query(&query, "from_time").optional_datetime();
    let to_time = check.query(&query, "to_time").optional_datetime();
    check.finish()?;
    // Owners see their standard posters' scans; promoter scans and their
    // risk flags stay admin-only so fraud controls are not exposed.
    let owned_by = (!user.is_admin()).then_some(user.id);
    let sql = "WITH matched AS ( \
             SELECT * FROM public.qr_code_scans s \
             WHERE ($3::text IS NULL OR s.qr_code_id = $3) \
               AND ($4::uuid IS NULL OR s.qr_code_id IN ( \
                   SELECT id FROM public.qr_codes WHERE created_by = $4 AND program = 'standard')) \
               AND ($5::timestamptz IS NULL OR s.scanned_at >= $5) \
               AND ($6::timestamptz IS NULL OR s.scanned_at <= $6)), \
         page AS (SELECT * FROM matched ORDER BY scanned_at DESC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true ORDER BY page.scanned_at DESC";
    let rows = read_with_retry(|| {
        sqlx::query(sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&qr_code_id)
            .bind(owned_by)
            .bind(from_time)
            .bind(to_time)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<Uuid>, _>("id")?.is_some() {
            items.push(QrCodeScanResponse::from_row(row)?);
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// `PosterEarningsItem`: one active poster's earnings this month.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PosterEarningsItem {
    pub qr_code_id: String,
    pub name: String,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub latest_scan: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::float")]
    pub latitude: f64,
    #[serde(serialize_with = "json::float")]
    pub longitude: f64,
    #[schema(required = true)]
    pub poster_template_id: Option<String>,
    #[schema(required = true)]
    pub template_preview_url: Option<String>,
    pub lifetime_unique_scans: i64,
    pub period_unique_scans: i64,
    pub period_creditable_scans: i64,
    pub pending_cents: i64,
}

/// `PromoterEarningsResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PromoterEarningsResponse {
    pub period: String,
    pub posters: Vec<PosterEarningsItem>,
    pub period_creditable_scans: i64,
    pub period_unqualified_scans: i64,
    pub pending_cents: i64,
    pub lifetime_paid_cents: i64,
    pub active_slots_used: i64,
    pub active_slots_limit: i64,
    pub program_enabled: bool,
}

#[utoipa::path(
    get,
    path = "/qr/earnings",
    tag = "qr",
    operation_id = "get_promoter_earnings_qr_earnings_get",
    summary = "Get Promoter Earnings",
    responses((status = 200, description = "Successful Response", body = PromoterEarningsResponse))
)]
pub async fn get_promoter_earnings(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<PromoterEarningsResponse>, ApiError> {
    let profile = get_user(&state.db, user.id).await?;
    let enrolled = profile.as_ref().is_some_and(|profile| {
        profile.payout_email.is_some() && profile.promoter_tos_accepted_at.is_some()
    });
    if !enrolled {
        return Err(ApiError::validation(PROMOTER_ENROLLMENT_REQUIRED));
    }
    promoter_earnings(&state.db, user.id, Utc::now())
        .await
        .map(Json)
}

/// `get_promoter_earnings`: this UTC month's earnings of the promoter's
/// active posters. A scan attempt that is not a creditable unique visitor
/// (unconfirmed, repeat, or the poster's first visitor) is unqualified.
async fn promoter_earnings(
    db: &sqlx::PgPool,
    user_id: Uuid,
    now: DateTime<Utc>,
) -> Result<PromoterEarningsResponse, ApiError> {
    let control = &*PROMOTER_PROGRAM;
    let (period_start, period_end) = month_bounds(now.date_naive());
    let rows = read_with_retry(|| earnings_rows(db, user_id, period_start, period_end)).await?;
    let posters: Vec<PosterEarningsItem> = rows
        .into_iter()
        .filter(|row| row.is_active)
        .map(|row| PosterEarningsItem {
            pending_cents: row.period_creditable_scans * control.rate_cents,
            qr_code_id: row.qr_code_id,
            name: row.name,
            latest_scan: row.latest_scan,
            latitude: row.latitude,
            longitude: row.longitude,
            poster_template_id: row.poster_template_id,
            template_preview_url: row.image_url,
            lifetime_unique_scans: row.lifetime_unique_scans,
            period_unique_scans: row.period_unique_scans,
            period_creditable_scans: row.period_creditable_scans,
        })
        .collect();
    let creditable: i64 = posters
        .iter()
        .map(|poster| poster.period_creditable_scans)
        .sum();
    let ids: Vec<&str> = posters
        .iter()
        .map(|poster| poster.qr_code_id.as_str())
        .collect();
    let attempts = if ids.is_empty() {
        0
    } else {
        read_with_retry(|| {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM public.qr_code_scans \
                 WHERE qr_code_id = ANY($1) AND scanned_at >= $2 AND scanned_at < $3",
            )
            .bind(&ids)
            .bind(period_start)
            .bind(period_end)
            .fetch_one(db)
        })
        .await?
    };
    let lifetime_paid_cents = read_with_retry(|| {
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(sum(amount_cents), 0)::bigint FROM public.poster_payouts \
             WHERE user_id = $1 AND status = 'paid'",
        )
        .bind(user_id)
        .fetch_one(db)
    })
    .await?;
    Ok(PromoterEarningsResponse {
        period: period_start.format("%Y-%m").to_string(),
        period_creditable_scans: creditable,
        period_unqualified_scans: (attempts - creditable).max(0),
        pending_cents: creditable * control.rate_cents,
        lifetime_paid_cents,
        active_slots_used: posters.len() as i64,
        active_slots_limit: control.maximum_active_posters,
        program_enabled: control.enabled,
        posters,
    })
}

/// `CampusCoverageCell`: one rounded map cell, with no poster or owner id.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct CampusCoverageCell {
    #[serde(serialize_with = "json::float")]
    pub latitude: f64,
    #[serde(serialize_with = "json::float")]
    pub longitude: f64,
    pub poster_count: i64,
    pub recent_poster_count: i64,
    pub quiet_poster_count: i64,
    #[schema(value_type = ConfirmedVisitorBucket, inline)]
    pub confirmed_visitor_bucket: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ConfirmedVisitorBucket {
    None,
    Low,
    Medium,
    High,
}

/// `CampusCoverageResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct CampusCoverageResponse {
    pub school: String,
    pub quiet_after_days: i64,
    pub cells: Vec<CampusCoverageCell>,
}

/// `_confirmed_visitor_bucket`: the controlbox maximums of none, low and medium.
pub fn confirmed_visitor_bucket(visitors: i64) -> &'static str {
    let [none, low, medium] = PROMOTER_PROGRAM.map_visitor_bucket_maximums;
    if visitors <= none {
        "none"
    } else if visitors <= low {
        "low"
    } else if visitors <= medium {
        "medium"
    } else {
        "high"
    }
}

#[utoipa::path(
    get,
    path = "/qr/map",
    tag = "qr",
    operation_id = "get_campus_coverage_qr_map_get",
    summary = "Get Campus Coverage",
    params(("school" = String, Query, min_length = 1, max_length = 255)),
    responses(
        (status = 200, description = "Successful Response", body = CampusCoverageResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_campus_coverage(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Json<CampusCoverageResponse>, ApiError> {
    let mut check = Validator::default();
    let school = check
        .query(&query, "school")
        .string(Length::default().min(1).max(MAX_SCHOOL_LENGTH));
    check.finish()?;
    let control = &*PROMOTER_PROGRAM;
    let slug = normalize_slug(&school);
    let Some(school_id) = school_id_by_slug(&state.db, &slug).await? else {
        return Ok(Json(CampusCoverageResponse {
            school: slug,
            quiet_after_days: control.quiet_poster_days,
            cells: Vec::new(),
        }));
    };
    let quiet_cutoff = Utc::now() - Duration::days(control.quiet_poster_days);
    let rows = read_with_retry(|| {
        sqlx::query(
            "SELECT latitude, longitude, poster_count, recent_poster_count, quiet_poster_count, \
                    confirmed_unique_visitors \
             FROM public.get_promoter_campus_coverage($1, $2, $3)",
        )
        .bind(school_id)
        .bind(quiet_cutoff)
        .bind(control.map_coordinate_decimal_places)
        .fetch_all(&state.db)
    })
    .await?;
    let cells = rows
        .iter()
        .map(|row| {
            Ok(CampusCoverageCell {
                latitude: row.try_get("latitude")?,
                longitude: row.try_get("longitude")?,
                poster_count: row.try_get("poster_count")?,
                recent_poster_count: row.try_get("recent_poster_count")?,
                quiet_poster_count: row.try_get("quiet_poster_count")?,
                confirmed_visitor_bucket: confirmed_visitor_bucket(
                    row.try_get("confirmed_unique_visitors")?,
                ),
            })
        })
        .collect::<Result<_, sqlx::Error>>()?;
    Ok(Json(CampusCoverageResponse {
        school: slug,
        quiet_after_days: control.quiet_poster_days,
        cells,
    }))
}

#[cfg(test)]
pub(crate) mod tests;
