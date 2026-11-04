//! `/positions`: the public position directory (`routers/positions.py`,
//! `services/position_service.py`).

use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Months, NaiveDate, Utc};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::errors::{ApiError, get_or_404};
use crate::api::json;
use crate::api::messages::POSITION_NOT_FOUND;
use crate::api::pagination::{DEFAULT_MAX_ROWS, Pagination};
use crate::api::validation::{Length, Limits, PathParams, QueryParams, Validator};
use crate::constants::{MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH};
use crate::controlbox::POSITIONS;
use crate::db::read_with_retry;
use crate::schools::{name_pattern, normalize_slug, school_id_sql};
use crate::text::sanitize_postgrest_value;

const POSITION_TYPES: &[&str] = &[
    "executive",
    "committee",
    "volunteer",
    "staff",
    "internship",
    "general",
];
const SORT_ORDERS: &[&str] = &["asc", "desc"];

/// When a position counts as open: active, and either its deadline is today
/// or later or, undated, it was added within `undated_visibility_months`.
#[derive(Debug, Clone, Copy)]
pub struct OpenWindow {
    pub today: NaiveDate,
    pub cutoff: DateTime<Utc>,
}

impl OpenWindow {
    pub fn now() -> Self {
        let now = Utc::now();
        Self {
            today: now.date_naive(),
            // Like relativedelta, a month back from the 31st lands on the month's last day.
            cutoff: now
                .checked_sub_months(Months::new(POSITIONS.undated_visibility_months))
                .unwrap_or(now),
        }
    }

    /// `_apply_open_filter` on positions `alias`, with `today` and `cutoff`
    /// bound to the given placeholders.
    pub fn sql(alias: &str, today: &str, cutoff: &str) -> String {
        format!(
            "{alias}.is_active AND ({alias}.deadline_date >= {today} \
             OR ({alias}.deadline_date IS NULL AND {alias}.added_at >= {cutoff}))"
        )
    }
}

/// An additional existing club sharing an event or position (FastAPI's
/// `ClubCohostResponse`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[schema(as = ClubCohostResponse)]
pub struct ClubCohost {
    pub id: i32,
    pub club_name: String,
    pub logo_url: Option<String>,
    pub club_type: Option<String>,
    pub club_page: Option<String>,
    pub ig: Option<String>,
    pub discord: Option<String>,
}

/// A position as cards and detail pages show it, with its club and school.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PositionResponse {
    pub title: String,
    pub description: String,
    #[schema(value_type = PositionType, inline)]
    pub position_type: String,
    #[schema(required = false)]
    pub requirements: Vec<String>,
    pub commitment: Option<String>,
    pub compensation: Option<String>,
    pub is_paid: Option<bool>,
    pub location: Option<String>,
    pub contact_email: Option<String>,
    #[schema(value_type = Option<String>, format = Date)]
    #[serde(serialize_with = "json::option_date")]
    pub deadline_date: Option<NaiveDate>,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub deadline_at: Option<DateTime<Utc>>,
    pub source_video_url: Option<String>,
    pub id: i64,
    pub club_id: i32,
    pub source_url: String,
    pub source_image_url: Option<String>,
    pub is_active: bool,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub added_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub updated_at: DateTime<Utc>,
    pub club_name: String,
    pub club_logo_url: Option<String>,
    #[schema(required = false)]
    pub cohosts: Vec<ClubCohost>,
    pub club_type: Option<String>,
    pub club_page: Option<String>,
    pub club_ig: Option<String>,
    pub club_discord: Option<String>,
    pub school: String,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PositionType {
    Executive,
    Committee,
    Volunteer,
    Staff,
    Internship,
    General,
}

/// `Literal["asc", "desc"]`, for the OpenAPI schema.
#[allow(dead_code)]
#[derive(ToSchema)]
#[schema(default = "asc")]
pub enum SortOrder {
    #[schema(rename = "asc")]
    Asc,
    #[schema(rename = "desc")]
    Desc,
}

