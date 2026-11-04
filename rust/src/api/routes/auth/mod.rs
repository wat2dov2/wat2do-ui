//! `/auth`: passwordless (code or link) and Google sign-in, refresh and
//! logout (`routers/auth.py`, `services/auth_service.py`), on our own access
//! tokens (`api::auth::AccessTokens`) and `auth_sessions`.
//!
//! The long-lived refresh token only ever travels in an `HttpOnly` cookie
//! scoped to the refresh endpoint; every cookie, redirect and error body is
//! written exactly as the FastAPI router wrote it.

mod google;
mod session;

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE;
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::body::{Body, Extra, Str};
use crate::api::client_ip::ClientIp;
use crate::api::cookies::{self, Cookie};
use crate::api::errors::ApiError;
use crate::api::messages::NO_REFRESH_TOKEN;
use crate::api::rate_limit::RateLimiter;
use crate::api::routing::redirect;
use crate::api::validation::{Length, QueryParams, Validator};
use crate::constants::MAX_URL_LENGTH;
use crate::controlbox::{AUTHENTICATION, RATE_LIMITS};
use crate::settings::Settings;
use crate::urls::{Split, unquote_fully, urlencode, urlparse};
use session::{SignedIn, TokenResponse};

/// Code and link requests (and Google sign-in starts) share one budget, so a
/// burst of either cannot become an email bomb; verification has its own.
static SEND_OTP_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.sensitive_authentication));
static VERIFY_OTP_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.sensitive_authentication));
/// More generous: legitimate clients refresh often.
static REFRESH_LIMITER: LazyLock<RateLimiter> =
    LazyLock::new(|| RateLimiter::new(RATE_LIMITS.token_refresh));

const REFRESH_COOKIE: &str = "refresh_token";
const GOOGLE_OAUTH_STATE_COOKIE: &str = "google_oauth_state";
const GOOGLE_OAUTH_STATE_MAX_AGE: i64 = 10 * 60;
const GOOGLE_OAUTH_CALLBACK_PATH: &str = "/api/auth/google/callback";
const UNSAFE_RETURN_TO: &str = "return_to must be a safe relative application path";
const INVALID_CALLBACK_URL: &str = "Invalid Google OAuth callback URL";

// `MessageResponse`.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageResponse {
    pub message: String,
}

impl MessageResponse {
    pub fn json(message: &str) -> Json<Self> {
        Json(Self {
            message: message.to_owned(),
        })
    }
}

/// A header as Starlette reads it: latin-1, or `None` when absent.
fn header_text(headers: &HeaderMap, name: header::HeaderName) -> Option<String> {
    headers.get(name).map(|value| {
        value
            .as_bytes()
            .iter()
            .map(|byte| char::from(*byte))
            .collect()
    })
}

/// `urlparse(url)`; its `ValueError` was uncaught in Python (a 500).
fn parse_url(url: &str) -> Result<(Split, String), ApiError> {
    urlparse(url).map_err(|error| ApiError::Internal(anyhow::anyhow!("ValueError: {error}")))
}

/// `validate_safe_return_to`: a path inside the app, after every layer of
/// percent-encoding is removed (the decoded path is what is kept).
fn safe_return_to(value: &str) -> Option<String> {
    let decoded = unquote_fully(value);
    let safe = decoded.starts_with('/')
        && !decoded.starts_with("//")
        && !decoded.contains('\\')
        && !decoded.chars().any(char::is_control);
    safe.then_some(decoded)
}

/// `_refresh_cookie_domain`: host-only for the retired frontend, which
/// proxies auth, else the configured shared domain.
fn cookie_domain<'a>(settings: &'a Settings, headers: &HeaderMap) -> Option<&'a str> {
    let origin = header_text(headers, header::ORIGIN).unwrap_or_default();
    let origin = origin.trim_end_matches('/');
    if AUTHENTICATION
        .legacy_frontend_origins
        .iter()
        .any(|legacy| legacy.trim_end_matches('/') == origin)
    {
        return None;
    }
    Some(settings.cookie_domain.as_str()).filter(|domain| !domain.is_empty())
}

