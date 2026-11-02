//! `backend/tests/routers/test_qr.py` and `test_qr_code_service.py`: the
//! `/qr` routes as clients see them before any database read, every 422
//! body FastAPI gave for the same requests (`fastapi_422.json`, recorded
//! from the Python app), and the poster rules.

use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::posters::{
    CreateRequest, PromoterBatch, compact_json_size, creation_template, is_safe_url,
    promoter_copy_names, read_create, read_update,
};
use super::*;
use crate::api::body::{Body, Extra, Str};
use crate::api::client_ip::Peer;
use crate::api::{AppState, router};
use crate::controlbox::{PromoterProgram, PromoterTemplate};
use crate::settings::{Settings, test_settings};

pub(crate) fn fixtures(group: &str) -> Vec<(Option<Value>, Value)> {
    let all: Vec<Value> = serde_json::from_str(include_str!("fastapi_422.json")).unwrap();
    all.into_iter()
        .filter(|case| case["group"] == group)
        .map(|case| {
            let body = case.get("body").cloned().filter(|body| !body.is_null());
            (body, case["detail"].clone())
        })
        .collect()
}

pub(crate) fn json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers
}

pub(crate) fn bytes(body: &Option<Value>) -> Vec<u8> {
    body.as_ref()
        .map(|body| body.to_string().into_bytes())
        .unwrap_or_default()
}

pub(crate) fn issues(result: Result<(), ApiError>) -> Value {
    match result {
        Err(ApiError::RequestValidation(issues)) => json!(issues),
        other => panic!("expected a 422, got {other:?}"),
    }
}

#[test]
fn create_bodies_fail_like_fastapi() {
    let cases = fixtures("create");
    assert!(cases.len() > 30);
    for (body, detail) in cases {
        let result = crate::api::validation::parse_json_body::<Value>(&bytes(&body), true)
            .and_then(read_create)
            .map(|_| ());
        assert_eq!(issues(result), detail, "{body:?}");
    }
}

#[test]
fn update_bodies_fail_like_fastapi() {
    for (body, detail) in fixtures("update") {
        let result =
            Body::parse(&bytes(&body), &json_headers(), Extra::Forbid).and_then(|mut parsed| {
                read_update(&mut parsed);
                parsed.finish()
            });
        assert_eq!(issues(result), detail, "{body:?}");
    }
}

#[test]
fn confirm_bodies_fail_like_fastapi() {
    for (body, detail) in fixtures("confirm") {
        let result =
            Body::parse(&bytes(&body), &json_headers(), Extra::Forbid).and_then(|mut parsed| {
                parsed.required_string("token", &Str::new().min(1).max(2048));
                parsed.finish()
            });
        assert_eq!(issues(result), detail, "{body:?}");
    }
}

#[test]
fn valid_create_bodies_pick_their_member() {
    let standard = read_create(json!({"id": "safe-qr", "name": "Safe", "destination_type": "custom-url", "destination_id": "https://example.com"})).unwrap();
    let CreateRequest::Standard(fields) = standard else {
        panic!("standard")
    };
    assert_eq!(fields.latitude, 0.0);
    assert!(matches!(
        read_create(
            json!({"id": "null-url-qr", "name": "No URL", "destination_type": "custom-url", "destination_id": null})
        ),
        Ok(CreateRequest::Standard(_))
    ));
    // pydantic's lax coercions: a whole float or a bool is an int, a numeric string a float.
    let lax = read_create(json!({"id": "ab", "name": "n", "destination_type": "event", "destination_id": true, "latitude": "4.5", "longitude": true, "program": "standard"})).unwrap();
    let CreateRequest::Standard(fields) = lax else {
        panic!("standard")
    };
    assert_eq!(
        fields.destination_id,
        Some(super::posters::DestinationInput::Integer(1))
    );
    assert_eq!((fields.latitude, fields.longitude), (4.5, 1.0));
    assert_eq!(
        read_create(json!({"program": "promoter", "poster_template_id": "campus-colour", "name": "SLC", "copies": "3"})).unwrap(),
        CreateRequest::Promoter(PromoterBatch { poster_template_id: "campus-colour".into(), name: "SLC".into(), copies: 3 })
    );
    assert!(matches!(
        read_create(
            json!({"program": "promoter", "poster_template_id": "ok", "name": "n", "copies": 2.0})
        ),
        Ok(CreateRequest::Promoter(PromoterBatch { copies: 2, .. }))
    ));
}

