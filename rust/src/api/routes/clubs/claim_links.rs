//! Claim links from outreach emails: the public `/clubs/claim-links/{token}` and
//! `/clubs/claim-links/{token}/accept`.
//!
//! Every outreach lead carries a claim token, and the email sent to the club's own
//! address links its page. Whoever opens the link signed in becomes the club's owner,
//! as an approved claim makes them, but only while nobody manages the club yet: the
//! first to accept wins, and the link stops working for everyone after.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use super::members::{AddError, add_member};
use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::errors::ApiError;
use crate::api::validation::{PathParams, Validator};
use crate::db::read_with_retry;

const CLAIM_LINK_NOT_FOUND: &str =
    "This claim link is invalid or its club has already been claimed";

/// The club a claim link would hand over.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema, FromRow)]
pub struct ClubClaimLinkResponse {
    pub club_id: i32,
    pub club_name: String,
    /// The club's school slug, whose site manages the club.
    pub school: String,
}

/// Nobody manages the club: it has no owner and no members.
const UNCLAIMED: &str = "c.created_by IS NULL \
     AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.club_id = c.id)";

fn token(path: &PathParams) -> Result<Uuid, ApiError> {
    let mut check = Validator::default();
    let token = check.path(path, "token").uuid();
    check.finish()?;
    Ok(token)
}

#[utoipa::path(
    get,
    path = "/clubs/claim-links/{token}",
    tag = "clubs",
    operation_id = "get_claim_link_clubs_claim_links__token__get",
    summary = "Get Claim Link",
    description = "Public: the club a claim link hands over, while nobody manages it.",
    params(("token" = Uuid, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubClaimLinkResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_claim_link(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<ClubClaimLinkResponse>, ApiError> {
    let token = token(&path)?;
    let sql = format!(
        "SELECT c.id AS club_id, c.club_name::text AS club_name, s.slug::text AS school \
         FROM public.outreach_leads l JOIN public.clubs c ON c.id = l.club_id \
         JOIN public.schools s ON s.id = c.school_id \
         WHERE l.claim_token = $1 AND {UNCLAIMED}"
    );
    let club = read_with_retry(|| {
        sqlx::query_as::<_, ClubClaimLinkResponse>(&sql)
            .bind(token)
            .fetch_optional(&state.db)
    })
    .await?
    .ok_or_else(|| ApiError::not_found(CLAIM_LINK_NOT_FOUND))?;
    Ok(Json(club))
}

#[utoipa::path(
    post,
    path = "/clubs/claim-links/{token}/accept",
    tag = "clubs",
    operation_id = "accept_claim_link_clubs_claim_links__token__accept_post",
    summary = "Accept Claim Link",
    description = "Make the signed-in user the owner of the club the link hands over.",
    params(("token" = Uuid, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubClaimLinkResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn accept_claim_link(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<ClubClaimLinkResponse>, ApiError> {
    let token = token(&path)?;
    // One statement takes the club only while nobody manages it, so of two people
    // accepting at once exactly one becomes the owner.
    let club = sqlx::query_as::<_, ClubClaimLinkResponse>(&format!(
        "UPDATE public.clubs c SET created_by = $2 \
         FROM public.outreach_leads l, public.schools s \
         WHERE l.claim_token = $1 AND c.id = l.club_id AND s.id = c.school_id AND {UNCLAIMED} \
         RETURNING c.id AS club_id, c.club_name::text AS club_name, s.slug::text AS school"
    ))
    .bind(token)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::not_found(CLAIM_LINK_NOT_FOUND))?;
    match add_member(&state.db, i64::from(club.club_id), user.id).await {
        Ok(_) | Err(AddError::AlreadyMember) => {}
        Err(AddError::Api(error)) => return Err(error),
    }
    sqlx::query("UPDATE public.outreach_leads SET status = 'claimed' WHERE claim_token = $1")
        .bind(token)
        .execute(&state.db)
        .await?;
    Ok(Json(club))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claim_link_only_hands_over_a_club_nobody_manages() {
        assert!(UNCLAIMED.starts_with("c.created_by IS NULL"));
        assert!(UNCLAIMED.contains("NOT EXISTS (SELECT 1 FROM public.club_members"));
    }
}
