//! `/competitor-pain-points`: public complaints about competitors that the
//! daily sweep (`jobs/find_competitor_pain_points.py`) stores, and its daily
//! reports, served to the admin page.

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use chrono::{DateTime, NaiveDate, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::auth::AdminUser;
use crate::api::body::{Body, Extra, Str, json_first, merge_issues};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::COMPETITOR_PAIN_POINT_NOT_FOUND;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::validation::{Length, PathParams, QueryParams, Validator};
use crate::constants::MAX_SEARCH_QUERY_LENGTH;
use crate::db::read_with_retry;
use crate::text::{python_strip, sanitize_postgrest_value};

const AUDIENCES: &[&str] = &["organizer", "attendee", "other"];
const STATUSES: &[&str] = &["new", "seen", "dismissed"];
const SLUG_PATTERN: &str = "^[a-z0-9_]+$";
static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(SLUG_PATTERN).expect("pattern"));
const MAX_SLUG_LENGTH: usize = 64;

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum PainPointAudience {
    Organizer,
    Attendee,
    Other,
}

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum PainPointStatus {
    New,
    Seen,
    Dismissed,
}

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum SuggestionPriority {
    High,
    Medium,
    Low,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CompetitorPainPointResponse {
    #[schema(pattern = "^[a-z0-9_]+$")]
    pub competitor: String,
    #[schema(pattern = "^[a-z0-9_]+$")]
    pub source: String,
    #[schema(max_length = 2000, pattern = "^https://\\S+$")]
    pub url: String,
    #[serde(default)]
    #[schema(max_length = 200, default = "")]
    pub author: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub quote: String,
    #[schema(min_length = 1, max_length = 300)]
    pub pain_point: String,
    #[schema(value_type = PainPointAudience, inline)]
    pub audience: String,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub posted_at: Option<DateTime<Utc>>,
    #[schema(value_type = uuid::Uuid)]
    pub id: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub found_at: DateTime<Utc>,
    #[schema(value_type = PainPointStatus, inline)]
    pub status: String,
}

const COLUMNS: &str = "competitor, source, url, author, quote, pain_point, audience, posted_at, \
     id::text AS id, found_at, status";

impl CompetitorPainPointResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        Ok(Self {
            competitor: row.try_get("competitor")?,
            source: row.try_get("source")?,
            url: row.try_get("url")?,
            author: row.try_get("author")?,
            quote: row.try_get("quote")?,
            pain_point: row.try_get("pain_point")?,
            audience: row.try_get("audience")?,
            posted_at: row.try_get("posted_at")?,
            id: row.try_get("id")?,
            found_at: row.try_get("found_at")?,
            status: row.try_get("status")?,
        })
    }
}

crate::paginated_schema!(
    PaginatedCompetitorPainPoints,
    PaginatedResponse_CompetitorPainPointResponse_,
    CompetitorPainPointResponse
);

/// A page query's total (on every row) and its rows (none when the page is empty).
fn page_rows(rows: Vec<PgRow>) -> Result<(i64, Vec<PgRow>), ApiError> {
    let mut total = 0;
    let mut items = Vec::new();
    for row in rows {
        total = row.try_get::<i64, _>("total")?;
        if row.try_get::<Option<String>, _>("id")?.is_some() {
            items.push(row);
        }
    }
    Ok((total, items))
}

