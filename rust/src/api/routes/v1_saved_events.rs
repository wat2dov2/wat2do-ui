//! `/v1/saved-events`: V1 saved events (`routers/v1_saved_events.py`).

use axum::Json;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::events::{going, store, writes};
use crate::api::messages::EVENT_NOT_FOUND;
use crate::api::validation::{PathParams, Validator};

#[utoipa::path(
    get,
    path = "/v1/saved-events/",
    tag = "v1-saved-events",
    operation_id = "list_saved_events_v1_saved_events__get",
    summary = "List Saved Events"
)]
pub async fn list_saved_events(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Response, ApiError> {
    Ok(Json(going::saved_event_ids(&state.db, user.id).await?).into_response())
}

#[utoipa::path(
    put,
    path = "/v1/saved-events/{event_id}",
    tag = "v1-saved-events",
    operation_id = "save_event_v1_saved_events__event_id__put",
    summary = "Save Event"
)]
pub async fn save_event(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "event_id").unbounded_int();
    check.finish()?;
    let id = writes::int4(id)?;
    if store::event_by_id(&state.db, id).await?.is_none() {
        return Err(ApiError::not_found(EVENT_NOT_FOUND));
    }
    going::save_event(&state.db, user.id, id).await?;
    Ok(Json(json!({"status": "saved"})).into_response())
}

#[utoipa::path(
    delete,
    path = "/v1/saved-events/{event_id}",
    tag = "v1-saved-events",
    operation_id = "unsave_event_v1_saved_events__event_id__delete",
    summary = "Unsave Event"
)]
pub async fn unsave_event(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "event_id").unbounded_int();
    check.finish()?;
    going::unsave_event(&state.db, user.id, writes::int4(id)?).await?;
    Ok(Json(json!({"status": "unsaved"})).into_response())
}
