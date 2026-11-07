//! `/uploads`: event posters, profile photos, club logos, QR poster assets
//! and club claim proofs (`routers/uploads.py`).
//!
//! Every upload is read as FastAPI reads a form (the body first, so a
//! malformed one is a 400 before anything else), then its sender is checked
//! and counted against one hourly limit, then an oversized `Content-Length`
//! is refused, then the file is checked against its bucket's rules and
//! stored under a random name. Replacing an image stores the new one and
//! points the record at it before the old object is deleted.

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use serde::Serialize;
use serde_json::{Map, json};
use uuid::Uuid;

use crate::api::AppState;
use crate::api::auth::{AuthUser, CurrentUser, User, find_user, require_owner_or_admin};
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::events::requests::EventInput;
use crate::api::events::{store, writes};
use crate::api::messages::{CLUB_NOT_FOUND, EVENT_NOT_FOUND, USER_NOT_FOUND};
use crate::api::multipart::{self, FormValue, UploadedFile};
use crate::api::rate_limit::RateLimiter;
use crate::api::routes::ai::prepare_upload;
use crate::api::routes::{clubs, users};
use crate::api::validation::{PathParams, Validator};
use crate::constants::{
    BUCKET_AVATARS, BUCKET_CLAIM_PROOFS, BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES, BUCKET_QR_ASSETS,
};
use crate::controlbox::RateLimit;
use crate::db::read_with_retry;
use crate::storage::{file_size_limit, too_large};

/// 30 uploads an hour per signed-in user (or, for anonymous posters, per
/// client IP): room for a multi-edit session, not for flooding storage.
static UPLOADS: LazyLock<RateLimiter> = LazyLock::new(|| {
    RateLimiter::new(RateLimit {
        maximum_requests: 30,
        window_seconds: 3600,
    })
});

/// Multipart framing around an at-limit file still fits.
const MULTIPART_SLACK: usize = 4 * 1024;

/// `UploadResponse`.
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    url: String,
}

/// The request's parts and its form's `file` value, read before anything else.
async fn read_form(request: Request, bucket: &str) -> Result<(Parts, Option<FormValue>), ApiError> {
    let (parts, body) = request.into_parts();
    let field =
        multipart::read_field(&parts.headers, body, "file", file_size_limit(bucket) + 1).await?;
    Ok((parts, field))
}

/// `_enforce_content_length`: refuse a body whose declared length is over
/// the bucket's limit (with framing slack); an unreadable length is ignored.
fn enforce_content_length(headers: &HeaderMap, bucket: &str) -> Result<(), ApiError> {
    let limit = file_size_limit(bucket);
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u128>().ok());
    match declared {
        Some(length) if length > (limit + MULTIPART_SLACK) as u128 => Err(ApiError::http(
            StatusCode::PAYLOAD_TOO_LARGE,
            too_large(limit).detail,
        )),
        _ => Ok(()),
    }
}

/// The signed-in sender, counted against the upload limit (`_rate_limit_dep`).
async fn signed_in(parts: &mut Parts, state: &AppState) -> Result<AuthUser, ApiError> {
    let CurrentUser(auth_user) = CurrentUser::from_request_parts(parts, state).await?;
    Ok(auth_user)
}

fn count_upload(auth_user: &AuthUser) -> Result<(), ApiError> {
    UPLOADS.check(&format!("uploads:{}", auth_user.id))
}

/// `get_db_user` for a signed-in sender.
async fn db_user(state: &AppState, auth_user: &AuthUser) -> Result<User, ApiError> {
    find_user(&state.db, &auth_user.id)
        .await?
        .ok_or_else(|| ApiError::not_found(USER_NOT_FOUND))
}

/// The `file` parameter, with any path parameter problems reported first.
fn file_parameter(
    mut check: Validator,
    field: Option<FormValue>,
) -> Result<UploadedFile, ApiError> {
    let file = multipart::required_file(field, "file").map_err(|issue| check.push(*issue));
    check.finish()?;
    Ok(file.expect("a missing file fails the check"))
}

/// Check, store and return the URL of one new file.
async fn store(
    state: &AppState,
    bucket: &'static str,
    file: UploadedFile,
) -> Result<String, ApiError> {
    let (data, content_type) = prepare_upload(bucket, file.data, file.content_type).await?;
    Ok(state.storage.upload(bucket, data, &content_type).await?)
}

/// `_replace_image`: store the new file, point the record at it, then delete
/// the old object when it is one of ours in this bucket.
async fn replace(
    state: &AppState,
    bucket: &'static str,
    file: UploadedFile,
    old_url: Option<&str>,
    persist: impl AsyncFnOnce(String) -> Result<(), ApiError>,
) -> Result<String, ApiError> {
    let (data, content_type) = prepare_upload(bucket, file.data, file.content_type).await?;
    let url = state.storage.upload(bucket, data, &content_type).await?;
    persist(url.clone()).await?;
    if let Some(old_path) = old_url
        .filter(|old_url| !old_url.is_empty())
        .and_then(|old_url| state.storage.path_from_url(old_url, bucket))
    {
        state.storage.delete_file(bucket, &old_path).await?;
    }
    Ok(url)
}

#[utoipa::path(
    post,
    path = "/uploads/event-image",
    tag = "uploads",
    operation_id = "upload_event_image_unsigned_uploads_event_image_post",
    summary = "Upload Event Image Unsigned"
)]
pub async fn upload_event_image_unsigned(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    let (parts, field) = read_form(request, BUCKET_EVENT_IMAGES).await?;
    UPLOADS.check(&client_ip)?;
    enforce_content_length(&parts.headers, BUCKET_EVENT_IMAGES)?;
    let file = file_parameter(Validator::default(), field)?;
    let url = store(&state, BUCKET_EVENT_IMAGES, file).await?;
    Ok(Json(UploadResponse { url }))
}

