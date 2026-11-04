//! `/discovery-queries/`: anonymous or signed-in search telemetry, and the
//! admin list of it (`routers/discovery_queries.py`,
//! `services/discovery_query_service.py`).

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AdminUser, OptionalUser};
use crate::api::body::{Body, Extra, Str, check_json_syntax};
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::DISCOVERY_QUERY_SCHOOL_NOT_FOUND;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::validation::{Length, QueryParams, Validator};
use crate::constants::{MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH};
use crate::controlbox::DISCOVERY_QUERIES;
use crate::db::read_with_retry;
use crate::schools::{name_pattern, normalize_slug, school_id_sql};
use crate::text::sanitize_postgrest_value;

static LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(DISCOVERY_QUERIES.rate_limit));

const SURFACES: &[&str] = &["events", "clubs", "positions"];

/// A validated `DiscoveryQueryCreate`.
#[derive(Debug, PartialEq)]
struct DiscoveryQuery {
    id: Uuid,
    school: String,
    surface: String,
    search_query: String,
    page_url: String,
    filters: Map<String, Value>,
}

/// `DiscoveryQueryCreate`: `extra="forbid"`, `str_strip_whitespace=True`.
fn parse_query(mut body: Body) -> Result<DiscoveryQuery, ApiError> {
    let control = &*DISCOVERY_QUERIES;
    let id = body.required_uuid("id");
    let school = body.required_string("school", &Str::new().strip().min(1).max(MAX_SCHOOL_LENGTH));
    let surface = body.required_string("surface", &Str::new().one_of(SURFACES));
    let search_query = body.required_string(
        "search_query",
        &Str::new().strip().max(control.maximum_search_length),
    );
    let page_url = body.required_http_url("page_url", false);
    let filters = body.required_object("filters", true);
    if let Some(filters) = &filters {
        let encoded = json::python_dumps(&Value::Object(filters.clone()));
        if encoded.len() > control.maximum_filters_bytes {
            body.field_error(
                "filters",
                Value::Object(filters.clone()),
                "Query filters exceed the maximum size",
            );
        }
    }
    body.finish()?;
    // `finish` fails whenever a field above is missing.
    match (id, school, surface, search_query, page_url, filters) {
        (
            Some(id),
            Some(school),
            Some(surface),
            Some(search_query),
            Some(page_url),
            Some(filters),
        ) => Ok(DiscoveryQuery {
            id,
            school,
            surface,
            search_query,
            page_url,
            filters,
        }),
        _ => Err(ApiError::Internal(anyhow::anyhow!(
            "validated body is incomplete"
        ))),
    }
}

fn is_excluded(email: Option<&str>) -> bool {
    email.is_some_and(|email| {
        let email = caseless::default_case_fold_str(email);
        DISCOVERY_QUERIES
            .excluded_account_emails
            .iter()
            .any(|excluded| caseless::default_case_fold_str(excluded) == email)
    })
}

