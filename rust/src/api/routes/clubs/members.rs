//! `/clubs/{club_id}/members`: a club's management team.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{club_id, club_id_into, managed_club, merge_err};
use crate::api::AppState;
use crate::api::auth::DbUser;
use crate::api::body::{Body, Extra, Str};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{CANNOT_REMOVE_YOURSELF, USER_NOT_FOUND};
use crate::api::routes::users::{get_user, get_user_by_email, no_content};
use crate::api::validation::{PathParams, Validator};
use crate::db::read_with_retry;

pub const ALREADY_MEMBER: &str = "User is already a member of this club";
const INVALID_USER_ID: &str = "Invalid user ID format";
const MEMBER_NOT_FOUND: &str = "Member not found in this club";
/// Every team member's role; the team has no ranks.
const MEMBER_ROLE: &str = "Member";

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ClubMemberResponse {
    #[schema(value_type = String, format = Uuid)]
    pub user_id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub joined_at: DateTime<Utc>,
}

/// Why `add_member` did not add the user.
#[derive(Debug)]
pub enum AddError {
    /// The user is already on the team (`ConflictError`).
    AlreadyMember,
    Api(ApiError),
}

impl From<ApiError> for AddError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

impl From<sqlx::Error> for AddError {
    fn from(error: sqlx::Error) -> Self {
        Self::Api(error.into())
    }
}

impl From<AddError> for ApiError {
    fn from(error: AddError) -> Self {
        match error {
            AddError::AlreadyMember => ApiError::conflict(ALREADY_MEMBER),
            AddError::Api(error) => error,
        }
    }
}

/// `add_club_member`: put a user on a club's team. Members always follow
/// their club, so the club is saved for them first (and stays saved even
/// when they turn out to be on the team already).
pub async fn add_member(
    db: &sqlx::PgPool,
    club_id: i64,
    user_id: Uuid,
) -> Result<ClubMemberResponse, AddError> {
    let user = get_user(db, user_id)
        .await?
        .ok_or_else(|| AddError::Api(ApiError::not_found(USER_NOT_FOUND)))?;
    sqlx::query(
        "INSERT INTO public.user_saved_clubs (id, user_id, club_id) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, club_id) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(club_id)
    .execute(db)
    .await?;
    let joined_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        "INSERT INTO public.club_members (club_id, user_id, joined_at) VALUES ($1, $2, $3) \
         ON CONFLICT (club_id, user_id) DO NOTHING RETURNING joined_at",
    )
    .bind(club_id)
    .bind(user_id)
    .bind(Utc::now())
    .fetch_optional(db)
    .await?
    .ok_or(AddError::AlreadyMember)?;
    Ok(ClubMemberResponse {
        user_id,
        email: user.email,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
        role: MEMBER_ROLE.to_owned(),
        joined_at,
    })
}

