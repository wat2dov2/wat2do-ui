//! Who owns a club, against a real Postgres loaded with our schema
//! (`api::test_database`): the club reads anyone can make never say, and
//! only admins' reads do.

use axum::body::Body as HttpBody;
use axum::extract::Request;
use axum::http::{StatusCode, header};
use http_body_util::BodyExt;
use serde_json::Value;
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

/// A new account with `role`: its id, email and an access token.
async fn user(db: &PgPool, role: &str) -> (Uuid, String, String) {
    let (id, auth_id) = (Uuid::new_v4(), Uuid::new_v4().to_string());
    let email = format!("{}@example.com", Uuid::new_v4().simple());
    sqlx::query("INSERT INTO public.users (id, auth_id, email, role) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(&auth_id)
        .bind(&email)
        .bind(role)
        .execute(db)
        .await
        .unwrap();
    (id, email, test_tokens::access_token(&auth_id))
}

async fn get(state: &AppState, path: &str, token: Option<&str>) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .uri(path)
        .header(header::HOST, "testserver");
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let mut request = builder.body(HttpBody::empty()).unwrap();
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

/// Neither the owner's account email nor their user id is in `club`.
fn says_nothing_of_its_owner(club: &Value, owner: Uuid, owner_email: &str) {
    let text = club.to_string();
    assert!(club.get("owner_email").is_none(), "{text}");
    assert!(club.get("created_by").is_none(), "{text}");
    assert!(!text.contains(owner_email), "{text}");
    assert!(!text.contains(&owner.to_string()), "{text}");
}

#[tokio::test]
async fn only_admins_read_who_owns_a_club() {
    let Some(db) = database() else { return };
    let state = state(db.clone());
    let (owner, owner_email, owner_token) = user(&db, "user").await;
    let (_, _, admin_token) = user(&db, "admin").await;
    // A submitted club its owner claimed and manages.
    let marker = Uuid::new_v4().simple().to_string();
    let club_id: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, school_id, created_by, status, submitted) \
         SELECT $1, id, $2, 'approved', true FROM public.schools WHERE slug = 'uwaterloo' \
         RETURNING id",
    )
    .bind(format!("Owned club {marker}"))
    .bind(owner)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO public.club_members (club_id, user_id) VALUES ($1, $2)")
        .bind(club_id)
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();

    // The public club page and directory, read by anyone or by the club's own team.
    for token in [None, Some(owner_token.as_str())] {
        let (status, club) = get(&state, &format!("/clubs/{club_id}"), token).await;
        assert_eq!(status, StatusCode::OK, "{club}");
        says_nothing_of_its_owner(&club, owner, &owner_email);
        let (status, page) = get(
            &state,
            &format!("/clubs/?school=uwaterloo&ids={club_id}"),
            token,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{page}");
        assert_eq!(page["items"][0]["id"], club_id, "{page}");
        says_nothing_of_its_owner(&page, owner, &owner_email);
    }
    let (status, mine) = get(&state, "/clubs/mine", Some(&owner_token)).await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(mine[0]["id"], club_id, "{mine}");
    says_nothing_of_its_owner(&mine, owner, &owner_email);

    // Admins' directory and review queue name the owner.
    let (status, page) = get(
        &state,
        &format!("/clubs/admin?ids={club_id}"),
        Some(&admin_token),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["items"][0]["owner_email"], owner_email.as_str());
    assert_eq!(page["items"][0]["created_by"], owner.to_string());
    let (status, page) = get(
        &state,
        &format!("/clubs/review?search={marker}"),
        Some(&admin_token),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["items"][0]["id"], club_id, "{page}");
    assert_eq!(page["items"][0]["owner_email"], owner_email.as_str());
    assert_eq!(page["items"][0]["created_by"], owner.to_string());

    // Nobody else reads the admins' directory, the club's own team included.
    let (status, _) = get(&state, "/clubs/admin", Some(&owner_token)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = get(&state, "/clubs/admin", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
