//! `/payouts`: a promoter's own payout history and the administrator payout
//! review (`routers/payouts.py`, `services/poster_payout_service.py`).
//!
//! Every administrator route is `AdminUser` first, before its body or
//! parameters are read. Status changes go through the database functions
//! `transition_poster_payout_status` and `mark_poster_payouts_paid`, which
//! lock the rows, check the transition and append the review history in one
//! transaction; no payment provider is called (finance pays the exported
//! Interac CSV by hand, then marks the payouts paid here).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::HeaderMap;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AdminUser, DbUser};
use crate::api::body::{Body, Extra, Input, Str, json_request, merge_issues};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{
    ADMIN_ACCESS_REQUIRED, INVALID_PAYOUT_FILTERS, INVALID_STATUS_TRANSITION,
    PAYOUT_EXPORT_PENDING_ONLY, PAYOUT_NOT_FOUND, PAYOUT_NOTES_REQUIRED,
};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::validation::{Length, Limits, PathParams, QueryParams, Validator};
use crate::db::read_with_retry;
use crate::poster_payouts::{
    FRAUD_STATUSES, HELD, PAYOUT_STATUSES, PENDING, PosterPayout, VOIDED, earnings_rows,
    load_period_scans, month_bounds, serialize_interac_csv,
};
use crate::text::python_strip;

/// `UserPosterPayoutResponse`: what a promoter sees of their own payout
/// (no notes, reviewer or fraud status).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UserPosterPayoutResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    #[schema(value_type = String, format = Date)]
    #[serde(serialize_with = "date")]
    pub period: NaiveDate,
    #[schema(format = Email)]
    pub payout_email: String,
    pub rate_cents: i64,
    pub amount_cents: i64,
    pub scan_count: i64,
    #[schema(value_type = PayoutStatus, inline)]
    pub status: String,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub paid_at: Option<DateTime<Utc>>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
}

/// `PosterPayoutResponse`: the administrator view of a payout.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PosterPayoutResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    #[schema(value_type = String, format = Uuid)]
    pub user_id: Uuid,
    #[schema(value_type = String, format = Date)]
    #[serde(serialize_with = "date")]
    pub period: NaiveDate,
    #[schema(format = Email)]
    pub payout_email: String,
    pub rate_cents: i64,
    pub amount_cents: i64,
    pub scan_count: i64,
    #[schema(value_type = PayoutStatus, inline)]
    pub status: String,
    #[schema(value_type = PayoutFraudStatus, inline)]
    pub fraud_status: &'static str,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub paid_at: Option<DateTime<Utc>>,
    #[schema(required = true)]
    pub notes: Option<String>,
    #[schema(required = true)]
    #[schema(value_type = Option<String>, format = Uuid)]
    pub reviewed_by: Option<Uuid>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PayoutStatus {
    Pending,
    Held,
    Paid,
    Voided,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PayoutFraudStatus {
    Flagged,
    Clear,
}

fn date<S: serde::Serializer>(value: &NaiveDate, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.format("%Y-%m-%d").to_string())
}

impl From<&PosterPayout> for UserPosterPayoutResponse {
    fn from(payout: &PosterPayout) -> Self {
        Self {
            id: payout.id,
            period: payout.period,
            payout_email: payout.payout_email.clone(),
            rate_cents: payout.rate_cents,
            amount_cents: payout.amount_cents,
            scan_count: payout.scan_count,
            status: payout.status.clone(),
            paid_at: payout.paid_at,
            created_at: payout.created_at,
        }
    }
}

impl From<&PosterPayout> for PosterPayoutResponse {
    fn from(payout: &PosterPayout) -> Self {
        Self {
            id: payout.id,
            user_id: payout.user_id,
            period: payout.period,
            payout_email: payout.payout_email.clone(),
            rate_cents: payout.rate_cents,
            amount_cents: payout.amount_cents,
            scan_count: payout.scan_count,
            status: payout.status.clone(),
            fraud_status: payout.fraud_status(),
            paid_at: payout.paid_at,
            notes: payout.notes.clone(),
            reviewed_by: payout.reviewed_by,
            created_at: payout.created_at,
            updated_at: payout.updated_at,
        }
    }
}

