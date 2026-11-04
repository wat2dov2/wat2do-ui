//! Creating, editing and deleting posters (`POST /qr/`, `PATCH` and
//! `DELETE /qr/{qr_code_id}`).
//!
//! `POST /qr/` takes either a standard poster (`QrCodeCreate`, for club
//! managers and admins) or a promoter batch (`PromoterPosterBatchCreate`,
//! for enrolled promoters); the body is validated against both, as
//! pydantic validates a union, and the one that fits is created. Promoter
//! posters are created by `create_promoter_qr_codes`, which locks the user,
//! checks enrollment, school and the active-poster cap, and inserts the
//! whole batch in one transaction. Promoter posters are never edited or
//! deleted (their scans are the payout record).

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use regex::Regex;
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{QR_COLUMNS, QR_JOINS, QrCodeResponse, get_qr_code, school_id, school_id_by_slug};
use crate::api::AppState;
use crate::api::auth::{
    ClubOwnerOrAdmin, DbUser, User, authorized_resource, require_club_owner_or_admin,
};
use crate::api::body::{Body, Extra, Str, json_first, merge_issues};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{
    ID_MISMATCH, POSTER_NOT_FOUND, PROMOTER_ENROLLMENT_REQUIRED, PROMOTER_POSTER_LIMIT_REACHED,
    PROMOTER_POSTERS_CANNOT_BE_DELETED, PROMOTER_POSTERS_CANNOT_BE_UPDATED,
    PROMOTER_PROGRAM_PAUSED, PROMOTER_SCHOOL_REQUIRED, PROMOTER_TEMPLATE_NOT_FOUND,
    PROMOTER_TEMPLATE_SCHOOL_MISMATCH, PROMOTER_TEMPLATE_UNAVAILABLE,
};
use crate::api::routes::clubs::SCHOOL_NOT_REGISTERED;
use crate::api::routes::users::{get_user, no_content};
use crate::api::validation::{FloatLimits, Limits, PathParams, Validator};
use crate::constants::MAX_URL_LENGTH;
use crate::controlbox::{PROMOTER_PROGRAM, PromoterProgram, PromoterTemplate};
use crate::schools::normalize_slug;

pub const POSTER_ALREADY_EXISTS: &str = "Poster with this ID already exists";
const MAX_QR_ID_LENGTH: usize = 128;
const MAX_QR_NAME_LENGTH: usize = 200;
const MAX_QR_DESCRIPTION_LENGTH: usize = 5_000;
/// The largest `filters` value, measured as compact ASCII JSON.
const MAX_QR_FILTERS_BYTES: usize = 4 * 1024;
const QR_ID_PATTERN: &str = "^[a-zA-Z0-9_-]+$";
static QR_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(QR_ID_PATTERN).expect("pattern"));
const TEMPLATE_ID_PATTERN: &str = "^[a-z0-9][a-z0-9-]*$";
static TEMPLATE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(TEMPLATE_ID_PATTERN).expect("pattern"));
/// How pydantic names the two members of the `POST /qr/` body union.
const CREATE_LABEL: &str =
    "function-after[validate_image_url(), function-after[validate_custom_url(), QrCodeCreate]]";
const BATCH_LABEL: &str = "PromoterPosterBatchCreate";

/// `_is_safe_url`: `urlparse` finds an http(s) scheme and a host.
pub fn is_safe_url(url: &str) -> bool {
    let url = url.trim_start_matches(|character: char| character <= ' ');
    let url: String = url
        .chars()
        .filter(|character| !matches!(character, '\t' | '\r' | '\n'))
        .collect();
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    let valid_scheme = scheme
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && scheme.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        });
    if !valid_scheme || !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return false;
    }
    let Some(after) = rest.strip_prefix("//") else {
        return false;
    };
    let netloc = after.split(['/', '?', '#']).next().unwrap_or_default();
    if netloc.contains('[') != netloc.contains(']') {
        // urlsplit refuses a half-bracketed IPv6 host.
        return false;
    }
    !netloc.is_empty()
}

