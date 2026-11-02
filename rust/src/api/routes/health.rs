//! `GET /health`: the container health check.
//!
//! Healthy only while the Python app behind the server also answers, so ECS
//! replaces a task whose Python half is starting or stuck. Without a Python
//! app (the parity replay) the Rust server alone answers.

use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::api::AppState;
use crate::controlbox::API_SERVER;

#[utoipa::path(
    get,
    path = "/health",
    operation_id = "health_health_get",
    summary = "Health",
    responses((status = 200, description = "Successful Response", body = serde_json::Value))
)]
pub async fn health(State(state): State<AppState>) -> Response {
    let python_answers = match &state.upstream {
        None => true,
        Some(upstream) => {
            upstream.is_ready()
                && upstream
                    .probe(Duration::from_secs_f64(
                        API_SERVER.python_probe_timeout_seconds,
                    ))
                    .await
        }
    };
    if python_answers {
        Json(json!({ "status": "ok" })).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "unavailable" })),
        )
            .into_response()
    }
}
