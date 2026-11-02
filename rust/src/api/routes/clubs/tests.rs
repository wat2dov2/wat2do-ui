//! The clubs group's routes as clients see them, before any database read:
//! authentication, FastAPI's 422 bodies and the shapes of the club bodies
//! (`backend/tests/routers/test_clubs.py`, `test_saved_clubs.py`,
//! `test_users.py`, `test_positions.py`, `test_schools.py`,
//! `test_discovery_queries.py`, `test_ingestion_latency.py`).

use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::api::client_ip::Peer;
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};

fn state() -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
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

async fn call(method: Method, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(json.to_string())
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
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn signed_in_routes_need_a_token() {
    // test_*_requires_auth across the ported routers.
    for (method, path) in [
        (Method::GET, "/clubs/mine"),
        (Method::GET, "/clubs/review"),
        (Method::GET, "/clubs/claims"),
        (Method::PATCH, "/clubs/1"),
        (Method::DELETE, "/clubs/1"),
        (Method::GET, "/clubs/1/members"),
        (Method::POST, "/clubs/1/members"),
        (Method::DELETE, "/clubs/1/members/x"),
        (Method::GET, "/clubs/1/invitations"),
        (Method::POST, "/clubs/1/claims"),
        (Method::POST, "/clubs/invitations/x/accept"),
        (Method::PATCH, "/clubs/claims/x"),
        (Method::GET, "/saved-clubs/"),
        (Method::PUT, "/saved-clubs/1"),
        (Method::DELETE, "/saved-clubs/1"),
        (Method::GET, "/users/me"),
        (Method::PATCH, "/users/me"),
        (Method::PATCH, "/users/me/profile"),
        (Method::PUT, "/users/me/promoter-enrollment"),
        (Method::GET, "/users/"),
        (Method::GET, "/users/x"),
        (Method::DELETE, "/users/x"),
        (Method::PATCH, "/users/x/role"),
        (Method::GET, "/discovery-queries/"),
        (Method::GET, "/ingestion-latency/"),
    ] {
        let (status, body) = call(method.clone(), path, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path}");
        assert_eq!(
            body,
            json!({"detail": "Not authenticated"}),
            "{method} {path}"
        );
    }
}

#[tokio::test]
async fn public_parameters_are_validated_like_fastapi() {
    let (status, body) = call(Method::GET, "/clubs/?page=0&club_type=A", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // FastAPI reports the pagination dependency's problems first.
    assert_eq!(
        body,
        json!({"detail": [
            {"type": "greater_than_equal", "loc": ["query", "page"], "msg": "Input should be greater than or equal to 1", "input": "0", "ctx": {"ge": 1}},
            {"type": "string_pattern_mismatch", "loc": ["query", "club_type"], "msg": "String should match pattern '^[a-z0-9]+(?:-[a-z0-9]+)*$'", "input": "A", "ctx": {"pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}}
        ]})
    );
    let (_, body) = call(Method::GET, "/clubs/?ids=1&ids=x&min_events=-1", None).await;
    assert_eq!(body["detail"][0]["loc"], json!(["query", "ids", 1]));
    assert_eq!(body["detail"][1]["type"], "greater_than_equal");

    // `/clubs/invitations` reads as a club id, as in FastAPI's route order.
    let (status, body) = call(Method::GET, "/clubs/invitations", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["loc"], json!(["path", "club_id"]));

    let (status, body) = call(
        Method::GET,
        "/positions/?added_since=2024-01-01T00:00:00&sort_order=x&position_type=y",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let kinds: Vec<&str> = body["detail"]
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| issue["type"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["literal_error", "timezone_aware", "literal_error"]);

    let (status, body) = call(Method::GET, "/positions/stats", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["detail"][0]["type"], "missing");
    let (status, _) = call(Method::GET, "/positions/abc", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = call(Method::GET, "/schools?limit=51", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn club_submissions_are_validated_before_anything_else() {
    // FastAPI's body for this submission (test_create_club_rejects_invalid_email and friends).
    let (status, body) = call(
        Method::POST,
        "/clubs/",
        Some(
            json!({"club_name": "  ", "school": "x", "club_page": "javascript:x",
            "categories": ["Nope", "Arts"], "club_type": "Bad Type!",
            "submitted_by_email": "not-an-email", "extra": 1}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body,
        json!({"detail": [
            {"type": "value_error", "loc": ["body", "submitted_by_email"], "msg": "value is not a valid email address: An email address must have an @-sign.", "input": "not-an-email", "ctx": {"reason": "An email address must have an @-sign."}},
            {"type": "value_error", "loc": ["body", "club_name"], "msg": "Value error, value cannot be blank", "input": "  ", "ctx": {"error": {}}},
            {"type": "value_error", "loc": ["body", "categories"], "msg": "Value error, categories must be from: Arts & Culture, Academics & Science, Business, Community Service, Environment, Games & Recreation, Health, Media & Web, Politics & Advocacy, Religion & Spirituality", "input": ["Nope", "Arts"], "ctx": {"error": {}}},
            {"type": "value_error", "loc": ["body", "club_page"], "msg": "Value error, URL must use http or https scheme", "input": "javascript:x", "ctx": {"error": {}}},
            {"type": "string_pattern_mismatch", "loc": ["body", "club_type"], "msg": "String should match pattern '^[a-z0-9]+(?:-[a-z0-9]+)*$'", "input": "bad type!", "ctx": {"pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}},
            {"type": "extra_forbidden", "loc": ["body", "extra"], "msg": "Extra inputs are not permitted", "input": 1}
        ]})
    );
    // test_club_create_rejects_old_field_names
    let (_, body) = call(
        Method::POST,
        "/clubs/",
        Some(json!({"club_name": "x", "organization_name": "y"})),
    )
    .await;
    assert_eq!(body["detail"][0]["type"], "extra_forbidden");
    let (_, body) = call(Method::POST, "/clubs/", Some(json!([1]))).await;
    assert_eq!(body["detail"][0]["type"], "model_attributes_type");
}

#[tokio::test]
async fn discovery_telemetry_is_validated_before_writes() {
    let (status, body) = call(
        Method::POST,
        "/discovery-queries/",
        Some(json!({"id": "x", "school": " ", "surface": "q", "search_query": 1, "page_url": "ftp://x", "filters": []})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let kinds: Vec<&str> = body["detail"]
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| issue["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "uuid_parsing",
            "string_too_short",
            "literal_error",
            "string_type",
            "url_scheme",
            "dict_type"
        ]
    );
}

#[tokio::test]
async fn constants_are_public_and_cacheable() {
    let mut request = Request::builder()
        .uri("/meta/constants")
        .header(header::HOST, "testserver")
        .body(HttpBody::empty())
        .unwrap();
    request.extensions_mut().insert(Peer("testclient".into()));
    let response = crate::api::app(router(state()))
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "public, max-age=60"
    );
}

fn club_body(value: Value, create: bool) -> Result<ClubFields, ApiError> {
    parse_club(Body::from_value(value, Extra::Forbid), create)
}

#[test]
fn club_bodies_normalize_like_pydantic() {
    // test_create_club_accepts_submission_without_email
    let fields = club_body(json!({"club_name": "  Chess Club ", "categories": [" Business ", "Business"], "club_page": " https://example.com ", "logo_url": "  ", "club_type": " UTSU "}), true).unwrap();
    assert_eq!(fields.club_name, Input::Given("Chess Club".into()));
    assert_eq!(fields.categories, Input::Given(vec!["Business".into()]));
    assert_eq!(fields.club_page, Input::Given("https://example.com".into()));
    assert_eq!(fields.logo_url, Input::Null);
    assert_eq!(fields.club_type, Input::Given("utsu".into()));
    assert_eq!(fields.school, Input::Given("uwaterloo".into()));
    assert_eq!(fields.submitted_by_email, None);
    let defaults = club_body(json!({"club_name": "x"}), true).unwrap();
    assert_eq!(
        defaults.club_type,
        Input::Given(CLUB_TYPE_INDEPENDENT.into())
    );

    // An update changes only what was sent; a blank name or school is refused.
    let update = club_body(json!({"ig": "@chess", "discord": null}), false).unwrap();
    assert_eq!(update.ig, Input::Given("@chess".into()));
    assert_eq!(update.discord, Input::Null);
    assert_eq!(update.club_name, Input::Missing);
    assert_eq!(update.school, Input::Missing);
    match club_body(json!({"school": "  "}), false) {
        Err(ApiError::RequestValidation(issues)) => {
            assert_eq!(
                issues[0].msg,
                "Value error, value cannot be blank on update"
            )
        }
        other => panic!("{other:?}"),
    }
    // test_club_contract_has_no_organization_aliases
    assert!(club_body(json!({"organization_id": 1}), false).is_err());
}

#[test]
fn club_urls_must_be_http() {
    assert_eq!(
        safe_http_url("https://x.ca/a"),
        Ok(Some("https://x.ca/a".into()))
    );
    assert_eq!(
        safe_http_url(" HTTP://x.ca "),
        Ok(Some("HTTP://x.ca".into()))
    );
    assert_eq!(safe_http_url("   "), Ok(None));
    for unsafe_url in [
        "javascript:alert(1)",
        "data:text/html,x",
        "file:///etc",
        "http:///path",
        "x.ca",
        "https://[::1",
    ] {
        assert!(safe_http_url(unsafe_url).is_err(), "{unsafe_url}");
    }
}

#[test]
fn admin_search_keeps_postgrest_wildcards() {
    let filters = AdminFilters::new("claims", Some("  a*b  ".into()), Some(String::new()), None);
    assert_eq!(filters.search.as_deref(), Some("%a%b%"));
    assert_eq!(filters.school, None);
    assert_eq!(
        AdminFilters::new("claims", Some("   ".into()), None, None).search,
        None
    );
}

#[test]
fn club_rows_serialize_in_the_model_order() {
    // test_public_club_response_preserves_creation_time
    let club: ClubResponse = serde_json::from_value(json!({
        "id": 7, "club_name": "Chess", "status": "approved", "categories": ["Business"],
        "club_page": null, "ig": null, "discord": null, "club_type": "independent",
        "logo_url": null, "created_by": null, "created_at": "2026-09-14T12:00:00.5+00:00",
        "school_id": 1, "submitted": false
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_string(&club).unwrap(),
        r#"{"id":7,"club_name":"Chess","status":"approved","categories":["Business"],"club_page":null,"ig":null,"discord":null,"club_type":"independent","logo_url":null,"created_by":null,"created_at":"2026-09-14T12:00:00.500000Z","school":null,"owner_email":null,"event_count":0,"position_count":0}"#
    );
    let submission = ClubSubmissionResponse {
        club,
        submitted_by_email: Some("visitor@example.com".into()),
    };
    assert!(
        serde_json::to_string(&submission)
            .unwrap()
            .ends_with(r#""position_count":0,"submitted_by_email":"visitor@example.com"}"#)
    );
}