/// The UTF-8 length of `json.dumps(value, separators=(",", ":"))`
/// (ASCII-escaped, Python float text).
pub fn compact_json_size(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(flag) => {
            if *flag {
                4
            } else {
                5
            }
        }
        Value::Number(number) => {
            if number.is_f64() {
                json::python_float(number.as_f64().unwrap_or_default()).len()
            } else {
                number.to_string().len()
            }
        }
        Value::String(text) => string_size(text),
        Value::Array(items) => {
            2 + items.iter().map(compact_json_size).sum::<usize>() + items.len().saturating_sub(1)
        }
        Value::Object(entries) => {
            2 + entries
                .iter()
                .map(|(key, item)| string_size(key) + 1 + compact_json_size(item))
                .sum::<usize>()
                + entries.len().saturating_sub(1)
        }
    }
}

fn string_size(text: &str) -> usize {
    2 + text
        .chars()
        .map(|character| match character {
            '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
            character if (character as u32) < 0x20 => 6,
            character if character.is_ascii() => 1,
            character if (character as u32) < 0x10000 => 6,
            _ => 12,
        })
        .sum::<usize>()
}

/// A poster's destination id as sent: text or a whole number.
#[derive(Debug, Clone, PartialEq)]
pub enum DestinationInput {
    Text(String),
    Integer(i64),
}

impl DestinationInput {
    /// `str(destination_id)`.
    fn text(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Integer(number) => number.to_string(),
        }
    }
}

/// The editable fields of `QrCodeCreate` and `QrCodeUpdate`.
#[derive(Debug, Clone, PartialEq)]
pub struct PosterFields {
    pub name: String,
    pub description: Option<String>,
    pub destination_type: String,
    pub destination_id: Option<DestinationInput>,
    pub filters: Option<Value>,
    pub image_url: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    pub id: String,
}

/// `destination_id: str | int | None` (pydantic's smart union).
fn read_destination(body: &mut Body) -> Option<DestinationInput> {
    let value = body.raw("destination_id").value()?;
    match &value {
        Value::String(text) => Some(DestinationInput::Text(text.clone())),
        Value::Bool(flag) => Some(DestinationInput::Integer(i64::from(*flag))),
        Value::Number(number) => match (number.as_i64(), number.as_f64()) {
            (Some(integer), _) => Some(DestinationInput::Integer(integer)),
            (None, Some(float)) if float.fract() == 0.0 && float.is_finite() => {
                Some(DestinationInput::Integer(float as i64))
            }
            _ => {
                body.nested_issue(
                    &["destination_id", "str"],
                    "string_type",
                    "Input should be a valid string",
                    &value,
                );
                body.nested_issue(
                    &["destination_id", "int"],
                    "int_from_float",
                    "Input should be a valid integer, got a number with a fractional part",
                    &value,
                );
                None
            }
        },
        _ => {
            body.nested_issue(
                &["destination_id", "str"],
                "string_type",
                "Input should be a valid string",
                &value,
            );
            body.nested_issue(
                &["destination_id", "int"],
                "int_type",
                "Input should be a valid integer",
                &value,
            );
            None
        }
    }
}

/// `filters: dict | list | None`, at most 4 KiB.
fn read_filters(body: &mut Body) -> Option<Value> {
    let value = body.raw("filters").value()?;
    if !value.is_object() && !value.is_array() {
        body.nested_issue(
            &["filters", "dict[any,any]"],
            "dict_type",
            "Input should be a valid dictionary",
            &value,
        );
        body.nested_issue(
            &["filters", "list[any]"],
            "list_type",
            "Input should be a valid list",
            &value,
        );
        return None;
    }
    if compact_json_size(&value) > MAX_QR_FILTERS_BYTES {
        body.field_error(
            "filters",
            value,
            &format!("filters exceeds maximum size of {MAX_QR_FILTERS_BYTES} bytes"),
        );
        return None;
    }
    Some(value)
}

