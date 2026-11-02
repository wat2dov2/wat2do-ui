//! Invitations to a club's management team: `/clubs/{club_id}/invitations`
//! and the public `/clubs/invitations/{token}`.

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use super::members::{ALREADY_MEMBER, AddError, add_member};
use super::{ClubResponse, club_id, club_id_into, emails, is_club_member, managed_club, merge_err};
use crate::api::AppState;
use crate::api::allowed_emails::AllowedEmailDomains;
use crate::api::auth::{DbUser, ROLE_ADMIN};
use crate::api::body::{Body, Extra, Str};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::NOT_AUTHORIZED;
use crate::api::routes::users::{get_user, get_user_by_email, no_content};
use crate::api::validation::{PathParams, Validator};
use crate::controlbox::CLUB_MANAGEMENT;
use crate::db::read_with_retry;

const INVITER_NOT_FOUND: &str = "Inviting user not found";
const INVITATION_NOT_FOUND: &str = "Invitation not found";
const INVITATION_EXPIRED: &str = "Invitation not found or has expired";

/// The process's school email domains (`core.allowed_emails`), read once.
static EMAIL_DOMAINS: LazyLock<AllowedEmailDomains> = LazyLock::new(AllowedEmailDomains::default);

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema, FromRow)]
pub struct ClubInvitationResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub club_id: i32,
    pub email: String,
    #[schema(value_type = String, format = Uuid)]
    pub token: Uuid,
    #[schema(value_type = String, format = Uuid)]
    pub invited_by: Uuid,
    pub status: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub expires_at: DateTime<Utc>,
}

const INVITATION_COLUMNS: &str =
    "id, club_id, email, token, invited_by, status, created_at, expires_at";