#[utoipa::path(
    post,
    path = "/discovery-queries/",
    tag = "discovery-queries",
    operation_id = "record_query_discovery_queries__post",
    summary = "Record Query",
    description = "Persist anonymous or signed-in browsing telemetry sent separately from UI reads.\n\nAcknowledge after persistence or an account exclusion so the client can safely retry.",
    request_body = DiscoveryQueryCreate,
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn record_query(
    State(state): State<AppState>,
    OptionalUser(auth_user): OptionalUser,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    check_json_syntax(&bytes, &headers)?;
    LIMITER.check(&client_ip)?;
    let query = parse_query(Body::parse(&bytes, &headers, Extra::Forbid)?)?;
    if is_excluded(auth_user.as_ref().and_then(|user| user.email.as_deref())) {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    // The client keeps this UUID on retries: a duplicate is ignored, never overwritten.
    let school_found = sqlx::query_scalar::<_, bool>(
        "WITH school AS (SELECT id FROM public.schools WHERE slug = $1 LIMIT 1), \
         inserted AS (INSERT INTO public.discovery_queries \
             (id, surface, search_query, page_url, filters, school_id) \
             SELECT $2, $3, $4, $5, $6, school.id FROM school \
             ON CONFLICT (id) DO NOTHING) \
         SELECT EXISTS (SELECT 1 FROM school)",
    )
    .bind(normalize_slug(&query.school))
    .bind(query.id)
    .bind(&query.surface)
    .bind(&query.search_query)
    .bind(&query.page_url)
    .bind(sqlx::types::Json(Value::Object(query.filters)))
    .fetch_one(&state.db)
    .await?;
    if !school_found {
        return Err(ApiError::validation(DISCOVERY_QUERY_SCHOOL_NOT_FOUND));
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// The request body, documented for the OpenAPI schema.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct DiscoveryQueryCreate {
    #[schema(value_type = String, format = Uuid)]
    id: Uuid,
    #[schema(min_length = 1, max_length = 255)]
    school: String,
    #[schema(inline)]
    surface: DiscoverySurface,
    #[schema(max_length = 2048)]
    search_query: String,
    #[schema(min_length = 1, max_length = 8192, format = "uri")]
    page_url: String,
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    filters: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DiscoverySurface {
    Events,
    Clubs,
    Positions,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DiscoveryQueryResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub school: String,
    // One of `events`, `clubs` or `positions` (a database check).
    #[schema(value_type = DiscoverySurface, inline)]
    pub surface: String,
    pub search_query: String,
    pub page_url: String,
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    #[serde(serialize_with = "json::value")]
    pub filters: Value,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
}

crate::paginated_schema!(
    PaginatedDiscoveryQueries,
    PaginatedResponse_DiscoveryQueryResponse_,
    DiscoveryQueryResponse
);

#[utoipa::path(
    get,
    path = "/discovery-queries/",
    tag = "discovery-queries",
    operation_id = "list_queries_discovery_queries__get",
    summary = "List Queries",
    params(
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedDiscoveryQueries),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_queries(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<DiscoveryQueryResponse>>, ApiError> {
    let mut check = Validator::default();
    // FastAPI reports the pagination dependency's problems first.
    let pagination = Pagination::read(&mut check, &query);
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let school = school.filter(|school| !school.is_empty());
    let term = search
        .map(|search| sanitize_postgrest_value(&search))
        .filter(|term| !term.is_empty());
    let (slug, name) = match &school {
        Some(school) => (
            Some(normalize_slug(school)).filter(|slug| !slug.is_empty()),
            name_pattern(school),
        ),
        None => (None, None),
    };
    let school_filter = if school.is_some() {
        // An unknown school matches nothing rather than every school.
        format!("AND q.school_id = {}", school_id_sql("$3", "$4"))
    } else {
        String::new()
    };
    let sql = format!(
        "WITH matched AS ( \
             SELECT q.id, q.created_at FROM public.discovery_queries q \
             WHERE q.search_query <> '' {school_filter} \
               AND ($5::text IS NULL OR q.search_query ILIKE '%' || $5 || '%')), \
         page AS ( \
             SELECT q.id, q.surface, q.search_query, q.page_url, q.filters, q.created_at, \
                    NULLIF(s.slug, '') AS school \
             FROM matched m JOIN public.discovery_queries q ON q.id = m.id \
             LEFT JOIN public.schools s ON s.id = q.school_id \
             ORDER BY m.created_at DESC, m.id DESC LIMIT $1 OFFSET $2) \
         SELECT (SELECT count(*) FROM matched) AS total, page.* \
         FROM (SELECT 1) AS one LEFT JOIN page ON true \
         ORDER BY page.created_at DESC, page.id DESC"
    );
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(&slug)
            .bind(&name)
            .bind(&term)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in rows {
        total = row.try_get::<i64, _>("total")?;
        let Some(id) = row.try_get::<Option<Uuid>, _>("id")? else {
            continue;
        };
        let school: Option<String> = row.try_get("school")?;
        items.push(DiscoveryQueryResponse {
            id,
            // `school: str` in the response model: a query without one fails.
            school: school.ok_or_else(|| {
                ApiError::Internal(anyhow::anyhow!("discovery query {id} has no school"))
            })?,
            surface: row.try_get("surface")?,
            search_query: row.try_get("search_query")?,
            page_url: row.try_get("page_url")?,
            filters: row.try_get::<sqlx::types::Json<Value>, _>("filters")?.0,
            created_at: row.try_get("created_at")?,
        });
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::validation::ValidationIssue;
    use serde_json::json;

    fn payload(changes: Value) -> Value {
        let mut body = json!({
            "id": "0b6f2f4c-1d1e-4f6c-9a43-7f2a1c0e9b11",
            "school": "uwaterloo",
            "surface": "events",
            "search_query": "missing club",
            "page_url": "https://uwaterloo.wat2do.io/?source=poster",
            "filters": {"categories": ["Technology"], "maxPrice": "0", "going": false},
        });
        for (key, value) in changes.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    }

    fn parse(value: Value) -> Result<DiscoveryQuery, ApiError> {
        parse_query(Body::from_value(value, Extra::Forbid))
    }

    fn issues(value: Value) -> Vec<ValidationIssue> {
        match parse(value) {
            Err(ApiError::RequestValidation(issues)) => issues,
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn captures_keep_the_query_and_filters() {
        // backend/tests/routers/test_discovery_queries.py
        for surface in SURFACES {
            let query = parse(payload(json!({"surface": surface, "search_query": ""}))).unwrap();
            assert_eq!(query.surface, *surface);
            assert_eq!(query.search_query, "");
            assert_eq!(query.page_url, "https://uwaterloo.wat2do.io/?source=poster");
            assert_eq!(
                Value::Object(query.filters),
                json!({"categories": ["Technology"], "maxPrice": "0", "going": false})
            );
        }
        let stripped = parse(payload(json!({"school": " uwaterloo ", "search_query": "  hi  ", "filters": {" k ": " v "}, "page_url": "https://WAT2DO.io"}))).unwrap();
        assert_eq!(stripped.school, "uwaterloo");
        assert_eq!(stripped.search_query, "hi");
        assert_eq!(stripped.page_url, "https://wat2do.io/");
        assert_eq!(Value::Object(stripped.filters), json!({"k": " v "}));
    }

    #[test]
    fn invalid_telemetry_is_rejected_before_writes() {
        // test_invalid_telemetry_is_rejected_before_writes
        for changes in [
            json!({"surface": "home"}),
            json!({"page_url": "javascript:alert(1)"}),
            json!({"filters": []}),
            json!({"search_query": "x".repeat(DISCOVERY_QUERIES.maximum_search_length + 1)}),
            json!({"filters": {"blob": "x".repeat(DISCOVERY_QUERIES.maximum_filters_bytes)}}),
            json!({"school": ""}),
            json!({"unexpected": true}),
        ] {
            assert_eq!(issues(payload(changes.clone())).len(), 1, "{changes}");
        }
        let oversized = issues(payload(
            json!({"filters": {"blob": "x".repeat(DISCOVERY_QUERIES.maximum_filters_bytes)}}),
        ));
        assert_eq!(
            oversized[0].msg,
            "Value error, Query filters exceed the maximum size"
        );
    }

    #[test]
    fn excluded_accounts_match_case_insensitively() {
        assert!(is_excluded(Some("e22han@uwaterloo.ca")));
        assert!(is_excluded(Some("E22HAN@UWATERLOO.CA")));
        assert!(!is_excluded(Some("other@uwaterloo.ca")));
        assert!(!is_excluded(None));
    }
}
