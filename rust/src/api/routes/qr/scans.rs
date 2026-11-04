//! Recording a poster scan (`GET /qr/{qr_code_id}`) and confirming that a
//! promoter scan reached the landing page (`POST /qr/scans/confirm`).
//!
//! Nothing identifying is stored: the visitor cookie and the client IP are
//! kept only as keyed hashes (`POSTER_HASH_SECRET`), and the user agent only
//! as broad browser and system families.

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha2::Sha256;
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{QrCodeResponse, get_qr_code};
use crate::api::AppState;
use crate::api::body::{Body, Extra, Str, json_first};
use crate::api::client_ip::{ClientIp, hash_client_ip};
use crate::api::errors::ApiError;
use crate::api::json;
use crate::api::messages::{INVALID_SCAN_CONFIRMATION, POSTER_NOT_FOUND, REQUIRES_LOCATION};
use crate::api::rate_limit::RateLimiter;
use crate::api::validation::{FloatLimits, PathParams, QueryParams, Validator};
use crate::controlbox::{PROMOTER_PROGRAM, RATE_LIMITS};
use crate::db::read_with_retry;
use crate::settings::Settings;

/// The anonymous visitor cookie.
pub const POSTER_VISITOR_COOKIE: &str = "wat2do_poster_visitor";
/// Two years.
const VISITOR_COOKIE_MAX_AGE: i64 = 60 * 60 * 24 * 365 * 2;
const MAX_VISITOR_TOKEN_LENGTH: usize = 256;
/// `core.constants.MAX_USER_AGENT_LENGTH`.
const MAX_USER_AGENT_LENGTH: usize = 512;
const CONFIRMATION_TOKEN_VERSION: &str = "1";

/// The scan limiter, keyed by the hashed client IP so raw IPs stay out of logs.
static SCANS: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(RATE_LIMITS.qr_scans));

/// HMAC-SHA256 of `domain:value`, as lower-case hex.
fn keyed_hash(domain: &str, value: &str, secret: &str) -> Result<String, ApiError> {
    if secret.is_empty() {
        return Err(anyhow::anyhow!("POSTER_HASH_SECRET is required for QR scan recording").into());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC takes any key");
    mac.update(format!("{domain}:{value}").as_bytes());
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// `hash_visitor_token`.
pub fn hash_visitor_token(token: &str, settings: &Settings) -> Result<String, ApiError> {
    keyed_hash("visitor:v1", token, &settings.poster_hash_secret)
}

fn encode_token(value: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value)
}

/// `base64.urlsafe_b64decode` after re-padding: characters outside the
/// alphabet are ignored, as Python's non-strict decoder ignores them.
fn decode_token(value: &str) -> Option<Vec<u8>> {
    let cleaned: String = value
        .chars()
        .map(|character| match character {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '+' | '/'))
        .collect();
    if cleaned.len() % 4 == 1 {
        return None;
    }
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone)
            .with_decode_allow_trailing_bits(true),
    );
    engine.decode(cleaned).ok()
}

fn confirmation_secret(settings: &Settings, purpose: &str) -> Result<Vec<u8>, ApiError> {
    if settings.poster_confirmation_secret.is_empty() {
        return Err(anyhow::anyhow!("POSTER_CONFIRMATION_SECRET is required for {purpose}").into());
    }
    Ok(settings.poster_confirmation_secret.as_bytes().to_vec())
}

fn sign(secret: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC takes any key");
    mac.update(payload);
    mac.finalize().into_bytes().to_vec()
}

/// Seconds since the epoch as Python's float `timestamp()`.
fn timestamp(value: DateTime<Utc>) -> f64 {
    value.timestamp() as f64 + f64::from(value.timestamp_subsec_micros()) / 1e6
}

/// `create_scan_confirmation_token`: signed, usable from
/// `landing_confirmation_seconds` after the scan until
/// `confirmation_token_minutes` after it.
pub fn create_confirmation_token(
    scan_id: Uuid,
    now: DateTime<Utc>,
    settings: &Settings,
) -> Result<String, ApiError> {
    let secret = confirmation_secret(settings, "promoter scans")?;
    let not_before = now + chrono::Duration::seconds(PROMOTER_PROGRAM.landing_confirmation_seconds);
    let expires = now + chrono::Duration::minutes(PROMOTER_PROGRAM.confirmation_token_minutes);
    let payload = format!(
        "{CONFIRMATION_TOKEN_VERSION}:{scan_id}:{}:{}",
        timestamp(not_before).ceil() as i64,
        timestamp(expires).floor() as i64
    );
    let signature = sign(&secret, payload.as_bytes());
    Ok(format!(
        "{}.{}",
        encode_token(payload.as_bytes()),
        encode_token(&signature)
    ))
}

