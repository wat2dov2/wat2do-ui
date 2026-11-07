//! The outreach, competitor pain point and automate log routes against a real
//! Postgres loaded with our schema, so every statement runs as in production.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job); without it each test returns at once. Each test
//! works on rows only it can match (fresh names, links and senders).

use std::time::Duration;

use axum::body::Body as HttpBody;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::api::auth::test_tokens::access_token;
use crate::api::client_ip::Peer;
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};

const AUTOMATE_KEY: &str = "automate-test-key";

fn database() -> Option<PgPool> {
    let Some(url) = std::env::var("WAT2DO_TEST_DATABASE_URL")
        .ok()
        .filter(|url| !url.is_empty())
    else {
        assert!(
            std::env::var_os("WAT2DO_DATABASE_TESTS_REQUIRED").is_none(),
            "WAT2DO_DATABASE_TESTS_REQUIRED is set but WAT2DO_TEST_DATABASE_URL is not"
        );
        return None;
    };
    Some(crate::db::connect_lazy(
        url.parse()
            .expect("WAT2DO_TEST_DATABASE_URL is a Postgres URL"),
        5,
        Duration::from_secs(30),
        Duration::from_secs(30),
        false,
    ))
}

fn state(db: PgPool) -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[(
        "AUTOMATE_WEBHOOK_KEY",
        AUTOMATE_KEY,
    )])));
    AppState::new(settings, db, None).unwrap()
}

/// A new admin's access token.
async fn admin(db: &PgPool) -> String {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO public.users (id, email, auth_id, full_name, role) \
         VALUES ($1, $2, $3, 'Admin Tester', 'admin')",
    )
    .bind(id)
    .bind(format!("admin-{}@example.com", id.simple()))
    .bind(id.to_string())
    .execute(db)
    .await
    .unwrap();
    access_token(&id.to_string())
}

async fn call(
    db: &PgPool,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver")
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(json.to_string())
        }
        None => HttpBody::empty(),
    };
    let mut request = builder.body(body).unwrap();
    request.extensions_mut().insert(Peer("testclient".into()));
    let response = crate::api::app(router(state(db.clone())))
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

/// A new club at uwaterloo with a lead; the lead has an email unless `email` is `None`.
async fn lead(db: &PgPool, name: &str, email: Option<&str>) -> (i32, Uuid) {
    let club: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, status) \
         SELECT $1, id, 'approved' FROM public.schools WHERE slug = 'uwaterloo' RETURNING id",
    )
    .bind(name)
    .fetch_one(db)
    .await
    .unwrap();
    let lead: Uuid = sqlx::query_scalar(
        "INSERT INTO public.outreach_leads \
             (club_id, email, email_source_url, email_found_by, found_at, formality) \
         VALUES ($1, $2, CASE WHEN $2 IS NULL THEN NULL ELSE 'https://example.com/clubs' END, \
             CASE WHEN $2 IS NULL THEN NULL ELSE 'club_page' END, \
             CASE WHEN $2 IS NULL THEN NULL ELSE now() END, 40) \
         RETURNING id",
    )
    .bind(club)
    .bind(email)
    .fetch_one(db)
    .await
    .unwrap();
    (club, lead)
}