/// The newest open position of a school (FastAPI's `LatestAddedItem`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[schema(as = LatestAddedItem)]
pub struct LatestAddedItem {
    pub title: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub added_at: DateTime<Utc>,
    pub club_name: Option<String>,
    pub club_logo_url: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PositionDirectoryResponse {
    pub items: Vec<PositionResponse>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
    /// School freshness metadata on the first page only.
    pub latest_added_position: Option<LatestAddedItem>,
}

/// The columns `PositionResponse::from_row` reads, for positions `p`.
const POSITION_COLUMNS: &str = "p.title, p.description, p.position_type, p.requirements, \
     p.commitment, p.compensation, p.is_paid, p.location, p.contact_email, p.deadline_date, \
     p.deadline_at, p.source_video_url, p.id, p.club_id, p.source_url, p.source_image_url, \
     p.is_active, p.added_at, p.updated_at, \
     c.club_name, c.logo_url AS club_logo_url, c.club_type, c.club_page, c.ig AS club_ig, \
     c.discord AS club_discord, NULLIF(s.slug, '') AS school, \
     COALESCE((SELECT json_agg(json_build_object('id', h.id, 'club_name', h.club_name, \
         'logo_url', h.logo_url, 'club_type', h.club_type, 'club_page', h.club_page, \
         'ig', h.ig, 'discord', h.discord) ORDER BY h.id) \
       FROM public.clubs h WHERE h.id = ANY(p.cohost_club_ids)), '[]') AS cohosts";

/// Joins for `POSITION_COLUMNS`.
const POSITION_JOINS: &str = "LEFT JOIN public.clubs c ON c.id = p.club_id \
     LEFT JOIN public.schools s ON s.id = p.school_id";

impl PositionResponse {
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let id: i64 = row.try_get("id")?;
        // `club_name: str` and `school: str` are required by the response model.
        let required = |value: Option<String>, field: &str| {
            value.ok_or_else(|| ApiError::Internal(anyhow::anyhow!("position {id} has no {field}")))
        };
        Ok(Self {
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            position_type: row.try_get("position_type")?,
            requirements: row
                .try_get::<sqlx::types::Json<Vec<String>>, _>("requirements")?
                .0,
            commitment: row.try_get("commitment")?,
            compensation: row.try_get("compensation")?,
            is_paid: row.try_get("is_paid")?,
            location: row.try_get("location")?,
            contact_email: row.try_get("contact_email")?,
            deadline_date: row.try_get("deadline_date")?,
            deadline_at: row.try_get("deadline_at")?,
            source_video_url: row.try_get("source_video_url")?,
            id,
            club_id: row.try_get("club_id")?,
            source_url: row.try_get("source_url")?,
            source_image_url: row.try_get("source_image_url")?,
            is_active: row.try_get("is_active")?,
            added_at: row.try_get("added_at")?,
            updated_at: row.try_get("updated_at")?,
            club_name: required(row.try_get("club_name")?, "club")?,
            club_logo_url: row.try_get("club_logo_url")?,
            cohosts: row
                .try_get::<sqlx::types::Json<Vec<ClubCohost>>, _>("cohosts")?
                .0,
            club_type: row.try_get("club_type")?,
            club_page: row.try_get("club_page")?,
            club_ig: row.try_get("club_ig")?,
            club_discord: row.try_get("club_discord")?,
            school: required(row.try_get("school")?, "school")?,
        })
    }
}

/// A school filter given as slug or name, bound as (`normalize_slug`, `name_pattern`).
fn school_lookup(school: &str) -> (Option<String>, Option<String>) {
    (
        Some(normalize_slug(school)).filter(|slug| !slug.is_empty()),
        name_pattern(school),
    )
}

