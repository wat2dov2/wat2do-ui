//! The submission routes before any database read
//! (`backend/tests/routers/test_submissions.py`, `test_position_submissions.py`,
//! `tests/services/test_position_submissions.py`): every body in
//! `testdata/bodies.json` (FastAPI's answers for the real request models)
//! validates to the same 422 or the same stored data, and the routes check
//! the sender, the rate limit and the body in FastAPI's order.

use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::positions::PositionCreate;
use super::*;
use crate::api::client_ip::Peer;
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};

fn outcome(path: &str, bytes: &[u8], headers: &HeaderMap) -> Result<Value, ApiError> {
    match path {
        "/event" => read_create(bytes, headers).map(|(email, input, stored)| {
            let size = model_json_size(&event_dump(&input));
            json!({"dump": {"submitted_by_email": email, "event_data": stored}, "size": size})
        }),
        "/position" => positions::read_create(bytes, headers).map(|(email, position)| {
            let stored = position.dump(true);
            let response = PositionCreate::stored(stored.clone()).unwrap().dump(false);
            json!({"dump": {"submitted_by_email": email, "position_data": stored}, "response": response})
        }),
        "/review" => review_body(bytes, headers, Validator::default()).map(|(status, reason)| {
            json!({"dump": {"status": status, "rejection_reason": reason}})
        }),
        _ => unreachable!(),
    }
}

/// A case's body with each `expand` path (dotted) set to its unit repeated
/// `count` times: a string repeated, or a list of copies.
fn expanded(case: &Value) -> Value {
    let mut body = case["json"].clone();
    for (path, spec) in case["expand"].as_object().into_iter().flatten() {
        let (unit, count) = (&spec[0], spec[1].as_u64().unwrap() as usize);
        let mut target = &mut body;
        let names: Vec<&str> = path.split('.').collect();
        for name in &names[..names.len() - 1] {
            target = &mut target[*name];
        }
        target[names[names.len() - 1]] = match unit {
            Value::String(text) => json!(text.repeat(count)),
            other => json!(vec![other.clone(); count]),
        };
    }
    body
}

#[test]
fn bodies_validate_like_fastapi() {
    let corpus: Vec<Value> = serde_json::from_str(include_str!("testdata/bodies.json")).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    for case in &corpus {
        let path = case["path"].as_str().unwrap();
        let bytes = match (case.get("json"), case.get("body")) {
            (Some(_), _) => serde_json::to_vec(&expanded(case)).unwrap(),
            (None, Some(Value::String(body))) => body.clone().into_bytes(),
            _ => unreachable!(),
        };
        let status = case["status"].as_u64().unwrap();
        let expected: Value = serde_json::from_str(case["response"].as_str().unwrap()).unwrap();
        match outcome(path, &bytes, &headers) {
            // A large answer was kept as its size alone.
            Ok(ours) if expected["dump_elided"] == json!(true) => {
                assert_eq!(status, 200, "{case} passed in Rust: {ours}");
                assert_eq!(ours["size"], expected["size"], "{case}");
            }
            Ok(ours) => {
                assert_eq!(status, 200, "{case} passed in Rust: {ours}");
                assert_eq!(ours, expected, "{case}");
            }
            Err(ApiError::RequestValidation(mut issues)) => {
                assert_eq!(status, 422, "{case} failed in Rust: {issues:?}");
                if expected["inputs_elided"] == json!(true) {
                    for issue in &mut issues {
                        issue.input = Value::Null;
                    }
                }
                // FastAPI quotes Python's JSON decoder; Rust quotes serde's.
                if issues[0].kind == "json_invalid" {
                    assert_eq!(expected["detail"][0]["type"], "json_invalid");
                } else {
                    assert_eq!(
                        json!({ "detail": issues }),
                        json!({"detail": expected["detail"]}),
                        "{case}"
                    );
                }
            }
            Err(other) => panic!("{case}: {other:?}"),
        }
    }
    assert!(corpus.len() > 80);
}

