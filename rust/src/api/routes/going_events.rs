//! `/going-events`: a user's Going selections and the public who's-going
//! list (`routers/going_events.py`).

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Response;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::events::{body, going, store, writes};
use crate::api::messages::EVENT_NOT_FOUND;
use crate::api::pyjson::ok;
use crate::api::validation::{PathParams, Validator};

#[utoipa::path(
    get,
    path = "/going-events/",
    tag = "going-events",
    operation_id = "list_going_events_going_events__get",
    summary = "List Going Events"
)]
pub async fn list_going_events(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Response, ApiError> {
    match going::selections(&state.db, user.id).await {
        Ok(selections) => Ok(ok(selections)),
        Err(ApiError::Database(error)) => {
            tracing::warn!("going_events table unavailable: {error}");
            Ok(ok(Vec::<going::GoingSelection>::new()))
        }
        Err(other) => Err(other),
    }
}

#[utoipa::path(
    get,
    path = "/going-events/{event_id}/attendees",
    tag = "going-events",
    operation_id = "list_event_attendees_going_events__event_id__attendees_get",
    summary = "List Event Attendees"
)]
pub async fn list_event_attendees(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "event_id").unbounded_int();
    check.finish()?;
    let id = writes::int4(id)?;
    if store::event_by_id(&state.db, id).await?.is_none() {
        return Err(ApiError::not_found(EVENT_NOT_FOUND));
    }
    Ok(ok(going::attendees(&state.db, id).await?))
}

#[utoipa::path(
    put,
    path = "/going-events/{event_id}",
    tag = "going-events",
    operation_id = "mark_going_going_events__event_id__put",
    summary = "Mark Going"
)]
pub async fn mark_going(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "event_id").unbounded_int();
    let selection = body::validate_into(&mut check, &headers, &bytes, body::going_selection)?;
    check.finish()?;
    let status = going::set_occurrences(
        &state.db,
        user.id,
        writes::int4(id)?,
        &selection.unwrap_or_default(),
    )
    .await?;
    Ok(ok(status))
}

#[utoipa::path(
    delete,
    path = "/going-events/{event_id}",
    tag = "going-events",
    operation_id = "unmark_going_going_events__event_id__delete",
    summary = "Unmark Going"
)]
pub async fn unmark_going(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "event_id").unbounded_int();
    check.finish()?;
    let status = going::set_occurrences(&state.db, user.id, writes::int4(id)?, &[]).await?;
    Ok(ok(status))
}