#[utoipa::path(
    get,
    path = "/competitor-pain-points/",
    tag = "competitor-pain-points",
    operation_id = "list_pain_points_competitor_pain_points__get",
    summary = "List Pain Points",
    params(
        ("competitor" = Option<String>, Query, nullable, max_length = 64, pattern = "^[a-z0-9_]+$"),
        ("source" = Option<String>, Query, nullable, max_length = 64, pattern = "^[a-z0-9_]+$"),
        ("audience" = inline(Option<PainPointAudience>), Query, nullable),
        ("pain_point_status" = inline(Option<PainPointStatus>), Query, nullable),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedCompetitorPainPoints),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_pain_points(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<CompetitorPainPointResponse>>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let slug = Length::default().max(MAX_SLUG_LENGTH);
    let competitor = check
        .query(&query, "competitor")
        .optional_pattern(slug, SLUG_PATTERN, &SLUG);
    let source = check
        .query(&query, "source")
        .optional_pattern(slug, SLUG_PATTERN, &SLUG);
    let audience = check.query(&query, "audience").optional_choice(AUDIENCES);
    let status = check
        .query(&query, "pain_point_status")
        .optional_choice(STATUSES);
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let term = search
        .as_deref()
        .map(python_strip)
        .filter(|search| !search.is_empty())
        .map(sanitize_postgrest_value);
    let sql = format!(
        "WITH matched AS ( \
             SELECT * FROM public.competitor_pain_points p \
             WHERE ($3::text IS NULL OR p.competitor = $3) \
               AND ($4::text IS NULL OR p.source = $4) \
               AND ($5::text IS NULL OR p.audience = $5) \
               AND ($6::text IS NULL OR p.status = $6) \
               AND ($7::text IS NULL OR p.quote ILIKE '%' || $7 || '%' \
                    OR p.pain_point ILIKE '%' || $7 || '%')), \
         page AS ( \
             SELECT row_number() OVER (ORDER BY m.found_at DESC, m.id ASC) AS position, \
                 {COLUMNS} \
             FROM matched m ORDER BY m.found_at DESC, m.id ASC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true \
         ORDER BY page.position"
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&competitor)
            .bind(&source)
            .bind(&audience)
            .bind(&status)
            .bind(&term)
            .fetch_all(&state.db)
    })
    .await?;
    let (total, rows) = page_rows(rows)?;
    let items = rows
        .iter()
        .map(CompetitorPainPointResponse::from_row)
        .collect::<Result<_, _>>()?;
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// A complaint that keeps coming up in one day's findings.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ReportTheme {
    #[schema(min_length = 1, max_length = 300)]
    pub theme: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub detail: String,
    #[serde(default)]
    #[schema(max_items = 30)]
    pub competitors: Vec<String>,
    #[serde(default)]
    #[schema(max_items = 30)]
    pub complaint_urls: Vec<String>,
}

/// One change to wat2do.io the report suggests, and the complaints behind it.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ReportSuggestion {
    #[schema(min_length = 1, max_length = 300)]
    pub title: String,
    #[schema(value_type = SuggestionPriority, inline)]
    pub priority: String,
    #[schema(min_length = 1, max_length = 2000)]
    pub problem: String,
    #[schema(min_length = 1, max_length = 4000)]
    pub change: String,
    #[serde(default)]
    #[schema(max_items = 20)]
    pub r#where: Vec<String>,
    #[serde(default)]
    #[schema(max_items = 30)]
    pub complaint_urls: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DailyReportResponse {
    #[schema(value_type = String, format = Date)]
    pub report_date: NaiveDate,
    pub model: String,
    #[schema(minimum = 0)]
    pub complaint_count: i64,
    #[schema(min_length = 1, max_length = 4000)]
    pub summary: String,
    #[serde(default)]
    #[schema(max_items = 20)]
    pub themes: Vec<ReportTheme>,
    #[serde(default)]
    #[schema(max_items = 20)]
    pub suggestions: Vec<ReportSuggestion>,
    #[schema(value_type = uuid::Uuid)]
    pub id: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
}

impl DailyReportResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let id: String = row.try_get("id")?;
        // The stored themes and suggestions are read as the report models
        // read them: unknown keys dropped, missing lists empty.
        let list = |column: &str| -> Result<serde_json::Value, ApiError> {
            Ok(row.try_get::<serde_json::Value, _>(column)?)
        };
        let invalid = |error: serde_json::Error| {
            ApiError::Internal(anyhow::anyhow!(
                "report {id} is not a valid report: {error}"
            ))
        };
        Ok(Self {
            report_date: row.try_get("report_date")?,
            model: row.try_get("model")?,
            complaint_count: row.try_get::<i32, _>("complaint_count")?.into(),
            summary: row.try_get("summary")?,
            themes: serde_json::from_value(list("themes")?).map_err(invalid)?,
            suggestions: serde_json::from_value(list("suggestions")?).map_err(invalid)?,
            created_at: row.try_get("created_at")?,
            id: id.clone(),
        })
    }
}

crate::paginated_schema!(
    PaginatedDailyReports,
    PaginatedResponse_DailyReportResponse_,
    DailyReportResponse
);

