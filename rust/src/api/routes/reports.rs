//! `/reports`: reporting an event and the admin review queue
//! (`routers/reports.py`).

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::api::AppState;
use crate::api::auth::{AdminUser, OptionalUser, find_user};
use crate::api::body::{Body, Extra, check_json_syntax, json_first, merge_issues};
use crate::api::client_ip::Peer;
use crate::api::errors::ApiError;
use crate::api::events::{reports, requests, store, writes};
use crate::api::messages::{EVENT_NOT_FOUND, REPORT_NOT_FOUND, USER_NOT_FOUND};
use crate::api::pagination::{Paginated, Pagination};
use crate::api::rate_limit::RateLimiter;
use crate::api::validation::{Length, PathParams, QueryParams, Validator};
use crate::constants::{MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH, MAX_STATUS_FILTER_LENGTH};
use crate::controlbox::RATE_LIMITS;

/// Per client IP, with the event-exists check, against forged report floods.
static CREATE_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.reports));
const MAX_REPORT_REASON_LENGTH: usize = 2000;

#[utoipa::path(
    post,
    path = "/reports/",
    tag = "reports",
    operation_id = "create_report_reports__post",
    summary = "Create Report"
)]
pub async fn create_report(
    State(state): State<AppState>,
    OptionalUser(auth_user): OptionalUser,
    peer: Option<axum::Extension<Peer>>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    // FastAPI decodes the body before its dependencies, the limiter included.
    check_json_syntax(&bytes, &headers)?;
    let peer = peer.map(|axum::Extension(Peer(peer))| peer);
    CREATE_LIMITER.check(&state.trust.client_ip(peer.as_deref(), &headers))?;
    let (event_id, reason) = requests::report_create(
        Body::parse(&bytes, &headers, Extra::Forbid)?,
        MAX_REPORT_REASON_LENGTH,
    )?;
    let user_id = match auth_user {
        Some(auth_user) => Some(
            find_user(&state.db, &auth_user.id)
                .await?
                .ok_or_else(|| ApiError::not_found(USER_NOT_FOUND))?
                .id,
        ),
        None => None,
    };
    let event_id = writes::int4(event_id)?;
    if store::event_by_id(&state.db, event_id).await?.is_none() {
        return Err(ApiError::not_found(EVENT_NOT_FOUND));
    }
    let report = reports::create(&state.db, user_id, event_id, &reason).await?;
    Ok((StatusCode::CREATED, Json(report)).into_response())
}

#[utoipa::path(
    get,
    path = "/reports/",
    tag = "reports",
    operation_id = "list_reports_reports__get",
    summary = "List Reports"
)]
pub async fn list_reports(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "report_status")
        .optional_string(Length::default().max(MAX_STATUS_FILTER_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    check.finish()?;
    let (items, total) = reports::page(
        &state.db,
        pagination,
        status.as_deref(),
        search.as_deref(),
        school.as_deref(),
    )
    .await?;
    Ok(Json(Paginated::new(items, total, pagination)).into_response())
}

#[utoipa::path(
    patch,
    path = "/reports/{report_id}",
    tag = "reports",
    operation_id = "update_report_reports__report_id__patch",
    summary = "Update Report"
)]
pub async fn update_report(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    AdminUser::from_request_parts(&mut parts, &state).await?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let report_id = check.path(&path, "report_id").string(Length::default());
    let status = merge_issues(
        check,
        Body::parse(&bytes, &parts.headers, Extra::Forbid).and_then(requests::report_update),
    )?;
    let report = reports::update(&state.db, &report_id, &status)
        .await?
        .ok_or_else(|| ApiError::not_found(REPORT_NOT_FOUND))?;
    Ok(Json(report).into_response())
}