/// `_QrCodeMutation` plus `id` (and `program` for a create), with its two
/// model validators.
fn read_poster(body: &mut Body, create: bool) -> Option<PosterFields> {
    let name = body.required_string("name", &Str::new().min(1).max(MAX_QR_NAME_LENGTH));
    let description = body.string("description", &Str::new().max(MAX_QR_DESCRIPTION_LENGTH));
    let destination_type = body.required_string(
        "destination_type",
        &Str::new().one_of(super::DESTINATION_TYPES),
    );
    let destination_id = read_destination(body);
    let filters = read_filters(body);
    let image_url = body.string("image_url", &Str::new().max(MAX_URL_LENGTH));
    let latitude = body.float_or("latitude", 0.0, FloatLimits::default().ge(-90.0).le(90.0));
    let longitude = body.float_or(
        "longitude",
        0.0,
        FloatLimits::default().ge(-180.0).le(180.0),
    );
    let id = body.required_string(
        "id",
        &Str::new()
            .min(1)
            .max(MAX_QR_ID_LENGTH)
            .pattern(QR_ID_PATTERN, &QR_ID),
    );
    if create {
        body.literal_or("program", "standard", &["standard"]);
    }
    if body.has_issues() {
        return None;
    }
    let fields = PosterFields {
        name: name?,
        description: description.value(),
        destination_type: destination_type?,
        destination_id,
        filters,
        image_url: image_url.value(),
        latitude: latitude?,
        longitude: longitude?,
        id: id?,
    };
    // validate_custom_url, then validate_image_url.
    if let Some(destination) = &fields.destination_id {
        let url = destination.text();
        if fields.destination_type == "custom-url" {
            if url.chars().count() > MAX_URL_LENGTH {
                body.model_error(&format!(
                    "custom-url destination_id exceeds {MAX_URL_LENGTH} chars"
                ));
                return None;
            }
            if !is_safe_url(&url) {
                body.model_error("custom-url destination_id must be a valid http or https URL");
                return None;
            }
        } else if url.chars().count() > MAX_URL_LENGTH {
            body.model_error(&format!("destination_id exceeds {MAX_URL_LENGTH} chars"));
            return None;
        }
    }
    if let Some(image_url) = &fields.image_url
        && !is_safe_url(image_url)
    {
        body.model_error("image_url must use http or https scheme");
        return None;
    }
    Some(fields)
}

/// `PromoterPosterBatchCreate`.
#[derive(Debug, Clone, PartialEq)]
pub struct PromoterBatch {
    pub poster_template_id: String,
    pub name: String,
    pub copies: i64,
}

fn read_batch(body: &mut Body) -> Option<PromoterBatch> {
    let program = body.required_string("program", &Str::new().one_of(&["promoter"]));
    let poster_template_id = body.required_string(
        "poster_template_id",
        &Str::new()
            .min(1)
            .max(100)
            .pattern(TEMPLATE_ID_PATTERN, &TEMPLATE_ID),
    );
    let name = body.required_string("name", &Str::new().min(1).max(MAX_QR_NAME_LENGTH));
    let copies = body.int_or("copies", 1, Limits::default().ge(1).le(1000));
    program?;
    Some(PromoterBatch {
        poster_template_id: poster_template_id?,
        name: name?,
        copies: copies?,
    })
}

/// The `POST /qr/` body.
#[derive(Debug, Clone, PartialEq)]
pub enum CreateRequest {
    Standard(PosterFields),
    Promoter(PromoterBatch),
}

/// `QrCodeCreate | PromoterPosterBatchCreate`: the first member that
/// validates, or every issue of both, each under its member's name.
pub fn read_create(value: Value) -> Result<CreateRequest, ApiError> {
    let Value::Object(object) = value else {
        let issue = |label: &str| {
            crate::api::validation::ValidationIssue::new(
                "model_attributes_type",
                vec![json!("body"), json!(label)],
                "Input should be a valid dictionary or object to extract fields from",
                value.clone(),
            )
        };
        return Err(ApiError::RequestValidation(vec![
            issue(CREATE_LABEL),
            issue(BATCH_LABEL),
        ]));
    };
    let mut standard = Body::member(object.clone(), Extra::Forbid, CREATE_LABEL);
    let fields = read_poster(&mut standard, true);
    let standard_issues = standard.into_issues();
    if standard_issues.is_empty() {
        return Ok(CreateRequest::Standard(fields.expect("valid fields")));
    }
    let mut promoter = Body::member(object, Extra::Forbid, BATCH_LABEL);
    let batch = read_batch(&mut promoter);
    let promoter_issues = promoter.into_issues();
    if promoter_issues.is_empty() {
        return Ok(CreateRequest::Promoter(batch.expect("valid batch")));
    }
    Err(ApiError::RequestValidation(
        standard_issues.into_iter().chain(promoter_issues).collect(),
    ))
}

/// `QrCodeUpdate`.
pub fn read_update(body: &mut Body) -> Option<PosterFields> {
    read_poster(body, false)
}

