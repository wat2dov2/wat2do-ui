//! The auth routes as clients see them (`backend/tests/routers/test_auth.py`,
//! `backend/tests/services/test_auth_service.py`). Nothing listens at the
//! database address, so a step that reaches the database fails the way an
//! unreachable database would; the session rules themselves are unit tests in
//! `session.rs`.

use std::time::Duration;

use axum::body::{Body as HttpBody, Bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::api::auth::test_tokens;
use crate::api::client_ip::Peer;
use crate::api::messages::INVALID_OR_EXPIRED_TOKEN;
use crate::api::{AppState, router};
use crate::settings::test_settings;
use crate::urls::quote_plus;

fn state(overrides: &[(&str, &str)]) -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(overrides)));
    let db = crate::db::connect_lazy(
        "postgres://localhost:1/none".parse().unwrap(),
        1,
        Duration::from_secs(1),
        Duration::from_millis(200),
        false,
    );
    AppState::new(settings, db, None).unwrap()
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

impl Reply {
    fn cookies(&self) -> Vec<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|value| value.to_str().unwrap().to_owned())
            .collect()
    }

    fn location(&self) -> &str {
        self.headers[header::LOCATION].to_str().unwrap()
    }
}

/// Send one request from `peer` (each test has its own, so the rate limiters
/// of parallel tests never meet).
async fn call(
    state: AppState,
    peer: &str,
    method: Method,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> Reply {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(json.to_string())
        }
        None => HttpBody::empty(),
    };
    let mut request = builder.body(body).unwrap();
    request.extensions_mut().insert(Peer(peer.to_owned()));
    let response = crate::api::app(router(state))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

const CALLBACK_URL: &str = "http://localhost:3000/api/auth/google/callback";
const ALLOWED_ORIGIN: &str = "http://localhost:3000";

// ---------------------------------------------------------------------------
// GET /auth/google and /auth/google/callback
// ---------------------------------------------------------------------------

#[tokio::test]
async fn start_google_oauth_sets_pkce_state_and_redirects() {
    // test_start_google_oauth_redirects_with_pkce_state
    let state = state(&[("COOKIE_SECURE", "false")]);
    let path = format!(
        "/auth/google?callback_url={}&return_to={}",
        quote_plus(CALLBACK_URL),
        quote_plus("/positions?school=uwaterloo")
    );
    let reply = call(state, "google-start", Method::GET, &path, &[], None).await;
    assert_eq!(reply.status, StatusCode::FOUND);
    let location = reply.location();
    assert!(location.starts_with("https://accounts.google.com/o/oauth2/v2/auth?client_id="));
    // Google always returns to the one registered callback on FRONTEND_URL.
    assert!(location.contains(
        "&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fgoogle%2Fcallback&response_type=code&scope=openid+email+profile&code_challenge="
    ));
    let cookies = reply.cookies();
    assert_eq!(cookies.len(), 1);
    let cookie = &cookies[0];
    assert!(cookie.starts_with("google_oauth_state=\""));
    assert!(
        cookie.ends_with("; HttpOnly; Max-Age=600; Path=/api/auth/google/callback; SameSite=lax")
    );
    // The cookie carries the verifier whose challenge went to Google, and the state.
    let value = cookie
        .trim_start_matches("google_oauth_state=\"")
        .split('"')
        .next()
        .unwrap();
    let payload = decode_state(Some(value)).unwrap();
    assert_eq!(payload.callback_url, CALLBACK_URL);
    assert_eq!(
        payload.return_to.as_deref(),
        Some("/positions?school=uwaterloo")
    );
    assert_eq!(payload.code_verifier.len(), 86);
    assert!(location.contains(&format!(
        "code_challenge={}&code_challenge_method=S256&state={}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            <sha2::Sha256 as sha2::Digest>::digest(payload.code_verifier.as_bytes())
        ),
        payload.state
    )));
}