/// Python's `int(text)`: surrounding whitespace, a sign and single
/// underscores between digits.
fn python_int(text: &str) -> Option<i64> {
    let text = text.trim();
    let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'_')
    {
        return None;
    }
    text.replace('_', "").parse().ok()
}

/// `verify_scan_confirmation_token`: the scan id of a valid, current token.
pub fn verify_confirmation_token(
    token: &str,
    now: DateTime<Utc>,
    settings: &Settings,
) -> Result<Option<Uuid>, ApiError> {
    let secret = confirmation_secret(settings, "scan confirmation")?;
    let Some((encoded_payload, encoded_signature)) = token.split_once('.') else {
        return Ok(None);
    };
    let (Some(payload), Some(signature)) = (
        decode_token(encoded_payload),
        decode_token(encoded_signature),
    ) else {
        return Ok(None);
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret).expect("HMAC takes any key");
    mac.update(&payload);
    if mac.verify_slice(&signature).is_err() {
        return Ok(None);
    }
    let Ok(payload) = String::from_utf8(payload) else {
        return Ok(None);
    };
    let parts: Vec<&str> = payload.splitn(4, ':').collect();
    let [version, scan_id, not_before, expires] = parts.as_slice() else {
        return Ok(None);
    };
    if *version != CONFIRMATION_TOKEN_VERSION {
        return Ok(None);
    }
    let (Ok(scan_id), Some(not_before), Some(expires)) = (
        Uuid::parse_str(scan_id),
        python_int(not_before),
        python_int(expires),
    ) else {
        return Ok(None);
    };
    let now = timestamp(now);
    if now < not_before as f64 || now > expires as f64 {
        return Ok(None);
    }
    Ok(Some(scan_id))
}

/// `parse_user_agent`: only broad browser and system families are kept.
pub fn parse_user_agent(user_agent: Option<&str>) -> (Option<&'static str>, Option<&'static str>) {
    let Some(user_agent) = user_agent.filter(|agent| !agent.is_empty()) else {
        return (None, None);
    };
    let normalized = user_agent.to_lowercase();
    let has = |needle: &str| normalized.contains(needle);
    let browser = if has("edg/") {
        "Edge"
    } else if has("opr/") || has("opera") {
        "Opera"
    } else if has("chrome/") || has("crios/") {
        "Chrome"
    } else if has("firefox/") || has("fxios/") {
        "Firefox"
    } else if has("safari/") {
        "Safari"
    } else {
        "Other"
    };
    let system = if has("android") {
        "Android"
    } else if has("iphone") || has("ipad") || has("ios") {
        "iOS"
    } else if has("windows") {
        "Windows"
    } else if has("mac os") || has("macintosh") {
        "macOS"
    } else if has("linux") {
        "Linux"
    } else {
        "Other"
    };
    (Some(browser), Some(system))
}

/// `http.cookies._unquote`: a quoted cookie value with its escapes undone.
fn unquote(value: &str) -> String {
    let Some(inner) = value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .filter(|_| value.len() >= 2)
    else {
        return value.to_owned();
    };
    let bytes = inner.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' && index + 1 < bytes.len() {
            let octal = &bytes[index + 1..(index + 4).min(bytes.len())];
            if octal.len() == 3
                && octal
                    .iter()
                    .all(|byte| (b'0'..=b'3').contains(&octal[0]) && (b'0'..=b'7').contains(byte))
            {
                out.push((octal[0] - b'0') * 64 + (octal[1] - b'0') * 8 + (octal[2] - b'0'));
                index += 4;
            } else {
                out.push(bytes[index + 1]);
                index += 2;
            }
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Starlette's `cookie_parser`: the named cookie, the last one if repeated.
pub fn request_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut found = None;
    for header in headers.get_all(header::COOKIE) {
        let text: String = header.as_bytes().iter().map(|byte| *byte as char).collect();
        for chunk in text.split(';') {
            let (key, value) = chunk.split_once('=').unwrap_or(("", chunk));
            let (key, value) = (key.trim(), value.trim());
            if key == name {
                found = Some(unquote(value));
            }
        }
    }
    found
}

