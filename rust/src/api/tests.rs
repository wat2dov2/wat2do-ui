//! The assembled application: Starlette routing behaviour on Rust routes,
//! and the proxy to a stand-in Python app on loopback.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::IntoResponse;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::client_ip::Peer;
use super::proxy::{NotServedByRust, Upstream};
use super::{AppState, router};
use crate::settings::{Settings, test_settings};

fn settings() -> &'static Settings {
    Box::leak(Box::new(test_settings(&[(
        "CORS_ORIGINS",
        r#"["https://wat2do.io"]"#,
    )])))
}

fn state(upstream: Option<Arc<Upstream>>) -> AppState {
    let db = crate::db::connect_lazy(
        "postgres://localhost:1/none".parse().unwrap(),
        1,
        Duration::from_secs(1),
        Duration::from_secs(1),
        false,
    );
    AppState::new(settings(), db, upstream).unwrap()
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
    rust: bool,
}

async fn send(state: AppState, request: Request<Body>, peer: &str) -> Reply {
    let mut request = request;
    request.extensions_mut().insert(Peer(peer.to_owned()));
    let app = super::app(router(state));
    let response = app.oneshot(request).await.unwrap();
    let rust = response.extensions().get::<NotServedByRust>().is_none();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        headers,
        body,
        rust,
    }
}

fn get(path: &str) -> Request<Body> {
    Request::builder()
        .uri(path)
        .header(header::HOST, "testserver")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn health_is_ok_without_python_and_carries_the_api_headers() {
    let reply = send(state(None), get("/health"), "testclient").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&reply.body).unwrap(),
        json!({"status": "ok"})
    );
    assert_eq!(reply.headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(reply.headers["x-content-type-options"], "nosniff");
    assert_eq!(reply.headers[header::VARY], "Origin");
    assert!(reply.headers.get("strict-transport-security").is_none());
}

#[tokio::test]
async fn health_fails_until_python_answers() {
    let upstream = Arc::new(Upstream::new(9, Duration::from_secs(1)));
    let reply = send(state(Some(upstream.clone())), get("/health"), "127.0.0.1").await;
    assert_eq!(reply.status, StatusCode::SERVICE_UNAVAILABLE);
    upstream.set_ready();
    // Ready once, but nothing listens on port 9 now: still unhealthy.
    let reply = send(state(Some(upstream)), get("/health"), "127.0.0.1").await;
    assert_eq!(reply.status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn wrong_methods_and_head_get_starlettes_405() {
    for method in [Method::POST, Method::HEAD, Method::OPTIONS, Method::DELETE] {
        let request = Request::builder()
            .method(method.clone())
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let reply = send(state(None), request, "testclient").await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED, "{method}");
        assert_eq!(reply.headers[header::ALLOW], "GET");
        assert_eq!(reply.headers[header::CONTENT_TYPE], "application/json");
        if method == Method::HEAD {
            // A HEAD response has no body but keeps the JSON's length, as Starlette's does.
            assert!(reply.body.is_empty());
            assert_eq!(reply.headers[header::CONTENT_LENGTH], "31");
        } else {
            assert_eq!(reply.body, br#"{"detail":"Method Not Allowed"}"#);
        }
        assert_eq!(reply.headers["x-frame-options"], "SAMEORIGIN");
    }
}

#[tokio::test]
async fn trailing_slash_redirects_like_starlette() {
    let reply = send(state(None), get("/health/?x=1&y=%20"), "testclient").await;
    assert_eq!(reply.status, StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(
        reply.headers[header::LOCATION],
        "http://testserver/health?x=1&y=%20"
    );
    assert!(reply.body.is_empty());
    assert_eq!(reply.headers["x-content-type-options"], "nosniff");

    // Behind the frontend the scheme comes from X-Forwarded-Proto.
    let request = Request::builder()
        .method(Method::POST)
        .uri("/site-banner/")
        .header(header::HOST, "127.0.0.1:8000")
        .header("x-forwarded-proto", "https")
        .body(Body::empty())
        .unwrap();
    let reply = send(state(None), request, "127.0.0.1").await;
    assert_eq!(reply.status, StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(
        reply.headers[header::LOCATION],
        "https://127.0.0.1:8000/site-banner"
    );
}

#[tokio::test]
async fn routes_match_the_decoded_path() {
    let reply = send(state(None), get("/heal%74h"), "testclient").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.rust);
}

#[tokio::test]
async fn preflights_for_rust_routes_are_answered_here() {
    let request = Request::builder()
        .method(Method::OPTIONS)
        .uri("/site-banner")
        .header(header::ORIGIN, "https://wat2do.io")
        .header("access-control-request-method", "GET")
        .body(Body::empty())
        .unwrap();
    let reply = send(state(None), request, "testclient").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://wat2do.io"
    );
    // Starlette answers preflights before its security headers middleware and routing.
    assert!(reply.headers.get("content-security-policy").is_none());
    assert!(reply.headers.get(header::ALLOW).is_none());
}

#[tokio::test]
async fn other_paths_are_not_served_by_rust() {
    let reply = send(state(None), get("/events/"), "testclient").await;
    assert!(!reply.rust);
}

#[test]
fn committed_openapi_fragment_is_current() {
    let committed = include_str!("../../../backend/core/rust_openapi.json");
    assert_eq!(
        super::openapi_json().unwrap(),
        committed,
        "backend/core/rust_openapi.json is stale: run \
         `cargo run --bin wat2do-api -- openapi > ../backend/core/rust_openapi.json` in rust/"
    );
}

/// A stand-in for the Python app: echoes what it received.
async fn start_python() -> u16 {
    let app = axum::Router::new().fallback(|request: Request| async move {
        let (parts, body) = request.into_parts();
        let bytes = body.collect().await.unwrap().to_bytes();
        let headers: Vec<(String, String)> = parts
            .headers
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_owned(),
                )
            })
            .collect();
        let echo = json!({
            "method": parts.method.as_str(),
            "uri": parts.uri.to_string(),
            "headers": headers,
            "body_length": bytes.len(),
            "body_sum": bytes.iter().map(|byte| u64::from(*byte)).sum::<u64>(),
        });
        let mut response = (StatusCode::IM_A_TEAPOT, axum::Json(echo)).into_response();
        response
            .headers_mut()
            .append(header::SET_COOKIE, "a=1; Path=/".parse().unwrap());
        response
            .headers_mut()
            .append(header::SET_COOKIE, "b=2; HttpOnly".parse().unwrap());
        response
            .headers_mut()
            .insert(header::LOCATION, "/elsewhere".parse().unwrap());
        response
    });
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    port
}

