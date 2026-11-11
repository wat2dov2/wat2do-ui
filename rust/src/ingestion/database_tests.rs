//! The ingestion agent's database side against a real Postgres loaded with our
//! schema.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job). Every test makes its own school and sources, so
//! the tests run in parallel without seeing each other's rows.

use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::agent::ingest;
use super::club_directories::queue;
use crate::api::test_database::database;

/// A school of its own, so no other test's listings meet this one's.
async fn school(db: &PgPool) -> (i32, String) {
    let slug = format!("ingestion-{}", &Uuid::new_v4().simple().to_string()[..12]);
    let id = sqlx::query_scalar(
        "INSERT INTO public.schools (slug, name, timezone, primary_color, secondary_color, \
             url_with_semester_dates) \
         VALUES ($1, $1, 'America/Toronto', '#000000', '#ffffff', 'https://example.com') \
         RETURNING id",
    )
    .bind(&slug)
    .fetch_one(db)
    .await
    .unwrap();
    (id, slug)
}

/// An Instagram post's address nobody else uses.
fn instagram_post() -> String {
    format!(
        "https://www.instagram.com/p/{}/",
        &Uuid::new_v4().simple().to_string()[..11]
    )
}

/// An event listed from `source_url` whose poster is `poster`.
async fn listed(db: &PgPool, school: i32, source_url: &str, poster: &str) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO public.events (title, location, club, ig_handle, school_id, source_url, \
             source_image_url, price) \
         VALUES ('Games Night', 'SLC', 'Games Club', 'gamesclub', $1, $2, $3, 0) RETURNING id",
    )
    .bind(school)
    .bind(source_url)
    .bind(poster)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn poster(db: &PgPool, event: i32) -> Option<String> {
    sqlx::query_scalar("SELECT source_image_url FROM public.events WHERE id = $1")
        .bind(event)
        .fetch_one(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_retry_settles_the_posters_its_cut_short_run_left() {
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    let (source, elsewhere) = (instagram_post(), instagram_post());
    let token = &Uuid::new_v4().simple().to_string()[..12];
    let left = listed(&db, school, &source, &format!("pending:{token}/image-0")).await;
    let other_token = &Uuid::new_v4().simple().to_string()[..12];
    let other_poster = format!("pending:{other_token}/image-0");
    let other = listed(&db, school, &elsewhere, &other_poster).await;

    // The retry finds the source listed. This source has no images to
    // download, so the poster is cleared rather than left broken.
    let post = json!({"url": source});
    assert!(
        ingest(&db, &post, &slug, "instagram", None, false)
            .await
            .unwrap()
    );

    assert_eq!(poster(&db, left).await, None);
    assert_eq!(poster(&db, other).await, Some(other_poster));
}

/// A club of the school with no Instagram account, on its directory page.
async fn club_without_account(db: &PgPool, school: i32, name: &str, page: &str) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, club_page, school_id, status) \
         VALUES ($1, $2, $3, 'approved') RETURNING id",
    )
    .bind(name)
    .bind(page)
    .bind(school)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn candidate(
    db: &PgPool,
    school: i32,
    handle: &str,
) -> Option<(String, Vec<String>, String, Option<i32>)> {
    sqlx::query_as(
        "SELECT source, found_via, status, club_id FROM public.instagram_follow_candidates \
         WHERE school_id = $1 AND handle = $2",
    )
    .bind(school)
    .bind(handle)
    .fetch_optional(db)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_directory_club_is_queued_once_and_linked_to_its_club() {
    let Some(db) = database() else { return };
    let (school, _) = school(&db).await;
    let page = "https://clubs.example.edu/clubs/7";
    let chess = club_without_account(&db, school, "Chess Club", page).await;
    let go =
        club_without_account(&db, school, "Go Club", "https://clubs.example.edu/clubs/8").await;

    // Found on the club's page: linked to the club that page belongs to.
    assert!(
        queue(
            &db,
            school,
            "uwchess",
            Some("Chess Club"),
            "Clubs",
            Some(page)
        )
        .await
        .unwrap()
    );
    assert_eq!(
        candidate(&db, school, "uwchess").await,
        Some((
            "directory".into(),
            vec!["Clubs".into()],
            "pending".into(),
            Some(chess)
        ))
    );
    // Shown in the listing: linked by the club's name.
    assert!(
        queue(&db, school, "uwgo", Some(" go club "), "Clubs", None)
            .await
            .unwrap()
    );
    assert_eq!(candidate(&db, school, "uwgo").await.unwrap().3, Some(go));
    // A page and a name that point at two different clubs link neither.
    let chess_page = Some(page);
    assert!(
        queue(&db, school, "uwgo2", Some("Go Club"), "Clubs", chess_page)
            .await
            .unwrap()
    );
    assert_eq!(candidate(&db, school, "uwgo2").await.unwrap().3, None);
    // No club to link: still queued.
    assert!(
        queue(&db, school, "uwbridge", None, "Clubs", None)
            .await
            .unwrap()
    );
    assert_eq!(candidate(&db, school, "uwbridge").await.unwrap().3, None);

    // A rejected account is never offered again.
    sqlx::query(
        "UPDATE public.instagram_follow_candidates SET status = 'rejected' \
         WHERE school_id = $1 AND handle = 'uwbridge'",
    )
    .bind(school)
    .execute(&db)
    .await
    .unwrap();
    assert!(
        !queue(&db, school, "uwbridge", None, "Clubs", None)
            .await
            .unwrap()
    );
    assert_eq!(
        candidate(&db, school, "uwbridge").await.unwrap().2,
        "rejected"
    );

    // An account one of the school's clubs already names is left to the club sync.
    sqlx::query(
        "INSERT INTO public.clubs (club_name, ig, school_id, status) \
         VALUES ('Poker Club', '@UWPoker', $1, 'approved')",
    )
    .bind(school)
    .execute(&db)
    .await
    .unwrap();
    assert!(
        !queue(&db, school, "uwpoker", None, "Clubs", None)
            .await
            .unwrap()
    );
    assert_eq!(candidate(&db, school, "uwpoker").await, None);
}
