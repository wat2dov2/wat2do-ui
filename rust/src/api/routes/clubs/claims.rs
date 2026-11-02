//! Claims to manage a club: `POST /clubs/{club_id}/claims`, and the admin
//! queue at `/clubs/claims`.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use sqlx::postgres::PgRow;
use std::sync::LazyLock;
use utoipa::ToSchema;
use uuid::Uuid;

use super::members::{AddError, add_member};
use super::{
    AdminFilters, ClubResponse, admin_page_sql, club_id_into, emails, get_club, is_club_member,
    merge_err,
};
use crate::api::AppState;
use crate::api::auth::{AdminUser, DbUser};
use crate::api::body::{Body, Extra, Str};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::CLUB_NOT_FOUND;
use crate::api::pagination::{Paginated, Pagination};
use crate::api::routes::users::UserResponse;
use crate::api::validation::{Length, PathParams, QueryParams, Validator};
use crate::constants::{MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH};
use crate::db::read_with_retry;

const ALREADY_MANAGED: &str = "You already manage this club";
const CLAIM_NOT_FOUND: &str = "Claim not found";
const CLAIM_STATUS_PATTERN: &str = "^(approved|rejected)$";
static CLAIM_STATUS: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(CLAIM_STATUS_PATTERN).expect("claim status pattern"));

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ClubClaimResponse {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub club_id: i32,
    #[schema(value_type = String, format = Uuid)]
    pub user_id: Uuid,
    pub executive_role: String,
    #[schema(required = true)]
    pub proof_url: Option<String>,
    pub status: String,
    pub rejection_reason: Option<String>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub updated_at: DateTime<Utc>,
    pub clubs: Option<ClubResponse>,
    pub users: Option<UserResponse>,
}

crate::paginated_schema!(
    PaginatedClaims,
    PaginatedResponse_ClubClaimResponse_,
    ClubClaimResponse
);

const CLAIM_COLUMNS: &str = "cc.id, cc.club_id, cc.user_id, cc.executive_role, cc.proof_url, cc.status, \
     cc.rejection_reason, cc.created_at, cc.updated_at";

impl ClubClaimResponse {
    /// A row of `CLAIM_COLUMNS`, with the embedded club and user (as `clubs`
    /// and `users` JSON) when the read selected them.
    fn from_row(row: &PgRow) -> Result<Self, ApiError> {
        let embedded = |name: &str| -> Result<Option<serde_json::Value>, sqlx::Error> {
            match row.try_get::<Option<sqlx::types::Json<serde_json::Value>>, _>(name) {
                Ok(value) => Ok(value.map(|json| json.0)),
                Err(sqlx::Error::ColumnNotFound(_)) => Ok(None),
                Err(error) => Err(error),
            }
        };
        let clubs = embedded("clubs")?
            .map(serde_json::from_value::<ClubResponse>)
            .transpose()
            .map_err(anyhow::Error::from)?;
        let users = embedded("users")?
            .map(serde_json::from_value::<UserResponse>)
            .transpose()
            .map_err(anyhow::Error::from)?;
        Ok(Self {
            id: row.try_get("id")?,
            club_id: row.try_get("club_id")?,
            user_id: row.try_get("user_id")?,
            executive_role: row.try_get("executive_role")?,
            proof_url: row.try_get("proof_url")?,
            status: row.try_get("status")?,
            rejection_reason: row.try_get("rejection_reason")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            clubs,
            users,
        })
    }
}