#[tokio::test]
async fn admins_list_and_update_outreach_leads() {
    let Some(db) = database() else { return };
    let token = admin(&db).await;
    let tag = Uuid::new_v4().simple().to_string();
    let name = format!("Lead Club {tag}");
    let (club, lead_id) = lead(&db, &name, Some("leads@example.com")).await;
    let (_, hidden) = lead(&db, &format!("Lead Club {tag} hidden"), None).await;

    for sort in ["newest", "formality"] {
        let (status, page) = call(
            &db,
            &token,
            Method::GET,
            &format!("/outreach/leads/?school=uwaterloo&search={tag}&sort={sort}"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{page}");
        assert_eq!(page["total"], 1, "{page}");
        let item = &page["items"][0];
        assert_eq!(item["id"], lead_id.to_string());
        assert_eq!(item["club_name"], name.as_str());
        assert_eq!(
            item["club_url"],
            format!("https://uwaterloo.wat2do.io/clubs/{club}")
        );
        assert_eq!(item["listings"], 0);
        assert_eq!(item["school_slug"], "uwaterloo");
        assert_eq!(item["formality"], 40);
        assert_eq!(item["formality_signals"], json!([]));
        assert!(item["email_body"].as_str().unwrap().contains(&name));
    }

    let path = format!("/outreach/leads/{lead_id}");
    let (status, updated) = call(
        &db,
        &token,
        Method::PATCH,
        &path,
        Some(json!({"status": "contacted", "notes": "Sent"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "contacted");
    assert_eq!(updated["notes"], "Sent");
    // Null keeps the column.
    let (_, kept) = call(
        &db,
        &token,
        Method::PATCH,
        &path,
        Some(json!({"status": null, "notes": "Followed up"})),
    )
    .await;
    assert_eq!(kept["status"], "contacted");
    assert_eq!(kept["notes"], "Followed up");

    for missing in [Uuid::new_v4(), hidden] {
        let (status, body) = call(
            &db,
            &token,
            Method::PATCH,
            &format!("/outreach/leads/{missing}"),
            Some(json!({"status": "replied"})),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({"detail": "Outreach lead not found"}));
    }
}

#[tokio::test]
async fn admins_review_competitor_pain_points_and_read_reports() {
    let Some(db) = database() else { return };
    let token = admin(&db).await;
    let tag = Uuid::new_v4().simple().to_string();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO public.competitor_pain_points \
             (competitor, source, url, quote, pain_point, audience) \
         VALUES ('eventbrite', 'reddit', $1, $2, 'Fees on free club events', 'organizer') \
         RETURNING id",
    )
    .bind(format!("https://www.reddit.com/r/example/comments/{tag}/"))
    .bind(format!("Fees on every RSVP {tag}"))
    .fetch_one(&db)
    .await
    .unwrap();

    let (status, page) = call(
        &db,
        &token,
        Method::GET,
        &format!("/competitor-pain-points/?competitor=eventbrite&audience=organizer&search={tag}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total"], 1, "{page}");
    assert_eq!(page["items"][0]["id"], id.to_string());
    assert_eq!(page["items"][0]["author"], "");
    assert_eq!(page["items"][0]["posted_at"], Value::Null);

    let path = format!("/competitor-pain-points/{id}");
    let (status, reviewed) = call(
        &db,
        &token,
        Method::PATCH,
        &path,
        Some(json!({"status": "dismissed"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reviewed}");
    assert_eq!(reviewed["status"], "dismissed");
    let (status, body) = call(
        &db,
        &token,
        Method::PATCH,
        &format!("/competitor-pain-points/{}", Uuid::new_v4()),
        Some(json!({"status": "seen"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({"detail": "Competitor pain point not found"}));

    // A report dated far ahead, so it is first.
    let days = i64::from(Uuid::new_v4().as_bytes()[0]) * 64 + 1;
    let report: Uuid = sqlx::query_scalar(
        "INSERT INTO public.competitor_pain_point_reports \
             (report_date, model, complaint_count, summary, suggestions) \
         VALUES (DATE '3000-01-01' + $1::int, 'claude-opus-5-5', 12, 'Fees', $2) RETURNING id",
    )
    .bind(i32::try_from(days).unwrap())
    .bind(
        json!([{"title": "Say it is free", "priority": "high", "problem": "Fees",
        "change": "Add a line", "complaint_urls": []}]),
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let (status, reports) = call(
        &db,
        &token,
        Method::GET,
        "/competitor-pain-points/reports?page_size=100",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reports}");
    let found = reports["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == report.to_string())
        .expect("the report is listed");
    assert_eq!(found["themes"], json!([]));
    assert_eq!(found["suggestions"][0]["where"], json!([]));
    assert_eq!(found["complaint_count"], 12);
    sqlx::query("DELETE FROM public.competitor_pain_point_reports WHERE id = $1")
        .bind(report)
        .execute(&db)
        .await
        .unwrap();
}

#[tokio::test]
async fn pain_point_features_are_listed_best_first() {
    let Some(db) = database() else { return };
    let token = admin(&db).await;
    let tag = Uuid::new_v4().simple().to_string();
    for (suffix, demand, status) in [
        ("low", 1, "open"),
        ("high", 5, "open"),
        ("built", 5, "built"),
    ] {
        sqlx::query(
            "INSERT INTO public.competitor_pain_point_features \
                 (key, title, problem, change, audience, status, demand, pain, fit, edge, ease, \
                  complaint_urls, first_seen, last_seen) \
             VALUES ($1, 'Free tickets', 'Fees', 'Add a line', 'organizer', $3, $2, 3, 3, 3, 3, \
                 '[\"https://x.com/a/status/1\"]', DATE '2026-10-01', DATE '2026-10-02')",
        )
        .bind(format!("db-test-{tag}-{suffix}"))
        .bind(demand)
        .bind(status)
        .execute(&db)
        .await
        .unwrap();
    }
    let (status, features) = call(
        &db,
        &token,
        Method::GET,
        "/competitor-pain-points/features?feature_status=open",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{features}");
    let ours: Vec<&Value> = features
        .as_array()
        .unwrap()
        .iter()
        .filter(|feature| feature["key"].as_str().unwrap().contains(&tag))
        .collect();
    let keys: Vec<&str> = ours.iter().map(|f| f["key"].as_str().unwrap()).collect();
    assert_eq!(
        keys,
        [format!("db-test-{tag}-high"), format!("db-test-{tag}-low")]
    );
    assert_eq!(ours[0]["score"], 17);
    assert_eq!(ours[0]["where"], json!([]));
    assert_eq!(
        ours[0]["complaint_urls"],
        json!(["https://x.com/a/status/1"])
    );
    sqlx::query("DELETE FROM public.competitor_pain_point_features WHERE key LIKE $1")
        .bind(format!("db-test-{tag}-%"))
        .execute(&db)
        .await
        .unwrap();
}

#[tokio::test]
async fn automate_logs_are_stored_and_listed_newest_first() {
    let Some(db) = database() else { return };
    let token = admin(&db).await;
    let sender = format!("db-test-{}", Uuid::new_v4().simple());
    for event in ["first", "second"] {
        let (status, body) = call(
            &db,
            AUTOMATE_KEY,
            Method::POST,
            "/webhooks/automate",
            Some(json!({"event": event, "sender": sender, "school": "uwaterloo"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body, json!({"status": "ok"}));
    }
    let (status, logs) = call(
        &db,
        &token,
        Method::GET,
        &format!("/webhooks/automate/logs?sender_id={sender}&limit=5"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{logs}");
    let logs = logs.as_array().unwrap();
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0]["event"], "second");
    let keys: Vec<&String> = logs[0].as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "id",
            "created_at",
            "event",
            "sender_id",
            "school",
            "ig_account",
            "post_url",
            "payload"
        ]
    );
    // PostgREST's timestamp text.
    let created_at = logs[0]["created_at"].as_str().unwrap();
    assert!(created_at.ends_with("+00:00"), "{created_at}");
    assert_eq!(logs[0]["payload"]["sender"], sender.as_str());
    let (status, none) = call(
        &db,
        &token,
        Method::GET,
        &format!("/webhooks/automate/logs?sender_id={sender}&limit=0"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(none, json!([]));
}
