//! `/clubs`: the public club directory, club submissions and their review,
//! and the management team (`routers/clubs.py`, `services/club_service.py`,
//! `services/admin_query.py`).
//!
//! `members`, `invitations` and `claims` hold the team routes; this module
//! holds the club itself and the reads they share.

pub mod claims;
pub mod emails;
pub mod invitations;
pub mod members;

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use sqlx::postgres::PgRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AdminUser, DbUser, OptionalUser, User, find_user};
use crate::api::body::{Body, Extra, Input, Str, merge_issues};
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{CLUB_NOT_FOUND, NOT_AUTHORIZED, USER_NOT_FOUND};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::positions::OpenWindow;
use crate::api::routes::users::no_content;
use crate::api::validation::{Length, Limits, PathParams, QueryParams, Validator};
use crate::constants::{
    CLUB_CATEGORIES, CLUB_TYPE_INDEPENDENT, MAX_CLUB_CATEGORY_COUNT, MAX_CLUB_CATEGORY_LENGTH,
    MAX_CLUB_NAME_LENGTH, MAX_CLUB_TYPE_LENGTH, MAX_REJECTION_REASON_LENGTH, MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH, MAX_URL_LENGTH,
};
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;
use crate::revalidation::revalidate_schools;
use crate::schools::normalize_slug;
use crate::text::{python_strip, sanitize_postgrest_value};

/// The pattern of a club type (`ClubTypeValue`), as pydantic reports it.
pub const CLUB_TYPE_PATTERN: &str = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
pub static CLUB_TYPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(CLUB_TYPE_PATTERN).expect("club type pattern"));
const CLUB_STATUSES: &[&str] = &["pending", "approved", "rejected"];
const SCHOOL_NOT_REGISTERED: &str = "School is not registered";
/// Resources a club change can make stale on the frontend.
const CLUB_RESOURCES: &[&str] = &["clubs"];
const ALL_RESOURCES: &[&str] = &["events", "positions", "clubs"];

/// The submission limiter of `POST /clubs/`, by client IP.
static SUBMISSIONS: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.submissions));

/// A club as the API returns it (`ClubResponse`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ClubResponse {
    pub id: i32,
    pub club_name: String,
    #[schema(value_type = ClubStatus, inline)]
    pub status: String,
    #[schema(value_type = Option<Vec<String>>)]
    #[serde(serialize_with = "json::option_value", default)]
    pub categories: Option<Value>,
    pub club_page: Option<String>,
    pub ig: Option<String>,
    pub discord: Option<String>,
    pub club_type: String,
    pub logo_url: Option<String>,
    pub created_by: Option<String>,
    #[schema(value_type = Option<String>, format = DateTime)]
    #[serde(serialize_with = "json::option_datetime")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub school: Option<String>,
    #[serde(default)]
    pub owner_email: Option<String>,
    #[schema(default = 0)]
    #[serde(default)]
    pub event_count: i64,
    #[schema(default = 0)]
    #[serde(default)]
    pub position_count: i64,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ClubStatus {
    Pending,
    Approved,
    Rejected,
}

/// A club in the admin review queue, with who submitted it.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ClubSubmissionResponse {
    #[serde(flatten)]
    pub club: ClubResponse,
    pub submitted_by_email: Option<String>,
}

crate::paginated_schema!(PaginatedClubs, PaginatedResponse_ClubResponse_, ClubResponse);
crate::paginated_schema!(
    PaginatedClubSubmissions,
    PaginatedResponse_ClubSubmissionResponse_,
    ClubSubmissionResponse
);

/// Which computed parts of a club a read fills in; the others read as Python
/// left them (no owner email, no event count).
#[derive(Debug, Clone, Copy)]
pub struct Computed {
    pub owner_email: bool,
    pub event_count: bool,
}

impl Computed {
    /// `get_club` and the directory: the owner's email and the event count.
    pub const FULL: Self = Self {
        owner_email: true,
        event_count: true,
    };
    /// A club row returned by a write (`_club_response(row)`).
    pub const ROW: Self = Self {
        owner_email: false,
        event_count: false,
    };
}

/// The columns `ClubResponse::from_row` reads, for clubs `c` joined to
/// schools `s` (`CLUB_JOINS`); `position_count` is added by the caller.
pub fn club_columns(computed: Computed) -> String {
    format!(
        "c.id, c.club_name, c.status, c.categories, c.club_page, c.ig, c.discord, c.club_type, \
         c.logo_url, c.created_by::text AS created_by, c.created_at, c.submitted_by_email, \
         NULLIF(s.slug, '') AS school, {} AS owner_email, {} AS event_count",
        if computed.owner_email {
            "(SELECT u.email FROM public.users u WHERE u.id = c.created_by)"
        } else {
            "NULL::text"
        },
        if computed.event_count {
            "public.event_count(c)"
        } else {
            "0::bigint"
        }
    )
}