crate::paginated_schema!(
    PaginatedUserPayouts,
    PaginatedResponse_UserPosterPayoutResponse_,
    UserPosterPayoutResponse
);
crate::paginated_schema!(
    PaginatedPayouts,
    PaginatedResponse_PosterPayoutResponse_,
    PosterPayoutResponse
);

/// `PayoutFraudReason`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PayoutFraudReason {
    pub code: String,
    pub points: i64,
    pub affected_scan_count: i64,
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    #[serde(serialize_with = "json::value")]
    pub evidence: Value,
}

/// `PosterPayoutContribution`: one poster's share of a payout.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PosterPayoutContribution {
    pub qr_code_id: String,
    pub name: String,
    #[schema(required = true)]
    pub poster_template_id: Option<String>,
    pub scan_count: i64,
    pub amount_cents: i64,
}

/// `PayoutReviewEvent`: one entry of the append-only review history.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PayoutReviewEvent {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    #[schema(value_type = PayoutStatus, inline)]
    pub from_status: String,
    #[schema(value_type = PayoutStatus, inline)]
    pub to_status: String,
    #[schema(required = true)]
    pub notes: Option<String>,
    #[schema(value_type = String, format = Uuid)]
    pub reviewed_by: Uuid,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub reviewed_at: DateTime<Utc>,
}

/// `AdminPayoutDetail`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdminPayoutDetail {
    pub payout: PosterPayoutResponse,
    pub fraud_reasons: Vec<PayoutFraudReason>,
    pub contributions: Vec<PosterPayoutContribution>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub period_start: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub period_end: DateTime<Utc>,
    pub review_history: Vec<PayoutReviewEvent>,
}

/// `PayoutCsvExportResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PayoutCsvExportResponse {
    pub filename: String,
    pub content: String,
}

/// The OpenAPI request bodies.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct PayoutStatusUpdate {
    #[schema(inline)]
    status: PayoutStatus,
    #[schema(max_length = 10000)]
    notes: Option<String>,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct PayoutSelectionRequest {
    #[schema(value_type = Vec<String>, format = Uuid, min_items = 1, max_items = 1000)]
    payout_ids: Vec<Uuid>,
}

/// The filters of a payout listing (`_list_payouts`).
#[derive(Debug, Default, Clone, PartialEq)]
struct PayoutFilters {
    user_id: Option<Uuid>,
    status: Option<String>,
    period: Option<NaiveDate>,
    payout_email: Option<String>,
    period_from: Option<NaiveDate>,
    period_to: Option<NaiveDate>,
    minimum_amount_cents: Option<i64>,
    maximum_amount_cents: Option<i64>,
    fraud_status: Option<String>,
}

impl PayoutFilters {
    /// An inverted range is refused before any query.
    fn check(&self) -> Result<(), ApiError> {
        if let (Some(from), Some(to)) = (self.period_from, self.period_to)
            && from > to
        {
            return Err(ApiError::validation(INVALID_PAYOUT_FILTERS));
        }
        if let (Some(minimum), Some(maximum)) =
            (self.minimum_amount_cents, self.maximum_amount_cents)
            && minimum > maximum
        {
            return Err(ApiError::validation(INVALID_PAYOUT_FILTERS));
        }
        Ok(())
    }

    /// PostgREST's `ilike.%value%`, where `*` is also a wildcard.
    fn email_pattern(&self) -> Option<String> {
        self.payout_email
            .as_deref()
            .filter(|email| !email.is_empty())
            .map(|email| format!("%{}%", email.replace('*', "%")))
    }
}

