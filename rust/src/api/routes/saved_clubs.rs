//! `/saved-clubs`: the clubs a signed-in user follows
//! (`routers/saved_clubs.py`, `services/saved_club_service.py`).

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::messages::{CLUB_NOT_FOUND, MEMBERS_ALWAYS_FOLLOW_CLUB, SAVED_CLUBS_CAP_REACHED};
use crate::api::pagination::DEFAULT_MAX_ROWS;
use crate::api::routes::clubs::{club_id, is_club_member};
use crate::api::validation::PathParams;
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;

/// Locks the save/unsave status contract at the OpenAPI boundary.
#[derive(Debug, Serialize, ToSchema)]
pub struct SaveClubStatusResponse {
    #[schema(inline)]
    pub status: SaveStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SaveStatus {
    Saved,
    Unsaved,
}

#[utoipa::path(
    get,
    path = "/saved-clubs/",
    tag = "saved-clubs",
    operation_id = "list_saved_clubs_saved_clubs__get",
    summary = "List Saved Clubs",
    responses((status = 200, description = "Successful Response", body = Vec<i64>))
)]
pub async fn list_saved_clubs(
    State(state): State<AppState>,
    DbUser(user): DbUser,
) -> Result<Json<Vec<i32>>, ApiError> {
    // Newest first, like the paged reads it replaces; the row cap of
    // `fetch_all_pages` is far above the saved-club limit.
    let result = read_with_retry(|| {
        sqlx::query_scalar::<_, i32>(
            "SELECT club_id FROM public.user_saved_clubs WHERE user_id = $1 \
             ORDER BY saved_at DESC LIMIT $2",
        )
        .bind(user.id)
        .bind(DEFAULT_MAX_ROWS as i64)
        .fetch_all(&state.db)
    })
    .await;
    match result {
        Ok(ids) => Ok(Json(ids)),
        // A query the database refuses reads as no saved clubs, as before.
        Err(sqlx::Error::Database(error)) => {
            tracing::warn!("saved_clubs table unavailable: {}", error.message());
            Ok(Json(Vec::new()))
        }
        Err(error) => Err(error.into()),
    }
}

#[utoipa::path(
    put,
    path = "/saved-clubs/{club_id}",
    tag = "saved-clubs",
    operation_id = "save_club_saved_clubs__club_id__put",
    summary = "Save Club",
    description = "Save (bookmark) a club.\n\n- 404 if the club does not exist.\n- 400 if the user has already hit ``MAX_SAVED_CLUBS_PER_USER``.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = SaveClubStatusResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn save_club(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<SaveClubStatusResponse>, ApiError> {
    let club_id = club_id(&path)?;
    // One round trip: the club must exist and the user be under the cap
    // (counting this club if it is already saved); saving twice keeps one row.
    let (club_found, saved_count) = sqlx::query_as::<_, (bool, i64)>(
        "WITH found AS (SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id = $2) AS club), \
         saved AS (SELECT count(*) AS total FROM public.user_saved_clubs WHERE user_id = $1), \
         inserted AS ( \
             INSERT INTO public.user_saved_clubs (id, user_id, club_id) \
             SELECT $3, $1, $2 FROM found, saved WHERE found.club AND saved.total < $4 \
             ON CONFLICT (user_id, club_id) DO NOTHING) \
         SELECT found.club, saved.total FROM found, saved",
    )
    .bind(user.id)
    .bind(club_id)
    .bind(Uuid::new_v4())
    .bind(RATE_LIMITS.maximum_saved_clubs_per_user)
    .fetch_one(&state.db)
    .await?;
    if !club_found {
        return Err(ApiError::not_found(CLUB_NOT_FOUND));
    }
    if saved_count >= RATE_LIMITS.maximum_saved_clubs_per_user {
        return Err(ApiError::validation(SAVED_CLUBS_CAP_REACHED));
    }
    Ok(Json(SaveClubStatusResponse {
        status: SaveStatus::Saved,
    }))
}

#[utoipa::path(
    delete,
    path = "/saved-clubs/{club_id}",
    tag = "saved-clubs",
    operation_id = "unsave_club_saved_clubs__club_id__delete",
    summary = "Unsave Club",
    description = "Unfollow a club. 400 for the club's own members, who always follow it.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = SaveClubStatusResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn unsave_club(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<SaveClubStatusResponse>, ApiError> {
    let club_id = club_id(&path)?;
    if is_club_member(&state.db, club_id, user.id).await {
        return Err(ApiError::validation(MEMBERS_ALWAYS_FOLLOW_CLUB));
    }
    sqlx::query("DELETE FROM public.user_saved_clubs WHERE user_id = $1 AND club_id = $2")
        .bind(user.id)
        .bind(club_id)
        .execute(&state.db)
        .await?;
    Ok(Json(SaveClubStatusResponse {
        status: SaveStatus::Unsaved,
    }))
}
