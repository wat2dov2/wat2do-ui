//! `/clubs/{club_id}/payouts` and `/clubs/{club_id}/ticket-sales`: a club's
//! side of tickets, for anyone on its team (or an admin).

use axum::Json;
use axum::extract::State;

use super::{club_id_into, managed_club};
use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::tickets::model::{
    ClubEventTicketSummary, ClubPayoutStatus, StripeRedirectResponse,
};
use crate::api::tickets::{door, payouts};
use crate::api::validation::{PathParams, Validator};

fn club_id(path: &PathParams) -> Result<i64, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, path);
    check.finish()?;
    Ok(id)
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}/payouts",
    tag = "club-ticketing",
    operation_id = "get_club_payouts_clubs__club_id__payouts_get",
    summary = "Get Club Payouts",
    description = "Whether the club can sell tickets, and what Stripe still needs from it.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubPayoutStatus),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_club_payouts(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<ClubPayoutStatus>, ApiError> {
    let club = managed_club(&state.db, club_id(&path)?, &user).await?;
    Ok(Json(payouts::status(&state, &club).await?))
}

#[utoipa::path(
    post,
    path = "/clubs/{club_id}/payouts/onboarding",
    tag = "club-ticketing",
    operation_id = "start_club_payout_onboarding_clubs__club_id__payouts_onboarding_post",
    summary = "Start Club Payout Onboarding",
    description = "A one-time link to Stripe's onboarding, creating the club's account on first use.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = StripeRedirectResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn start_club_payout_onboarding(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<StripeRedirectResponse>, ApiError> {
    let club = managed_club(&state.db, club_id(&path)?, &user).await?;
    let url = payouts::onboarding_url(&state, &club, &user).await?;
    Ok(Json(StripeRedirectResponse { url }))
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}/ticket-sales",
    tag = "club-ticketing",
    operation_id = "list_club_ticket_sales_clubs__club_id__ticket_sales_get",
    summary = "List Club Ticket Sales",
    description = "Every event of the club that has tickets, with its counts.",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = Vec<ClubEventTicketSummary>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_club_ticket_sales(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<Vec<ClubEventTicketSummary>>, ApiError> {
    let club = managed_club(&state.db, club_id(&path)?, &user).await?;
    Ok(Json(door::club_summaries(&state, club.id.into()).await?))
}