#[test]
fn safe_urls_follow_urlparse() {
    for (url, safe) in [
        ("https://a", true),
        ("http:/x", false),
        (" https://a.b", true),
        ("HTTPS://X", true),
        ("https://[::1", false),
        ("ht tp://x", false),
        ("https://a\tb", true),
        ("javascript://x", false),
        ("https:x", false),
        ("//x", false),
        ("data:text/html,<script>", false),
    ] {
        assert_eq!(is_safe_url(url), safe, "{url:?}");
    }
}

#[test]
fn filter_size_is_measured_like_python_json_dumps() {
    // len(json.dumps(value, separators=(",", ":")).encode())
    let value = json!({"a": "é😀\n", "b": [1, 2.5, null, true], "c": 0.00001});
    assert_eq!(compact_json_size(&value), 60);
}

#[test]
fn promoter_copy_names_fit_two_hundred_characters() {
    assert_eq!(promoter_copy_names("SLC", 1), ["SLC"]);
    assert_eq!(
        promoter_copy_names("SLC second floor", 2),
        ["SLC second floor - 1 of 2", "SLC second floor - 2 of 2"]
    );
    let long = "x".repeat(200);
    let names = promoter_copy_names(&long, 12);
    assert!(names.iter().all(|name| name.chars().count() == 200));
    assert!(names[11].ends_with(" - 12 of 12"));
}

fn template(id: &str, school: &str, available: bool) -> PromoterTemplate {
    PromoterTemplate {
        id: id.into(),
        asset_path: format!("/poster-templates/{id}-v1.png"),
        eligible_school: school.into(),
        available_for_creation: available,
    }
}

#[test]
fn creation_templates_must_be_approved_available_and_for_the_school() {
    let control = PromoterProgram {
        approved_templates: vec![
            template("campus-colour", "global", true),
            template("retired-template", "global", false),
            template("utsg-template", "utsg", true),
        ],
        ..PROMOTER_PROGRAM.clone()
    };
    assert_eq!(
        creation_template(&control, "campus-colour", "uwaterloo")
            .unwrap()
            .id,
        "campus-colour"
    );
    assert_eq!(
        creation_template(&control, "utsg-template", "utsg")
            .unwrap()
            .id,
        "utsg-template"
    );
    let detail = |result: Result<&PromoterTemplate, ApiError>| match result {
        Err(ApiError::Validation { detail, .. }) => detail,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        detail(creation_template(&control, "not-approved", "uwaterloo")),
        "Approved poster template not found"
    );
    assert_eq!(
        detail(creation_template(&control, "retired-template", "uwaterloo")),
        "This poster template is not available for new posters"
    );
    assert_eq!(
        detail(creation_template(&control, "utsg-template", "uwaterloo")),
        "This poster template is not available for your school"
    );
    // Every configured template is a real, creatable one.
    for configured in &PROMOTER_PROGRAM.approved_templates {
        assert!(creation_template(&PROMOTER_PROGRAM, &configured.id, "uwaterloo").is_ok());
    }
    assert!(
        PROMOTER_PROGRAM.maximum_active_posters < 51,
        "a 51-copy batch is over the cap"
    );
}

#[test]
fn visitor_buckets_use_the_controlbox_maximums() {
    for (visitors, bucket) in [
        (0, "none"),
        (1, "low"),
        (9, "low"),
        (10, "medium"),
        (49, "medium"),
        (50, "high"),
    ] {
        assert_eq!(confirmed_visitor_bucket(visitors), bucket, "{visitors}");
    }
}

