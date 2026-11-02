//! `/calendar`: the per-user feed token and the public ICS feed
//! (`routers/calendar.py`).

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::header::{CONTENT_TYPE, HOST};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::client_ip::Peer;
use crate::api::errors::ApiError;
use crate::api::events::{going, ics};
use crate::api::messages::CALENDAR_FEED_NOT_FOUND;
use crate::api::rate_limit::RateLimiter;
use crate::controlbox::RATE_LIMITS;

/// Keyed by token, so one misbehaving calendar client cannot affect others.
static FEED_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.calendar_feed));

/// `CalendarTokenResponse`.
#[derive(Serialize)]
struct TokenResponse {
    token: String,
    feed_url: String,
}

/// `request.url_for("get_calendar_feed", token=...)`: the feed's absolute URL
/// on the host and scheme the caller used.
fn feed_url(state: &AppState, request: &Request, token: &str) -> String {
    let peer = request
        .extensions()
        .get::<Peer>()
        .map(|peer| peer.0.clone());
    let scheme = state.trust.scheme(peer.as_deref(), request.headers());
    let host = request
        .headers()
        .get(HOST)
        .and_then(|host| host.to_str().ok())
        .unwrap_or("127.0.0.1:8000");
    format!("{scheme}://{host}/calendar/feed/{token}.ics")
}

#[utoipa::path(
    get,
    path = "/calendar/token",
    tag = "calendar",
    operation_id = "get_calendar_token_calendar_token_get",
    summary = "Get Calendar Token"
)]
pub async fn get_calendar_token(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    request: Request,
) -> Result<Response, ApiError> {
    let token = ics::token_for(&state.db, user.id).await?;
    let feed_url = feed_url(&state, &request, &token);
    Ok(Json(TokenResponse { token, feed_url }).into_response())
}

#[utoipa::path(
    post,
    path = "/calendar/token/regenerate",
    tag = "calendar",
    operation_id = "regenerate_calendar_token_calendar_token_regenerate_post",
    summary = "Regenerate Calendar Token"
)]
pub async fn regenerate_calendar_token(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    request: Request,
) -> Result<Response, ApiError> {
    let token = ics::rotate_token(&state.db, user.id).await?;
    let feed_url = feed_url(&state, &request, &token);
    Ok(Json(TokenResponse { token, feed_url }).into_response())
}

/// `_frontend_base_url`: the first CORS origin, else the production site.
fn frontend_base_url(state: &AppState) -> String {
    state.settings.cors_origins.first().map_or_else(
        || "https://wat2do.io".to_owned(),
        |origin| origin.trim_end_matches('/').to_owned(),
    )
}

/// The token in `/calendar/feed/{token}.ics`. axum cannot route a parameter
/// with a suffix, so the route takes the whole segment and checks it here.
fn feed_token(request: &Request) -> Option<String> {
    let segment = request.uri().path().strip_prefix("/calendar/feed/")?;
    let segment = percent_encoding::percent_decode_str(segment).decode_utf8_lossy();
    let token = segment.strip_suffix(".ics")?;
    // Starlette's `{token}` never spans a slash.
    (!token.is_empty() && !token.contains('/')).then(|| token.to_owned())
}

/// The limiter key for a token: its digest, so a refused feed's log line
/// never carries the token itself.
fn limiter_key(token: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[utoipa::path(
    get,
    path = "/calendar/feed/{token}",
    tag = "calendar",
    operation_id = "get_calendar_feed_calendar_feed__token__ics_get",
    summary = "Get Calendar Feed"
)]
pub async fn get_calendar_feed(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    // Without `.ics` this is not the feed route: Python answers as for any unknown path.
    let Some(token) = feed_token(&request) else {
        return Ok(crate::api::proxy::to_python(State(state), request).await);
    };
    FEED_LIMITER.check(&limiter_key(&token))?;
    let user_id = ics::user_for_token(&state.db, &token)
        .await?
        .ok_or_else(|| ApiError::not_found(CALENDAR_FEED_NOT_FOUND))?;
    let selections = going::selections(&state.db, user_id).await?;
    let events = ics::selected_events(&state.db, &selections).await?;
    let body = ics::render(&events, &frontend_base_url(&state), &chrono::Utc::now());
    let mut response = (StatusCode::OK, body).into_response();
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/calendar; charset=utf-8"),
    );
    Ok(response)
}