/// The insert or update values of a standard poster (`_build_qr_payload`):
/// a `school` inside the filters becomes the poster's school.
struct PosterPayload {
    filters: Option<Value>,
    school_id: Option<i32>,
}

async fn poster_payload(
    db: &sqlx::PgPool,
    fields: &PosterFields,
) -> Result<PosterPayload, ApiError> {
    let mut filters = fields.filters.clone();
    let mut slug = String::new();
    if let Some(Value::Object(entries)) = &mut filters {
        slug = match entries.shift_remove("school") {
            Some(Value::String(school)) => normalize_slug(&school),
            Some(value) if !truthy(&value) => String::new(),
            Some(value) => {
                return Err(anyhow::anyhow!("poster filters school is not text: {value}").into());
            }
            None => String::new(),
        };
    }
    let school_id = if slug.is_empty() {
        None
    } else {
        Some(
            school_id(db, &slug)
                .await?
                .ok_or_else(|| ApiError::validation(SCHOOL_NOT_REGISTERED))?,
        )
    };
    Ok(PosterPayload { filters, school_id })
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64() != Some(0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(entries) => !entries.is_empty(),
    }
}

/// `PromoterPosterBatchResponse`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PromoterPosterBatchResponse {
    pub posters: Vec<QrCodeResponse>,
}

