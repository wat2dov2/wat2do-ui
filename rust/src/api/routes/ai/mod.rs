//! `/ai`: reading an event or a hiring position from an uploaded poster
//! (`routers/ai.py`, `services/ai_service.py`).
//!
//! Visitors may use both routes, so they share one limiter by client IP. The
//! poster is checked and re-encoded like an event image upload, read by the
//! vision model, and stored only once something was read from it.

pub mod extractor;

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{NaiveDate, Utc};
use serde::Serialize;

use crate::api::AppState;
use crate::api::client_ip::ClientIp;
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{EVENT_IMAGE_NO_EVENT, POSITION_IMAGE_NO_POSITION};
use crate::api::multipart::{self, UploadedFile};
use crate::api::rate_limit::RateLimiter;
use crate::api::validation::{Length, QueryParams, Validator};
use crate::constants::{BUCKET_EVENT_IMAGES, MAX_SCHOOL_LENGTH};
use crate::controlbox::RATE_LIMITS;
use crate::db::read_with_retry;
use crate::schools::{COLUMNS, School, normalize_slug};
use crate::storage::{UploadRefused, file_size_limit, validate_and_prepare};
use extractor::{
    EventForm, ExtractedPosition, ExtractionFailed, FormOccurrence, OpenAi, PostContent,
};

/// `ai_parse_event_image_rate_limiter`: both routes, by client IP.
static AI_PARSE: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(RATE_LIMITS.default));

/// `EventFormDataResponse`.
#[derive(Debug, Serialize)]
struct EventFormDataResponse {
    title: String,
    description: String,
    occurrences: Vec<FormOccurrence>,
    location: String,
    category: String,
    #[serde(serialize_with = "json::float")]
    price: f64,
    food: Vec<String>,
    registration: bool,
    source_image_url: Option<String>,
}

/// `PositionImageResponse`.
#[derive(Debug, Serialize)]
struct PositionImageResponse {
    title: String,
    description: String,
    position_type: String,
    requirements: Vec<String>,
    commitment: Option<String>,
    compensation: Option<String>,
    is_paid: Option<bool>,
    location: Option<String>,
    contact_email: Option<String>,
    #[serde(serialize_with = "json::option_date")]
    deadline_date: Option<NaiveDate>,
    deadline_at: Option<String>,
    source_image_url: Option<String>,
}

/// An upload's refusal as the routes answer it (`HTTPException`): 413 for
/// the size limit, 400 otherwise.
pub fn upload_refusal(refused: UploadRefused) -> ApiError {
    let status = if refused.too_large {
        StatusCode::PAYLOAD_TOO_LARGE
    } else {
        StatusCode::BAD_REQUEST
    };
    ApiError::http(status, refused.detail)
}

/// `validate_and_prepare` off the request's thread: re-encoding an image is CPU work.
pub async fn prepare_upload(
    bucket: &'static str,
    data: Vec<u8>,
    content_type: Option<String>,
) -> Result<(Vec<u8>, String), ApiError> {
    tokio::task::spawn_blocking(move || validate_and_prepare(bucket, data, content_type.as_deref()))
        .await
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("image preparation: {error}")))?
        .map_err(upload_refusal)
}

/// The form and the `school` parameter, read as FastAPI reads them: the body
/// first, then the rate limit, then every parameter's problems together.
async fn read_request(
    client_ip: &str,
    query: &QueryParams,
    request: Request,
) -> Result<(String, UploadedFile), ApiError> {
    let (parts, body) = request.into_parts();
    let keep = file_size_limit(BUCKET_EVENT_IMAGES) + 1;
    let field = multipart::read_field(&parts.headers, body, "file", keep).await?;
    AI_PARSE.check(client_ip)?;
    let mut check = Validator::default();
    let school = check
        .query(query, "school")
        .string(Length::default().min(1).max(MAX_SCHOOL_LENGTH));
    let file = multipart::required_file(field, "file").map_err(|issue| check.push(*issue));
    check.finish()?;
    Ok((school, file.expect("a missing file fails the check")))
}