#[utoipa::path(
    get,
    path = "/clubs/claims",
    tag = "clubs",
    operation_id = "list_claims_clubs_claims_get",
    summary = "List Claims",
    params(
        ("status" = Option<String>, Query, nullable),
        ("school" = Option<String>, Query, nullable, max_length = 255),
        ("search" = Option<String>, Query, nullable, max_length = 200),
        ("page" = Option<i64>, Query, minimum = 1, maximum = 1000, description = "Page number (1-indexed)"),
        ("page_size" = Option<i64>, Query, minimum = 1, maximum = 100, description = "Items per page (max 100)"),
    ),
    responses(
        (status = 200, description = "Successful Response", body = PaginatedClaims),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn list_claims(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    query: QueryParams,
) -> Result<Json<Paginated<ClubClaimResponse>>, ApiError> {
    let mut check = Validator::default();
    let pagination = Pagination::read(&mut check, &query);
    let status = check
        .query(&query, "status")
        .optional_string(Length::default());
    let school = check
        .query(&query, "school")
        .optional_string(Length::default().max(MAX_SCHOOL_LENGTH));
    let search = check
        .query(&query, "search")
        .optional_string(Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    check.finish()?;
    let filters = AdminFilters::new("claims", search, school, status);
    // The club and the claimant come embedded as stored, like `clubs(*)` and
    // `users(*)`: no owner email, event count or generated avatar.
    let sql = admin_page_sql(&format!(
        "SELECT entries.position, {CLAIM_COLUMNS}, \
             (SELECT to_jsonb(c) || jsonb_build_object('school', NULLIF(s.slug, '')) \
              FROM public.clubs c LEFT JOIN public.schools s ON s.id = c.school_id \
              WHERE c.id = cc.club_id) AS clubs, \
             (SELECT to_jsonb(u) FROM public.users u WHERE u.id = cc.user_id) AS users \
         FROM entries JOIN public.club_claims cc ON cc.id::text = entries.id"
    ));
    let rows = read_with_retry(|| {
        sqlx::query(&sql)
            .bind(pagination.page_size)
            .bind(pagination.offset())
            .bind(filters.resource)
            .bind(&filters.search)
            .bind(&filters.school)
            .bind(&filters.status)
            .fetch_all(&state.db)
    })
    .await?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in &rows {
        total = row.try_get("total")?;
        if row.try_get::<Option<Uuid>, _>("id")?.is_some() {
            items.push(ClubClaimResponse::from_row(row)?);
        }
    }
    Ok(Json(Paginated::new(items, total, pagination)))
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubClaimCreate {
    #[schema(min_length = 2, max_length = 100)]
    executive_role: String,
    #[schema(max_length = 500)]
    proof_url: Option<String>,
}

#[utoipa::path(
    post,
    path = "/clubs/{club_id}/claims",
    tag = "clubs",
    operation_id = "create_claim_clubs__club_id__claims_post",
    summary = "Create Claim",
    params(("club_id" = i64, Path)),
    request_body = ClubClaimCreate,
    responses(
        (status = 201, description = "Successful Response", body = ClubClaimResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn create_claim(
    State(state): State<AppState>,
    DbUser(user): DbUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = club_id_into(&mut check, &path);
    let (role, proof_url) = match Body::parse(&bytes, &headers, Extra::Ignore) {
        Ok(mut body) => {
            let role = body.required_string("executive_role", &Str::new().min(2).max(100));
            let proof_url = body.string("proof_url", &Str::new().max(500)).value();
            match body.finish() {
                Ok(()) => {
                    check.finish()?;
                    (role.unwrap_or_default(), proof_url)
                }
                Err(error) => return Err(merge_err(check, error)),
            }
        }
        Err(error) => return Err(merge_err(check, error)),
    };
    if get_club(&state.db, id).await?.is_none() {
        return Err(ApiError::not_found(CLUB_NOT_FOUND));
    }
    if is_club_member(&state.db, id, user.id).await {
        return Err(ApiError::conflict(ALREADY_MANAGED));
    }
    let now = Utc::now();
    let row = sqlx::query(&format!(
        "INSERT INTO public.club_claims AS cc \
             (club_id, user_id, executive_role, proof_url, status, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, 'pending', $5, $5) RETURNING {CLAIM_COLUMNS}"
    ))
    .bind(id)
    .bind(user.id)
    .bind(&role)
    .bind(&proof_url)
    .bind(now)
    .fetch_one(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(ClubClaimResponse::from_row(&row)?),
    )
        .into_response())
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ClubClaimUpdate {
    #[schema(pattern = "^(approved|rejected)$")]
    status: String,
    #[schema(max_length = 500)]
    rejection_reason: Option<String>,
}

#[utoipa::path(
    patch,
    path = "/clubs/claims/{claim_id}",
    tag = "clubs",
    operation_id = "update_claim_clubs_claims__claim_id__patch",
    summary = "Update Claim",
    params(("claim_id" = String, Path, format = Uuid)),
    request_body = ClubClaimUpdate,
    responses(
        (status = 200, description = "Successful Response", body = ClubClaimResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_claim(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
    path: PathParams,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<ClubClaimResponse>, ApiError> {
    let mut check = Validator::default();
    let claim_id = check.path(&path, "claim_id").uuid();
    let (status, reason) = match Body::parse(&bytes, &headers, Extra::Ignore) {
        Ok(mut body) => {
            let status = body.required_string(
                "status",
                &Str::new().pattern(CLAIM_STATUS_PATTERN, &CLAIM_STATUS),
            );
            let reason = body
                .string("rejection_reason", &Str::new().max(500))
                .value();
            match body.finish() {
                Ok(()) => {
                    check.finish()?;
                    (status.unwrap_or_default(), reason)
                }
                Err(error) => return Err(merge_err(check, error)),
            }
        }
        Err(error) => return Err(merge_err(check, error)),
    };
    // The previous status comes from the same statement's snapshot.
    let row = sqlx::query(&format!(
        "UPDATE public.club_claims cc SET status = $2, rejection_reason = $3, updated_at = $4 \
         FROM public.club_claims old WHERE cc.id = $1 AND old.id = cc.id \
         RETURNING {CLAIM_COLUMNS}, old.status AS previous_status"
    ))
    .bind(claim_id)
    .bind(&status)
    .bind(&reason)
    .bind(Utc::now())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::not_found(CLAIM_NOT_FOUND))?;
    let claim = ClubClaimResponse::from_row(&row)?;
    let previous: String = row.try_get("previous_status")?;
    if status == "approved" {
        // An unowned club gets the claimant as its owner.
        sqlx::query("UPDATE public.clubs SET created_by = $2 WHERE id = $1 AND created_by IS NULL")
            .bind(claim.club_id)
            .bind(claim.user_id)
            .execute(&state.db)
            .await?;
        match add_member(&state.db, i64::from(claim.club_id), claim.user_id).await {
            Ok(_) | Err(AddError::AlreadyMember) => {}
            Err(AddError::Api(error)) => return Err(error),
        }
    }
    if previous != status {
        send_claim_decision(&state.db, &claim, &status, reason.as_deref()).await?;
    }
    Ok(Json(claim))
}

/// `_send_claim_decision`: email the claimant; a missing club or account skips it.
async fn send_claim_decision(
    db: &sqlx::PgPool,
    claim: &ClubClaimResponse,
    status: &str,
    reason: Option<&str>,
) -> Result<(), ApiError> {
    let club = get_club(db, i64::from(claim.club_id)).await?;
    let claimant = read_with_retry(|| {
        sqlx::query_scalar::<_, String>("SELECT email FROM public.users WHERE id = $1")
            .bind(claim.user_id)
            .fetch_optional(db)
    })
    .await?;
    let (Some(club), Some(email)) = (club, claimant) else {
        return Ok(());
    };
    emails::send_review_decision(
        emails::Reviewed::Claim,
        &club.club_name,
        status,
        Some(&email),
        club.school.as_deref(),
        "/club-panel",
        reason,
    )
    .await;
    Ok(())
}
