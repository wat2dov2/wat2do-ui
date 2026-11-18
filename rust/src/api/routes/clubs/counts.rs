//! `/clubs/{club_id}/counts`: what a club has going on, for its team's club
//! panel, whose Events, Positions and Members cards show these numbers.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;

use super::{club_id, managed_club, open_position_count};
use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::events::store::{hosted_by, not_ended_sql};
use crate::api::routes::positions::OpenWindow;
use crate::api::validation::PathParams;
use crate::db::read_with_retry;

/// What a club has going on, as its team's club panel shows it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ClubCounts {
    /// Events the club hosts or co-hosts that are on now or still to come.
    pub upcoming_events: i64,
    /// Positions the club hosts or co-hosts that are open, as its public page lists them.
    pub open_positions: i64,
    /// People on the club's team; invitations not yet accepted are not counted.
    pub members: i64,
}

/// The club's counts, read in one statement.
pub async fn club_counts(db: &sqlx::PgPool, club: i64) -> Result<ClubCounts, ApiError> {
    let sql = format!(
        "SELECT (SELECT count(*) FROM public.events e WHERE {} AND {}) AS upcoming_events, \
                {} AS open_positions, \
                (SELECT count(*) FROM public.club_members m WHERE m.club_id = $1) AS members",
        hosted_by("$1"),
        not_ended_sql(),
        open_position_count("$1::int4", "$2", "$3"),
    );
    let open = OpenWindow::now();
    let row = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(club)
            .bind(open.today)
            .bind(open.cutoff)
            .fetch_one(db)
    })
    .await?;
    Ok(ClubCounts {
        upcoming_events: row.try_get("upcoming_events")?,
        open_positions: row.try_get("open_positions")?,
        members: row.try_get("members")?,
    })
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}/counts",
    tag = "clubs",
    operation_id = "get_club_counts_clubs__club_id__counts_get",
    summary = "Get Club Counts",
    description = "The club's upcoming events, open positions and team members, for its team or an admin.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubCounts),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_club_counts(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<ClubCounts>, ApiError> {
    let id = club_id(&path)?;
    managed_club(&state.db, id, &user).await?;
    Ok(Json(club_counts(&state.db, id).await?))
}
