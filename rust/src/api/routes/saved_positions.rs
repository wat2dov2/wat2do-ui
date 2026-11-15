//! `/saved-positions`: the positions a signed-in user saved (bookmarked),
//! like `/saved-clubs`.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::messages::{POSITION_NOT_FOUND, SAVED_POSITIONS_CAP_REACHED};
use crate::api::pagination::DEFAULT_MAX_ROWS;
use crate::api::routes::saved_clubs::SaveStatus;
use crate::api::validation::{Limits, PathParams, Validator};
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;

/// Locks the save/unsave status contract at the OpenAPI boundary.
#[derive(Debug, Serialize, ToSchema)]
pub struct SavePositionStatusResponse {
    #[schema(inline)]
    pub status: SaveStatus,
}

/// Save a position once: the insert happens only for an existing position
/// and a user under the cap, and returns both facts for `save_refusal`.
const SAVE_SQL: &str = "WITH found AS (SELECT EXISTS (SELECT 1 FROM public.positions WHERE id = $2) AS present), \
         saved AS (SELECT count(*) AS total FROM public.user_saved_positions WHERE user_id = $1), \
         inserted AS ( \
             INSERT INTO public.user_saved_positions (id, user_id, position_id) \
             SELECT $3, $1, $2 FROM found, saved WHERE found.present AND saved.total < $4 \
             ON CONFLICT (user_id, position_id) DO NOTHING) \
         SELECT found.present, saved.total FROM found, saved";

/// Saving needs the position to exist (404) and the user under the cap
/// (400); the count includes this position when it is already saved. The
/// insert in `save_position` repeats both conditions, so a refused save
/// writes nothing.
fn save_refusal(position_found: bool, saved_count: i64, cap: i64) -> Result<(), ApiError> {
    if !position_found {
        return Err(ApiError::not_found(POSITION_NOT_FOUND));
    }
    if saved_count >= cap {
        return Err(ApiError::validation(SAVED_POSITIONS_CAP_REACHED));
    }
    Ok(())
}

fn position_id(path: &PathParams) -> Result<i64, ApiError> {
    let mut check = Validator::default();
    let id = check.path(path, "position_id").int(Limits::default());
    check.finish()?;
    Ok(id)
}

#[utoipa::path(
    get,
    path = "/saved-positions/",
    tag = "saved-positions",
    operation_id = "list_saved_positions_saved_positions__get",
    summary = "List Saved Positions",
    description = "The ids of the positions the user saved, newest first.",
    responses((status = 200, description = "Successful Response", body = Vec<i64>))
)]
pub async fn list_saved_positions(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<Vec<i64>>, ApiError> {
    let ids = read_with_retry(|| {
        sqlx::query_scalar::<_, i64>(
            "SELECT position_id FROM public.user_saved_positions WHERE user_id = $1 \
             ORDER BY saved_at DESC LIMIT $2",
        )
        .bind(user.id)
        .bind(DEFAULT_MAX_ROWS as i64)
        .fetch_all(&state.db)
    })
    .await?;
    Ok(Json(ids))
}

#[utoipa::path(
    put,
    path = "/saved-positions/{position_id}",
    tag = "saved-positions",
    operation_id = "save_position_saved_positions__position_id__put",
    summary = "Save Position",
    description = "Save (bookmark) a position; saving it again changes nothing.\n\n- 404 if the position does not exist.\n- 400 if the user has already saved `maximum_saved_positions_per_user` positions.",
    params(("position_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = SavePositionStatusResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn save_position(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<SavePositionStatusResponse>, ApiError> {
    let position_id = position_id(&path)?;
    let cap = RATE_LIMITS.maximum_saved_positions_per_user;
    let (position_found, saved_count) = sqlx::query_as::<_, (bool, i64)>(SAVE_SQL)
        .bind(user.id)
        .bind(position_id)
        .bind(Uuid::new_v4())
        .bind(cap)
        .fetch_one(&state.db)
        .await?;
    save_refusal(position_found, saved_count, cap)?;
    Ok(Json(SavePositionStatusResponse {
        status: SaveStatus::Saved,
    }))
}

#[utoipa::path(
    delete,
    path = "/saved-positions/{position_id}",
    tag = "saved-positions",
    operation_id = "unsave_position_saved_positions__position_id__delete",
    summary = "Unsave Position",
    description = "Remove a saved position; removing one that is not saved changes nothing.",
    params(("position_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = SavePositionStatusResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn unsave_position(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<SavePositionStatusResponse>, ApiError> {
    let position_id = position_id(&path)?;
    sqlx::query("DELETE FROM public.user_saved_positions WHERE user_id = $1 AND position_id = $2")
        .bind(user.id)
        .bind(position_id)
        .execute(&state.db)
        .await?;
    Ok(Json(SavePositionStatusResponse {
        status: SaveStatus::Unsaved,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_needs_the_position_and_room_under_the_cap() {
        let cap = RATE_LIMITS.maximum_saved_positions_per_user;
        assert!(
            matches!(save_refusal(false, 0, cap), Err(ApiError::NotFound(detail)) if detail == POSITION_NOT_FOUND)
        );
        assert!(
            matches!(save_refusal(true, cap, cap), Err(ApiError::Validation { detail, .. }) if detail == SAVED_POSITIONS_CAP_REACHED)
        );
        assert!(save_refusal(true, cap - 1, cap).is_ok());
        // A missing position is reported before the cap.
        assert!(matches!(
            save_refusal(false, cap, cap),
            Err(ApiError::NotFound(_))
        ));
        // The insert itself is guarded by the same two conditions, and is idempotent.
        assert!(SAVE_SQL.contains("WHERE found.present AND saved.total < $4"));
        assert!(SAVE_SQL.contains("ON CONFLICT (user_id, position_id) DO NOTHING"));
    }
}