fn echoed_header(echo: &Value, name: &str) -> Vec<String> {
    echo["headers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn proxied_requests_and_responses_pass_through_untouched() {
    let port = start_python().await;
    let upstream = Arc::new(Upstream::new(port, Duration::from_secs(5)));
    let upload: Vec<u8> = (0..5 * 1024 * 1024)
        .map(|index| (index % 251) as u8)
        .collect();
    let expected_sum: u64 = upload.iter().map(|byte| u64::from(*byte)).sum();
    let request = Request::builder()
        .method(Method::POST)
        .uri("/uploads/image?school=uwaterloo&a=%2F")
        .header(header::HOST, "127.0.0.1:8000")
        .header(header::CONTENT_TYPE, "multipart/form-data; boundary=x")
        .header(header::COOKIE, "refresh=abc; other=1")
        .header(header::AUTHORIZATION, "Bearer token")
        .header("x-forwarded-for", "203.0.113.9, 130.176.1.1")
        .header("x-forwarded-proto", "https")
        .header("x-wat2do-viewer-ip", "203.0.113.9")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from(upload))
        .unwrap();
    let reply = send(state(Some(upstream)), request, "127.0.0.1").await;
    assert_eq!(reply.status, StatusCode::IM_A_TEAPOT);
    let cookies: Vec<_> = reply.headers.get_all(header::SET_COOKIE).iter().collect();
    assert_eq!(cookies, ["a=1; Path=/", "b=2; HttpOnly"]);
    assert_eq!(reply.headers[header::LOCATION], "/elsewhere");
    // Proxied responses get no Rust headers; Python adds its own.
    assert!(reply.headers.get("x-content-type-options").is_none());
    assert!(reply.headers.get(header::VARY).is_none());
    let echo: Value = serde_json::from_slice(&reply.body).unwrap();
    assert_eq!(echo["method"], "POST");
    assert_eq!(echo["uri"], "/uploads/image?school=uwaterloo&a=%2F");
    assert_eq!(echo["body_length"], 5 * 1024 * 1024);
    assert_eq!(echo["body_sum"], expected_sum);
    assert_eq!(echoed_header(&echo, "host"), ["127.0.0.1:8000"]);
    assert_eq!(echoed_header(&echo, "cookie"), ["refresh=abc; other=1"]);
    assert_eq!(echoed_header(&echo, "authorization"), ["Bearer token"]);
    assert_eq!(
        echoed_header(&echo, "x-forwarded-for"),
        ["203.0.113.9, 130.176.1.1"]
    );
    assert_eq!(echoed_header(&echo, "x-forwarded-proto"), ["https"]);
    assert_eq!(echoed_header(&echo, "x-wat2do-viewer-ip"), ["203.0.113.9"]);
}

#[tokio::test]
async fn untrusted_peers_are_presented_to_python_as_the_client() {
    let port = start_python().await;
    let upstream = Arc::new(Upstream::new(port, Duration::from_secs(5)));
    let request = Request::builder()
        .uri("/events/?x=%20")
        .header("x-forwarded-for", "1.2.3.4")
        .header("x-forwarded-proto", "https")
        .body(Body::empty())
        .unwrap();
    let reply = send(state(Some(upstream)), request, "172.17.0.5").await;
    let echo: Value = serde_json::from_slice(&reply.body).unwrap();
    assert_eq!(echo["uri"], "/events/?x=%20");
    // uvicorn on loopback trusts these headers, so they now say what it saw before.
    assert_eq!(echoed_header(&echo, "x-forwarded-for"), ["172.17.0.5"]);
    assert!(echoed_header(&echo, "x-forwarded-proto").is_empty());
}

#[tokio::test]
async fn an_unreachable_python_app_is_a_502() {
    let upstream = Arc::new(Upstream::new(9, Duration::from_secs(1)));
    let reply = send(state(Some(upstream)), get("/events/"), "127.0.0.1").await;
    assert_eq!(reply.status, StatusCode::BAD_GATEWAY);
}