#[test]
fn the_school_is_shown_last_inside_object_filters() {
    assert_eq!(
        serde_json::to_string(&with_school(
            Some(json!({"school": "old", "b": 1, "a": 2})),
            Some("uwaterloo")
        ))
        .unwrap(),
        r#"{"b":1,"a":2,"school":"uwaterloo"}"#
    );
    assert_eq!(
        with_school(Some(json!({"school": "old"})), None),
        Some(json!({}))
    );
    assert_eq!(
        with_school(Some(json!([1])), Some("uwaterloo")),
        Some(json!([1]))
    );
    assert_eq!(with_school(None, Some("uwaterloo")), None);
}

fn state() -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[
        ("POSTER_HASH_SECRET", "hash-secret"),
        ("POSTER_CONFIRMATION_SECRET", "confirmation-secret"),
    ])));
    // Nothing listens here: a test that reached the database would fail.
    let db = crate::db::connect_lazy(
        "postgres://localhost:1/none".parse().unwrap(),
        1,
        Duration::from_secs(1),
        Duration::from_millis(200),
        false,
    );
    AppState::new(settings, db, None, None).unwrap()
}

pub(crate) async fn call(
    method: Method,
    path: &str,
    body: Option<&str>,
    cookie: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    let body = match body {
        Some(text) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(text.to_owned())
        }
        None => HttpBody::empty(),
    };
    let mut request = builder.body(body).unwrap();
    request.extensions_mut().insert(Peer("testclient".into()));
    let response = crate::api::app(router(state()))
        .oneshot(request)
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn signed_in_routes_need_a_token() {
    // test_*_requires_auth and test_list_own_payouts_requires_auth.
    let valid = r#"{"id": "x", "name": "X", "destination_type": "custom-url"}"#;
    for (method, path, body) in [
        (Method::GET, "/qr/", None),
        (Method::GET, "/qr/scans", None),
        (Method::GET, "/qr/earnings", None),
        (Method::POST, "/qr/", Some(valid)),
        (
            Method::PATCH,
            "/qr/test-qr",
            Some(r#"{"id": "test-qr", "name": "X", "destination_type": "custom-url"}"#),
        ),
        (Method::DELETE, "/qr/test-qr", None),
        // Starlette's fall-through from a static path to the poster route.
        (Method::PATCH, "/qr/scans", Some(valid)),
        (Method::DELETE, "/qr/map", None),
        (Method::DELETE, "/qr/earnings", None),
        (Method::GET, "/payouts/", None),
        (Method::GET, "/payouts/admin", None),
        (
            Method::GET,
            "/payouts/admin/00000000-0000-0000-0000-000000000001",
            None,
        ),
        (Method::GET, "/payouts/admin/export", None),
        (Method::GET, "/payouts/admin/mark-paid", None),
        (
            Method::POST,
            "/payouts/admin/export",
            Some(r#"{"payout_ids": []}"#),
        ),
        (
            Method::POST,
            "/payouts/admin/mark-paid",
            Some(r#"{"payout_ids": []}"#),
        ),
        (
            Method::PATCH,
            "/payouts/admin/x/status",
            Some(r#"{"status": "paid"}"#),
        ),
    ] {
        let (status, headers, body) = call(method.clone(), path, body, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path}");
        assert_eq!(body, json!({"detail": "Not authenticated"}));
        assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
    }
}

#[tokio::test]
async fn malformed_json_is_refused_before_authentication() {
    for (method, path) in [
        (Method::POST, "/qr/"),
        (Method::PATCH, "/qr/x"),
        (Method::POST, "/qr/scans/confirm"),
        (Method::POST, "/payouts/admin/export"),
        (Method::POST, "/payouts/admin/mark-paid"),
        (Method::PATCH, "/payouts/admin/x/status"),
    ] {
        let (status, _, body) = call(method.clone(), path, Some("{bad"), None).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{method} {path}");
        assert_eq!(body["detail"][0]["type"], "json_invalid");
    }
}

#[tokio::test]
async fn wrong_methods_get_starlettes_405() {
    for (method, path, allow) in [
        (Method::POST, "/qr/scans", "GET"),
        (Method::GET, "/qr/scans/confirm", "POST"),
        (Method::PUT, "/qr/x", "GET"),
        (Method::DELETE, "/payouts/", "GET"),
        (Method::PUT, "/payouts/admin/x/status", "PATCH"),
    ] {
        let (status, headers, body) = call(method.clone(), path, None, None).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED, "{method} {path}");
        assert_eq!(headers[header::ALLOW], allow);
        assert_eq!(body, json!({"detail": "Method Not Allowed"}));
    }
}

#[tokio::test]
async fn the_public_routes_validate_before_reading() {
    let (status, _, body) = call(Method::GET, "/qr/map", None, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body,
        json!({"detail": [{"type": "missing", "loc": ["query", "school"], "msg": "Field required", "input": null}]})
    );
    let (_, _, body) = call(Method::GET, "/qr/map?school=", None, None).await;
    assert_eq!(
        body,
        json!({"detail": [{"type": "string_too_short", "loc": ["query", "school"], "msg": "String should have at least 1 character", "input": "", "ctx": {"min_length": 1}}]})
    );
    let (status, headers, body) = call(Method::GET, "/qr/abc?lat=91&lon=abc", None, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(headers.get(header::SET_COOKIE).is_none());
    assert_eq!(
        body.to_string(),
        r#"{"detail":[{"type":"less_than_equal","loc":["query","lat"],"msg":"Input should be less than or equal to 90","input":"91","ctx":{"le":90.0}},{"type":"float_parsing","loc":["query","lon"],"msg":"Input should be a valid number, unable to parse string as a number","input":"abc"}]}"#
    );
    let (_, _, body) = call(Method::GET, "/qr/abc?lat=-90.5&lon=inf", None, None).await;
    assert_eq!(
        body.to_string(),
        r#"{"detail":[{"type":"greater_than_equal","loc":["query","lat"],"msg":"Input should be greater than or equal to -90","input":"-90.5","ctx":{"ge":-90.0}},{"type":"less_than_equal","loc":["query","lon"],"msg":"Input should be less than or equal to 180","input":"inf","ctx":{"le":180.0}}]}"#
    );
    let (_, _, body) = call(Method::GET, "/qr/abc?lat=nan&lon=1e400", None, None).await;
    assert_eq!(body["detail"][0]["type"], "less_than_equal");
    assert_eq!(body["detail"][1]["type"], "less_than_equal");
}

#[tokio::test]
async fn scan_confirmation_needs_the_visitor_cookie_and_a_valid_token() {
    // test_scan_confirmation_requires_matching_visitor_cookie
    let invalid = json!({"detail": "Invalid or expired scan confirmation"});
    let (status, _, body) = call(
        Method::POST,
        "/qr/scans/confirm",
        Some(r#"{"token": "signed-token"}"#),
        None,
    )
    .await;
    assert_eq!(
        (status, body.clone()),
        (StatusCode::BAD_REQUEST, invalid.clone())
    );
    let long = format!("wat2do_poster_visitor={}", "a".repeat(257));
    let (status, _, _) = call(
        Method::POST,
        "/qr/scans/confirm",
        Some(r#"{"token": "t"}"#),
        Some(&long),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _, body) = call(
        Method::POST,
        "/qr/scans/confirm",
        Some(r#"{"token": "signed-token"}"#),
        Some("wat2do_poster_visitor=visitor-token"),
    )
    .await;
    assert_eq!((status, body), (StatusCode::BAD_REQUEST, invalid));
}

#[tokio::test]
async fn the_scan_limiter_counts_before_validation_and_answers_429() {
    // test_qr_scan_rate_limit_triggers_429: the limiter is keyed by the
    // hashed client IP, so its warning never logs the raw address.
    let maximum = crate::controlbox::RATE_LIMITS.qr_scans.maximum_requests;
    let mut last = StatusCode::OK;
    let mut headers = HeaderMap::new();
    for _ in 0..=maximum {
        (last, headers, _) = call(Method::GET, "/qr/abc?lat=999", None, None).await;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    assert!(
        headers[header::RETRY_AFTER]
            .to_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            >= 1
    );
}