#[tokio::test]
async fn start_google_oauth_rejects_untrusted_callbacks_and_return_paths() {
    // test_start_google_oauth_rejects_untrusted_callback
    for (index, callback_url) in [
        "https://evil.example/api/auth/google/callback",
        "http://localhost:3000/auth/google/callback",
        "http://localhost:3000/api/auth/google/callback?next=evil",
        "http://localhost:3000/api/auth/google/callback;p",
        "http://localhost:3000/api/auth/google/callback#f",
        "ftp://localhost:3000/api/auth/google/callback",
    ]
    .into_iter()
    .enumerate()
    {
        let path = format!("/auth/google?callback_url={}", quote_plus(callback_url));
        let reply = call(
            state(&[]),
            &format!("untrusted-{index}"),
            Method::GET,
            &path,
            &[],
            None,
        )
        .await;
        assert_eq!(
            reply.status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{callback_url}"
        );
        assert_eq!(reply.body, json!({"detail": INVALID_CALLBACK_URL}));
        assert!(reply.cookies().is_empty());
    }
    let path = format!(
        "/auth/google?callback_url={}&return_to=%2F%2Fevil.example",
        quote_plus(CALLBACK_URL)
    );
    let reply = call(state(&[]), "unsafe-return", Method::GET, &path, &[], None).await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(reply.body, json!({"detail": UNSAFE_RETURN_TO}));
    let reply = call(
        state(&[]),
        "missing-callback",
        Method::GET,
        "/auth/google",
        &[],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        reply.body["detail"][0]["loc"],
        json!(["query", "callback_url"])
    );
    // A malformed IPv6 host is Python's uncaught ValueError.
    let reply = call(
        state(&[]),
        "bad-ipv6",
        Method::GET,
        "/auth/google?callback_url=http%3A%2F%2F%5B%3A%3A1%2Fx",
        &[],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn complete_google_oauth_without_state_returns_to_login() {
    // test_complete_google_oauth_without_pkce_state_returns_to_login
    let reply = call(
        state(&[]),
        "callback-no-state",
        Method::GET,
        "/auth/google/callback?code=auth-code&state=s",
        &[],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::SEE_OTHER);
    assert_eq!(
        reply.location(),
        "http://localhost:3000/login?oauthError=google"
    );
    let cookies = reply.cookies();
    assert_eq!(cookies.len(), 1);
    assert!(cookies[0].starts_with(r#"google_oauth_state=""; expires="#));
    assert!(cookies[0].ends_with("; Max-Age=0; Path=/api/auth/google/callback; SameSite=lax"));
}

fn state_cookie(callback_url: &str) -> String {
    format!(
        "google_oauth_state=\"{}\"",
        encode_state(&OAuthState {
            code_verifier: "verifier".into(),
            state: "state-1".into(),
            callback_url: callback_url.into(),
            return_to: Some("/positions?school=uwaterloo".into()),
        })
    )
}

#[tokio::test]
async fn provider_errors_missing_codes_and_forged_states_return_to_login() {
    // test_complete_google_oauth_rejects_a_mismatched_state and the provider-error cases
    let cookie = state_cookie("http://uwaterloo.wat2do.localhost:3000/api/auth/google/callback");
    let settings = [(
        "CORS_ORIGIN_REGEX",
        r"http://[a-z]+\.wat2do\.localhost:3000",
    )];
    for (index, path) in [
        "/auth/google/callback?error=access_denied&code=x&state=state-1",
        "/auth/google/callback?state=state-1",
        "/auth/google/callback?code=&state=state-1",
    ]
    .into_iter()
    .enumerate()
    {
        let reply = call(
            state(&settings),
            &format!("callback-error-{index}"),
            Method::GET,
            path,
            &[("cookie", &cookie)],
            None,
        )
        .await;
        assert_eq!(reply.status, StatusCode::SEE_OTHER, "{path}");
        assert_eq!(
            reply.location(),
            "http://uwaterloo.wat2do.localhost:3000/login?oauthError=google"
        );
    }
    // Google echoes the state we sent; any other (or none) is a forged or
    // stale callback, so the cookie is ignored and FRONTEND_URL is used.
    for (index, path) in [
        "/auth/google/callback?code=x&state=state-2",
        "/auth/google/callback?code=x",
    ]
    .into_iter()
    .enumerate()
    {
        let reply = call(
            state(&settings),
            &format!("callback-state-{index}"),
            Method::GET,
            path,
            &[("cookie", &cookie)],
            None,
        )
        .await;
        assert_eq!(
            reply.location(),
            "http://localhost:3000/login?oauthError=google"
        );
    }
    // A state naming a callback that is no longer trusted falls back to FRONTEND_URL.
    let forged = state_cookie("https://evil.example/api/auth/google/callback");
    let reply = call(
        state(&settings),
        "callback-forged",
        Method::GET,
        "/auth/google/callback?code=x&state=state-1",
        &[("cookie", &forged)],
        None,
    )
    .await;
    assert_eq!(
        reply.location(),
        "http://localhost:3000/login?oauthError=google"
    );
}

#[test]
fn oauth_state_round_trips_like_python() {
    // base64.urlsafe_b64encode(json.dumps({...}, separators=(",", ":")).encode())
    let state = OAuthState {
        code_verifier: "v".into(),
        state: "s".into(),
        callback_url: "c".into(),
        return_to: Some("/caf\u{e9}".into()),
    };
    assert_eq!(
        encode_state(&state),
        "eyJjb2RlX3ZlcmlmaWVyIjoidiIsInN0YXRlIjoicyIsImNhbGxiYWNrX3VybCI6ImMiLCJyZXR1cm5fdG8iOiIvY2FmXHUwMGU5In0="
    );
    assert_eq!(decode_state(Some(&encode_state(&state))), Some(state));
    let none = OAuthState {
        code_verifier: "v".into(),
        state: "s".into(),
        callback_url: "c".into(),
        return_to: None,
    };
    assert_eq!(decode_state(Some(&encode_state(&none))), Some(none));
    for invalid in [
        None,
        Some(""),
        Some("not base64!"),
        Some("e30="),
        Some("WzFd"),
        // A cookie from before the state was added.
        Some(
            "eyJjb2RlX3ZlcmlmaWVyIjoidiIsImNhbGxiYWNrX3VybCI6ImMiLCJyZXR1cm5fdG8iOiIvY2FmXHUwMGU5In0=",
        ),
        Some("\u{e9}"),
    ] {
        assert_eq!(decode_state(invalid), None, "{invalid:?}");
    }
    // Python's lenient decoder skips stray characters and stops at padding.
    assert_eq!(python_b64decode("e3\n0=").unwrap(), b"{}");
    assert_eq!(python_b64decode("e30=garbage").unwrap(), b"{}");
    assert_eq!(python_b64decode("e30"), None);
    assert_eq!(python_b64decode("e"), None);
    assert_eq!(ascii_json("\u{1f600}\u{7f}"), r#""\ud83d\ude00\u007f""#);
}

#[test]
fn return_paths_must_stay_inside_the_app() {
    // test_send_otp_rejects_unsafe_return_path
    for unsafe_path in [
        "https://evil.example",
        "//evil.example",
        r"/safe\evil",
        "/safe%0AHeader:value",
        "/safe\u{85}Header:value",
        "%252F%252Fevil.example",
        "relative",
        "",
    ] {
        assert_eq!(safe_return_to(unsafe_path), None, "{unsafe_path}");
    }
    assert_eq!(
        safe_return_to("/promote?school=uwaterloo").as_deref(),
        Some("/promote?school=uwaterloo")
    );
    assert_eq!(
        safe_return_to("%2Fevents%3Fa%3D1").as_deref(),
        Some("/events?a=1")
    );
}

// ---------------------------------------------------------------------------
// POST /auth/send-otp and /auth/verify-otp
// ---------------------------------------------------------------------------
#[tokio::test]
async fn send_otp_validates_before_doing_anything() {
    for (index, body) in [
        json!({"email": "not-an-email"}),
        json!({}),
        json!({"email": "student@uwaterloo.ca", "return_to": "//evil.example"}),
        json!({"email": "student@uwaterloo.ca", "return_to": "x".repeat(2049)}),
        json!({"email": null}),
        json!({"email": "student@uwaterloo.ca", "token": 5}),
    ]
    .into_iter()
    .enumerate()
    {
        let reply = call(
            state(&[]),
            &format!("send-invalid-{index}"),
            Method::POST,
            "/auth/send-otp",
            &[],
            Some(body.clone()),
        )
        .await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    let reply = call(
        state(&[]),
        "send-unsafe-message",
        Method::POST,
        "/auth/send-otp",
        &[],
        Some(json!({"email": "student@uwaterloo.ca", "return_to": "//evil.example"})),
    )
    .await;
    assert_eq!(
        reply.body["detail"][0],
        json!({
            "type": "value_error",
            "loc": ["body", "return_to"],
            "msg": "Value error, return_to must be a safe relative application path",
            "input": "//evil.example",
            "ctx": {"error": {}},
        })
    );
}

#[test]
fn send_otp_forwards_the_decoded_return_path() {
    // test_send_otp_forwards_safe_relative_return_path
    let request = parse_send_otp(Body::from_value(
        json!({"email": "Student@UWaterloo.ca", "return_to": "%2Fpromote%3Fschool%3Duwaterloo", "token": "t", "extra": 1}),
        Extra::Ignore,
    ))
    .ok()
    .unwrap();
    assert_eq!(request.email, "Student@uwaterloo.ca");
    assert_eq!(
        request.return_to.as_deref(),
        Some("/promote?school=uwaterloo")
    );
    assert_eq!(request.token.as_deref(), Some("t"));
}

#[tokio::test]
async fn send_otp_shares_its_rate_limit_with_google_sign_in() {
    let budget = RATE_LIMITS.sensitive_authentication.maximum_requests;
    for _ in 0..budget {
        let reply = call(
            state(&[]),
            "send-limit",
            Method::POST,
            "/auth/send-otp",
            &[],
            Some(json!({})),
        )
        .await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let reply = call(
        state(&[]),
        "send-limit",
        Method::GET,
        "/auth/google",
        &[],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(reply.headers.get(header::RETRY_AFTER).is_some());
    // test_send_burst_does_not_block_verify: verification has its own budget.
    let reply = call(
        state(&[]),
        "send-limit",
        Method::POST,
        "/auth/verify-otp",
        &[],
        Some(json!({})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn verify_otp_rejects_unknown_tokens_without_naming_why() {
    // test_wrong_or_expired_code_is_rejected_and_kept: a link token is looked up
    // (no lockout check); a failed lookup reads as no match.
    let reply = call(
        state(&[]),
        "verify-unknown",
        Method::POST,
        "/auth/verify-otp",
        &[],
        Some(json!({"email": "student@uwaterloo.ca", "token": "some-link-token"})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.body, json!({"detail": INVALID_OR_EXPIRED_TOKEN}));
    assert_eq!(reply.headers[header::WWW_AUTHENTICATE], "Bearer");
    assert!(reply.cookies().is_empty());
    // A six-digit code checks the address's lockout first, and that read's
    // failure is not hidden (Python let it propagate).
    let reply = call(
        state(&[]),
        "verify-code",
        Method::POST,
        "/auth/verify-otp",
        &[],
        Some(json!({"email": "student@uwaterloo.ca", "token": " 123456 "})),
    )
    .await;
    assert!(reply.status.is_server_error(), "{}", reply.status);
}

#[tokio::test]
async fn verify_otp_requires_email_and_token() {
    for (index, body) in [
        json!({"token": "tok"}),
        json!({"email": "student@uwaterloo.ca"}),
        json!({"email": "student@uwaterloo.ca", "token": ""}),
        json!({"email": "student@uwaterloo.ca", "token": "x".repeat(256)}),
    ]
    .into_iter()
    .enumerate()
    {
        let reply = call(
            state(&[]),
            &format!("verify-invalid-{index}"),
            Method::POST,
            "/auth/verify-otp",
            &[],
            Some(body.clone()),
        )
        .await;
        assert_eq!(reply.status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
}

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------

async fn refresh_with(peer: &str, settings: &[(&str, &str)], headers: &[(&str, &str)]) -> Reply {
    call(
        state(settings),
        peer,
        Method::POST,
        "/auth/refresh",
        headers,
        None,
    )
    .await
}

#[tokio::test]
async fn refresh_needs_a_trusted_origin_and_a_cookie() {
    // test_refresh_rejects_untrusted_origin, test_refresh_without_cookie
    let cookie = ("cookie", "refresh_token=tok");
    for (index, headers) in [
        vec![cookie],
        vec![("origin", "https://evil.example"), cookie],
        vec![("referer", "https://evil.example/page"), cookie],
        vec![("origin", ""), ("referer", "https://evil.example/"), cookie],
    ]
    .into_iter()
    .enumerate()
    {
        let reply = refresh_with(&format!("refresh-origin-{index}"), &[], &headers).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN);
        assert_eq!(
            reply.body,
            json!({"detail": "Cross-origin refresh blocked"})
        );
    }
    let reply = refresh_with(
        "refresh-no-cookie",
        &[],
        &[("origin", ALLOWED_ORIGIN), ("cookie", "refresh_token=")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply.body, json!({"detail": NO_REFRESH_TOKEN}));
    assert!(!reply.headers.contains_key(header::WWW_AUTHENTICATE));
    // A trusted Referer, or an origin the regex allows, reaches the session
    // lookup (which has no database here).
    for (index, (settings, headers)) in [
        (
            vec![],
            vec![("referer", "http://localhost:3000/events?x=1"), cookie],
        ),
        (
            vec![("CORS_ORIGIN_REGEX", r"^https://([a-z0-9-]+\.)?wat2do\.io$")],
            vec![("origin", "https://mit.wat2do.io"), cookie],
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let reply = refresh_with(&format!("refresh-trusted-{index}"), &settings, &headers).await;
        assert!(reply.status.is_server_error(), "{}", reply.status);
        assert!(reply.cookies().is_empty());
    }
}

#[test]
fn refresh_cookie_attributes_follow_settings_and_origin() {
    // TestCookieBehavior: httpOnly, SameSite=lax, the configured path, and a
    // host-only cookie for the retired frontend.
    for (index, (settings, origin, expected)) in [
        (
            vec![("REFRESH_COOKIE_PATH", "/api/auth/refresh")],
            ALLOWED_ORIGIN,
            "; HttpOnly; Max-Age=2592000; Path=/api/auth/refresh; SameSite=lax; Secure",
        ),
        (
            vec![
                ("COOKIE_DOMAIN", ".wat2do.io"),
                (
                    "CORS_ORIGINS",
                    r#"["https://wat2do.ca", "https://wat2do.io"]"#,
                ),
            ],
            "https://wat2do.ca",
            "; HttpOnly; Max-Age=2592000; Path=/auth/refresh; SameSite=lax; Secure",
        ),
        (
            vec![
                ("COOKIE_DOMAIN", ".wat2do.io"),
                ("CORS_ORIGINS", r#"["https://wat2do.io"]"#),
            ],
            "https://wat2do.io",
            "; HttpOnly; Max-Age=2592000; Path=/auth/refresh; SameSite=lax; Secure",
        ),
        (
            vec![("ENVIRONMENT", "production"), ("COOKIE_SECURE", "true")],
            ALLOWED_ORIGIN,
            "; HttpOnly; Max-Age=2592000; Path=/auth/refresh; SameSite=lax; Secure",
        ),
        (
            vec![("COOKIE_SECURE", "false")],
            ALLOWED_ORIGIN,
            "; HttpOnly; Max-Age=2592000; Path=/auth/refresh; SameSite=lax",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let settings = test_settings(&settings);
        let mut headers = HeaderMap::new();
        headers.insert(header::ORIGIN, origin.parse().unwrap());
        let mut response = axum::response::Response::new(HttpBody::empty());
        set_refresh_cookie(&mut response, &settings, &headers, "tok");
        let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with("refresh_token=tok; "), "{cookie}");
        assert!(cookie.contains("; expires="), "{cookie}");
        assert!(cookie.ends_with(expected), "{index}: {cookie}");
        assert_eq!(
            cookie.contains("; Domain=.wat2do.io; "),
            index == 2,
            "{cookie}"
        );
    }
}

#[tokio::test]
async fn production_refuses_insecure_cookies() {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[
        ("ENVIRONMENT", "production"),
        ("COOKIE_SECURE", "false"),
    ])));
    let db = crate::db::connect_lazy(
        "postgres://localhost:1/none".parse().unwrap(),
        1,
        Duration::from_secs(1),
        Duration::from_millis(200),
        false,
    );
    let error = AppState::new(settings, db, None).err().unwrap();
    assert!(
        error
            .to_string()
            .contains("COOKIE_SECURE must be true in production")
    );
}

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

#[tokio::test]
async fn logout_with_a_token_we_did_not_sign_still_clears_the_cookie() {
    // test_logout_with_an_invalid_token
    for (index, token) in ["expired", "not.a.jwt"].into_iter().enumerate() {
        let reply = call(
            state(&[]),
            &format!("logout-rejected-{index}"),
            Method::POST,
            "/auth/logout",
            &[("authorization", &format!("Bearer {token}"))],
            None,
        )
        .await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
        assert_eq!(reply.body, json!({"detail": INVALID_OR_EXPIRED_TOKEN}));
        assert!(!reply.headers.contains_key(header::WWW_AUTHENTICATE));
        let cookies = reply.cookies();
        assert_eq!(cookies.len(), 1);
        assert!(cookies[0].starts_with(r#"refresh_token=""; expires="#));
        assert!(cookies[0].ends_with("; Max-Age=0; Path=/auth/refresh; SameSite=lax"));
    }
    // An expired token of ours is refused the same way.
    let mut claims = test_tokens::claims("auth-id-1");
    claims["exp"] = json!(chrono::Utc::now().timestamp() - 1);
    let reply = call(
        state(&[]),
        "logout-expired",
        Method::POST,
        "/auth/logout",
        &[(
            "authorization",
            &format!("Bearer {}", test_tokens::sign(&claims)),
        )],
        None,
    )
    .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_with_our_token_revokes_the_sessions() {
    // test_logout_ends_every_session_of_the_user: a valid token reaches the
    // revocation, whose failure is a server error (uncaught in Python), with
    // the cookie left alone.
    let reply = call(
        state(&[]),
        "logout-valid",
        Method::POST,
        "/auth/logout",
        &[(
            "authorization",
            &format!("Bearer {}", test_tokens::access_token("auth-id-1")),
        )],
        None,
    )
    .await;
    assert!(reply.status.is_server_error(), "{}", reply.status);
    assert!(reply.cookies().is_empty());
}

#[tokio::test]
async fn logout_without_a_bearer_only_clears_the_cookie() {
    // test_logout_without_bearer_clears_cookie
    for (index, headers) in [
        vec![],
        vec![("authorization", "Basic abc")],
        vec![("authorization", "Bearer ")],
    ]
    .into_iter()
    .enumerate()
    {
        let reply = call(
            state(&[]),
            &format!("logout-anonymous-{index}"),
            Method::POST,
            "/auth/logout",
            &headers,
            None,
        )
        .await;
        assert_eq!(reply.status, StatusCode::OK);
        assert_eq!(reply.body, json!({"message": "Logged out successfully"}));
        assert_eq!(reply.cookies().len(), 1);
    }
}