#[test]
fn only_a_pending_submission_is_decided_once() {
    // test_submission_service_rejects_terminal_to_pending,
    // test_terminal_submission_cannot_be_reopened
    assert_eq!(allowed("pending"), ["approved", "rejected"]);
    assert!(allowed("approved").is_empty());
    assert!(allowed("rejected").is_empty());
    assert!(allowed("unknown").is_empty());
    assert!(matches!(
        refuse_transition("sub-001", "approved", "pending"),
        ApiError::Validation { detail, .. } if detail == "Invalid status transition"
    ));
}

#[test]
fn stored_event_data_drops_every_unset_value() {
    let dump = json!({"title": "X", "description": null, "occurrences": [{"dtstart_utc": "2026-12-01T18:00:00Z", "dtend_utc": null}], "price": null});
    assert_eq!(
        without_nulls(dump),
        json!({"title": "X", "occurrences": [{"dtstart_utc": "2026-12-01T18:00:00Z"}]})
    );
}

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
    AppState::new(settings, db, None).unwrap()
}

async fn call(method: Method, path: &str, peer: &str, body: Option<&str>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let mut request = builder
        .body(body.map_or_else(HttpBody::empty, |body| HttpBody::from(body.to_owned())))
        .unwrap();
    request.extensions_mut().insert(Peer(peer.to_owned()));
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
async fn admin_routes_need_a_token() {
    // test_list_submissions_forbidden_for_non_admin (the anonymous half)
    for (method, path) in [
        (Method::GET, "/submissions/"),
        (Method::GET, "/submissions/sub-001"),
        (Method::PATCH, "/submissions/sub-001"),
        (Method::DELETE, "/submissions/sub-001"),
        (Method::GET, "/position-submissions/"),
        (
            Method::PATCH,
            "/position-submissions/00000000-0000-4000-9000-000000000001",
        ),
    ] {
        let body = (method == Method::PATCH).then_some(r#"{"status": "approved"}"#);
        let (status, response) = call(method.clone(), path, "10.2.0.1", body).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {path}");
        assert_eq!(response, json!({"detail": "Not authenticated"}));
    }
    // FastAPI decodes the JSON body before it checks the sender.
    let (status, response) = call(Method::PATCH, "/submissions/x", "10.2.0.1", Some("{bad")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(response["detail"][0]["type"], "json_invalid");
}

#[tokio::test]
async fn public_submissions_need_a_valid_email() {
    // test_public_submission_requires_valid_email
    let event = json!({"title": "X", "location": "Loc", "club_id": 7, "occurrences": [{"dtstart_utc": "2026-12-01T18:00:00+00:00"}]});
    let position = json!({"club_id": 7, "title": "Lead", "description": "Lead our team", "position_type": "committee", "source_url": "https://example.com/role"});
    let mut peer = 0;
    for (path, field, data) in [
        ("/submissions/", "event_data", event),
        ("/position-submissions/", "position_data", position),
    ] {
        for email in [
            None,
            Some(""),
            Some("not-an-email"),
            Some("person@example.com\r\nInjected: header"),
        ] {
            peer += 1;
            let mut body = json!({ field: data.clone() });
            if let Some(email) = email {
                body["submitted_by_email"] = json!(email);
            }
            let (status, response) = call(
                Method::POST,
                path,
                &format!("10.3.0.{peer}"),
                Some(&body.to_string()),
            )
            .await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{path} {email:?}");
            assert_eq!(
                response["detail"][0]["loc"],
                json!(["body", "submitted_by_email"])
            );
        }
    }
}

#[tokio::test]
async fn submissions_are_limited_per_visitor_before_their_bodies_are_read() {
    let budget = crate::controlbox::RATE_LIMITS.submissions.maximum_requests;
    for path in ["/submissions/", "/position-submissions/"] {
        for _ in 0..budget {
            let (status, _) = call(Method::POST, path, "10.4.0.1", Some("{}")).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        }
        let (status, response) = call(Method::POST, path, "10.4.0.1", Some("{}")).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{path}");
        assert_eq!(
            response["detail"],
            crate::api::messages::RATE_LIMIT_EXCEEDED
        );
    }
    // Malformed JSON is refused before the limit is counted.
    let (status, _) = call(Method::POST, "/submissions/", "10.4.0.1", Some("{bad")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[test]
fn position_responses_show_every_field() {
    // test_authenticated_creation_uses_position_resource: `is_paid` stays null.
    let stored = json!({"title": "Design Lead", "description": "Lead the design team.", "position_type": "committee", "requirements": [], "club_id": 7, "source_url": "https://example.com/jobs/design"});
    let position = PositionCreate::stored(stored.clone()).unwrap();
    assert_eq!(position.dump(true), stored);
    let full = position.dump(false);
    assert_eq!(full["is_paid"], Value::Null);
    assert_eq!(
        full.as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "title",
            "description",
            "position_type",
            "requirements",
            "commitment",
            "compensation",
            "is_paid",
            "location",
            "contact_email",
            "deadline_date",
            "deadline_at",
            "club_id",
            "source_url",
            "source_image_url"
        ]
    );
    // Stored data that no longer validates is a server error, as in Python.
    assert!(PositionCreate::stored(json!({"title": "x"})).is_err());
}

/// Every write statement of the submission routes plans against the real
/// schema (column names, types, the review function's signature) on a
/// read-only session, which refuses to run any of them: `EXPLAIN` without
/// `ANALYZE` plans a write without executing it.
#[tokio::test]
#[ignore = "plans against production through DATABASE_URL"]
async fn write_statements_plan_against_production() {
    crate::install_tls();
    let db = crate::db::connect_lazy(
        crate::db::connect_options().unwrap(),
        1,
        Duration::from_secs(30),
        Duration::from_secs(30),
        true,
    );
    let read_only: String = sqlx::query_scalar("SHOW default_transaction_read_only")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(read_only, "on");
    let id = uuid::Uuid::nil();
    let explain = |sql: String| format!("EXPLAIN {sql}");
    sqlx::query(&explain(insert_sql()))
        .bind(id)
        .bind(Some(id))
        .bind("a@b.c")
        .bind(json!({"title": "x"}))
        .bind(1_i32)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(LOCK_SQL.to_owned()))
        .bind(id.to_string())
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(update_sql()))
        .bind(id.to_string())
        .bind("rejected")
        .bind(chrono::Utc::now())
        .bind(Some("reason"))
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(DELETE_SQL.to_owned()))
        .bind(id.to_string())
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(positions::insert_sql()))
        .bind(id)
        .bind(None::<uuid::Uuid>)
        .bind("a@b.c")
        .bind(json!({"title": "x"}))
        .bind(1_i32)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(positions::review_sql()))
        .bind(id)
        .bind("approved")
        .bind(None::<String>)
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query(&explain(
        crate::api::events::writes::OCCURRENCES_INSERT.to_owned(),
    ))
    .bind(json!([{"dtstart_utc": "2026-12-01T18:00:00Z", "event_id": 1}]))
    .execute(&db)
    .await
    .unwrap();
    // The approval's event insert, run for real inside the read-only
    // transaction: Postgres refuses it with 25006 after parsing and planning.
    let input = crate::api::events::requests::event(
        crate::api::body::Body::nested(
            json!({"title": "Plan check", "location": "SLC", "club_id": 1,
                   "occurrences": [{"dtstart_utc": "2026-12-01T18:00:00Z"}]}),
            Vec::new(),
            Extra::Forbid,
        )
        .unwrap(),
        false,
    )
    .unwrap();
    let club = crate::api::events::writes::Club {
        id: 1,
        club_name: "Plan check".into(),
        status: "approved".into(),
        school_id: Some(1),
        school: Some("uwaterloo".into()),
        is_member: false,
    };
    let mut transaction = db.begin().await.unwrap();
    let refused =
        crate::api::events::writes::insert(&mut transaction, input, &club, &id.to_string())
            .await
            .unwrap_err();
    let ApiError::Database(error) = refused else {
        panic!("{refused:?}")
    };
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("25006")
    );
}
