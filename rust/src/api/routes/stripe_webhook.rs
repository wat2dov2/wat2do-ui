//! `/webhooks/stripe`: Stripe Connect events for club tickets, trusted only
//! with a valid signature. Stripe waits for the answer, so emails go out after it.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use serde_json::{Value, json};

use crate::api::AppState;
use crate::api::errors::ApiError;
use crate::api::tickets::{admission, stripe};

#[utoipa::path(
    post,
    path = "/webhooks/stripe",
    tag = "webhooks",
    operation_id = "receive_stripe_event_webhooks_stripe_post",
    summary = "Receive Stripe Event",
    description = "Stripe Connect events for club tickets: paid and expired checkouts, and account updates.",
    responses((status = 200, description = "Successful Response", body = Object))
)]
pub async fn receive_stripe_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Bytes,
) -> Result<Json<Value>, ApiError> {
    let signature = headers
        .get("stripe-signature")
        .and_then(|value| value.to_str().ok());
    let event = stripe::verified_event(
        state.settings,
        &payload,
        signature,
        chrono::Utc::now().timestamp(),
    )?;
    admission::handle_webhook(&state, event).await?;
    Ok(Json(json!({"received": true})))
}
