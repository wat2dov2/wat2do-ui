//! `/interactions/batch`: event and position interaction batches
//! (`routers/interactions.py`).

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::api::AppState;
use crate::api::auth::{OptionalUser, find_user};
use crate::api::body::{Body, Extra};
use crate::api::client_ip::{Peer, hash_client_ip};
use crate::api::errors::ApiError;
use crate::api::events::{interactions, requests};
use crate::api::messages::USER_NOT_FOUND;
use crate::api::rate_limit::RateLimiter;
use crate::controlbox::{INTERACTION_INGESTION, RATE_LIMITS, RateLimit};

/// Authenticated batches: 30 requests a minute per user.
static USER_LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| {
    RateLimiter::new(RateLimit {
        maximum_requests: 30,
        window_seconds: 60,
    })
});
/// Anonymous batches, per client IP (`anon_interaction_rate_limiter`).
static ANONYMOUS_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.anonymous_interactions));

#[utoipa::path(
    post,
    path = "/interactions/batch",
    tag = "interactions",
    operation_id = "record_interactions_interactions_batch_post",
    summary = "Record Interactions"
)]
pub async fn record_interactions(
    State(state): State<AppState>,
    OptionalUser(auth_user): OptionalUser,
    peer: Option<axum::Extension<Peer>>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let batch = requests::interaction_batch(
        Body::parse(&bytes, &headers, Extra::Forbid)?,
        INTERACTION_INGESTION.maximum_batch_size,
        INTERACTION_INGESTION.maximum_metadata_bytes,
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
    let peer = peer.map(|axum::Extension(Peer(peer))| peer);
    let client_ip = state.trust.client_ip(peer.as_deref(), &headers);
    match user_id {
        Some(id) => USER_LIMITER.check(&id.to_string())?,
        None => ANONYMOUS_LIMITER.check(&client_ip)?,
    }
    // Best effort, as in Python: without the secret, interactions still record,
    // without the per-IP click cap or the stored hash.
    let secret = &state.settings.poster_hash_secret;
    let ip_hash = (!client_ip.is_empty() && !secret.is_empty())
        .then(|| hash_client_ip(&client_ip, secret))
        .transpose()?;
    let recorded = interactions::record_batch(
        &state.db,
        user_id,
        batch.user_id,
        &batch.session_id,
        batch.interactions,
        ip_hash.as_deref(),
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "recorded": recorded }))).into_response())
}