pub const CLUB_JOINS: &str = "LEFT JOIN public.schools s ON s.id = c.school_id";

impl ClubResponse {
    /// A row of `club_columns`, with `position_count` when the read selected it.
    pub fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            id: row.try_get("id")?,
            club_name: row.try_get("club_name")?,
            status: row.try_get("status")?,
            categories: row
                .try_get::<Option<sqlx::types::Json<Value>>, _>("categories")?
                .map(|json| json.0),
            club_page: row.try_get("club_page")?,
            ig: row.try_get("ig")?,
            discord: row.try_get("discord")?,
            club_type: row.try_get("club_type")?,
            logo_url: row.try_get("logo_url")?,
            created_by: row.try_get("created_by")?,
            created_at: row.try_get("created_at")?,
            school: row.try_get("school")?,
            owner_email: row.try_get("owner_email")?,
            event_count: row.try_get("event_count")?,
            position_count: match row.try_get::<Option<i64>, _>("position_count") {
                Ok(count) => count.unwrap_or_default(),
                Err(sqlx::Error::ColumnNotFound(_)) => 0,
                Err(error) => return Err(error),
            },
        })
    }
}

/// The `club_id` path parameter.
pub fn club_id(path: &PathParams) -> Result<i64, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, path);
    check.finish()?;
    Ok(id)
}

fn club_id_into(check: &mut Validator, path: &PathParams) -> i64 {
    check.path(path, "club_id").int(Limits::default())
}

/// `club_service.get_club`.
pub async fn get_club(db: &sqlx::PgPool, id: i64) -> Result<Option<ClubResponse>, ApiError> {
    let sql = format!(
        "SELECT {} FROM public.clubs c {CLUB_JOINS} WHERE c.id = $1",
        club_columns(Computed::FULL)
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).fetch_optional(db)).await?;
    Ok(row.as_ref().map(ClubResponse::from_row).transpose()?)
}

/// `is_club_member`: a failed lookup reads as not a member, as in Python.
pub async fn is_club_member(db: &sqlx::PgPool, club_id: i64, user_id: Uuid) -> bool {
    let result = read_with_retry(|| {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM public.club_members WHERE club_id = $1 AND user_id = $2)",
        )
        .bind(club_id)
        .bind(user_id)
        .fetch_one(db)
    })
    .await;
    result.unwrap_or_else(|error| {
        tracing::warn!("Failed to query club_members in is_club_member: {error}");
        false
    })
}

/// `_get_club_or_403`: the club (404 when missing), for an admin or a member of it.
pub async fn managed_club(db: &sqlx::PgPool, id: i64, user: &User) -> Result<ClubResponse, ApiError> {
    let sql = format!(
        "SELECT {}, EXISTS (SELECT 1 FROM public.club_members m \
                 WHERE m.club_id = c.id AND m.user_id = $2) AS is_member \
         FROM public.clubs c {CLUB_JOINS} WHERE c.id = $1",
        club_columns(Computed::FULL)
    );
    let row = read_with_retry(|| sqlx::query(&sql).bind(id).bind(user.id).fetch_optional(db))
        .await?
        .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))?;
    let club = ClubResponse::from_row(&row)?;
    if user.is_admin() || row.try_get::<bool, _>("is_member")? {
        Ok(club)
    } else {
        Err(ApiError::authorization(NOT_AUTHORIZED))
    }
}

/// Ask the frontend to refresh `resources` of each named school.
async fn revalidate(schools: &[Option<String>], resources: &[&str]) {
    let schools: Vec<String> = schools.iter().flatten().cloned().collect();
    revalidate_schools(&schools, resources).await;
}

/// The `ids`, `categories` and other filters of the public directory.
#[derive(Debug, Default)]
struct DirectoryFilters {
    club_type: Option<String>,
    school: Option<String>,
    term: Option<String>,
    categories: Option<Vec<String>>,
    ids: Option<Vec<i64>>,
    min_events: i64,
}

