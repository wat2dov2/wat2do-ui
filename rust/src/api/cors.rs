//! Starlette's `CORSMiddleware` as `main.py` configures it: explicit origins
//! plus `CORS_ORIGIN_REGEX`, credentials allowed, every method and header.
//!
//! Preflights are answered here; every other response gets
//! `Access-Control-Allow-Credentials` when the request has an `Origin`, the
//! origin echoed back when it is allowed, and `Vary: Origin`.

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_MAX_AGE, CONTENT_TYPE, ORIGIN, VARY,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::settings::Settings;

/// Starlette's `ALL_METHODS`, which `allow_methods=["*"]` expands to.
const ALL_METHODS: [&str; 8] = [
    "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "QUERY",
];
const PREFLIGHT_VARY: &str = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network";
const MAX_AGE_SECONDS: &str = "600";

/// Answer preflights and decorate responses for an allowed-origin policy.
pub async fn cors(
    State(settings): State<&'static Settings>,
    request: Request,
    next: Next,
) -> Response {
    let origin = request.headers().get(ORIGIN).cloned();
    if let Some(origin) = &origin
        && request.method() == Method::OPTIONS
        && request
            .headers()
            .contains_key("access-control-request-method")
    {
        return preflight(settings, origin, request.headers());
    }
    let mut response = next.run(request).await;
    decorate(settings, origin.as_ref(), response.headers_mut());
    response
}

fn origin_allowed(settings: &Settings, origin: &HeaderValue) -> bool {
    origin
        .to_str()
        .is_ok_and(|origin| settings.is_allowed_origin(Some(origin)))
}

fn preflight(settings: &Settings, origin: &HeaderValue, request: &HeaderMap) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(VARY, HeaderValue::from_static(PREFLIGHT_VARY));
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, QUERY"),
    );
    headers.insert(
        ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static(MAX_AGE_SECONDS),
    );
    headers.insert(
        ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    let mut failures = Vec::new();
    if origin_allowed(settings, origin) {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
    } else {
        failures.push("origin");
    }
    let method = request
        .get("access-control-request-method")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !ALL_METHODS.contains(&method) {
        failures.push("method");
    }
    // Every header is allowed, so the requested ones are mirrored back.
    if let Some(requested) = request.get("access-control-request-headers") {
        headers.insert(ACCESS_CONTROL_ALLOW_HEADERS, requested.clone());
    }
    if request.contains_key("access-control-request-private-network") {
        failures.push("private-network");
    }
    let (status, body) = if failures.is_empty() {
        (StatusCode::OK, "OK".to_owned())
    } else {
        (
            StatusCode::BAD_REQUEST,
            format!("Disallowed CORS {}", failures.join(", ")),
        )
    };
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response.extensions_mut().insert(Preflight);
    response
}

/// Marks a preflight answer: axum adds the route's `Allow` header to it after
/// the route returns, and `finish` takes it off again (Starlette sends none).
#[derive(Clone, Copy, Debug)]
pub struct Preflight;

/// Runs after routing: undo what axum adds to a preflight answer.
pub fn finish(mut response: Response) -> Response {
    if response.extensions().get::<Preflight>().is_some() {
        response.headers_mut().remove(axum::http::header::ALLOW);
    }
    response
}

fn decorate(settings: &Settings, origin: Option<&HeaderValue>, headers: &mut HeaderMap) {
    if origin.is_some() {
        headers.insert(
            ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
    }
    if let Some(origin) = origin.filter(|origin| origin_allowed(settings, origin)) {
        headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
    }
    // Starlette appends Origin to Vary on every response, joining existing values.
    let mut vary: Vec<String> = headers
        .get_all(VARY)
        .iter()
        .filter_map(|value| value.to_str().ok().map(str::to_owned))
        .collect();
    vary.push("Origin".to_owned());
    headers.insert(
        VARY,
        HeaderValue::from_str(&vary.join(", ")).expect("valid Vary header"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;
    use axum::Router;
    use axum::routing::get;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn app() -> Router {
        let settings: &'static Settings = Box::leak(Box::new(test_settings(&[
            ("CORS_ORIGINS", r#"["https://wat2do.io"]"#),
            ("CORS_ORIGIN_REGEX", "^https://[a-z0-9-]+[.]wat2do.io$"),
        ])));
        Router::new()
            .route("/x", get(|| async { ([(VARY, "Accept-Encoding")], "hi") }))
            .layer(axum::middleware::from_fn_with_state(settings, cors))
    }

    async fn send(request: axum::http::Request<Body>) -> (StatusCode, HeaderMap, String) {
        let response = app().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, String::from_utf8(body.to_vec()).unwrap())
    }

    fn request(method: Method, headers: &[(&str, &str)]) -> axum::http::Request<Body> {
        let mut builder = axum::http::Request::builder().method(method).uri("/x");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        builder.body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn allowed_origins_are_echoed_with_credentials() {
        let (_, headers, _) = send(request(
            Method::GET,
            &[("origin", "https://uwaterloo.wat2do.io")],
        ))
        .await;
        assert_eq!(
            headers[ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://uwaterloo.wat2do.io"
        );
        assert_eq!(headers[ACCESS_CONTROL_ALLOW_CREDENTIALS], "true");
        assert_eq!(headers[VARY], "Accept-Encoding, Origin");
    }

    #[tokio::test]
    async fn other_origins_get_credentials_but_no_origin() {
        let (_, headers, _) = send(request(Method::GET, &[("origin", "https://evil.com")])).await;
        assert!(headers.get(ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        assert_eq!(headers[ACCESS_CONTROL_ALLOW_CREDENTIALS], "true");
        assert_eq!(headers[VARY], "Accept-Encoding, Origin");
        let (_, headers, _) = send(request(Method::GET, &[])).await;
        assert!(headers.get(ACCESS_CONTROL_ALLOW_CREDENTIALS).is_none());
        assert_eq!(headers[VARY], "Accept-Encoding, Origin");
    }

    #[tokio::test]
    async fn preflights_are_answered_like_starlette() {
        let (status, headers, body) = send(request(
            Method::OPTIONS,
            &[
                ("origin", "https://wat2do.io"),
                ("access-control-request-method", "POST"),
                (
                    "access-control-request-headers",
                    "authorization, content-type",
                ),
            ],
        ))
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "OK");
        assert_eq!(headers[ACCESS_CONTROL_ALLOW_ORIGIN], "https://wat2do.io");
        assert_eq!(
            headers[ACCESS_CONTROL_ALLOW_HEADERS],
            "authorization, content-type"
        );
        assert_eq!(
            headers[ACCESS_CONTROL_ALLOW_METHODS],
            "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, QUERY"
        );
        assert_eq!(headers[ACCESS_CONTROL_MAX_AGE], "600");
        assert_eq!(headers[VARY], PREFLIGHT_VARY);
        assert_eq!(headers[CONTENT_TYPE], "text/plain; charset=utf-8");

        let (status, headers, body) = send(request(
            Method::OPTIONS,
            &[
                ("origin", "https://evil.com"),
                ("access-control-request-method", "get"),
                ("access-control-request-private-network", "true"),
            ],
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, "Disallowed CORS origin, method, private-network");
        assert!(headers.get(ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
    }

    #[tokio::test]
    async fn options_without_a_requested_method_is_not_a_preflight() {
        let (status, headers, _) =
            send(request(Method::OPTIONS, &[("origin", "https://wat2do.io")])).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(headers[ACCESS_CONTROL_ALLOW_ORIGIN], "https://wat2do.io");
    }
}