#[utoipa::path(
    post,
    path = "/uploads/event-image/{event_id}",
    tag = "uploads",
    operation_id = "upload_event_image_uploads_event_image__event_id__post",
    summary = "Upload Event Image"
)]
pub async fn upload_event_image(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    let (mut parts, field) = read_form(request, BUCKET_EVENT_IMAGES).await?;
    let auth_user = signed_in(&mut parts, &state).await?;
    let user = db_user(&state, &auth_user).await?;
    count_upload(&auth_user)?;
    enforce_content_length(&parts.headers, BUCKET_EVENT_IMAGES)?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let event_id = check.path(&path, "event_id").unbounded_int();
    let file = file_parameter(check, field)?;
    let event_id = writes::int4(event_id)?;
    let event = store::event_by_id(&state.db, event_id)
        .await?
        .ok_or_else(|| ApiError::not_found(EVENT_NOT_FOUND))?;
    require_owner_or_admin(&user, event.created_by)?;
    let url = replace(
        &state,
        BUCKET_EVENT_IMAGES,
        file,
        event.source_image_url.as_deref(),
        async |url| {
            let mut fields = Map::new();
            fields.insert("source_image_url".into(), json!(url));
            let input = EventInput {
                fields,
                ..EventInput::default()
            };
            writes::update(&state.db, event_id, input, None).await?;
            Ok(())
        },
    )
    .await?;
    Ok(Json(UploadResponse { url }))
}

#[utoipa::path(
    post,
    path = "/uploads/avatar",
    tag = "uploads",
    operation_id = "upload_avatar_uploads_avatar_post",
    summary = "Upload Avatar"
)]
pub async fn upload_avatar(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    let (mut parts, field) = read_form(request, BUCKET_AVATARS).await?;
    let auth_user = signed_in(&mut parts, &state).await?;
    let user = db_user(&state, &auth_user).await?;
    count_upload(&auth_user)?;
    enforce_content_length(&parts.headers, BUCKET_AVATARS)?;
    let file = file_parameter(Validator::default(), field)?;
    let old_url = stored_avatar(&state.db, user.id).await?;
    let url = replace(
        &state,
        BUCKET_AVATARS,
        file,
        old_url.as_deref(),
        async |url| {
            users::set_avatar(&state.db, user.id, url).await?;
            Ok(())
        },
    )
    .await?;
    Ok(Json(UploadResponse { url }))
}

/// The profile photo the user has now, as stored.
async fn stored_avatar(db: &sqlx::PgPool, user_id: Uuid) -> Result<Option<String>, ApiError> {
    Ok(read_with_retry(|| {
        sqlx::query_scalar::<_, Option<String>>("SELECT avatar_url FROM public.users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(db)
    })
    .await?
    .flatten())
}

#[utoipa::path(
    post,
    path = "/uploads/club-logo/{club_id}",
    tag = "uploads",
    operation_id = "upload_club_logo_uploads_club_logo__club_id__post",
    summary = "Upload Club Logo"
)]
pub async fn upload_club_logo(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    let (mut parts, field) = read_form(request, BUCKET_CLUB_LOGOS).await?;
    let auth_user = signed_in(&mut parts, &state).await?;
    let user = db_user(&state, &auth_user).await?;
    count_upload(&auth_user)?;
    enforce_content_length(&parts.headers, BUCKET_CLUB_LOGOS)?;
    let path = PathParams::from_request_parts(&mut parts, &state).await?;
    let mut check = Validator::default();
    let club_id = check.path(&path, "club_id").unbounded_int();
    let file = file_parameter(check, field)?;
    let club_id = writes::int4(club_id)?;
    let club = clubs::get_club(&state.db, club_id)
        .await?
        .ok_or_else(|| ApiError::not_found(CLUB_NOT_FOUND))?;
    let owner = club
        .created_by
        .as_deref()
        .and_then(|owner| Uuid::parse_str(owner).ok());
    require_owner_or_admin(&user, owner)?;
    let url = replace(
        &state,
        BUCKET_CLUB_LOGOS,
        file,
        club.logo_url.as_deref(),
        async |url| {
            clubs::set_logo(&state.db, &club, url).await?;
            Ok(())
        },
    )
    .await?;
    Ok(Json(UploadResponse { url }))
}

#[utoipa::path(
    post,
    path = "/uploads/qr-asset",
    tag = "uploads",
    operation_id = "upload_qr_asset_uploads_qr_asset_post",
    summary = "Upload Qr Asset"
)]
pub async fn upload_qr_asset(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    signed_in_upload(state, request, BUCKET_QR_ASSETS).await
}

#[utoipa::path(
    post,
    path = "/uploads/claim-proof",
    tag = "uploads",
    operation_id = "upload_claim_proof_uploads_claim_proof_post",
    summary = "Upload Claim Proof"
)]
pub async fn upload_claim_proof(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<UploadResponse>, ApiError> {
    signed_in_upload(state, request, BUCKET_CLAIM_PROOFS).await
}

/// A new file from any signed-in user, owned by nothing yet (QR assets,
/// claim proofs).
async fn signed_in_upload(
    state: AppState,
    request: Request,
    bucket: &'static str,
) -> Result<Json<UploadResponse>, ApiError> {
    let (mut parts, field) = read_form(request, bucket).await?;
    let auth_user = signed_in(&mut parts, &state).await?;
    count_upload(&auth_user)?;
    enforce_content_length(&parts.headers, bucket)?;
    let file = file_parameter(Validator::default(), field)?;
    let url = store(&state, bucket, file).await?;
    Ok(Json(UploadResponse { url }))
}

#[cfg(test)]
mod database_tests;
#[cfg(test)]
mod tests;