/// A usable visitor token from the request: present and at most 256 characters.
fn visitor_token(headers: &HeaderMap) -> Option<String> {
    request_cookie(headers, POSTER_VISITOR_COOKIE)
        .filter(|token| !token.is_empty() && token.chars().count() <= MAX_VISITOR_TOKEN_LENGTH)
}

/// `secrets.token_urlsafe(32)`: 32 bytes from the operating system's
/// cryptographic random source.
fn new_visitor_token() -> String {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system random source is available");
    encode_token(&bytes)
}

/// Starlette's `set_cookie` for the visitor token.
fn visitor_cookie(token: &str, settings: &Settings) -> String {
    let mut cookie = format!("{POSTER_VISITOR_COOKIE}={token}");
    if !settings.cookie_domain.is_empty() {
        cookie.push_str(&format!("; Domain={}", settings.cookie_domain));
    }
    cookie.push_str(&format!(
        "; HttpOnly; Max-Age={VISITOR_COOKIE_MAX_AGE}; Path={}; SameSite=lax",
        settings.poster_visitor_cookie_path
    ));
    if settings.cookie_secure || settings.is_production() {
        cookie.push_str("; Secure");
    }
    cookie
}

/// A redirect's destination id: an event's id as a number, anything else as text.
#[derive(Debug, Clone, PartialEq)]
pub enum DestinationId {
    Text(String),
    /// Python's `int(text)`, as its decimal digits.
    Integer(String),
}

impl Serialize for DestinationId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => serializer.serialize_str(text),
            Self::Integer(digits) => serde_json::value::RawValue::from_string(digits.clone())
                .map_err(serde::ser::Error::custom)?
                .serialize(serializer),
        }
    }
}

/// Python's `int(text)` as canonical digits (any size), or `None`.
fn integer_digits(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let (negative, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits
            .chars()
            .all(|character| character.is_ascii_digit() || character == '_')
    {
        return None;
    }
    let digits = digits.replace('_', "");
    let digits = digits.trim_start_matches('0');
    Some(match (digits.is_empty(), negative) {
        (true, _) => "0".to_owned(),
        (false, true) => format!("-{digits}"),
        (false, false) => digits.to_owned(),
    })
}

/// `_coerce_destination_id`.
fn destination_id(poster: &QrCodeResponse) -> Option<DestinationId> {
    let id = poster.destination_id.as_ref()?;
    if poster.destination_type == "event" {
        match integer_digits(id) {
            Some(digits) => return Some(DestinationId::Integer(digits)),
            None => tracing::warn!(
                "QR {} has non-integer destination_id for event type: invalid literal for int() with base 10: {:?}",
                poster.id,
                id
            ),
        }
    }
    Some(DestinationId::Text(id.clone()))
}

/// `QrCodeRedirect`: where a scan goes; the scan itself is recorded server-side.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct QrCodeRedirect {
    #[schema(value_type = super::QrDestinationType, inline)]
    pub destination_type: String,
    #[schema(value_type = Option<super::DestinationIdSchema>, inline)]
    pub destination_id: Option<DestinationId>,
    #[schema(value_type = Option<super::FiltersSchema>, inline)]
    #[serde(serialize_with = "json::option_value")]
    pub filters: Option<Value>,
    #[schema(value_type = Option<std::collections::HashMap<String, String>>)]
    pub query_params: Option<Value>,
    pub scan_confirmation_token: Option<String>,
}

/// `build_redirect`: promoter scans carry the poster id for attribution.
pub fn build_redirect(
    poster: &QrCodeResponse,
    confirmation_token: Option<String>,
) -> QrCodeRedirect {
    let query_params = (poster.program == "promoter")
        .then(|| serde_json::json!({"utm_source": "poster", "poster_id": poster.id}));
    QrCodeRedirect {
        destination_type: poster.destination_type.clone(),
        destination_id: destination_id(poster),
        filters: poster.filters.clone(),
        query_params,
        scan_confirmation_token: confirmation_token,
    }
}

/// What `handle_scan` decided before writing anything.
#[derive(Debug, Clone, PartialEq)]
pub enum ScanPlan {
    /// An archived poster still redirects, but records nothing.
    RedirectOnly,
    /// Record a scan with these coordinates (a promoter poster that is
    /// already placed cannot be moved by a scan).
    Record {
        latitude: Option<f64>,
        longitude: Option<f64>,
    },
}