#[utoipa::path(
    get,
    path = "/competitor-pain-points/reports",
    tag = "competitor-pain-points",
    operation_id = "list_reports_competitor_pain_points_reports_get",
    summary = "List Reports",
    params(
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedDailyReports),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_reports(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<DailyReportResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    check.finish()?;
    let sql = "WITH page AS ( \
             SELECT report_date, model, complaint_count, summary, themes, suggestions, \
                 id::text AS id, created_at \
             FROM public.competitor_pain_point_reports \
             ORDER BY report_date DESC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM public.competitor_pain_point_reports) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true \
         ORDER BY page.report_date DESC";
    let rows = read_with_retry(|| {
        sqlx::query(sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .fetch_all(&state.db)
    })
    .await?;
    let (total, rows) = page_rows(rows)?;
    let items = rows
        .iter()
        .map(DailyReportResponse::from_row)
        .collect::<Result<_, _>>()?;
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[allow(dead_code)]
#[derive(ToSchema)]
#[schema(as = CompetitorPainPointReview)]
pub struct CompetitorPainPointReview {
    #[schema(inline)]
    status: PainPointStatus,
}

#[utoipa::path(
    patch,
    path = "/competitor-pain-points/{pain_point_id}",
    tag = "competitor-pain-points",
    operation_id = "review_pain_point_competitor_pain_points__pain_point_id__patch",
    summary = "Review Pain Point",
    params(("pain_point_id" = uuid::Uuid, Path)),
    request_body = CompetitorPainPointReview,
    responses(
        (status = 200, description = "Successful Response", body = CompetitorPainPointResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn review_pain_point(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<CompetitorPainPointResponse>, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    AdminUser::from_request_parts(&mut parts, &state).await?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let id = check.path(&path, "pain_point_id").uuid();
    let status = merge_issues(
        check,
        Body::parse(&bytes, &parts.headers, Extra::Forbid).and_then(read_review),
    )?;
    let reviewed = sqlx::query(&format!(
        "UPDATE public.competitor_pain_points SET status = $2 WHERE id = $1 RETURNING {COLUMNS}"
    ))
    .bind(id)
    .bind(&status)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::not_found(COMPETITOR_PAIN_POINT_NOT_FOUND))?;
    Ok(Json(CompetitorPainPointResponse::from_row(&reviewed)?))
}

/// `CompetitorPainPointReview`: the new status.
fn read_review(mut body: Body) -> Result<String, ApiError> {
    let status = body.required_string("status", &Str::new().one_of(STATUSES));
    body.finish()?;
    status.ok_or_else(|| ApiError::Internal(anyhow::anyhow!("no review status")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn review(value: Value) -> Result<String, ApiError> {
        read_review(Body::from_value(value, Extra::Forbid))
    }

    #[test]
    fn reviews_take_one_known_status() {
        // test_admin_marks_a_pain_point_and_unknown_ids_404 (the 422 half)
        assert_eq!(review(json!({"status": "dismissed"})).unwrap(), "dismissed");
        for body in [
            json!({"status": "replied"}),
            json!({}),
            json!({"status": null}),
            json!({"status": "seen", "note": "x"}),
        ] {
            assert!(
                matches!(review(body.clone()), Err(ApiError::RequestValidation(_))),
                "{body}"
            );
        }
    }

    #[test]
    fn stored_report_lists_read_like_the_report_models() {
        let suggestions: Vec<ReportSuggestion> = serde_json::from_value(json!([{
            "title": "Say wat2do is free for clubs",
            "priority": "high",
            "problem": "Fees",
            "change": "Add a line",
            "complaint_urls": ["https://www.reddit.com/r/example/comments/seed1/"],
            "extra": "dropped"
        }]))
        .unwrap();
        assert_eq!(
            serde_json::to_string(&suggestions).unwrap(),
            r#"[{"title":"Say wat2do is free for clubs","priority":"high","problem":"Fees","change":"Add a line","where":[],"complaint_urls":["https://www.reddit.com/r/example/comments/seed1/"]}]"#
        );
    }

    #[test]
    fn response_fields_follow_the_model_order() {
        let response = CompetitorPainPointResponse {
            competitor: "eventbrite".into(),
            source: "reddit".into(),
            url: "https://www.reddit.com/r/example/comments/seed1/".into(),
            author: "club_treasurer".into(),
            quote: "Eventbrite took a fee from every free RSVP.".into(),
            pain_point: "Fees on free club events".into(),
            audience: "organizer".into(),
            posted_at: None,
            id: "88888888-8888-4888-8888-888888888881".into(),
            found_at: DateTime::parse_from_rfc3339("2026-10-19T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            status: "new".into(),
        };
        assert_eq!(
            serde_json::to_string(&response).unwrap(),
            r#"{"competitor":"eventbrite","source":"reddit","url":"https://www.reddit.com/r/example/comments/seed1/","author":"club_treasurer","quote":"Eventbrite took a fee from every free RSVP.","pain_point":"Fees on free club events","audience":"organizer","posted_at":null,"id":"88888888-8888-4888-8888-888888888881","found_at":"2026-10-19T00:00:00Z","status":"new"}"#
        );
    }
}