#[utoipa::path(
    get,
    path = "/clubs/{club_id}/members",
    tag = "clubs",
    operation_id = "list_club_members_clubs__club_id__members_get",
    summary = "List Club Members",
    params(("club_id" = i64, Path)),
    responses(
        (status = 200, description = "Successful Response", body = Vec<ClubMemberResponse>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_club_members(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Json<Vec<ClubMemberResponse>>, ApiError> {
    let id = club_id(&path)?;
    managed_club(&state.db, id, &user).await?;
    // Driven from club_members like PostgREST's embedding, so the order
    // matches; avatars are as stored (no generated identicon here).
    let rows = read_with_retry(|| {
        sqlx::query(
            "SELECT m.joined_at, u.id, u.email, u.full_name, u.avatar_url \
             FROM public.club_members m \
             CROSS JOIN LATERAL (SELECT id, email, full_name, avatar_url FROM public.users \
                                 WHERE users.id = m.user_id) AS u \
             WHERE m.club_id = $1",
        )
        .bind(id)
        .fetch_all(&state.db)
    })
    .await?;
    let members = rows
        .iter()
        .map(|row| {
            Ok(ClubMemberResponse {
                user_id: row.try_get("id")?,
                email: row.try_get("email")?,
                full_name: row.try_get("full_name")?,
                avatar_url: row.try_get("avatar_url")?,
                role: MEMBER_ROLE.to_owned(),
                joined_at: row.try_get("joined_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
    Ok(Json(members))
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubMemberAdd {
    email: String,
}

#[utoipa::path(
    post,
    path = "/clubs/{club_id}/members",
    tag = "clubs",
    operation_id = "add_club_member_clubs__club_id__members_post",
    summary = "Add Club Member",
    description = "Add by email: existing users join club_members directly; otherwise invite.",
    params(("club_id" = i64, Path)),
    request_body = ClubMemberAdd,
    responses(
        (status = 201, description = "Successful Response", body = MemberOrInvitation),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn add_club_member(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, &path);
    let email = match Body::parse(&bytes, &headers, Extra::Ignore) {
        Ok(mut body) => {
            let email = body.required_string("email", &Str::new());
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
    let body = match get_user_by_email(&state.db, &email).await? {
        None => {
            let invitation = super::invitations::create(&state.db, &club, &email, user.id).await?;
            serde_json::to_value(invitation).map_err(anyhow::Error::from)?
        }
        Some(target) => {
            let member = add_member(&state.db, id, target.id).await?;
            serde_json::to_value(member).map_err(anyhow::Error::from)?
        }
    };
    Ok((StatusCode::CREATED, Json(body)).into_response())
}

/// `Union[ClubMemberResponse, ClubInvitationResponse]`.
#[allow(dead_code)]
#[derive(ToSchema)]
#[serde(untagged)]
pub enum MemberOrInvitation {
    Member(ClubMemberResponse),
    Invitation(super::invitations::ClubInvitationResponse),
}

/// Python's `UUID(text)`: braces, `urn:uuid:` and hyphens anywhere are
/// ignored; 32 hex digits remain.
fn python_uuid(text: &str) -> Option<Uuid> {
    let text = text.replace("urn:", "").replace("uuid:", "");
    let hex: String = text
        .trim_matches(|c| c == '{' || c == '}')
        .chars()
        .filter(|c| *c != '-')
        .collect();
    if hex.len() != 32 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Uuid::parse_str(&hex).ok()
}

#[utoipa::path(
    delete,
    path = "/clubs/{club_id}/members/{user_id}",
    tag = "clubs",
    operation_id = "remove_club_member_clubs__club_id__members__user_id__delete",
    summary = "Remove Club Member",
    params(("club_id" = i64, Path), ("user_id" = String, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn remove_club_member(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
) -> Result<Response, ApiError> {
    let id = club_id(&path)?;
    managed_club(&state.db, id, &user).await?;
    let mut check = Validator::default();
    let raw = check.path(&path, "user_id").string(Default::default());
    check.finish()?;
    let member = python_uuid(&raw).ok_or_else(|| ApiError::validation(INVALID_USER_ID))?;
    if member == user.id {
        return Err(ApiError::validation(CANNOT_REMOVE_YOURSELF));
    }
    let removed = sqlx::query("DELETE FROM public.club_members WHERE club_id = $1 AND user_id = $2")
        .bind(id)
        .bind(member)
        .execute(&state.db)
        .await?
        .rows_affected();
    if removed == 0 {
        return Err(ApiError::not_found(MEMBER_NOT_FOUND));
    }
    Ok(no_content())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_ids_parse_like_python_uuid() {
        let id = Uuid::parse_str("12345678-1234-5678-1234-567812345678").unwrap();
        for text in [
            "12345678-1234-5678-1234-567812345678",
            "{12345678-1234-5678-1234-567812345678}",
            "urn:uuid:12345678-1234-5678-1234-567812345678",
            "12345678123456781234567812345678",
            "1234-5678-1234-5678-1234-5678-1234-5678",
        ] {
            assert_eq!(python_uuid(text), Some(id), "{text}");
        }
        for text in ["", "not-a-uuid", "12345678-1234-5678-1234-56781234567", "g2345678123456781234567812345678"] {
            assert_eq!(python_uuid(text), None, "{text}");
        }
    }
}
