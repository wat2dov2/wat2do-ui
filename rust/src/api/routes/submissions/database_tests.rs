//! The submission routes against a real Postgres loaded with our schema
//! (`api::test_database`): what a submission stores, and what its review
//! writes (the event and its dates with the new status, or the position
//! through `review_position_submission`), once. Every test makes its own
//! users, club and submissions, so the tests can run in parallel.

use axum::body::Body as HttpBody;
use axum::extract::Request;
use axum::http::{Method, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::api::auth::test_tokens;
use crate::api::client_ip::Peer;
use crate::api::test_database::{database, peer};
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};

fn state(db: PgPool) -> AppState {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
    AppState::new(settings, db, None).unwrap()
}

/// A user with this role; returns its id and the token its sessions carry.
async fn user(db: &PgPool, role: &str) -> (Uuid, String) {
    let (id, auth_id) = (Uuid::new_v4(), Uuid::new_v4().to_string());
    sqlx::query("INSERT INTO public.users (id, auth_id, email, role) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(&auth_id)
        .bind(format!("{}@example.com", Uuid::new_v4().simple()))
        .bind(role)
        .execute(db)
        .await
        .unwrap();
    (id, test_tokens::access_token(&auth_id))
}

/// A Waterloo club in `status`, with `member` on its management team.
async fn club(db: &PgPool, status: &str, member: Option<Uuid>) -> i32 {
    let club_id: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, status) \
         SELECT $1, id, $2 FROM public.schools WHERE slug = 'uwaterloo' RETURNING id",
    )
    .bind(format!("Database test club {}", Uuid::new_v4().simple()))
    .bind(status)
    .fetch_one(db)
    .await
    .unwrap();
    if let Some(member) = member {
        sqlx::query("INSERT INTO public.club_members (club_id, user_id) VALUES ($1, $2)")
            .bind(club_id)
            .bind(member)
            .execute(db)
            .await
            .unwrap();
    }
    club_id
}

async fn call(
    state: &AppState,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "testserver");
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            HttpBody::from(json.to_string())
        }
        None => HttpBody::empty(),
    };
    let mut request = builder.body(body).unwrap();
    request.extensions_mut().insert(Peer(peer()));
    let response = crate::api::app(router(state.clone()))
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

fn event_body(club_id: i32, title: &str) -> Value {
    json!({
        "submitted_by_email": " Student@UWaterloo.CA ",
        "event_data": {
            "title": title,
            "location": "SLC 3223",
            "club_id": club_id,
            "occurrences": [
                {"dtstart_utc": "2030-12-01T18:00:00Z", "dtend_utc": "2030-12-01T20:00:00+00:00"},
                {"dtstart_utc": "2030-12-08T18:00:00Z"},
            ],
            "price": 5,
        },
    })
}