#[utoipa::path(
    get,
    path = "/clubs/",
    tag = "clubs",
    operation_id = "list_clubs_clubs__get",
    summary = "List Clubs",
    description = "Public directory. Only approved clubs are listed.",
    params(
        ("club_type" = Option<String>, Query, nullable, min_length = 1, max_length = 100, pattern = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"),
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("categories" = Option<Vec<String>>, Query, nullable),
        ("ids" = Option<Vec<i64>>, Query, nullable),
        ("min_events" = Option<i64>, Query, minimum = 0),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedClubs),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_clubs(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Json<Paginated<ClubResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let club_type = check.query(&query, "club_type").optional_pattern(
        Length::default().min(1).max(MAX_CLUB_TYPE_LENGTH),
        CLUB_TYPE_PATTERN,
        &CLUB_TYPE,
    );
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let categories = query.all("categories");
    let ids = check.query_ints(&query, "ids");
    let min_events = check
        .query(&query, "min_events")
        .int_or(0, Limits::default().ge(0));
    check.finish()?;
    let filters = DirectoryFilters {
        club_type,
        school: school.filter(|school| !school.is_empty()),
        term: search
            .map(|search| sanitize_postgrest_value(&search))
            .filter(|term| !term.is_empty())
            .map(|term| format!("%{term}%")),
        categories: (!categories.is_empty())
            .then(|| categories.into_iter().map(str::to_owned).collect()),
        ids,
        min_events,
    };
    let (items, total) = directory(&state.db, &filters, pagination).await?;
    Ok(Json(Paginated::new(items, total, pagination)))
}

/// `list_clubs`: one page of approved clubs by name, with their open positions.
async fn directory(
    db: &sqlx::PgPool,
    filters: &DirectoryFilters,
    pagination: Pagination,
) -> Result<(Vec<ClubResponse>, i64), ApiError> {
    let school_filter = if filters.school.is_some() {
        // `get_school` by slug only; an unknown school matches nothing.
        "AND c.school_id = (SELECT id FROM public.schools WHERE slug = $5 LIMIT 1)"
    } else {
        ""
    };
    let open = OpenWindow::now();
    let sql = format!(
        "WITH matched AS ( \
             SELECT c.id, c.club_name FROM public.clubs c \
             WHERE c.status = 'approved' {school_filter} \
               AND ($3::bigint[] IS NULL OR c.id = ANY($3)) \
               AND ($4::text IS NULL OR c.club_type = $4) \
               AND ($6::text IS NULL OR c.club_name ILIKE $6) \
               AND ($7::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($7::text[]) AS category \
                    WHERE c.categories @> jsonb_build_array(category))) \
               AND ($8 = 0 OR public.event_count(c) >= $8)), \
         page AS (SELECT id, club_name FROM matched ORDER BY club_name ASC, id ASC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, listed.* \
         FROM (SELECT 1) AS one LEFT JOIN ( \
             SELECT {}, (SELECT count(*) FROM public.positions p \
                         WHERE (p.club_id = c.id OR p.cohost_club_ids @> ARRAY[c.id]) \
                           AND {}) AS position_count \
             FROM page JOIN public.clubs c ON c.id = page.id {CLUB_JOINS}) AS listed ON true \
         ORDER BY listed.club_name ASC, listed.id ASC",
        club_columns(Computed::FULL),
        OpenWindow::sql("p", "$9", "$10"),
    );
    let slug = filters.school.as_deref().map(normalize_slug);
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&filters.ids)
            .bind(&filters.club_type)
            .bind(&slug)
            .bind(&filters.term)
            .bind(&filters.categories)
            .bind(filters.min_events)
            .bind(open.today)
            .bind(open.cutoff)
            .fetch_all(db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<i32>, _>("id")?.is_some() {
            items.push(ClubResponse::from_row(row)?);
        }
    }
    Ok((items, total))
}

/// `admin_query.load_page_rows`: a page of one admin list (`admin_list_entries`,
/// newest first) and its total, as a CTE `entries (id, position)` plus the
/// total, given placeholders for the resource and its filters.
pub fn admin_page_sql(rows: &str) -> String {
    format!(
        "WITH matched AS ( \
             SELECT e.id, e.sort_at FROM public.admin_list_entries e \
             WHERE e.resource = $3 \
               AND ($4::text IS NULL OR e.search_text ILIKE $4) \
               AND ($5::text IS NULL OR e.school = $5) \
               AND ($6::text IS NULL OR e.status = $6)), \
         entries AS ( \
             SELECT id, row_number() OVER (ORDER BY sort_at DESC, id ASC) AS position \
             FROM (SELECT id, sort_at FROM matched ORDER BY sort_at DESC, id ASC \
                   LIMIT $1 OFFSET $2) AS page) \
         SELECT (SELECT count(*) FROM matched) AS total, listed.* \
         FROM (SELECT 1) AS one LEFT JOIN ({rows}) AS listed ON true \
         ORDER BY listed.position"
    )
}