/// Secure whenever configured, and always in production.
fn secure_cookies(settings: &Settings) -> bool {
    settings.cookie_secure || settings.is_production()
}

/// `_set_refresh_cookie`.
fn set_refresh_cookie(
    response: &mut Response,
    settings: &Settings,
    headers: &HeaderMap,
    token: &str,
) {
    let max_age = AUTHENTICATION.session_cookie_days * 24 * 3600;
    cookies::set(
        response.headers_mut(),
        &Cookie {
            max_age: Some(max_age),
            expires_in: Some(max_age),
            path: &settings.refresh_cookie_path,
            domain: cookie_domain(settings, headers),
            secure: secure_cookies(settings),
            http_only: true,
            ..Cookie::new(REFRESH_COOKIE, token)
        },
    );
}

/// `_clear_refresh_cookie`: must name the same path and domain it was set with.
fn clear_refresh_cookie(response: &mut Response, settings: &Settings, headers: &HeaderMap) {
    cookies::delete(
        response.headers_mut(),
        REFRESH_COOKIE,
        &settings.refresh_cookie_path,
        cookie_domain(settings, headers),
    );
}

fn clear_google_state_cookie(response: &mut Response, settings: &Settings, headers: &HeaderMap) {
    cookies::delete(
        response.headers_mut(),
        GOOGLE_OAUTH_STATE_COOKIE,
        GOOGLE_OAUTH_CALLBACK_PATH,
        cookie_domain(settings, headers),
    );
}

/// The signed-in body, with the rotated refresh token in its cookie.
fn signed_in_response(signed_in: SignedIn, settings: &Settings, headers: &HeaderMap) -> Response {
    let mut response = Json(signed_in.body).into_response();
    if !signed_in.refresh_token.is_empty() {
        set_refresh_cookie(&mut response, settings, headers, &signed_in.refresh_token);
    }
    response
}

/// `_validate_google_callback_url`: our own callback page on a trusted
/// origin, with nothing else in the URL. `Ok(Err(_))` is the 422.
fn validate_callback_url(
    settings: &Settings,
    callback_url: &str,
) -> Result<Result<(), ApiError>, ApiError> {
    let (parsed, params) = parse_url(callback_url)?;
    let origin = parsed.origin().unwrap_or_default();
    let valid = matches!(parsed.scheme.as_str(), "http" | "https")
        && settings.is_allowed_origin(Some(&origin))
        && parsed.path == GOOGLE_OAUTH_CALLBACK_PATH
        && params.is_empty()
        && parsed.query.is_empty()
        && parsed.fragment.is_empty();
    Ok(if valid {
        Ok(())
    } else {
        Err(ApiError::http(
            StatusCode::UNPROCESSABLE_ENTITY,
            INVALID_CALLBACK_URL,
        ))
    })
}

/// `_google_redirect_uri`: the one callback registered with Google; it sends
/// people back to their school's site after.
fn google_redirect_uri(settings: &Settings) -> String {
    format!(
        "{}{GOOGLE_OAUTH_CALLBACK_PATH}",
        settings.frontend_url.trim_end_matches('/')
    )
}

/// What the state cookie carries between the start and the callback.
#[derive(Debug, PartialEq)]
struct OAuthState {
    code_verifier: String,
    /// The `state` Google must echo back.
    state: String,
    callback_url: String,
    return_to: Option<String>,
}