async fn events_titled(db: &PgPool, title: &str) -> Vec<(i32, Option<Uuid>, String, i64)> {
    sqlx::query_as(
        "SELECT e.id, e.created_by, e.club, \
                (SELECT count(*) FROM public.event_dates d WHERE d.event_id = e.id) \
         FROM public.events e WHERE e.title = $1",
    )
    .bind(title)
    .fetch_all(db)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_event_submission_is_stored_then_published_once() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (admin, admin_token) = user(&db, "admin").await;
    let (submitter, submitter_token) = user(&db, "user").await;
    let club_id = club(&db, "approved", None).await;
    let title = format!("Submitted {}", Uuid::new_v4().simple());

    let (status, created) = call(
        &state,
        Method::POST,
        "/submissions/",
        Some(&submitter_token),
        Some(event_body(club_id, &title)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    // The row as written: no school slug or club name yet.
    assert_eq!(created["status"], "pending");
    assert_eq!(created["school"], Value::Null);
    assert_eq!(created["club_name"], Value::Null);
    assert_eq!(created["user_id"], submitter.to_string());
    assert_eq!(created["submitted_by_email"], "Student@uwaterloo.ca");
    // `model_dump(mode="json", exclude_none=True)`: no unset values, at any level.
    assert_eq!(
        created["event_data"]["occurrences"][1],
        json!({"dtstart_utc": "2030-12-08T18:00:00Z"})
    );
    assert_eq!(created["event_data"]["price"], json!(5.0));
    assert!(created["event_data"].get("description").is_none());
    let id = created["id"].as_str().unwrap().to_owned();

    // The admin sees it with its school and club.
    let (status, found) = call(
        &state,
        Method::GET,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found["school"], "uwaterloo");
    assert!(
        found["club_name"]
            .as_str()
            .unwrap()
            .starts_with("Database test club")
    );
    let (status, page) = call(
        &state,
        Method::GET,
        &format!(
            "/submissions/?search={}&school=uwaterloo&submission_status=pending",
            title.replace(' ', "%20")
        ),
        Some(&admin_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total"], 1, "{page}");
    assert_eq!(page["items"][0]["id"], id.as_str());
    assert_eq!(page["items"][0]["club_name"], found["club_name"]);

    // Approving publishes the event with its dates, created by the reviewer.
    let (status, approved) = call(
        &state,
        Method::PATCH,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        Some(json!({"status": "approved"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{approved}");
    assert_eq!(approved["status"], "approved");
    assert_eq!(approved["school"], Value::Null);
    assert!(approved["reviewed_at"].is_string());
    let events = events_titled(&db, &title).await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].1, Some(admin));
    assert_eq!(events[0].2, found["club_name"].as_str().unwrap());
    assert_eq!(events[0].3, 2);

    // The same decision again changes nothing; another decision is refused.
    let (status, again) = call(
        &state,
        Method::PATCH,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        Some(json!({"status": "approved"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["school"], "uwaterloo");
    let (status, refused) = call(
        &state,
        Method::PATCH,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        Some(json!({"status": "rejected"})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{refused}");
    assert_eq!(refused, json!({"detail": "Invalid status transition"}));
    assert_eq!(events_titled(&db, &title).await.len(), 1);

    // Deleting removes it.
    let (status, _) = call(
        &state,
        Method::DELETE,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, gone) = call(
        &state,
        Method::DELETE,
        &format!("/submissions/{id}"),
        Some(&admin_token),
        None,
    )
    .await;
    assert_eq!(
        (status, gone),
        (
            StatusCode::NOT_FOUND,
            json!({"detail": "Submission not found"})
        )
    );
}

#[tokio::test]
async fn concurrent_approvals_publish_one_event() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (_, admin_token) = user(&db, "admin").await;
    let club_id = club(&db, "approved", None).await;
    let title = format!("Raced {}", Uuid::new_v4().simple());
    let (_, created) = call(
        &state,
        Method::POST,
        "/submissions/",
        None,
        Some(event_body(club_id, &title)),
    )
    .await;
    let path = format!("/submissions/{}", created["id"].as_str().unwrap());
    let approvals: Vec<_> = (0..4)
        .map(|_| {
            let (state, path, token) = (state.clone(), path.clone(), admin_token.clone());
            tokio::spawn(async move {
                call(
                    &state,
                    Method::PATCH,
                    &path,
                    Some(&token),
                    Some(json!({"status": "approved"})),
                )
                .await
            })
        })
        .collect();
    for approval in approvals {
        let (status, body) = approval.await.unwrap();
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["status"], "approved");
    }
    assert_eq!(events_titled(&db, &title).await.len(), 1);
}

#[tokio::test]
async fn a_rejection_keeps_its_reason_and_writes_no_event() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (_, admin_token) = user(&db, "admin").await;
    let club_id = club(&db, "approved", None).await;
    let title = format!("Rejected {}", Uuid::new_v4().simple());
    let (_, created) = call(
        &state,
        Method::POST,
        "/submissions/",
        None,
        Some(event_body(club_id, &title)),
    )
    .await;
    assert_eq!(created["user_id"], Value::Null);
    let path = format!("/submissions/{}", created["id"].as_str().unwrap());
    let (status, rejected) = call(
        &state,
        Method::PATCH,
        &path,
        Some(&admin_token),
        Some(json!({"status": "rejected", "rejection_reason": "Not a campus event"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rejected}");
    assert_eq!(rejected["rejection_reason"], "Not a campus event");
    assert!(events_titled(&db, &title).await.is_empty());
}

#[tokio::test]
async fn an_approval_whose_club_is_gone_writes_nothing() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (_, admin_token) = user(&db, "admin").await;
    let club_id = club(&db, "approved", None).await;
    let title = format!("Orphaned {}", Uuid::new_v4().simple());
    let (_, created) = call(
        &state,
        Method::POST,
        "/submissions/",
        None,
        Some(event_body(club_id, &title)),
    )
    .await;
    sqlx::query("DELETE FROM public.clubs WHERE id = $1")
        .bind(club_id)
        .execute(&db)
        .await
        .unwrap();
    let path = format!("/submissions/{}", created["id"].as_str().unwrap());
    let (status, refused) = call(
        &state,
        Method::PATCH,
        &path,
        Some(&admin_token),
        Some(json!({"status": "approved"})),
    )
    .await;
    assert_eq!(
        (status, refused),
        (StatusCode::NOT_FOUND, json!({"detail": "Club not found"}))
    );
    let (_, still) = call(&state, Method::GET, &path, Some(&admin_token), None).await;
    assert_eq!(still["status"], "pending");
    // A submission naming no club is refused before anything is stored.
    let (status, body) = call(
        &state,
        Method::POST,
        "/submissions/",
        None,
        Some(event_body(club_id, &title)),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            json!({"detail": "Submission club school is not registered"})
        )
    );
}

fn position_body(club_id: i32, source_url: &str) -> Value {
    json!({
        "submitted_by_email": "lead@uwaterloo.ca",
        "position_data": {
            "club_id": club_id,
            "title": " Design Lead ",
            "description": "Lead the design team.",
            "position_type": "committee",
            "requirements": ["Figma"],
            "deadline_date": "2030-12-01",
            "deadline_at": "2030-12-01T23:59:00-05:00",
            "source_url": source_url,
        },
    })
}

async fn positions_at(db: &PgPool, source_url: &str) -> Vec<(i32, String, Value)> {
    sqlx::query_as(
        "SELECT club_id, title::text, requirements FROM public.positions WHERE source_url = $1",
    )
    .bind(source_url)
    .fetch_all(db)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_position_submission_is_reviewed_through_the_database_function() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (admin, admin_token) = user(&db, "admin").await;
    let club_id = club(&db, "approved", None).await;
    let source = format!("https://example.com/jobs/{}", Uuid::new_v4().simple());
    let (status, created) = call(
        &state,
        Method::POST,
        "/position-submissions/",
        None,
        Some(position_body(club_id, &source)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["status"], "pending");
    assert_eq!(created["position_data"]["title"], "Design Lead");
    assert_eq!(
        created["position_data"]["deadline_at"],
        "2030-12-01T23:59:00-05:00"
    );
    assert_eq!(created["position_data"]["is_paid"], Value::Null);
    let id = created["id"].as_str().unwrap().to_owned();

    let (status, page) = call(
        &state,
        Method::GET,
        "/position-submissions/?school=uwaterloo&search=design&submission_status=pending",
        Some(&admin_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    let listed = page["items"].as_array().unwrap();
    let ours = listed
        .iter()
        .find(|item| item["id"] == id.as_str())
        .expect("listed");
    assert_eq!(ours["school"], "uwaterloo");

    let (status, approved) = call(
        &state,
        Method::PATCH,
        &format!("/position-submissions/{id}"),
        Some(&admin_token),
        Some(json!({"status": "approved"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{approved}");
    assert_eq!(approved["status"], "approved");
    assert_eq!(approved["school"], Value::Null);
    assert_eq!(approved["submitted_by_email"], "lead@uwaterloo.ca");
    assert_eq!(
        positions_at(&db, &source).await,
        [(club_id, "Design Lead".to_owned(), json!(["Figma"]))]
    );
    let reviewer: Option<Uuid> = sqlx::query_scalar(
        "SELECT reviewed_by FROM public.position_submissions WHERE id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(reviewer, Some(admin));
    let (status, refused) = call(
        &state,
        Method::PATCH,
        &format!("/position-submissions/{id}"),
        Some(&admin_token),
        Some(json!({"status": "pending"})),
    )
    .await;
    assert_eq!(
        (status, refused),
        (
            StatusCode::BAD_REQUEST,
            json!({"detail": "Invalid status transition"})
        )
    );

    // The same role from the same page again cannot be published twice.
    let (_, duplicate) = call(
        &state,
        Method::POST,
        "/position-submissions/",
        None,
        Some(position_body(club_id, &source)),
    )
    .await;
    let (status, refused) = call(
        &state,
        Method::PATCH,
        &format!(
            "/position-submissions/{}",
            duplicate["id"].as_str().unwrap()
        ),
        Some(&admin_token),
        Some(json!({"status": "approved"})),
    )
    .await;
    assert_eq!(
        (status, refused),
        (
            StatusCode::BAD_REQUEST,
            json!({"detail": "This position already exists"})
        )
    );
    assert_eq!(positions_at(&db, &source).await.len(), 1);
}

#[tokio::test]
async fn a_clubs_own_team_publishes_its_position_at_once() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (member, member_token) = user(&db, "user").await;
    let approved_club = club(&db, "approved", Some(member)).await;
    let source = format!("https://example.com/jobs/{}", Uuid::new_v4().simple());
    let (status, published) = call(
        &state,
        Method::POST,
        "/position-submissions/",
        Some(&member_token),
        Some(position_body(approved_club, &source)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{published}");
    assert_eq!(published["status"], "approved");
    assert_eq!(positions_at(&db, &source).await.len(), 1);

    // A club still under review sends its team's positions for review.
    let pending_club = club(&db, "pending", Some(member)).await;
    let source = format!("https://example.com/jobs/{}", Uuid::new_v4().simple());
    let (status, held) = call(
        &state,
        Method::POST,
        "/position-submissions/",
        Some(&member_token),
        Some(position_body(pending_club, &source)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{held}");
    assert_eq!(held["status"], "pending");
    assert!(positions_at(&db, &source).await.is_empty());
}