/// The OpenAPI request bodies.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct QrCodeCreate {
    #[schema(min_length = 1, max_length = 200)]
    name: String,
    #[schema(max_length = 5000)]
    description: Option<String>,
    #[schema(inline)]
    destination_type: super::QrDestinationType,
    #[schema(value_type = Option<super::DestinationIdSchema>, inline)]
    destination_id: Option<String>,
    #[schema(value_type = Option<super::FiltersSchema>, inline)]
    filters: Option<Value>,
    #[schema(max_length = 2048)]
    image_url: Option<String>,
    #[schema(minimum = -90, maximum = 90, default = 0.0)]
    latitude: f64,
    #[schema(minimum = -180, maximum = 180, default = 0.0)]
    longitude: f64,
    #[schema(min_length = 1, max_length = 128, pattern = "^[a-zA-Z0-9_-]+$")]
    id: String,
    #[schema(inline)]
    program: StandardProgram,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct QrCodeUpdate {
    #[schema(min_length = 1, max_length = 200)]
    name: String,
    #[schema(max_length = 5000)]
    description: Option<String>,
    #[schema(inline)]
    destination_type: super::QrDestinationType,
    #[schema(value_type = Option<super::DestinationIdSchema>, inline)]
    destination_id: Option<String>,
    #[schema(value_type = Option<super::FiltersSchema>, inline)]
    filters: Option<Value>,
    #[schema(max_length = 2048)]
    image_url: Option<String>,
    #[schema(minimum = -90, maximum = 90, default = 0.0)]
    latitude: f64,
    #[schema(minimum = -180, maximum = 180, default = 0.0)]
    longitude: f64,
    #[schema(min_length = 1, max_length = 128, pattern = "^[a-zA-Z0-9_-]+$")]
    id: String,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct PromoterPosterBatchCreate {
    #[schema(inline)]
    program: PromoterProgramLiteral,
    #[schema(min_length = 1, max_length = 100, pattern = "^[a-z0-9][a-z0-9-]*$")]
    poster_template_id: String,
    #[schema(min_length = 1, max_length = 200)]
    name: String,
    #[schema(minimum = 1, maximum = 1000, default = 1)]
    copies: i64,
}

#[allow(dead_code)]
#[derive(ToSchema)]
#[schema(default = "standard")]
pub enum StandardProgram {
    #[serde(rename = "standard")]
    Standard,
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub enum PromoterProgramLiteral {
    #[serde(rename = "promoter")]
    Promoter,
}

#[allow(dead_code)]
#[derive(ToSchema)]
#[serde(untagged)]
pub enum CreatePosterBody {
    Standard(QrCodeCreate),
    Promoter(PromoterPosterBatchCreate),
}

#[allow(dead_code)]
#[derive(ToSchema)]
#[serde(untagged)]
pub enum CreatePosterResponse {
    Standard(Box<QrCodeResponse>),
    Promoter(PromoterPosterBatchResponse),
}

#[utoipa::path(
    post,
    path = "/qr/",
    tag = "qr",
    operation_id = "create_poster_qr__post",
    summary = "Create Poster",
    request_body = inline(CreatePosterBody),
    responses(
        (status = 201, description = "Successful Response", body = inline(CreatePosterResponse)),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn create_poster(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let DbUser(user) = DbUser::from_request_parts(&mut parts, &state).await?;
    let value: Value = crate::api::validation::parse_json_body(
        &bytes,
        crate::api::validation::json_content_type(&parts.headers),
    )?;
    let created = match read_create(value)? {
        CreateRequest::Standard(fields) => {
            require_club_owner_or_admin(&state.db, &user).await?;
            serde_json::to_value(create_standard(&state.db, &fields, &user).await?)
        }
        CreateRequest::Promoter(batch) => serde_json::to_value(PromoterPosterBatchResponse {
            posters: create_promoter_batch(
                &state.db,
                &batch,
                &user,
                &PROMOTER_PROGRAM,
                state.settings,
            )
            .await?,
        }),
    }
    .map_err(anyhow::Error::from)?;
    Ok((StatusCode::CREATED, Json(created)).into_response())
}

/// `create_qr_code`: a standard poster, refusing an id already in use.
async fn create_standard(
    db: &sqlx::PgPool,
    fields: &PosterFields,
    creator: &User,
) -> Result<QrCodeResponse, ApiError> {
    if get_qr_code(db, &fields.id).await?.is_some() {
        return Err(ApiError::conflict(POSTER_ALREADY_EXISTS));
    }
    let payload = poster_payload(db, fields).await?;
    let inserted = sqlx::query(
        "INSERT INTO public.qr_codes (id, name, description, destination_type, destination_id, \
         filters, school_id, created_by, is_active, program, image_url, latitude, longitude) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'standard', $9, $10, $11)",
    )
    .bind(&fields.id)
    .bind(&fields.name)
    .bind(&fields.description)
    .bind(&fields.destination_type)
    .bind(fields.destination_id.as_ref().map(DestinationInput::text))
    .bind(payload.filters.map(sqlx::types::Json))
    .bind(payload.school_id)
    .bind(creator.id)
    .bind(&fields.image_url)
    .bind(fields.latitude)
    .bind(fields.longitude)
    .execute(db)
    .await;
    match inserted {
        Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => {
            return Err(ApiError::conflict(POSTER_ALREADY_EXISTS));
        }
        result => {
            result?;
        }
    }
    get_qr_code(db, &fields.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Created QR code could not be reloaded").into())
}

/// `_promoter_copy_names`: "Name - i of n" for a batch, the name fitting 200 characters.
pub fn promoter_copy_names(name: &str, copies: i64) -> Vec<String> {
    if copies == 1 {
        return vec![name.to_owned()];
    }
    (1..=copies)
        .map(|index| {
            let suffix = format!(" - {index} of {copies}");
            let keep = MAX_QR_NAME_LENGTH.saturating_sub(suffix.chars().count());
            format!("{}{suffix}", name.chars().take(keep).collect::<String>())
        })
        .collect()
}

/// `_get_creation_template`.
pub fn creation_template<'a>(
    control: &'a PromoterProgram,
    template_id: &str,
    school: &str,
) -> Result<&'a PromoterTemplate, ApiError> {
    let template = control
        .approved_templates
        .iter()
        .find(|template| template.id == template_id)
        .ok_or_else(|| ApiError::validation(PROMOTER_TEMPLATE_NOT_FOUND))?;
    if !template.available_for_creation {
        return Err(ApiError::validation(PROMOTER_TEMPLATE_UNAVAILABLE));
    }
    if template.eligible_school != "global" && template.eligible_school != school {
        return Err(ApiError::validation(PROMOTER_TEMPLATE_SCHOOL_MISMATCH));
    }
    Ok(template)
}

/// `create_promoter_qr_codes`.
async fn create_promoter_batch(
    db: &sqlx::PgPool,
    batch: &PromoterBatch,
    creator: &User,
    control: &PromoterProgram,
    settings: &crate::settings::Settings,
) -> Result<Vec<QrCodeResponse>, ApiError> {
    if !control.enabled {
        return Err(ApiError::validation(PROMOTER_PROGRAM_PAUSED));
    }
    let profile = get_user(db, creator.id).await?;
    let enrolled = profile.as_ref().is_some_and(|profile| {
        profile.payout_email.is_some()
            && profile.promoter_tos_accepted_at.is_some()
            && profile.promoter_tos_version.is_some()
    });
    if !enrolled {
        return Err(ApiError::validation(PROMOTER_ENROLLMENT_REQUIRED));
    }
    let school = normalize_slug(creator.school.as_deref().unwrap_or_default());
    let school_id = school_id_by_slug(db, &school)
        .await?
        .ok_or_else(|| ApiError::validation(PROMOTER_SCHOOL_REQUIRED))?;
    if batch.copies > control.maximum_active_posters {
        return Err(ApiError::validation(PROMOTER_POSTER_LIMIT_REACHED));
    }
    let template = creation_template(control, &batch.poster_template_id, &school)?;
    let ids: Vec<String> = (0..batch.copies)
        .map(|_| Uuid::new_v4().to_string())
        .collect();
    let names = promoter_copy_names(&batch.name, batch.copies);
    let preview_url = format!(
        "{}{}",
        settings.frontend_url.trim_end_matches('/'),
        template.asset_path
    );
    let sql = format!(
        "WITH created AS (SELECT * FROM public.create_promoter_qr_codes($1, $2, $3, $4, $5, $6, $7)) \
         SELECT {} FROM created q {QR_JOINS}",
        QR_COLUMNS
    );
    let result = sqlx::query(&sql)
        .bind(&ids)
        .bind(&names)
        .bind(creator.id)
        .bind(school_id)
        .bind(&preview_url)
        .bind(&template.id)
        .bind(i32::try_from(control.maximum_active_posters).unwrap_or(i32::MAX))
        .fetch_all(db)
        .await;
    let rows = match result {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(error)) => {
            let message = error.message().to_owned();
            if error.code().as_deref() == Some("23505") {
                return Err(ApiError::conflict(POSTER_ALREADY_EXISTS));
            }
            if message.contains("promoter_poster_limit_reached") {
                return Err(ApiError::validation(PROMOTER_POSTER_LIMIT_REACHED));
            }
            if message.contains("promoter_enrollment_required") {
                return Err(ApiError::validation(PROMOTER_ENROLLMENT_REQUIRED));
            }
            if message.contains("promoter_school_required") {
                return Err(ApiError::validation(PROMOTER_SCHOOL_REQUIRED));
            }
            return Err(ApiError::Database(sqlx::Error::Database(error)));
        }
        Err(error) => return Err(error.into()),
    };
    let created: Vec<QrCodeResponse> = rows
        .iter()
        .map(QrCodeResponse::from_row)
        .collect::<anyhow::Result<_>>()?;
    if created.is_empty() {
        return Err(anyhow::anyhow!("create_promoter_qr_codes returned no rows").into());
    }
    ids.iter()
        .map(|id| {
            created
                .iter()
                .find(|poster| poster.id == *id)
                .cloned()
                .map(|mut poster| {
                    // The response names the creator's school, as Python's does.
                    poster.filters = super::with_school(poster.filters, Some(&school));
                    poster
                })
                .ok_or_else(|| {
                    anyhow::anyhow!("create_promoter_qr_codes returned incomplete rows").into()
                })
        })
        .collect()
}

/// The poster a manager may change: 404 when missing, 403 unless theirs or an admin.
async fn managed_poster(
    db: &sqlx::PgPool,
    id: &str,
    user: &User,
) -> Result<QrCodeResponse, ApiError> {
    let poster = get_qr_code(db, id).await?;
    authorized_resource(poster, POSTER_NOT_FOUND, user, |poster| {
        Uuid::parse_str(&poster.created_by).ok()
    })
}

#[utoipa::path(
    patch,
    path = "/qr/{qr_code_id}",
    tag = "qr",
    operation_id = "update_poster_qr__qr_code_id__patch",
    summary = "Update Poster",
    params(("qr_code_id" = String, Path)),
    request_body = QrCodeUpdate,
    responses(
        (status = 200, description = "Successful Response", body = QrCodeResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn update_poster(
    State(state): State<AppState>,
    path: PathParams,
    request: Request,
) -> Result<Json<QrCodeResponse>, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "qr_code_id").string(Default::default());
    update(state, id, check, request).await
}

/// `PATCH /qr/scans`, `/qr/earnings` and `/qr/map`: FastAPI reaches the
/// poster route with that word as the id once the static route refuses PATCH.
pub async fn update_static_path(
    State(state): State<AppState>,
    uri: axum::http::Uri,
    request: Request,
) -> Result<Json<QrCodeResponse>, ApiError> {
    let id = last_segment(&uri);
    update(state, id, Validator::default(), request).await
}

fn last_segment(uri: &axum::http::Uri) -> String {
    uri.path().rsplit('/').next().unwrap_or_default().to_owned()
}

async fn update(
    state: AppState,
    id: String,
    check: Validator,
    request: Request,
) -> Result<Json<QrCodeResponse>, ApiError> {
    let (mut parts, bytes) = json_first(request).await?;
    let ClubOwnerOrAdmin(user) = ClubOwnerOrAdmin::from_request_parts(&mut parts, &state).await?;
    let fields = match Body::parse(&bytes, &parts.headers, Extra::Forbid) {
        Ok(mut body) => {
            let fields = read_update(&mut body);
            merge_issues(check, body.finish())?;
            fields.expect("valid fields")
        }
        Err(error) => return Err(merge_issues::<()>(check, Err(error)).expect_err("an error")),
    };
    if fields.id != id {
        return Err(ApiError::http(StatusCode::BAD_REQUEST, ID_MISMATCH));
    }
    let existing = managed_poster(&state.db, &id, &user).await?;
    if existing.program == "promoter" {
        return Err(ApiError::validation(PROMOTER_POSTERS_CANNOT_BE_UPDATED));
    }
    let payload = poster_payload(&state.db, &fields).await?;
    sqlx::query(
        "UPDATE public.qr_codes SET id = $1, name = $2, description = $3, destination_type = $4, \
         destination_id = $5, filters = $6, school_id = $7, created_by = $8, is_active = $9, \
         program = $10, image_url = $11, latitude = $12, longitude = $13 WHERE id = $1",
    )
    .bind(&fields.id)
    .bind(&fields.name)
    .bind(&fields.description)
    .bind(&fields.destination_type)
    .bind(fields.destination_id.as_ref().map(DestinationInput::text))
    .bind(payload.filters.map(sqlx::types::Json))
    .bind(payload.school_id)
    .bind(Uuid::parse_str(&existing.created_by).map_err(anyhow::Error::from)?)
    .bind(existing.is_active)
    .bind(&existing.program)
    .bind(&fields.image_url)
    .bind(fields.latitude)
    .bind(fields.longitude)
    .execute(&state.db)
    .await?;
    let updated = get_qr_code(&state.db, &fields.id)
        .await?
        .ok_or_else(|| ApiError::not_found(POSTER_NOT_FOUND))?;
    Ok(Json(updated))
}

#[utoipa::path(
    delete,
    path = "/qr/{qr_code_id}",
    tag = "qr",
    operation_id = "delete_poster_qr__qr_code_id__delete",
    summary = "Delete Poster",
    params(("qr_code_id" = String, Path)),
    responses(
        (status = 204, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn delete_poster(
    State(state): State<AppState>,
    ClubOwnerOrAdmin(user): ClubOwnerOrAdmin,
    path: PathParams,
) -> Result<Response, ApiError> {
    let mut check = Validator::default();
    let id = check.path(&path, "qr_code_id").string(Default::default());
    check.finish()?;
    delete(&state.db, &id, &user).await
}

/// `DELETE /qr/scans`, `/qr/earnings` and `/qr/map` (see `update_static_path`).
pub async fn delete_static_path(
    State(state): State<AppState>,
    ClubOwnerOrAdmin(user): ClubOwnerOrAdmin,
    uri: axum::http::Uri,
) -> Result<Response, ApiError> {
    delete(&state.db, &last_segment(&uri), &user).await
}

async fn delete(db: &sqlx::PgPool, id: &str, user: &User) -> Result<Response, ApiError> {
    managed_poster(db, id, user).await?;
    // `delete_qr_code` reads the poster again before deleting it.
    let poster = get_qr_code(db, id)
        .await?
        .ok_or_else(|| ApiError::not_found(POSTER_NOT_FOUND))?;
    if poster.program == "promoter" {
        return Err(ApiError::validation(PROMOTER_POSTERS_CANNOT_BE_DELETED));
    }
    sqlx::query("DELETE FROM public.qr_codes WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(no_content())
}