/// The admin list filters, bound as `$3` to `$6` of `admin_page_sql`.
pub struct AdminFilters {
    pub resource: &'static str,
    /// `%search%` with PostgREST's `*` wildcard, unsanitized as in Python.
    pub search: Option<String>,
    pub school: Option<String>,
    pub status: Option<String>,
}

impl AdminFilters {
    pub fn new(
        resource: &'static str,
        search: Option<String>,
        school: Option<String>,
        status: Option<String>,
    ) -> Self {
        Self {
            resource,
            search: search
                .map(|search| python_strip(&search).to_owned())
                .filter(|search| !search.is_empty())
                .map(|search| format!("%{search}%").replace('*', "%")),
            school: school.filter(|school| !school.is_empty()),
            status: status.filter(|status| !status.is_empty()),
        }
    }
}

#[utoipa::path(
    get,
    path = "/clubs/review",
    tag = "clubs",
    operation_id = "list_clubs_for_review_clubs_review_get",
    summary = "List Clubs For Review",
    description = "Admin review queue across every review state.",
    params(
        ("club_status" = inline(Option<ClubStatus>), Query, nullable),
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedClubSubmissions),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_clubs_for_review(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<ClubSubmissionResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let status = check.query(&query, "club_status").optional_choice(CLUB_STATUSES);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let filters = AdminFilters::new("clubSubmissions", search, school, status);
    let sql = admin_page_sql(&format!(
        "SELECT entries.position, {} FROM entries \
         JOIN public.clubs c ON c.id::text = entries.id {CLUB_JOINS}",
        club_columns(Computed::FULL)
    ));
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(filters.resource)
            .bind(&filters.search)
            .bind(&filters.school)
            .bind(&filters.status)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<i32>, _>("id")?.is_some() {
            items.push(ClubSubmissionResponse {
                club: ClubResponse::from_row(row)?,
                submitted_by_email: row.try_get("submitted_by_email")?,
            });
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[utoipa::path(
    get,
    path = "/clubs/mine",
    tag = "clubs",
    operation_id = "list_my_clubs_clubs_mine_get",
    summary = "List My Clubs",
    responses((status = 200, description = "Successful Response", body = Vec<ClubResponse>))
)]
pub async fn list_my_clubs(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<Vec<ClubResponse>>, ApiError> {
    Ok(Json(clubs_managed_by(&state.db, user.id).await))
}

/// `list_clubs_by_owner`: the clubs whose team the user is on, with their
/// owners' emails (their event counts are not read). A failed read is no clubs.
pub async fn clubs_managed_by(db: &sqlx::PgPool, user_id: Uuid) -> Vec<ClubResponse> {
    // Driven from club_members like PostgREST's embedding, so the order matches.
    let sql = format!(
        "SELECT club.* FROM public.club_members m \
         CROSS JOIN LATERAL (SELECT {} FROM public.clubs c {CLUB_JOINS} \
                             WHERE c.id = m.club_id) AS club \
         WHERE m.user_id = $1",
        club_columns(Computed {
            owner_email: true,
            event_count: false,
        })
    );
    let rows = read_with_retry(|| sqlx::query(&sql).bind(user_id).fetch_all(db)).await;
    let clubs = rows.map_err(ApiError::from).and_then(|rows| {
        rows.iter()
            .map(|row| ClubResponse::from_row(row).map_err(ApiError::from))
            .collect::<Result<Vec<_>, _>>()
    });
    match clubs {
        Ok(mut clubs) => {
            let mut seen = std::collections::HashSet::new();
            clubs.retain(|club| seen.insert(club.id));
            clubs
        }
        Err(error) => {
            tracing::warn!("Failed to query club_members for owner_id {user_id}: {error:?}");
            Vec::new()
        }
    }
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}",
    tag = "clubs",
    operation_id = "get_club_clubs__club_id__get",
    summary = "Get Club",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_club_route(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<ClubResponse>, ApiError> {
    let id = club_id(&path)?;
    get_club(&state.db, id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))
}

/// `_validate_http_url`: `None` for blank, the stripped URL when it is
/// http(s) with a host, else the validator's message.
fn safe_http_url(value: &str) -> Result<Option<String>, &'static str> {
    let value = python_strip(value);
    if value.is_empty() {
        return Ok(None);
    }
    // urlparse drops tabs and newlines and lower-cases the scheme.
    let cleaned: String = value.chars().filter(|c| !matches!(c, '\t' | '\r' | '\n')).collect();
    let safe = cleaned.split_once(':').is_some_and(|(scheme, rest)| {
        let scheme_ok = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
        let netloc = rest
            .strip_prefix("//")
            .map(|rest| rest.split(['/', '?', '#']).next().unwrap_or_default())
            .unwrap_or_default();
        scheme_ok
            && matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https")
            && !netloc.is_empty()
            && netloc_parses(netloc)
    });
    if safe {
        Ok(Some(value.to_owned()))
    } else {
        Err("URL must use http or https scheme")
    }
}

/// urlsplit refuses a netloc with unbalanced IPv6 brackets.
fn netloc_parses(netloc: &str) -> bool {
    let host = netloc.rsplit_once('@').map_or(netloc, |(_, host)| host);
    host.contains('[') == host.contains(']')
}

/// `_validate_club_categories`: each a known category, deduplicated.
fn checked_categories(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized: Vec<String> = Vec::new();
    for value in values {
        let category = python_strip(&value);
        if !CLUB_CATEGORIES.contains(&category) {
            if !category.is_empty() {
                tracing::warn!("Unrecognized club category {category:?}, dropping it");
            }
            return Err(format!("categories must be from: {}", CLUB_CATEGORIES.join(", ")));
        }
        if !normalized.iter().any(|known| known == category) {
            normalized.push(category.to_owned());
        }
    }
    Ok(normalized)
}

/// The fields `ClubCreate` and `ClubUpdate` share, as sent (`Missing` if not).
#[derive(Debug, Clone, Default)]
pub struct ClubFields {
    pub submitted_by_email: Option<String>,
    pub club_name: Input<String>,
    pub categories: Input<Vec<String>>,
    pub club_page: Input<String>,
    pub ig: Input<String>,
    pub discord: Input<String>,
    pub club_type: Input<String>,
    pub logo_url: Input<String>,
    pub school: Input<String>,
}

/// Read a club body; `create` applies `ClubCreate`'s rules (required name,
/// default type and school), otherwise `ClubUpdate`'s.
fn parse_club(mut body: Body, create: bool) -> Result<ClubFields, ApiError> {
    let mut fields = ClubFields::default();
    if create {
        fields.submitted_by_email = body.email("submitted_by_email").value();
    }
    let blank = if create {
        "value cannot be blank"
    } else {
        "value cannot be blank on update"
    };
    let name_rules = if create {
        Str::new().min(1).max(MAX_CLUB_NAME_LENGTH)
    } else {
        Str::new().max(MAX_CLUB_NAME_LENGTH)
    };
    let name = if create {
        body.required_string("club_name", &name_rules)
            .map_or(Input::Missing, Input::Given)
    } else {
        body.string("club_name", &name_rules)
    };
    fields.club_name = not_blank(&mut body, "club_name", name, blank);
    fields.categories = match body.string_list(
        "categories",
        &Str::new().min(1).max(MAX_CLUB_CATEGORY_LENGTH),
        MAX_CLUB_CATEGORY_COUNT,
    ) {
        Input::Given(values) => match checked_categories(values.clone()) {
            Ok(categories) => Input::Given(categories),
            Err(message) => {
                body.field_error("categories", json!(values), &message);
                Input::Missing
            }
        },
        other => other,
    };
    fields.club_page = safe_url_field(&mut body, "club_page");
    fields.ig = body.string("ig", &Str::new().max(MAX_URL_LENGTH));
    fields.discord = body.string("discord", &Str::new().max(MAX_URL_LENGTH));
    let type_rules = Str::new()
        .strip_lower()
        .min(1)
        .max(MAX_CLUB_TYPE_LENGTH)
        .pattern(CLUB_TYPE_PATTERN, &CLUB_TYPE);
    fields.club_type = match body.string("club_type", &type_rules) {
        // `ClubTypeValue` (not optional) on create: null is not a string.
        Input::Null if create => {
            body.required_string("club_type", &Str::new());
            Input::Missing
        }
        Input::Missing if create => Input::Given(CLUB_TYPE_INDEPENDENT.to_owned()),
        other => other,
    };
    fields.logo_url = safe_url_field(&mut body, "logo_url");
    let school_rules = if create {
        Str::new().min(1).max(MAX_SCHOOL_LENGTH)
    } else {
        Str::new().max(MAX_SCHOOL_LENGTH)
    };
    let school = match body.string("school", &school_rules) {
        Input::Null if create => {
            body.required_string("school", &Str::new());
            Input::Missing
        }
        Input::Missing if create => Input::Given("uwaterloo".to_owned()),
        other => other,
    };
    fields.school = not_blank(&mut body, "school", school, blank);
    body.finish()?;
    Ok(fields)
}

/// The `_strip_non_blank` / `_not_blank` validators: strip, refuse blank.
fn not_blank(body: &mut Body, name: &str, value: Input<String>, message: &str) -> Input<String> {
    match value {
        Input::Given(text) => {
            let stripped = python_strip(&text);
            if stripped.is_empty() {
                body.field_error(name, json!(text), message);
                Input::Missing
            } else {
                Input::Given(stripped.to_owned())
            }
        }
        other => other,
    }
}

fn safe_url_field(body: &mut Body, name: &'static str) -> Input<String> {
    match body.string(name, &Str::new().max(MAX_URL_LENGTH)) {
        Input::Given(text) => match safe_http_url(&text) {
            Ok(Some(url)) => Input::Given(url),
            Ok(None) => Input::Null,
            Err(message) => {
                body.field_error(name, json!(text), message);
                Input::Missing
            }
        },
        other => other,
    }
}

/// The OpenAPI request bodies.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubCreate {
    #[schema(format = Email)]
    submitted_by_email: Option<String>,
    #[schema(min_length = 1, max_length = 200)]
    club_name: String,
    #[schema(max_items = 20)]
    categories: Option<Vec<String>>,
    #[schema(max_length = 2048)]
    club_page: Option<String>,
    #[schema(max_length = 2048)]
    ig: Option<String>,
    #[schema(max_length = 2048)]
    discord: Option<String>,
    #[schema(min_length = 1, max_length = 100, pattern = r"^[a-z0-9]+(?:-[a-z0-9]+)*$", default = "independent")]
    club_type: String,
    #[schema(max_length = 2048)]
    logo_url: Option<String>,
    #[schema(min_length = 1, max_length = 255, default = "uwaterloo")]
    school: String,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubUpdate {
    #[schema(max_length = 200)]
    club_name: Option<String>,
    #[schema(max_items = 20)]
    categories: Option<Vec<String>>,
    #[schema(max_length = 2048)]
    club_page: Option<String>,
    #[schema(max_length = 2048)]
    ig: Option<String>,
    #[schema(max_length = 2048)]
    discord: Option<String>,
    club_type: Option<String>,
    #[schema(max_length = 2048)]
    logo_url: Option<String>,
    #[schema(max_length = 255)]
    school: Option<String>,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct SubmissionUpdate {
    #[schema(inline)]
    status: ClubStatus,
    #[schema(max_length = 2000)]
    rejection_reason: Option<String>,
}

/// `ClubResponse` columns of the row a write returned (`RETURNING`), for clubs `c`.
fn returned_club_sql(school: &str) -> String {
    format!(
        "c.id, c.club_name, c.status, c.categories, c.club_page, c.ig, c.discord, c.club_type, \
         c.logo_url, c.created_by::text AS created_by, c.created_at, c.submitted_by_email, \
         {school} AS school, NULL::text AS owner_email, 0::bigint AS event_count"
    )
}

#[utoipa::path(
    post,
    path = "/clubs/",
    tag = "clubs",
    operation_id = "create_club_clubs__post",
    summary = "Create Club",
    description = "Visitors may submit a club; only authenticated admins publish directly.",
    request_body = ClubCreate,
    responses(
        (status = 201, description = "Successful Response", body = ClubResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn create_club(
    State(state): State<AppState>,
    OptionalUser(auth_user): OptionalUser,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    SUBMISSIONS.check(&client_ip)?;
    let fields = parse_club(Body::parse(&bytes, &headers, Extra::Forbid)?, true)?;
    let db_user = match auth_user {
        Some(auth_user) => Some(
            find_user(&state.db, &auth_user.id)
                .await?
                .ok_or_else(|| ApiError::not_found(USER_NOT_FOUND))?,
        ),
        None => None,
    };
    let auto_approve = db_user.as_ref().is_some_and(User::is_admin);
    let school_slug = normalize_slug(fields.school.clone().value().as_deref().unwrap_or_default());
    // Insert and read back in one statement; a new club has no events yet.
    let sql = format!(
        "WITH school AS (SELECT id, slug FROM public.schools WHERE slug = $1 AND $1 <> '' LIMIT 1), \
         inserted AS ( \
             INSERT INTO public.clubs (submitted_by_email, club_name, categories, club_page, ig, \
                 discord, club_type, logo_url, school_id, created_by, submitted, status) \
             SELECT $2, $3, $4, $5, $6, $7, $8, $9, school.id, $10, true, $11 FROM school \
             RETURNING *) \
         SELECT {}, (SELECT u.email FROM public.users u WHERE u.id = c.created_by) AS owner_email, \
                0::bigint AS event_count \
         FROM inserted c LEFT JOIN public.schools s ON s.id = c.school_id",
        "c.id, c.club_name, c.status, c.categories, c.club_page, c.ig, c.discord, c.club_type, \
         c.logo_url, c.created_by::text AS created_by, c.created_at, c.submitted_by_email, \
         NULLIF(s.slug, '') AS school"
    );
    let categories = fields
        .categories
        .clone()
        .value()
        .map(|categories| sqlx::types::Json(json!(categories)));
    let row = sqlx::query(&sql)
        .bind(&school_slug)
        .bind(&fields.submitted_by_email)
        .bind(fields.club_name.clone().value())
        .bind(categories)
        .bind(fields.club_page.clone().value())
        .bind(fields.ig.clone().value())
        .bind(fields.discord.clone().value())
        .bind(fields.club_type.clone().value())
        .bind(fields.logo_url.clone().value())
        .bind(db_user.as_ref().map(|user| user.id))
        .bind(if auto_approve { "approved" } else { "pending" })
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::validation(SCHOOL_NOT_REGISTERED))?;
    let club = ClubResponse::from_row(&row)?;
    if let Some(user) = &db_user
        && let Err(error) = members::add_member(&state.db, i64::from(club.id), user.id).await
    {
        tracing::warn!("Failed to auto-add creator {} to club members: {error:?}", user.id);
    }
    if auto_approve {
        revalidate(&[club.school.clone()], CLUB_RESOURCES).await;
    }
    Ok((StatusCode::CREATED, Json(club)).into_response())
}

/// `SubmissionUpdate`: a review decision and an optional reason.
fn parse_review(body: Result<Body, ApiError>, check: Validator) -> Result<(String, Option<String>), ApiError> {
    let mut body = match body {
        Ok(body) => body,
        Err(error) => return Err(merge_err(check, error)),
    };
    let status = body.required_string("status", &Str::new().one_of(CLUB_STATUSES));
    let reason = body
        .string("rejection_reason", &Str::new().max(MAX_REJECTION_REASON_LENGTH))
        .value();
    merge_issues(check, body.finish())?;
    Ok((status.unwrap_or_default(), reason))
}

#[utoipa::path(
    post,
    path = "/clubs/{club_id}/review",
    tag = "clubs",
    operation_id = "review_club_clubs__club_id__review_post",
    summary = "Review Club",
    description = "Approve or reject a submitted club; the submitter is emailed the decision and reason.",
    params(("club_id" = i64, Path)),
    request_body = SubmissionUpdate,
    responses(
        (status = 200, description = "Successful Response", body = ClubResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn review_club(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<ClubResponse>, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, &path);
    let (status, reason) = parse_review(Body::parse(&bytes, &headers, Extra::Forbid), check)?;
    // The old status comes from the same statement's snapshot.
    let sql = format!(
        "UPDATE public.clubs c SET status = $2 FROM public.clubs old \
         WHERE c.id = $1 AND old.id = c.id \
         RETURNING {}, old.status AS previous_status",
        returned_club_sql("(SELECT NULLIF(s.slug, '') FROM public.schools s WHERE s.id = c.school_id)")
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .bind(&status)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))?;
    let club = ClubResponse::from_row(&row)?;
    let previous: String = row.try_get("previous_status")?;
    if previous != club.status {
        revalidate(&[club.school.clone()], ALL_RESOURCES).await;
        let recipient: Option<String> = row.try_get("submitted_by_email")?;
        emails::send_review_decision(
            emails::Reviewed::Club,
            &club.club_name,
            &club.status,
            recipient.as_deref(),
            club.school.as_deref(),
            &format!("/clubs/{}", club.id),
            reason.as_deref(),
        )
        .await;
    }
    Ok(Json(club))
}

#[utoipa::path(
    patch,
    path = "/clubs/{club_id}",
    tag = "clubs",
    operation_id = "update_club_clubs__club_id__patch",
    summary = "Update Club",
    params(("club_id" = i64, Path)),
    request_body = ClubUpdate,
    responses(
        (status = 200, description = "Successful Response", body = ClubResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_club(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<ClubResponse>, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, &path);
    let fields = match Body::parse(&bytes, &headers, Extra::Forbid) {
        Ok(body) => match parse_club(body, false) {
            Ok(fields) => {
                check.finish()?;
                fields
            }
            Err(error) => return Err(merge_err(check, error)),
        },
        Err(error) => return Err(merge_err(check, error)),
    };
    let existing = managed_club(&state.db, id, &user).await?;
    let updated = apply_update(&state.db, id, &existing, fields).await?;
    Ok(Json(updated))
}

fn merge_err(check: Validator, error: ApiError) -> ApiError {
    merge_issues(check, Err(error)).expect_err("an error stays an error")
}

/// One bound value of a dynamic statement.
enum Arg {
    Text(Option<String>),
    Json(Option<sqlx::types::Json<Value>>),
    Int(i32),
}

/// `update_club`: change only the fields sent.
async fn apply_update(
    db: &sqlx::PgPool,
    id: i64,
    existing: &ClubResponse,
    fields: ClubFields,
) -> Result<ClubResponse, ApiError> {
    let mut assignments: Vec<String> = Vec::new();
    let mut args: Vec<Arg> = Vec::new();
    let mut assign = |column: &str, arg: Arg, args: &mut Vec<Arg>| {
        args.push(arg);
        assignments.push(format!("{column} = ${}", args.len() + 1));
    };
    for (column, value) in [
        ("club_name", &fields.club_name),
        ("club_page", &fields.club_page),
        ("ig", &fields.ig),
        ("discord", &fields.discord),
        ("club_type", &fields.club_type),
        ("logo_url", &fields.logo_url),
    ] {
        if value.is_set() {
            assign(column, Arg::Text(value.clone().value()), &mut args);
        }
    }
    if fields.categories.is_set() {
        let categories = fields.categories.clone().value();
        assign(
            "categories",
            Arg::Json(categories.map(|categories| sqlx::types::Json(json!(categories)))),
            &mut args,
        );
    }
    let updated_school = if fields.school.is_set() {
        let sent = fields.school.clone().value();
        let slug = normalize_slug(sent.as_deref().unwrap_or_default());
        let school_id = if slug.is_empty() {
            None
        } else {
            read_with_retry(|| {
                sqlx::query_scalar::<_, i32>("SELECT id FROM public.schools WHERE slug = $1 LIMIT 1")
                    .bind(&slug)
                    .fetch_optional(db)
            })
            .await?
        };
        let school_id = school_id.ok_or_else(|| ApiError::validation(SCHOOL_NOT_REGISTERED))?;
        assign("school_id", Arg::Int(school_id), &mut args);
        // Python answers with the school as sent (stripped, not lower-cased).
        sent
    } else {
        existing.school.clone()
    };
    if args.is_empty() {
        return Ok(existing.clone());
    }
    args.push(Arg::Text(updated_school));
    let sql = format!(
        "UPDATE public.clubs c SET {} WHERE c.id = $1 RETURNING {}",
        assignments.join(", "),
        returned_club_sql(&format!("${}::text", args.len() + 1))
    );
    let mut query = sqlx::query(&sql).bind(id);
    for arg in args {
        query = match arg {
            Arg::Text(value) => query.bind(value),
            Arg::Json(value) => query.bind(value),
            Arg::Int(value) => query.bind(value),
        };
    }
    let row = query.fetch_optional(db).await?.ok_or_else(|| {
        // The response model cannot hold `None`: FastAPI answered 500.
        ApiError::Internal(anyhow::anyhow!("club {id} vanished during its update"))
    })?;
    let updated = ClubResponse::from_row(&row)?;
    // These fields are embedded by the event and position read models.
    let embedded_changed = updated.club_name != existing.club_name
        || updated.club_type != existing.club_type
        || updated.logo_url != existing.logo_url
        || updated.school != existing.school
        || updated.club_page != existing.club_page
        || updated.ig != existing.ig
        || updated.discord != existing.discord;
    revalidate(
        &[existing.school.clone(), updated.school.clone()],
        if embedded_changed { ALL_RESOURCES } else { CLUB_RESOURCES },
    )
    .await;
    Ok(updated)
}

#[utoipa::path(
    delete,
    path = "/clubs/{club_id}",
    tag = "clubs",
    operation_id = "delete_club_clubs__club_id__delete",
    summary = "Delete Club",
    params(("club_id" = i64, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn delete_club(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = club_id(&path)?;
    let existing = managed_club(&state.db, id, &user).await?;
    let deleted = sqlx::query("DELETE FROM public.clubs WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if deleted > 0 {
        revalidate(&[existing.school], ALL_RESOURCES).await;
    }
    Ok(no_content())
}

#[cfg(test)]
mod tests;