/// `school_service.get_school`: the registered school with this slug.
async fn registered_school(db: &sqlx::PgPool, school: &str) -> Result<School, ApiError> {
    let slug = normalize_slug(school);
    let found = if slug.is_empty() {
        None
    } else {
        let sql = format!("SELECT {COLUMNS} FROM public.schools WHERE slug = $1 LIMIT 1");
        read_with_retry(|| {
            sqlx::query_as::<_, School>(&sql)
                .bind(&slug)
                .fetch_optional(db)
        })
        .await?
    };
    found.ok_or_else(|| ApiError::validation("School is not registered"))
}

/// `_parse_uploaded_image`'s first half: the checked poster, read by the model.
async fn read_poster(
    state: &AppState,
    school: &School,
    file: UploadedFile,
) -> Result<(Vec<u8>, String, PostContent), ApiError> {
    let declared = file
        .content_type
        .filter(|content_type| !content_type.is_empty())
        .unwrap_or_else(|| "image/jpeg".to_owned());
    let (data, content_type) =
        prepare_upload(BUCKET_EVENT_IMAGES, file.data, Some(declared)).await?;
    let image_url = format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&data)
    );
    let model = OpenAi {
        api_key: &state.settings.openai_api_key,
        model: &state.settings.openai_extraction_model,
    };
    let content = extractor::extract_post_content(school, &[image_url], Utc::now(), &model)
        .await
        .map_err(|ExtractionFailed| {
            ApiError::Internal(anyhow::anyhow!("Instagram post extraction failed"))
        })?;
    Ok((data, content_type, content))
}

#[utoipa::path(
    post,
    path = "/ai/parse-event-image",
    tag = "ai",
    operation_id = "parse_event_image_ai_parse_event_image_post",
    summary = "Parse Event Image"
)]
pub async fn parse_event_image(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    query: QueryParams,
    request: Request,
) -> Result<Response, ApiError> {
    let (school, file) = read_request(&client_ip, &query, request).await?;
    let school = registered_school(&state.db, &school).await?;
    let (data, content_type, content) = read_poster(&state, &school, file).await?;
    let form: EventForm = content
        .events
        .first()
        .and_then(|event| extractor::event_form(event, &school.timezone, Utc::now()))
        .ok_or_else(|| ApiError::validation(EVENT_IMAGE_NO_EVENT))?;
    let url = state
        .storage
        .upload(BUCKET_EVENT_IMAGES, data, &content_type)
        .await?;
    Ok(Json(EventFormDataResponse {
        title: form.title,
        description: form.description,
        occurrences: form.occurrences,
        location: form.location,
        category: form.category,
        price: form.price,
        food: form.food,
        registration: form.registration,
        source_image_url: Some(url),
    })
    .into_response())
}

#[utoipa::path(
    post,
    path = "/ai/parse-position-image",
    tag = "ai",
    operation_id = "parse_position_image_ai_parse_position_image_post",
    summary = "Parse Position Image"
)]
pub async fn parse_position_image(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    query: QueryParams,
    request: Request,
) -> Result<Response, ApiError> {
    let (school, file) = read_request(&client_ip, &query, request).await?;
    let school = registered_school(&state.db, &school).await?;
    let (data, content_type, content) = read_poster(&state, &school, file).await?;
    let Some(position) = content.positions.into_iter().next() else {
        return Err(ApiError::validation(POSITION_IMAGE_NO_POSITION));
    };
    let url = state
        .storage
        .upload(BUCKET_EVENT_IMAGES, data, &content_type)
        .await?;
    let ExtractedPosition {
        title,
        description,
        position_type,
        requirements,
        commitment,
        compensation,
        is_paid,
        location,
        contact_email,
        deadline_date,
        deadline_at,
    } = position;
    Ok(Json(PositionImageResponse {
        title,
        description,
        position_type,
        requirements,
        commitment,
        compensation,
        is_paid,
        location,
        contact_email,
        deadline_date,
        deadline_at,
        source_image_url: Some(url),
    })
    .into_response())
}

#[cfg(test)]
mod tests;