/// The location rules of `handle_scan`: a standard poster's first scan and
/// an unplaced promoter poster's scans must send a location.
pub fn plan_scan(
    poster: &QrCodeResponse,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<ScanPlan, ApiError> {
    if !poster.is_active {
        return Ok(ScanPlan::RedirectOnly);
    }
    let promoter = poster.program == "promoter";
    let unplaced = promoter && poster.latitude == 0.0 && poster.longitude == 0.0;
    let needs_location = (poster.program == "standard" && poster.latest_scan.is_none()) || unplaced;
    if needs_location && (latitude.is_none() || longitude.is_none()) {
        return Err(ApiError::validation(REQUIRES_LOCATION));
    }
    if promoter && !unplaced {
        return Ok(ScanPlan::Record {
            latitude: None,
            longitude: None,
        });
    }
    Ok(ScanPlan::Record {
        latitude,
        longitude,
    })
}

/// `record_scan` through the transactional `record_qr_scan`: `None` when
/// the poster was archived meanwhile.
async fn record_scan(
    db: &sqlx::PgPool,
    poster_id: &str,
    dedupe_hash: &str,
    ip_hash: &str,
    families: (Option<&str>, Option<&str>),
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<Option<Uuid>, ApiError> {
    let result = sqlx::query(
        "SELECT id FROM public.record_qr_scan($1::uuid, $2::varchar, $3::text, $4::text, \
         $5::varchar, $6::varchar, NULL::bigint, NULL::varchar, $7::float8, $8::float8)",
    )
    .bind(Uuid::new_v4())
    .bind(poster_id)
    .bind(dedupe_hash)
    .bind(ip_hash)
    .bind(families.0)
    .bind(families.1)
    .bind(latitude)
    .bind(longitude)
    .fetch_optional(db)
    .await;
    match result {
        Ok(Some(row)) => Ok(Some(row.try_get("id")?)),
        Ok(None) => Err(anyhow::anyhow!("record_qr_scan returned no row").into()),
        Err(sqlx::Error::Database(error)) if error.message().contains("qr_code_archived") => {
            Ok(None)
        }
        Err(sqlx::Error::Database(error)) if error.message().contains("qr_code_not_found") => {
            Err(ApiError::not_found(POSTER_NOT_FOUND))
        }
        Err(sqlx::Error::Database(error)) if error.message().contains("requires_location") => {
            Err(ApiError::validation(REQUIRES_LOCATION))
        }
        Err(error) => Err(error.into()),
    }
}

/// The request's `User-Agent`, as Starlette decodes it (Latin-1), at most 512 characters.
fn user_agent(headers: &HeaderMap) -> Option<String> {
    let header = headers.get(header::USER_AGENT)?;
    let text: String = header.as_bytes().iter().map(|byte| *byte as char).collect();
    Some(text.chars().take(MAX_USER_AGENT_LENGTH).collect())
}

#[utoipa::path(
    get,
    path = "/qr/{qr_code_id}",
    tag = "qr",
    operation_id = "resolve_qr_and_record_scan_qr__qr_code_id__get",
    summary = "Resolve Qr And Record Scan",
    params(
        ("qr_code_id" = String, Path),
        ("lat" = Option<f64>, Query, nullable, minimum = -90, maximum = 90),
        ("lon" = Option<f64>, Query, nullable, minimum = -180, maximum = 180),
    ),
    responses(
        (status = 200, description = "Successful Response", body = QrCodeRedirect),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn resolve_qr_and_record_scan(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    path: PathParams,
    query: QueryParams,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let settings = state.settings;
    // The limiter is a dependency, so it counts before parameters are checked.
    let ip_hash = hash_client_ip(&client_ip, &settings.poster_hash_secret)?;
    SCANS.check(&ip_hash)?;
    let mut check = Validator::default();
    let qr_code_id = check.path(&path, "qr_code_id").string(Default::default());
    let latitude = check
        .query(&query, "lat")
        .optional_float(FloatLimits::default().ge(-90.0).le(90.0));
    let longitude = check
        .query(&query, "lon")
        .optional_float(FloatLimits::default().ge(-180.0).le(180.0));
    check.finish()?;

    let existing_token = visitor_token(&headers);
    let new_token = existing_token.is_none().then(new_visitor_token);
    let token = existing_token
        .or_else(|| new_token.clone())
        .expect("a token");

    let poster = get_qr_code(&state.db, &qr_code_id)
        .await?
        .ok_or_else(|| ApiError::not_found(POSTER_NOT_FOUND))?;
    let redirect = match plan_scan(&poster, latitude, longitude)? {
        ScanPlan::RedirectOnly => build_redirect(&poster, None),
        ScanPlan::Record {
            latitude,
            longitude,
        } => {
            let agent = user_agent(&headers);
            let recorded = record_scan(
                &state.db,
                &poster.id,
                &hash_visitor_token(&token, settings)?,
                &ip_hash,
                parse_user_agent(agent.as_deref()),
                latitude,
                longitude,
            )
            .await?;
            match recorded {
                Some(scan_id) if poster.program == "promoter" => {
                    let token = create_confirmation_token(scan_id, Utc::now(), settings)?;
                    build_redirect(&poster, Some(token))
                }
                _ => build_redirect(&poster, None),
            }
        }
    };
    let mut response = Json(redirect).into_response();
    if let Some(token) = new_token {
        let cookie = HeaderValue::from_str(&visitor_cookie(&token, settings))
            .map_err(|error| anyhow::anyhow!("visitor cookie: {error}"))?;
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    Ok(response)
}

/// `QrScanConfirmResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct QrScanConfirmResponse {
    pub confirmed: bool,
    #[schema(value_type = String, format = DateTime)]
    #[serde(serialize_with = "json::datetime")]
    pub landing_confirmed_at: DateTime<Utc>,
}

/// The OpenAPI request body.
#[allow(dead_code)]
#[derive(ToSchema)]
pub struct QrScanConfirmRequest {
    #[schema(min_length = 1, max_length = 2048)]
    token: String,
}

#[utoipa::path(
    post,
    path = "/qr/scans/confirm",
    tag = "qr",
    operation_id = "confirm_scan_qr_scans_confirm_post",
    summary = "Confirm Scan",
    request_body = QrScanConfirmRequest,
    responses(
        (status = 200, description = "Successful Response", body = QrScanConfirmResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn confirm_scan(
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<QrScanConfirmResponse>, ApiError> {
    let (parts, bytes) = json_first(request).await?;
    let mut body = Body::parse(&bytes, &parts.headers, Extra::Forbid)?;
    let token = body.required_string("token", &Str::new().min(1).max(2048));
    body.finish()?;
    let token = token.unwrap_or_default();
    let visitor = visitor_token(&parts.headers)
        .ok_or_else(|| ApiError::validation(INVALID_SCAN_CONFIRMATION))?;
    let scan_id = verify_confirmation_token(&token, Utc::now(), state.settings)?
        .ok_or_else(|| ApiError::validation(INVALID_SCAN_CONFIRMATION))?;
    let dedupe_hash = hash_visitor_token(&visitor, state.settings)?;
    let confirmed_at = confirm_landing(&state.db, scan_id, &dedupe_hash).await?;
    Ok(Json(QrScanConfirmResponse {
        confirmed: true,
        landing_confirmed_at: confirmed_at,
    }))
}

/// `confirm_scan`: the scan must belong to this visitor; the first
/// confirmation time is kept (a repeat or a race returns it unchanged).
async fn confirm_landing(
    db: &sqlx::PgPool,
    scan_id: Uuid,
    dedupe_hash: &str,
) -> Result<DateTime<Utc>, ApiError> {
    let existing = read_with_retry(|| {
        sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT landing_confirmed_at FROM public.qr_code_scans \
             WHERE id = $1 AND dedupe_hash = $2",
        )
        .bind(scan_id)
        .bind(dedupe_hash)
        .fetch_optional(db)
    })
    .await?
    .ok_or_else(|| ApiError::validation(INVALID_SCAN_CONFIRMATION))?;
    if let Some(confirmed_at) = existing {
        return Ok(confirmed_at);
    }
    let updated = sqlx::query_scalar::<_, DateTime<Utc>>(
        "UPDATE public.qr_code_scans SET landing_confirmed_at = $2 \
         WHERE id = $1 AND landing_confirmed_at IS NULL RETURNING landing_confirmed_at",
    )
    .bind(scan_id)
    .bind(Utc::now())
    .fetch_optional(db)
    .await?;
    if let Some(confirmed_at) = updated {
        return Ok(confirmed_at);
    }
    read_with_retry(|| {
        sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT landing_confirmed_at FROM public.qr_code_scans WHERE id = $1",
        )
        .bind(scan_id)
        .fetch_optional(db)
    })
    .await?
    .flatten()
    .ok_or_else(|| ApiError::validation(INVALID_SCAN_CONFIRMATION))
}

#[cfg(test)]
mod tests;
