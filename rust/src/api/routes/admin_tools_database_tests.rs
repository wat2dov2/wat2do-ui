//! The outreach (with its claim links), competitor pain point and automate log routes against a real
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

/// A new user with `role`: its id and access token.
async fn user(db: &PgPool, role: &str) -> (Uuid, String) {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO public.users (id, email, auth_id, full_name, role) \
         VALUES ($1, $2, $3, 'Tester', $4)",
    )
    .bind(id)
    .bind(format!("{role}-{}@example.com", id.simple()))
    .bind(id.to_string())
    .bind(role)
    .execute(db)
    .await
    .unwrap();
    (id, access_token(&id.to_string()))
}

/// A new admin's access token.
async fn admin(db: &PgPool) -> String {
    user(db, "admin").await.1
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

/// A new club at uwaterloo with a lead: its club, id and claim token. The lead has
/// an email unless `email` is `None`, and Claude's verdict `fit` unless that is `None`.
async fn lead(
    db: &PgPool,
    name: &str,
    email: Option<&str>,
    fit: Option<bool>,
) -> (i32, Uuid, Uuid) {
    let club: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, status) \
         SELECT $1, id, 'approved' FROM public.schools WHERE slug = 'uwaterloo' RETURNING id",
    )
    .bind(name)
    .fetch_one(db)
    .await
    .unwrap();
    let (lead, token): (Uuid, Uuid) = sqlx::query_as(
        "INSERT INTO public.outreach_leads \
             (club_id, email, email_source_url, email_found_by, found_at, formality, \
              pitch_fit, pitch_reason, pitch_script, pitch_email_subject, pitch_email_body, \
              pitched_at) \
         VALUES ($1, $2, CASE WHEN $2 IS NULL THEN NULL ELSE 'https://example.com/clubs' END, \
             CASE WHEN $2 IS NULL THEN NULL ELSE 'club_page' END, \
             CASE WHEN $2 IS NULL THEN NULL ELSE now() END, 40, \
             $3, CASE WHEN $3 IS NULL THEN NULL ELSE 'Game nights with snacks.' END, \
             CASE WHEN $3 THEN 'Hey ' || $4 || '!' END, CASE WHEN $3 THEN $4 || ' on Wat2Do' END, \
             CASE WHEN $3 THEN 'Hi ' || $4 || E' team,\n{{claim_url}}\nTony' END, \
             CASE WHEN $3 IS NULL THEN NULL ELSE now() END) \
         RETURNING id, claim_token",
    )
    .bind(club)
    .bind(email)
    .bind(fit)
    .bind(name)
    .fetch_one(db)
    .await
    .unwrap();
    (club, lead, token)
}

#[tokio::test]
async fn admins_list_and_update_outreach_leads() {
    let Some(db) = database() else { return };
    let token = admin(&db).await;
    let tag = Uuid::new_v4().simple().to_string();
    let name = format!("Lead Club {tag}");
    let (club, lead_id, claim_token) =
        lead(&db, &name, Some("leads@example.com"), Some(true)).await;
    // The page lists only leads with an email whose club Claude judged a fit.
    let (_, hidden, _) = lead(&db, &format!("Lead Club {tag} hidden"), None, None).await;
    let (_, not_a_fit, _) = lead(
        &db,
        &format!("Lead Club {tag} unfit"),
        Some("unfit@example.com"),
        Some(false),
    )
    .await;
    let (_, unjudged, _) = lead(
        &db,
        &format!("Lead Club {tag} unjudged"),
        Some("unjudged@example.com"),
        None,
    )
    .await;

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
        let claim_url = format!("https://uwaterloo.wat2do.io/claim/{claim_token}");
        assert_eq!(item["claim_url"], claim_url.as_str());
        assert_eq!(
            item["email_body"],
            format!("Hi {name} team,\n{claim_url}\nTony").as_str()
        );
        assert_eq!(item["email_subject"], format!("{name} on Wat2Do").as_str());
        assert_eq!(item["script"], format!("Hey {name}!").as_str());
        assert_eq!(item["pitch_reason"], "Game nights with snacks.");
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

    for missing in [Uuid::new_v4(), hidden, not_a_fit, unjudged] {
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

#[tokio::test]
async fn a_claim_link_hands_its_club_to_the_first_signed_in_opener() {
    let Some(db) = database() else { return };
    let tag = Uuid::new_v4().simple().to_string();
    let name = format!("Claim Club {tag}");
    let (club, lead_id, token) = lead(&db, &name, Some("claim@example.com"), Some(true)).await;
    let (first, first_token) = user(&db, "user").await;
    let (_, second_token) = user(&db, "user").await;
    let link = format!("/clubs/claim-links/{token}");
    let expected = json!({"club_id": club, "club_name": name, "school": "uwaterloo"});

    let (status, shown) = call(&db, &first_token, Method::GET, &link, None).await;
    assert_eq!((status, &shown), (StatusCode::OK, &expected));
    let accept = format!("{link}/accept");
    let (status, claimed) = call(&db, &first_token, Method::POST, &accept, None).await;
    assert_eq!((status, &claimed), (StatusCode::OK, &expected));

    let (owner, members, lead_status): (Option<Uuid>, Vec<Uuid>, String) = sqlx::query_as(
        "SELECT c.created_by, \
             ARRAY(SELECT m.user_id FROM public.club_members m WHERE m.club_id = c.id), l.status \
         FROM public.clubs c JOIN public.outreach_leads l ON l.club_id = c.id WHERE l.id = $1",
    )
    .bind(lead_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        (owner, members, lead_status.as_str()),
        (Some(first), vec![first], "claimed")
    );

    // Once the club is claimed the link hands over nothing, to anyone.
    for (method, path) in [(Method::GET, &link), (Method::POST, &accept)] {
        let (status, body) = call(&db, &second_token, method, path, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    }
    let (status, _) = call(
        &db,
        &first_token,
        Method::GET,
        "/clubs/claim-links/nope",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