const LIST_SQL: &str = "WITH matched AS ( \
         SELECT * FROM public.poster_payouts p \
         WHERE ($3::uuid IS NULL OR p.user_id = $3) \
           AND ($4::text IS NULL OR p.status = $4) \
           AND ($5::date IS NULL OR p.period = $5) \
           AND ($6::text IS NULL OR p.payout_email ILIKE $6) \
           AND ($7::date IS NULL OR p.period >= $7) \
           AND ($8::date IS NULL OR p.period <= $8) \
           AND ($9::bigint IS NULL OR p.amount_cents >= $9) \
           AND ($10::bigint IS NULL OR p.amount_cents <= $10) \
           AND ($11::text IS NULL \
                OR ($11 = 'flagged' AND p.status IN ('held', 'voided')) \
                OR ($11 = 'clear' AND p.status <> 'held' AND p.status <> 'voided'))), \
     page AS (SELECT * FROM matched ORDER BY period DESC, created_at DESC LIMIT $1 OFFSET $2) \
     SELECT (SELECT count(*) FROM matched) AS total, page.* \
     FROM (SELECT 1) AS one LEFT JOIN page ON true \
     ORDER BY page.period DESC, page.created_at DESC";

/// `_list_payouts`: newest period first, then newest row.
async fn list_payouts(
    db: &sqlx::PgPool,
    filters: &PayoutFilters,
    pagination: Pagination,
) -> Result<(Vec<PosterPayout>, i64), ApiError> {
    filters.check()?;
    let email = filters.email_pattern();
    let rows = read_with_retry(|| {
        sqlx::query(LIST_SQL)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(filters.user_id)
            .bind(&filters.status)
            .bind(filters.period)
            .bind(&email)
            .bind(filters.period_from)
            .bind(filters.period_to)
            .bind(filters.minimum_amount_cents)
            .bind(filters.maximum_amount_cents)
            .bind(&filters.fraud_status)
            .fetch_all(db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<Uuid>, _>("id")?.is_some() {
            items.push(PosterPayout::from_row(row)?);
        }
    }
    Ok((items, total))
}

#[utoipa::path(
    get,
    path = "/payouts/",
    tag = "payouts",
    operation_id = "list_own_payouts_payouts__get",
    summary = "List Own Payouts",
    params(
        ("payout_status" = inline(Option<PayoutStatus>), Query, nullable),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedUserPayouts),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_own_payouts(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    query: QueryParams,
) -> Result<Json<Paginated<UserPosterPayoutResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "payout_status")
        .optional_choice(PAYOUT_STATUSES);
    check.finish()?;
    let filters = PayoutFilters {
        user_id: Some(user.id),
        status,
        ..PayoutFilters::default()
    };
    let (payouts, total) = list_payouts(&state.db, &filters, pagination).await?;
    let items = payouts.iter().map(UserPosterPayoutResponse::from).collect();
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[utoipa::path(
    get,
    path = "/payouts/admin",
    tag = "payouts",
    operation_id = "list_admin_payouts_payouts_admin_get",
    summary = "List Admin Payouts",
    params(
        ("user_id" = Option<String>, Query, nullable, format = Uuid),
        ("payout_status" = inline(Option<PayoutStatus>), Query, nullable),
        ("period" = Option<String>, Query, nullable, format = Date),
        ("payout_email" = Option<String>, Query, nullable, max_length = 320),
        ("period_from" = Option<String>, Query, nullable, format = Date),
        ("period_to" = Option<String>, Query, nullable, format = Date),
        ("min_amount_cents" = Option<i64>, Query, nullable, minimum = 0),
        ("max_amount_cents" = Option<i64>, Query, nullable, minimum = 0),
        ("fraud_status" = inline(Option<PayoutFraudStatus>), Query, nullable),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedPayouts),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_admin_payouts(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<PosterPayoutResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let filters = PayoutFilters {
        user_id: check.query(&query, "user_id").optional_uuid(),
        status: check
            .query(&query, "payout_status")
            .optional_choice(PAYOUT_STATUSES),
        period: check.query(&query, "period").optional_date(),
        payout_email: check
            .query(&query, "payout_email")
            .optional_string(Length::default().max(320)),
        period_from: check.query(&query, "period_from").optional_date(),
        period_to: check.query(&query, "period_to").optional_date(),
        minimum_amount_cents: check
            .query(&query, "min_amount_cents")
            .optional_int(Limits::default().ge(0)),
        maximum_amount_cents: check
            .query(&query, "max_amount_cents")
            .optional_int(Limits::default().ge(0)),
        fraud_status: check
            .query(&query, "fraud_status")
            .optional_choice(FRAUD_STATUSES),
    };
    check.finish()?;
    let (payouts, total) = list_payouts(&state.db, &filters, pagination).await?;
    let items = payouts.iter().map(PosterPayoutResponse::from).collect();
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// `PayoutSelectionRequest`: 1 to 1000 payout ids.
fn read_selection(bytes: &Bytes, headers: &HeaderMap) -> Result<Vec<Uuid>, ApiError> {
    let mut body = Body::parse(bytes, headers, Extra::Forbid)?;
    let ids = body.required_uuid_list("payout_ids", 1, 1000);
    body.finish()?;
    Ok(ids.unwrap_or_default())
}

/// The ids once each, in the order first given (`dict.fromkeys`).
fn unique(ids: &[Uuid]) -> Vec<Uuid> {
    let mut seen = std::collections::HashSet::new();
    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
}

/// `get_pending_payouts_for_export`: every selected payout, which must all
/// exist and all be pending.
async fn pending_payouts_for_export(
    db: &sqlx::PgPool,
    ids: &[Uuid],
) -> Result<Vec<PosterPayout>, ApiError> {
    let ids = unique(ids);
    let rows = read_with_retry(|| {
        sqlx::query("SELECT * FROM public.poster_payouts WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(db)
    })
    .await?;
    let found: Vec<PosterPayout> = rows
        .iter()
        .map(PosterPayout::from_row)
        .collect::<anyhow::Result<_>>()?;
    let mut payouts = Vec::with_capacity(ids.len());
    for id in &ids {
        match found.iter().find(|payout| payout.id == *id) {
            Some(payout) => payouts.push(payout.clone()),
            None => return Err(ApiError::not_found(PAYOUT_NOT_FOUND)),
        }
    }
    if payouts.iter().any(|payout| payout.status != PENDING) {
        return Err(ApiError::validation(PAYOUT_EXPORT_PENDING_ONLY));
    }
    Ok(payouts)
}

/// `poster-payouts-YYYY-MM.csv` when every payout is from one month.
fn export_filename(payouts: &[PosterPayout]) -> String {
    let mut periods: Vec<NaiveDate> = payouts.iter().map(|payout| payout.period).collect();
    periods.dedup();
    periods.sort_unstable();
    periods.dedup();
    match periods.as_slice() {
        [period] => format!("poster-payouts-{}.csv", period.format("%Y-%m")),
        _ => "poster-payouts-export.csv".to_owned(),
    }
}

#[utoipa::path(
    post,
    path = "/payouts/admin/export",
    tag = "payouts",
    operation_id = "export_pending_payouts_payouts_admin_export_post",
    summary = "Export Pending Payouts",
    request_body = PayoutSelectionRequest,
    responses(
        (status = 200, description = "Successful Response", body = PayoutCsvExportResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn export_pending_payouts(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<PayoutCsvExportResponse>, ApiError> {
    let (mut parts, bytes) = json_request(request).await?;
    AdminUser::from_request_parts(&mut parts, &state).await?;
    let ids = read_selection(&bytes, &parts.headers)?;
    let payouts = pending_payouts_for_export(&state.db, &ids).await?;
    Ok(Json(PayoutCsvExportResponse {
        filename: export_filename(&payouts),
        content: serialize_interac_csv(&payouts),
    }))
}

/// Python's `int(value or 0)` for a stored flag's points.
fn flag_points(value: Option<&Value>) -> Result<i64, ApiError> {
    Ok(match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => 0,
        Some(Value::Bool(true)) => 1,
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|float| float.trunc() as i64))
            .unwrap_or_default(),
        Some(Value::String(text)) if text.is_empty() => 0,
        Some(Value::String(text)) => crate::api::validation::parse_python_int(text)
            .ok_or_else(|| anyhow::anyhow!("risk flag points are not an integer: {text}"))?,
        Some(other) => {
            return Err(anyhow::anyhow!("risk flag points are not an integer: {other}").into());
        }
    })
}

/// Python truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64() != Some(0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(entries) => !entries.is_empty(),
    }
}

/// `json.dumps(value, sort_keys=True)`: the identity of a flag.
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(entries) => {
            let mut keys: Vec<&String> = entries.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|key| (key.clone(), sorted(&entries[key])))
                    .collect::<Map<String, Value>>(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

/// The fraud reasons of a payout: each distinct stored flag once, with how
/// many scans carry it, in the order first seen. A held or voided payout
/// with no flags shows the administrator's notes as a manual review.
fn fraud_reasons(
    scan_flags: &[Value],
    payout: &PosterPayout,
) -> Result<Vec<PayoutFraudReason>, ApiError> {
    let mut reasons: Vec<(String, PayoutFraudReason)> = Vec::new();
    for flags in scan_flags {
        let flags = match flags {
            Value::Array(flags) => flags.as_slice(),
            other if !truthy(other) => &[],
            other => return Err(anyhow::anyhow!("risk_flags is not a list: {other}").into()),
        };
        for flag in flags {
            let Value::Object(flag) = flag else {
                return Err(anyhow::anyhow!("a risk flag is not an object").into());
            };
            let evidence = flag
                .get("evidence")
                .filter(|evidence| truthy(evidence))
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let key = json::python_dumps(&sorted(&serde_json::json!({
                "code": flag.get("code").cloned().unwrap_or(Value::Null),
                "points": flag.get("points").cloned().unwrap_or(Value::Null),
                "evidence": evidence,
            })));
            if let Some((_, reason)) = reasons.iter_mut().find(|(existing, _)| *existing == key) {
                reason.affected_scan_count += 1;
                continue;
            }
            if !evidence.is_object() {
                return Err(anyhow::anyhow!("risk flag evidence is not an object").into());
            }
            let code = match flag.get("code") {
                Some(Value::String(code)) if !code.is_empty() => code.clone(),
                Some(value) if truthy(value) => value.to_string(),
                _ => "UNKNOWN".to_owned(),
            };
            reasons.push((
                key,
                PayoutFraudReason {
                    code,
                    points: flag_points(flag.get("points"))?,
                    affected_scan_count: 1,
                    evidence,
                },
            ));
        }
    }
    if reasons.is_empty() && (payout.status == HELD || payout.status == VOIDED) {
        return Ok(vec![PayoutFraudReason {
            code: "MANUAL_REVIEW".into(),
            points: 0,
            affected_scan_count: 0,
            evidence: serde_json::json!({"review_notes": payout.notes.clone().unwrap_or_default()}),
        }]);
    }
    Ok(reasons.into_iter().map(|(_, reason)| reason).collect())
}

async fn get_payout(db: &sqlx::PgPool, id: Uuid) -> Result<Option<PosterPayout>, ApiError> {
    let row = read_with_retry(|| {
        sqlx::query("SELECT * FROM public.poster_payouts WHERE id = $1")
            .bind(id)
            .fetch_optional(db)
    })
    .await?;
    Ok(row.as_ref().map(PosterPayout::from_row).transpose()?)
}

async fn review_history(db: &sqlx::PgPool, id: Uuid) -> Result<Vec<PayoutReviewEvent>, ApiError> {
    let rows = read_with_retry(|| {
        sqlx::query(
            "SELECT id, from_status, to_status, notes, reviewed_by, reviewed_at \
             FROM public.poster_payout_reviews WHERE payout_id = $1 ORDER BY reviewed_at, id",
        )
        .bind(id)
        .fetch_all(db)
    })
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PayoutReviewEvent {
                id: row.try_get("id")?,
                from_status: row.try_get("from_status")?,
                to_status: row.try_get("to_status")?,
                notes: row.try_get("notes")?,
                reviewed_by: row.try_get("reviewed_by")?,
                reviewed_at: row.try_get("reviewed_at")?,
            })
        })
        .collect()
}

fn payout_id(path: &PathParams, check: &mut Validator) -> Uuid {
    check.path(path, "payout_id").uuid()
}

#[utoipa::path(
    get,
    path = "/payouts/admin/{payout_id}",
    tag = "payouts",
    operation_id = "get_admin_payout_detail_payouts_admin__payout_id__get",
    summary = "Get Admin Payout Detail",
    params(("payout_id" = String, Path, format = Uuid)),
    responses(
        (status = 200, description = "Successful Response", body = AdminPayoutDetail),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_admin_payout_detail(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
) -> Result<Json<AdminPayoutDetail>, ApiError> {
    let mut check = Validator::default();
    let id = payout_id(&path, &mut check);
    check.finish()?;
    payout_detail(&state.db, id).await.map(Json)
}

/// `get_admin_payout_detail`.
async fn payout_detail(db: &sqlx::PgPool, id: Uuid) -> Result<AdminPayoutDetail, ApiError> {
    let payout = get_payout(db, id)
        .await?
        .ok_or_else(|| ApiError::not_found(PAYOUT_NOT_FOUND))?;
    let (period_start, period_end) = month_bounds(payout.period);
    let scans =
        read_with_retry(|| load_period_scans(db, payout.user_id, period_start, period_end)).await?;
    let flags: Vec<Value> = scans.into_iter().map(|scan| scan.risk_flags).collect();
    let fraud_reasons = fraud_reasons(&flags, &payout)?;
    let contributions =
        read_with_retry(|| earnings_rows(db, payout.user_id, period_start, period_end))
            .await?
            .into_iter()
            .filter(|row| row.period_creditable_scans > 0)
            .map(|row| PosterPayoutContribution {
                qr_code_id: row.qr_code_id,
                name: row.name,
                poster_template_id: row.poster_template_id,
                scan_count: row.period_creditable_scans,
                amount_cents: row.period_creditable_scans * payout.rate_cents,
            })
            .collect();
    Ok(AdminPayoutDetail {
        payout: PosterPayoutResponse::from(&payout),
        fraud_reasons,
        contributions,
        period_start,
        period_end,
        review_history: review_history(db, payout.id).await?,
    })
}

/// `_raise_payout_rpc_error`: the payout functions' refusals as API errors;
/// any other database error keeps its usual mapping.
fn payout_rpc_error(error: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(database) = &error {
        let message = database.message();
        if message.contains("payout_not_found") {
            return ApiError::not_found(PAYOUT_NOT_FOUND);
        }
        if message.contains("payout_notes_required") {
            return ApiError::validation(PAYOUT_NOTES_REQUIRED);
        }
        if message.contains("invalid_payout_status_transition") {
            return ApiError::validation(INVALID_STATUS_TRANSITION);
        }
        if message.contains("admin_access_required") {
            return ApiError::authorization(ADMIN_ACCESS_REQUIRED);
        }
    }
    ApiError::Database(error)
}

/// `PayoutStatusUpdate`: the target status, and notes stripped to `None` when blank.
fn read_status_update(body: &mut Body) -> (Option<String>, Option<String>) {
    let status = body.required_string("status", &Str::new().one_of(PAYOUT_STATUSES));
    let notes = match body.string("notes", &Str::new().max(10_000)) {
        Input::Given(notes) => {
            Some(python_strip(&notes).to_owned()).filter(|notes| !notes.is_empty())
        }
        _ => None,
    };
    (status, notes)
}

#[utoipa::path(
    patch,
    path = "/payouts/admin/{payout_id}/status",
    tag = "payouts",
    operation_id = "transition_payout_payouts_admin__payout_id__status_patch",
    summary = "Transition Payout",
    params(("payout_id" = String, Path, format = Uuid)),
    request_body = PayoutStatusUpdate,
    responses(
        (status = 200, description = "Successful Response", body = PosterPayoutResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn transition_payout(
    State(state): State<AppState>,
    path: PathParams,
    request: Request,
) -> Result<Json<PosterPayoutResponse>, ApiError> {
    let (mut parts, bytes) = json_request(request).await?;
    let AdminUser(admin) = AdminUser::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let id = payout_id(&path, &mut check);
    let (status, notes) = match Body::parse(&bytes, &parts.headers, Extra::Forbid) {
        Ok(mut body) => {
            let fields = read_status_update(&mut body);
            merge_issues(check, body.finish())?;
            fields
        }
        Err(error) => return Err(merge_issues(check, Err(error)).expect_err("an error")),
    };
    let row = sqlx::query("SELECT * FROM public.transition_poster_payout_status($1, $2, $3, $4)")
        .bind(id)
        .bind(status.unwrap_or_default())
        .bind(notes)
        .bind(admin.id)
        .fetch_optional(&state.db)
        .await
        .map_err(payout_rpc_error)?;
    let row = row.ok_or_else(|| ApiError::conflict(INVALID_STATUS_TRANSITION))?;
    Ok(Json(PosterPayoutResponse::from(&PosterPayout::from_row(
        &row,
    )?)))
}

#[utoipa::path(
    post,
    path = "/payouts/admin/mark-paid",
    tag = "payouts",
    operation_id = "bulk_mark_paid_payouts_admin_mark_paid_post",
    summary = "Bulk Mark Paid",
    request_body = PayoutSelectionRequest,
    responses(
        (status = 200, description = "Successful Response", body = Vec<PosterPayoutResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn bulk_mark_paid(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<Vec<PosterPayoutResponse>>, ApiError> {
    let (mut parts, bytes) = json_request(request).await?;
    let AdminUser(admin) = AdminUser::from_request_parts(&mut parts, &state).await?;
    let ids = unique(&read_selection(&bytes, &parts.headers)?);
    let rows = sqlx::query("SELECT * FROM public.mark_poster_payouts_paid($1, $2)")
        .bind(&ids)
        .bind(admin.id)
        .fetch_all(&state.db)
        .await
        .map_err(payout_rpc_error)?;
    let payouts = rows
        .iter()
        .map(|row| PosterPayout::from_row(row).map(|payout| PosterPayoutResponse::from(&payout)))
        .collect::<anyhow::Result<_>>()?;
    Ok(Json(payouts))
}

/// FastAPI answers a GET of `/payouts/admin/export` or `/payouts/admin/mark-paid`
/// as a detail request for that "id" (Starlette tries the parameter route
/// after the static one refuses the method), which fails as an invalid UUID.
pub async fn detail_of_static_path(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    uri: axum::http::Uri,
) -> Result<Json<AdminPayoutDetail>, ApiError> {
    let raw = uri.path().rsplit('/').next().unwrap_or_default().to_owned();
    let id = Uuid::parse_str(&raw).map_err(|error| {
        ApiError::RequestValidation(vec![
            crate::api::validation::ValidationIssue::new(
                "uuid_parsing",
                vec![serde_json::json!("path"), serde_json::json!("payout_id")],
                format!("Input should be a valid UUID, {error}"),
                serde_json::json!(raw),
            )
            .with_ctx(serde_json::json!({"error": error.to_string()})),
        ])
    })?;
    payout_detail(&state.db, id).await.map(Json)
}

#[cfg(test)]
mod tests;