/// `create_invitation`: invite an email to the club's team (renewing an
/// earlier invitation to it), then email the invitation.
pub async fn create(
    db: &sqlx::PgPool,
    club: &ClubResponse,
    email: &str,
    invited_by: Uuid,
) -> Result<ClubInvitationResponse, ApiError> {
    let inviter = get_user(db, invited_by)
        .await?
        .ok_or_else(|| ApiError::not_found(INVITER_NOT_FOUND))?;
    if inviter.role != ROLE_ADMIN {
        // Managers may only invite people from their own school.
        let invited_school = EMAIL_DOMAINS.school_for_email(db, email).await;
        let same_school = match (&invited_school, &inviter.school) {
            (Some(invited), Some(own)) => invited.to_lowercase() == own.to_lowercase(),
            _ => false,
        };
        if !same_school {
            return Err(ApiError::validation(format!(
                "You can only invite emails matching your school domain ({}).",
                inviter.school.as_deref().filter(|school| !school.is_empty()).unwrap_or("Unknown")
            )));
        }
    }
    if let Some(existing) = get_user_by_email(db, email).await?
        && is_club_member(db, i64::from(club.id), existing.id).await
    {
        return Err(ApiError::conflict(ALREADY_MEMBER));
    }
    let token = Uuid::new_v4();
    let now = Utc::now();
    let expires_at = now + Duration::days(CLUB_MANAGEMENT.invite_expiration_days);
    let invitation = sqlx::query_as::<_, ClubInvitationResponse>(&format!(
        "INSERT INTO public.club_invitations \
             (club_id, email, token, invited_by, status, expires_at, created_at) \
         VALUES ($1, $2, $3, $4, 'pending', $5, $6) \
         ON CONFLICT (club_id, email) DO UPDATE SET club_id = EXCLUDED.club_id, \
             email = EXCLUDED.email, token = EXCLUDED.token, invited_by = EXCLUDED.invited_by, \
             status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, \
             created_at = EXCLUDED.created_at \
         RETURNING {INVITATION_COLUMNS}"
    ))
    .bind(club.id)
    .bind(crate::text::python_strip(email).to_lowercase())
    .bind(token)
    .bind(invited_by)
    .bind(expires_at)
    .bind(now)
    .fetch_one(db)
    .await
    .inspect_err(|error| tracing::error!("Failed to create/upsert invitation: {error}"))?;
    emails::send_invitation(&club.club_name, club.school.as_deref(), email, &token.to_string()).await;
    Ok(invitation)
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubInvitationCreate {
    /// Email to invite
    #[schema(min_length = 3)]
    email: String,
}

#[utoipa::path(
    post,
    path = "/clubs/{club_id}/invitations",
    tag = "clubs",
    operation_id = "create_invitation_clubs__club_id__invitations_post",
    summary = "Create Invitation",
    params(("club_id" = i64, Path)),
    request_body = ClubInvitationCreate,
    responses(
        (status = 201, description = "Successful Response", body = ClubInvitationResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn create_invitation(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, &path);
    let email = match Body::parse(&bytes, &headers, Extra::Forbid) {
        Ok(mut body) => {
            let email = body.required_string("email", &Str::new().min(3));
            match body.finish() {
                Ok(()) => {
                    check.finish()?;
                    email.unwrap_or_default()
                }
                Err(error) => return Err(merge_err(check, error)),
            }
        }
        Err(error) => return Err(merge_err(check, error)),
    };
    let club = managed_club(&state.db, id, &user).await?;
    let invitation = create(&state.db, &club, &email, user.id).await?;
    Ok((StatusCode::CREATED, Json(invitation)).into_response())
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}/invitations",
    tag = "clubs",
    operation_id = "list_invitations_clubs__club_id__invitations_get",
    summary = "List Invitations",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = Vec<ClubInvitationResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_invitations(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<Vec<ClubInvitationResponse>>, ApiError> {
    let id = club_id(&path)?;
    managed_club(&state.db, id, &user).await?;
    let now = Utc::now();
    let sql = format!(
        "SELECT {INVITATION_COLUMNS} FROM public.club_invitations \
         WHERE club_id = $1 AND status = 'pending' AND expires_at > $2"
    );
    let invitations = read_with_retry(|| {
        sqlx::query_as::<_, ClubInvitationResponse>(&sql)
        .bind(id)
        .bind(now)
        .fetch_all(&state.db)
    })
    .await?;
    Ok(Json(invitations))
}

#[utoipa::path(
    delete,
    path = "/clubs/{club_id}/invitations/{invitation_id}",
    tag = "clubs",
    operation_id = "revoke_invitation_clubs__club_id__invitations__invitation_id__delete",
    summary = "Revoke Invitation",
    params(("club_id" = i64, Path), ("invitation_id" = String, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn revoke_invitation(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = club_id(&path)?;
    managed_club(&state.db, id, &user).await?;
    let mut check = Validator::default();
    let invitation_id = check.path(&path, "invitation_id").string(Default::default());
    check.finish()?;
    // Compared as text cast to uuid, so a malformed id fails as it did through PostgREST.
    let revoked = sqlx::query("DELETE FROM public.club_invitations WHERE club_id = $1 AND id = $2::uuid")
        .bind(id)
        .bind(&invitation_id)
        .execute(&state.db)
        .await?
        .rows_affected();
    if revoked == 0 {
        return Err(ApiError::not_found(INVITATION_NOT_FOUND));
    }
    Ok(no_content())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ClubInvitationPublicResponse {
    pub club_name: String,
    pub email: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub expires_at: DateTime<Utc>,
}

#[utoipa::path(
    get,
    path = "/clubs/invitations/{token}",
    tag = "clubs",
    operation_id = "get_invitation_by_token_clubs_invitations__token__get",
    summary = "Get Invitation By Token",
    description = "Public: validate invitation token and return public details (club name).",
    params(("token" = String, Path)),
    responses(
        (status = 200, description = "Successful Response", body = ClubInvitationPublicResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_invitation_by_token(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<ClubInvitationPublicResponse>, ApiError> {
    let mut check = Validator::default();
    let token = check.path(&path, "token").string(Default::default());
    check.finish()?;
    let now = Utc::now();
    let row = read_with_retry(|| {
        sqlx::query_as::<_, (Option<String>, String, DateTime<Utc>)>(
            "SELECT c.club_name, i.email, i.expires_at FROM public.club_invitations i \
             LEFT JOIN public.clubs c ON c.id = i.club_id \
             WHERE i.token = $1::uuid AND i.status = 'pending' AND i.expires_at > $2 LIMIT 1",
        )
        .bind(&token)
        .bind(now)
        .fetch_optional(&state.db)
    })
    .await?
    .ok_or_else(|| ApiError::not_found(INVITATION_EXPIRED))?;
    let (club_name, email, expires_at) = row;
    Ok(Json(ClubInvitationPublicResponse {
        // The club cannot be missing (the invitation cascades with it); Python failed with a 500.
        club_name: club_name
            .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("invitation without a club")))?,
        email,
        expires_at,
    }))
}

#[utoipa::path(
    post,
    path = "/clubs/invitations/{token}/accept",
    tag = "clubs",
    operation_id = "accept_invitation_clubs_invitations__token__accept_post",
    summary = "Accept Invitation",
    params(("token" = String, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn accept_invitation(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let token = check.path(&path, "token").string(Default::default());
    check.finish()?;
    let now = Utc::now();
    let invitation = read_with_retry(|| {
        sqlx::query_as::<_, (Uuid, i32, String)>(
            "SELECT id, club_id, email FROM public.club_invitations \
             WHERE token = $1::uuid AND status = 'pending' AND expires_at > $2 LIMIT 1",
        )
        .bind(&token)
        .bind(now)
        .fetch_optional(&state.db)
    })
    .await?
    .ok_or_else(|| ApiError::not_found(INVITATION_EXPIRED))?;
    let (invitation_id, club_id, invited_email) = invitation;
    // Only the invited address may accept.
    let fold = |text: &str| caseless::default_case_fold_str(crate::text::python_strip(text));
    if user.email.is_empty() || fold(&user.email) != fold(&invited_email) {
        return Err(ApiError::authorization(NOT_AUTHORIZED));
    }
    match add_member(&state.db, i64::from(club_id), user.id).await {
        Ok(_) | Err(AddError::AlreadyMember) => {}
        Err(AddError::Api(error)) => return Err(error),
    }
    sqlx::query("UPDATE public.club_invitations SET status = 'accepted' WHERE id = $1")
        .bind(invitation_id)
        .execute(&state.db)
        .await?;
    Ok(no_content())
}