/// `json.dumps(value)`'s string: non-ASCII written as `\uXXXX`.
fn ascii_json(text: &str) -> String {
    let encoded = serde_json::to_string(text).expect("a string serializes");
    let mut out = String::with_capacity(encoded.len());
    for character in encoded.chars() {
        if character.is_ascii() && character != '\u{7f}' {
            out.push(character);
        } else {
            let mut units = [0u16; 2];
            for unit in character.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

/// `_encode_google_oauth_state`: compact JSON in padded base64url.
fn encode_state(state: &OAuthState) -> String {
    let return_to = state
        .return_to
        .as_deref()
        .map_or_else(|| "null".to_owned(), ascii_json);
    let raw = format!(
        r#"{{"code_verifier":{},"state":{},"callback_url":{},"return_to":{return_to}}}"#,
        ascii_json(&state.code_verifier),
        ascii_json(&state.state),
        ascii_json(&state.callback_url),
    );
    URL_SAFE.encode(raw)
}

/// `binascii.a2b_base64` without strict mode, as `urlsafe_b64decode` uses
/// it: characters outside the alphabet are skipped and decoding stops at
/// complete padding.
fn python_b64decode(text: &str) -> Option<Vec<u8>> {
    let value = |byte: u8| match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    };
    let (mut out, mut quad, mut pads, mut left) = (Vec::new(), 0, 0, 0u32);
    for byte in text.bytes() {
        if byte == b'=' {
            if quad >= 2 {
                pads += 1;
                if quad + pads >= 4 {
                    return Some(out);
                }
            }
            continue;
        }
        let Some(bits) = value(byte) else { continue };
        let bits = u32::from(bits);
        pads = 0;
        match quad {
            0 => left = bits,
            1 => {
                out.push(((left << 2) | (bits >> 4)) as u8);
                left = bits & 0x0f;
            }
            2 => {
                out.push(((left << 4) | (bits >> 2)) as u8);
                left = bits & 0x03;
            }
            _ => out.push(((left << 6) | bits) as u8),
        }
        quad = (quad + 1) % 4;
    }
    (quad == 0).then_some(out)
}

/// `_decode_google_oauth_state`: `None` for anything we did not write.
fn decode_state(value: Option<&str>) -> Option<OAuthState> {
    let value = value.filter(|value| !value.is_empty() && value.is_ascii())?;
    let raw = python_b64decode(value)?;
    let payload: Value = serde_json::from_slice(&raw).ok()?;
    let payload = payload.as_object()?;
    let text = |name: &str| payload.get(name).and_then(Value::as_str).map(str::to_owned);
    let return_to = match payload.get("return_to") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(_) => return None,
    };
    Some(OAuthState {
        code_verifier: text("code_verifier")?,
        state: text("state")?,
        callback_url: text("callback_url")?,
        return_to,
    })
}

/// `_oauth_frontend_url`: a page on the callback's own origin.
fn frontend_page(
    callback_url: &str,
    path: &str,
    params: &[(&str, &str)],
) -> Result<String, ApiError> {
    let (parsed, _) = parse_url(callback_url)?;
    let query = if params.is_empty() {
        String::new()
    } else {
        format!("?{}", urlencode(params))
    };
    Ok(format!(
        "{}://{}{path}{query}",
        parsed.scheme, parsed.netloc
    ))
}

/// `_request_school`: the campus whose site sent the request.
async fn request_school(state: &AppState, headers: &HeaderMap) -> Result<Option<String>, ApiError> {
    let source = [header::ORIGIN, header::REFERER]
        .into_iter()
        .filter_map(|name| header_text(headers, name))
        .find(|value| !value.is_empty())
        .unwrap_or_default();
    session::school_from_frontend_url(&state.db, state.settings, &source).await
}

#[utoipa::path(
    get,
    path = "/auth/google",
    tag = "auth",
    operation_id = "start_google_oauth_auth_google_get",
    summary = "Start Google Oauth",
    params(
        ("callback_url" = String, Query, max_length = 2048),
        ("return_to" = Option<String>, Query, nullable, max_length = 2048),
    ),
    responses(
        (status = 307, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn start_google_oauth(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    query: QueryParams,
) -> Result<Response, ApiError> {
    SEND_OTP_LIMITER.check(&client_ip)?;
    let mut check = Validator::default();
    let callback_url = check
        .query(&query, "callback_url")
        .string(Length::default().max(MAX_URL_LENGTH));
    let return_to = check
        .query(&query, "return_to")
        .optional_string(Length::default().max(MAX_URL_LENGTH));
    check.finish()?;
    let settings = state.settings;
    validate_callback_url(settings, &callback_url)??;
    let return_to =
        match return_to {
            Some(value) => Some(safe_return_to(&value).ok_or_else(|| {
                ApiError::http(StatusCode::UNPROCESSABLE_ENTITY, UNSAFE_RETURN_TO)
            })?),
            None => None,
        };
    let start = google::prepare(&google_redirect_uri(settings));
    let cookie_value = encode_state(&OAuthState {
        code_verifier: start.code_verifier,
        state: start.state,
        callback_url,
        return_to,
    });
    let mut response = redirect(StatusCode::FOUND, &start.authorization_url);
    cookies::set(
        response.headers_mut(),
        &Cookie {
            max_age: Some(GOOGLE_OAUTH_STATE_MAX_AGE),
            path: GOOGLE_OAUTH_CALLBACK_PATH,
            domain: cookie_domain(settings, &headers),
            secure: secure_cookies(settings),
            http_only: true,
            ..Cookie::new(GOOGLE_OAUTH_STATE_COOKIE, &cookie_value)
        },
    );
    Ok(response)
}

/// Whether Python's callback caught the error (`ServiceError` and its subclasses).
fn is_service_error(error: &ApiError) -> bool {
    matches!(
        error,
        ApiError::NotFound(_)
            | ApiError::Authentication(_)
            | ApiError::Authorization(_)
            | ApiError::Conflict(_)
            | ApiError::Validation { .. }
            | ApiError::Service { .. }
    )
}

#[utoipa::path(
    get,
    path = "/auth/google/callback",
    tag = "auth",
    operation_id = "complete_google_oauth_auth_google_callback_get",
    summary = "Complete Google Oauth",
    params(
        ("code" = Option<String>, Query, nullable, max_length = 2048),
        ("state" = Option<String>, Query, nullable, max_length = 2048),
        ("error" = Option<String>, Query, nullable, max_length = 255),
    ),
    responses(
        (status = 307, description = "Successful Response"),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn complete_google_oauth(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    query: QueryParams,
) -> Result<Response, ApiError> {
    VERIFY_OTP_LIMITER.check(&client_ip)?;
    let mut check = Validator::default();
    let code = check
        .query(&query, "code")
        .optional_string(Length::default().max(MAX_URL_LENGTH));
    let returned_state = check
        .query(&query, "state")
        .optional_string(Length::default().max(MAX_URL_LENGTH));
    let error = check
        .query(&query, "error")
        .optional_string(Length::default().max(255));
    check.finish()?;
    let settings = state.settings;
    let cookies = cookies::read(&headers);
    let mut payload = decode_state(cookies.get(GOOGLE_OAUTH_STATE_COOKIE).map(String::as_str));
    // Google echoes the state we sent; anything else is a forged or stale callback.
    if let Some(sent) = &payload {
        let returned = returned_state.as_deref().unwrap_or_default();
        if aws_lc_rs::constant_time::verify_slices_are_equal(
            returned.as_bytes(),
            sent.state.as_bytes(),
        )
        .is_err()
        {
            payload = None;
        }
    }
    let fallback = google_redirect_uri(settings);
    let mut callback_url = payload
        .as_ref()
        .map_or_else(|| fallback.clone(), |payload| payload.callback_url.clone());
    if validate_callback_url(settings, &callback_url)?.is_err() {
        callback_url = fallback;
        payload = None;
    }
    let login_error = |callback_url: &str| -> Result<Response, ApiError> {
        let location = frontend_page(callback_url, "/login", &[("oauthError", "google")])?;
        let mut response = redirect(StatusCode::SEE_OTHER, &location);
        clear_google_state_cookie(&mut response, settings, &headers);
        Ok(response)
    };
    let code = code.filter(|code| !code.is_empty());
    let (Some(code), Some(payload), true) =
        (code, payload, error.is_none_or(|error| error.is_empty()))
    else {
        return login_error(&callback_url);
    };
    let signed_in = match session::verify_google_oauth(
        &state.db,
        settings,
        &state.auth,
        &code,
        &payload.code_verifier,
        &google_redirect_uri(settings),
        &callback_url,
    )
    .await
    {
        Ok(signed_in) => signed_in,
        Err(error) if is_service_error(&error) => return login_error(&callback_url),
        Err(error) => return Err(error),
    };
    let school = signed_in.body.school.clone().unwrap_or_default();
    let onboarding = if signed_in.body.onboarding_required {
        "true"
    } else {
        "false"
    };
    let mut params = vec![
        ("oauth", "google"),
        ("school", school.as_str()),
        ("onboardingRequired", onboarding),
    ];
    if let Some(return_to) = payload
        .return_to
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        params.push(("returnTo", return_to));
    }
    let location = frontend_page(&callback_url, "/auth/callback", &params)?;
    let mut response = redirect(StatusCode::SEE_OTHER, &location);
    if !signed_in.refresh_token.is_empty() {
        set_refresh_cookie(&mut response, settings, &headers, &signed_in.refresh_token);
    }
    clear_google_state_cookie(&mut response, settings, &headers);
    Ok(response)
}

/// A validated `SendOtpRequest`.
struct SendOtp {
    email: String,
    token: Option<String>,
    return_to: Option<String>,
}

/// `SendOtpRequest` (unknown keys ignored).
fn parse_send_otp(mut body: Body) -> Result<SendOtp, ApiError> {
    let email = body.required_email("email");
    let token = body.string("token", &Str::new()).value();
    let return_to = match body.string("return_to", &Str::new().max(MAX_URL_LENGTH)) {
        crate::api::body::Input::Given(value) => match safe_return_to(&value) {
            Some(decoded) => Some(decoded),
            None => {
                body.field_error("return_to", json!(value), UNSAFE_RETURN_TO);
                None
            }
        },
        _ => None,
    };
    body.finish()?;
    Ok(SendOtp {
        email: email.unwrap_or_default(),
        token,
        return_to,
    })
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct SendOtpRequest {
    #[schema(format = Email)]
    email: String,
    /// Optional invitation token
    token: Option<String>,
    #[schema(max_length = 2048)]
    return_to: Option<String>,
}

#[utoipa::path(
    post,
    path = "/auth/send-otp",
    tag = "auth",
    operation_id = "send_otp_auth_send_otp_post",
    summary = "Send Otp",
    request_body = SendOtpRequest,
    responses(
        (status = 200, description = "Successful Response", body = MessageResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn send_otp(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<MessageResponse>, ApiError> {
    SEND_OTP_LIMITER.check(&client_ip)?;
    let request = parse_send_otp(Body::parse(&bytes, &headers, Extra::Ignore)?)?;
    let signup_school = request_school(&state, &headers).await?;
    let message = session::prepare_otp_email(
        &state.db,
        state.settings,
        &request.email,
        request.token.as_deref(),
        request.return_to.as_deref(),
        signup_school,
    )
    .await?;
    // The tokens are stored; the email goes out after the response.
    crate::email::send_in_background(message);
    Ok(MessageResponse::json(
        "Verification link and code sent successfully",
    ))
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct VerifyOtpRequest {
    #[schema(format = Email)]
    email: String,
    #[schema(min_length = 1, max_length = 255)]
    token: String,
}

#[utoipa::path(
    post,
    path = "/auth/verify-otp",
    tag = "auth",
    operation_id = "verify_otp_auth_verify_otp_post",
    summary = "Verify Otp",
    request_body = VerifyOtpRequest,
    responses(
        (status = 200, description = "Successful Response", body = TokenResponse),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn verify_otp(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    VERIFY_OTP_LIMITER.check(&client_ip)?;
    let mut body = Body::parse(&bytes, &headers, Extra::Ignore)?;
    let email = body.required_email("email");
    let token = body.required_string("token", &Str::new().min(1).max(255));
    body.finish()?;
    let (Some(email), Some(token)) = (email, token) else {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "validated body is incomplete"
        )));
    };
    let signup_school = request_school(&state, &headers).await?;
    let signed_in =
        session::verify_otp(&state.db, &state.auth, &email, &token, signup_school).await?;
    Ok(signed_in_response(signed_in, state.settings, &headers))
}

/// `_origin_allowed`: SameSite=Lax still sends the cookie on top-level
/// cross-site POSTs, so a refresh must come from a trusted origin (by
/// `Origin`, else `Referer`); neither header is refused.
fn origin_allowed(settings: &Settings, headers: &HeaderMap) -> Result<bool, ApiError> {
    if settings.cors_origins.is_empty() && settings.cors_origin_regex.is_none() {
        return Ok(false);
    }
    if let Some(origin) = header_text(headers, header::ORIGIN).filter(|value| !value.is_empty()) {
        return Ok(settings.is_allowed_origin(Some(&origin)));
    }
    if let Some(referer) = header_text(headers, header::REFERER).filter(|value| !value.is_empty()) {
        let (parsed, _) = parse_url(&referer)?;
        let origin = parsed.origin().unwrap_or(referer);
        return Ok(settings.is_allowed_origin(Some(&origin)));
    }
    Ok(false)
}

#[utoipa::path(
    post,
    path = "/auth/refresh",
    tag = "auth",
    operation_id = "refresh_auth_refresh_post",
    summary = "Refresh",
    responses((status = 200, description = "Successful Response", body = TokenResponse))
)]
pub async fn refresh(
    State(state): State<AppState>,
    ClientIp(client_ip): ClientIp,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let settings = state.settings;
    if !origin_allowed(settings, &headers)? {
        return Err(ApiError::http(
            StatusCode::FORBIDDEN,
            "Cross-origin refresh blocked",
        ));
    }
    let refresh_token = cookies::read(&headers)
        .remove(REFRESH_COOKIE)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| ApiError::http(StatusCode::UNAUTHORIZED, NO_REFRESH_TOKEN))?;
    REFRESH_LIMITER.check(&client_ip)?;
    let signed_in = session::refresh(&state.db, &state.auth, &refresh_token).await?;
    Ok(signed_in_response(signed_in, settings, &headers))
}

/// `_error_response_with_cleared_cookie`: an error body that still clears the
/// refresh cookie.
fn error_with_cleared_cookie(
    status: StatusCode,
    detail: &str,
    settings: &Settings,
    headers: &HeaderMap,
) -> Response {
    let mut response = (status, Json(json!({ "detail": detail }))).into_response();
    clear_refresh_cookie(&mut response, settings, headers);
    response
}

#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "auth",
    operation_id = "logout_auth_logout_post",
    summary = "Logout",
    description = "Log the user out.\n\nBearer is optional: if the access token has expired, the refresh cookie\nis still cleared so the browser does not hold a replayable token.\nEven if upstream revocation fails, the cookie is cleared via a\nJSONResponse that carries Set-Cookie for ``refresh_token``.",
    responses((status = 200, description = "Successful Response", body = MessageResponse))
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let settings = state.settings;
    if let Some(token) = crate::api::auth::bearer_token(&headers) {
        match session::logout(&state.db, &state.auth, token).await {
            Ok(()) => {}
            // The cookie is cleared even though revocation failed.
            Err(ApiError::Authentication(detail)) => {
                return Ok(error_with_cleared_cookie(
                    StatusCode::UNAUTHORIZED,
                    &detail,
                    settings,
                    &headers,
                ));
            }
            Err(ApiError::Service { detail, .. }) => {
                return Ok(error_with_cleared_cookie(
                    StatusCode::BAD_REQUEST,
                    &detail,
                    settings,
                    &headers,
                ));
            }
            Err(error) => return Err(error),
        }
    }
    let mut response = MessageResponse::json("Logged out successfully").into_response();
    clear_refresh_cookie(&mut response, settings, &headers);
    Ok(response)
}

#[cfg(test)]
mod tests;
