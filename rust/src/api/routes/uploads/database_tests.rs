//! The upload routes that point a record at a new image, against a real
//! Postgres loaded with our schema (`api::test_database`); S3 is a recorder.
//! The new object is stored and the record updated before the old object is
//! deleted, and a refused update deletes nothing.

use std::io::Cursor;
use std::sync::Arc;

use axum::body::Body as HttpBody;
use axum::extract::Request;
use axum::http::{Method, StatusCode, header};
use http_body_util::BodyExt;
use image::{DynamicImage, ImageFormat};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::api::auth::test_tokens;
use crate::api::client_ip::Peer;
use crate::api::test_database::{database, peer};
use crate::api::{AppState, router};
use crate::settings::{Settings, test_settings};
use crate::storage::recording::{self, Recorder};

const BASE: &str = "https://media.wat2do.io";

fn state(db: PgPool) -> (AppState, Recorder) {
    let settings: &'static Settings = Box::leak(Box::new(test_settings(&[])));
    let mut state = AppState::new(settings, db, None).unwrap();
    let (storage, recorder) = recording::storage("wat2do-test-media", BASE);
    state.storage = Arc::new(storage);
    (state, recorder)
}

async fn user(db: &PgPool, role: &str, avatar_url: Option<&str>) -> (Uuid, String) {
    let (id, auth_id) = (Uuid::new_v4(), Uuid::new_v4().to_string());
    sqlx::query(
        "INSERT INTO public.users (id, auth_id, email, role, avatar_url) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(&auth_id)
    .bind(format!("{}@example.com", Uuid::new_v4().simple()))
    .bind(role)
    .bind(avatar_url)
    .execute(db)
    .await
    .unwrap();
    (id, test_tokens::access_token(&auth_id))
}

async fn club(db: &PgPool, owner: Uuid, logo_url: &str) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, created_by, logo_url) \
         SELECT $1, id, $2, $3 FROM public.schools WHERE slug = 'uwaterloo' RETURNING id",
    )
    .bind(format!("Database test club {}", Uuid::new_v4().simple()))
    .bind(owner)
    .bind(logo_url)
    .fetch_one(db)
    .await
    .unwrap()
}

/// An event of `club_id` by `owner` whose one occurrence starts `days` from now.
async fn event(db: &PgPool, club_id: i32, owner: Uuid, image: &str, days: i32) -> i32 {
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO public.events (title, location, club, club_id, school_id, created_by, source_image_url) \
         SELECT 'Upload test', 'SLC', c.club_name, c.id, c.school_id, $2, $3 \
         FROM public.clubs c WHERE c.id = $1 RETURNING id",
    )
    .bind(club_id)
    .bind(owner)
    .bind(image)
    .fetch_one(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc) \
         VALUES ($1, now() + make_interval(days => $2), now() + make_interval(days => $2, hours => 2))",
    )
    .bind(id)
    .bind(days)
    .execute(db)
    .await
    .unwrap();
    id
}

fn png() -> Vec<u8> {
    let mut out = Vec::new();
    DynamicImage::new_rgb8(4, 4)
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .unwrap();
    out
}

async fn upload(state: &AppState, path: &str, token: &str) -> (StatusCode, Value) {
    let mut body = b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"p.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
    body.extend_from_slice(&png());
    body.extend_from_slice(b"\r\n--b--\r\n");
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::HOST, "testserver")
        .header(header::CONTENT_TYPE, "multipart/form-data; boundary=b")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(HttpBody::from(body))
        .unwrap();
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

/// The methods and object paths S3 was asked for, in order.
fn requests(recorder: &Recorder) -> Vec<(String, String)> {
    recorder
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|request| (request.method.clone(), request.key().to_owned()))
        .collect()
}

#[tokio::test]
async fn an_event_poster_is_replaced_then_the_old_one_deleted() {
    let Some(db) = database() else { return };
    let (state, recorder) = state(db.clone());
    let (owner, token) = user(&db, "user", None).await;
    let club_id = club(&db, owner, "https://elsewhere.example/logo.png").await;
    let old = format!("{BASE}/event-images/old-poster.png");
    let event_id = event(&db, club_id, owner, &old, 7).await;

    let (status, body) = upload(&state, &format!("/uploads/event-image/{event_id}"), &token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let url = body["url"].as_str().unwrap();
    let stored: String =
        sqlx::query_scalar("SELECT source_image_url FROM public.events WHERE id = $1")
            .bind(event_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(stored, url);
    let new_key = format!("event-images/{}", url.rsplit('/').next().unwrap());
    // Each poster goes with its thumbnail, stored first and deleted last.
    assert_eq!(
        requests(&recorder),
        [
            ("PUT".to_owned(), crate::storage::thumbnail_key(&new_key)),
            ("PUT".to_owned(), new_key),
            (
                "DELETE".to_owned(),
                "event-images/old-poster.png".to_owned()
            ),
            (
                "DELETE".to_owned(),
                "event-images/old-poster.thumb.webp".to_owned()
            ),
        ]
    );

    // Someone else's event is refused before anything is stored.
    let (_, stranger) = user(&db, "user", None).await;
    let (status, _) = upload(
        &state,
        &format!("/uploads/event-image/{event_id}"),
        &stranger,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(requests(&recorder).len(), 4);
}

#[tokio::test]
async fn a_past_event_keeps_its_poster() {
    let Some(db) = database() else { return };
    let (state, recorder) = state(db.clone());
    let (admin, token) = user(&db, "admin", None).await;
    let club_id = club(&db, admin, "https://elsewhere.example/logo.png").await;
    let old = format!("{BASE}/event-images/kept.png");
    let event_id = event(&db, club_id, admin, &old, -7).await;
    let (status, body) = upload(&state, &format!("/uploads/event-image/{event_id}"), &token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["detail"],
        "Event has already ended and cannot be modified"
    );
    let stored: String =
        sqlx::query_scalar("SELECT source_image_url FROM public.events WHERE id = $1")
            .bind(event_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(stored, old);
    // The new poster and its thumbnail were stored (as Python stored them),
    // but the old one stays.
    let sent = requests(&recorder);
    assert_eq!(sent.len(), 2);
    assert!(sent.iter().all(|(method, _)| method == "PUT"));
}

#[tokio::test]
async fn a_club_logo_and_an_avatar_point_at_their_new_images() {
    let Some(db) = database() else { return };
    let (state, recorder) = state(db.clone());
    let old_avatar = format!("{BASE}/avatars/old-face.png");
    let (owner, token) = user(&db, "user", Some(&old_avatar)).await;
    // A logo that is not one of ours is never deleted.
    let club_id = club(&db, owner, "https://elsewhere.example/logo.png").await;

    let (status, body) = upload(&state, &format!("/uploads/club-logo/{club_id}"), &token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let logo: String = sqlx::query_scalar("SELECT logo_url FROM public.clubs WHERE id = $1")
        .bind(club_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(logo, body["url"].as_str().unwrap());
    assert!(logo.starts_with(&format!("{BASE}/organization-logos/")));

    let (status, body) = upload(&state, "/uploads/avatar", &token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let avatar: String = sqlx::query_scalar("SELECT avatar_url FROM public.users WHERE id = $1")
        .bind(owner)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(avatar, body["url"].as_str().unwrap());
    let methods: Vec<(String, String)> = requests(&recorder);
    assert_eq!(methods.len(), 3, "{methods:?}");
    assert_eq!(methods[0].0, "PUT");
    assert_eq!(methods[1].0, "PUT");
    assert_eq!(
        methods[2],
        ("DELETE".to_owned(), "avatars/old-face.png".to_owned())
    );
}