#[utoipa::path(
    get,
    path = "/positions/",
    tag = "positions",
    operation_id = "list_positions_positions__get",
    summary = "List Positions",
    params(
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("position_type" = inline(Option<PositionType>), Query, nullable),
        ("club_id" = Option<i64>, Query, nullable, minimum = 1),
        ("include_closed" = Option<bool>, Query),
        ("added_since" = Option<String>, Query, nullable, format = DateTime),
        ("paid_only" = Option<bool>, Query),
        ("sort_order" = inline(Option<SortOrder>), Query),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PositionDirectoryResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_positions(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Json<PositionDirectoryResponse>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let position_type = check
        .query(&query, "position_type")
        .optional_choice(POSITION_TYPES);
    let club_id = check
        .query(&query, "club_id")
        .optional_int(Limits::default().ge(1));
    let include_closed = check.query(&query, "include_closed").bool_or(false);
    let added_since = check.query(&query, "added_since").optional_aware_datetime();
    let paid_only = check.query(&query, "paid_only").bool_or(false);
    let descending = check
        .query(&query, "sort_order")
        .choice_or("asc", SORT_ORDERS)
        == "desc";
    check.finish()?;

    let school = school.filter(|school| !school.is_empty());
    let (slug, name) = school.as_deref().map(school_lookup).unwrap_or_default();
    let school_filter = if school.is_some() {
        format!("AND p.school_id = {}", school_id_sql("$3", "$4"))
    } else {
        String::new()
    };
    let term = search
        .map(|search| sanitize_postgrest_value(&search))
        .filter(|term| !term.is_empty())
        .map(|term| format!("%{term}%"));
    let open = OpenWindow::now();
    let direction = if descending { "DESC" } else { "ASC" };
    let order = format!(
        "deadline_date {direction} NULLS LAST, deadline_at {direction} NULLS LAST, id {direction}"
    );
    let open_sql = OpenWindow::sql("p", "$11", "$12");
    let sql = format!(
        "WITH matched AS ( \
             SELECT p.id, p.deadline_date, p.deadline_at FROM public.positions p \
             WHERE true {school_filter} \
               AND ($5::text IS NULL OR p.position_type = $5) \
               AND ($6::timestamptz IS NULL OR p.added_at >= $6) \
               AND (NOT $7 OR p.is_paid = true) \
               AND ($8::bigint IS NULL OR p.club_id = $8 OR p.cohost_club_ids @> ARRAY[$8::int]) \
               AND ($9::text IS NULL OR p.title ILIKE $9 OR p.description ILIKE $9 \
                    OR p.commitment ILIKE $9 OR p.location ILIKE $9) \
               AND ($10 OR ({open_sql}))), \
         page AS ( \
             SELECT m.id FROM matched m ORDER BY {order} LIMIT $1 OFFSET $2), \
         latest AS ( \
             SELECT p.title, p.added_at, c.club_name, c.logo_url FROM public.positions p \
             LEFT JOIN public.clubs c ON c.id = p.club_id \
             WHERE $13 AND {open_sql} {school_filter} \
             ORDER BY p.added_at DESC, p.id DESC LIMIT 1) \
         SELECT (SELECT count(*) FROM matched) AS total, \
                latest.title AS latest_title, latest.added_at AS latest_added_at, \
                latest.club_name AS latest_club_name, latest.logo_url AS latest_club_logo_url, \
                listed.* \
         FROM (SELECT 1) AS one \
         LEFT JOIN latest ON true \
         LEFT JOIN (SELECT {POSITION_COLUMNS} FROM page JOIN public.positions p ON p.id = page.id \
                    {POSITION_JOINS}) AS listed ON true \
         ORDER BY listed.{}",
        order.replace(", ", ", listed.")
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&slug)
            .bind(&name)
            .bind(&position_type)
            .bind(added_since)
            .bind(paid_only)
            .bind(club_id)
            .bind(&term)
            .bind(include_closed)
            .bind(open.today)
            .bind(open.cutoff)
            .bind(pagination.page == 1)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut latest = None;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if let Some(title) = row.try_get::<Option<String>, _>("latest_title")? {
            latest = Some(LatestAddedItem {
                title,
                added_at: row
                    .try_get::<Option<DateTime<Utc>>, _>("latest_added_at")?
                    .unwrap_or_default(),
                club_name: row.try_get("latest_club_name")?,
                club_logo_url: row.try_get("latest_club_logo_url")?,
            });
        }
        if row.try_get::<Option<i64>, _>("id")?.is_some() {
            items.push(PositionResponse::from_row(row)?);
        }
    }
    let page = crate::api::pagination::Paginated::new(items, total, pagination);
    Ok(Json(PositionDirectoryResponse {
        items: page.items,
        total: page.total,
        page: page.page,
        page_size: page.page_size,
        total_pages: page.total_pages,
        latest_added_position: latest,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PositionStatsResponse {
    #[schema(minimum = 0)]
    pub click_count: i64,
}

#[utoipa::path(
    get,
    path = "/positions/stats",
    tag = "positions",
    operation_id = "get_position_stats_positions_stats_get",
    summary = "Get Position Stats",
    params(("school" = String, Query, min_length = 1, max_length = 255)),
    responses(
        (status = 200, description = "Successful Response", body = std::collections::HashMap<String, PositionStatsResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_position_stats(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Json<IndexMap<String, PositionStatsResponse>>, ApiError> {
    let mut check = Validator::default();
    let school = check
        .query(&query, "school")
        .string(Length::default().min(1).max(MAX_SCHOOL_LENGTH));
    check.finish()?;
    let (slug, name) = school_lookup(&school);
    let open = OpenWindow::now();
    // The school's open positions; a failure here is the request's failure.
    let sql = format!(
        "SELECT p.id::int FROM public.positions p WHERE p.school_id = {} AND {} \
         ORDER BY p.id LIMIT $5",
        school_id_sql("$1", "$2"),
        OpenWindow::sql("p", "$3", "$4"),
    );
    let ids = read_with_retry(|| {
        sqlx::query_scalar::<_, i32>(&sql)
            .bind(&slug)
            .bind(&name)
            .bind(open.today)
            .bind(open.cutoff)
            .bind(DEFAULT_MAX_ROWS as i64 + 1)
            .fetch_all(&state.db)
    })
    .await?;
    if ids.len() > DEFAULT_MAX_ROWS {
        // `fetch_all_pages` refuses rather than return a partial read.
        return Err(ApiError::Internal(anyhow::anyhow!(
            "fetch_all_pages exceeded max_rows={DEFAULT_MAX_ROWS}"
        )));
    }
    if ids.is_empty() {
        return Ok(Json(IndexMap::new()));
    }
    // Live click counts (the events group's
    // `interaction_service.get_click_counts_for_positions`, inlined), by id.
    // As in `_get_click_counts`, failing counts read as none.
    let result = read_with_retry(|| {
        sqlx::query_as::<_, (i32, i64)>(
            "SELECT position_id, click_count FROM public.get_position_click_counts($1) \
             ORDER BY position_id",
        )
        .bind(&ids)
        .fetch_all(&state.db)
    })
    .await;
    let counts = result.unwrap_or_else(|error| {
        tracing::warn!("Failed to fetch position click counts: {error}");
        Vec::new()
    });
    Ok(Json(
        counts
            .into_iter()
            .map(|(id, click_count)| (id.to_string(), PositionStatsResponse { click_count }))
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/positions/{position_id}",
    tag = "positions",
    operation_id = "get_position_positions__position_id__get",
    summary = "Get Position",
    params(("position_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = PositionResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_position(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<PositionResponse>, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "position_id").int(Limits::default());
    check.finish()?;
    let sql = format!(
        "SELECT {POSITION_COLUMNS} FROM public.positions p {POSITION_JOINS} WHERE p.id = $1 LIMIT 1"
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(&state.db)).await?;
    let row = get_or_404(row, POSITION_NOT_FOUND)?;
    Ok(Json(PositionResponse::from_row(&row)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undated_positions_stay_open_four_calendar_months() {
        // test_no_deadline_expiry_uses_four_calendar_months_for_all_open_reads
        assert_eq!(POSITIONS.undated_visibility_months, 4);
        let window = OpenWindow::now();
        assert_eq!(window.today, Utc::now().date_naive());
        let months = (window
            .today
            .signed_duration_since(window.cutoff.date_naive()))
        .num_days();
        assert!((118..=124).contains(&months), "{months}");
        assert_eq!(
            OpenWindow::sql("p", "$1", "$2"),
            "p.is_active AND (p.deadline_date >= $1 OR (p.deadline_date IS NULL AND p.added_at >= $2))"
        );
    }

    #[test]
    fn school_filters_take_a_slug_or_a_name() {
        assert_eq!(
            school_lookup(" UWaterloo "),
            (Some("uwaterloo".into()), Some("UWaterloo".into()))
        );
    }
}
