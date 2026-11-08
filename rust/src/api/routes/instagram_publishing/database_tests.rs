//! The carousel routes' statements against a real Postgres loaded with our
//! schema, so the draft RPC, the claim and the follow decisions run as they
//! do in production.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job); without it each test returns at once. Every
//! test makes its own events, batches and candidates, so the tests run in
//! parallel.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::credentials::tests::{KEY, TOKEN};
use super::{accounts, batches, follow_candidates, songs};
use crate::api::errors::ApiError;
use crate::api::pagination::Pagination;
use crate::api::test_database::database;

async fn uwaterloo(db: &PgPool) -> i32 {
    sqlx::query_scalar("SELECT id FROM public.schools WHERE slug = 'uwaterloo'")
        .fetch_one(db)
        .await
        .unwrap()
}

/// A postable event (a category and a poster) on one date `days` from now.
async fn event(db: &PgPool, school: i32, title: &str, days: i64) -> i64 {
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO public.events (title, location, club, school_id, category, source_image_url) \
         VALUES ($1, 'SLC', 'Carousel Club', $2, 'Business', 'https://example.com/poster.jpg') \
         RETURNING id",
    )
    .bind(title)
    .bind(school)
    .fetch_one(db)
    .await
    .unwrap();
    let start = Utc::now() + chrono::Duration::days(days);
    sqlx::query(
        "INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc) VALUES ($1, $2, $3)",
    )
    .bind(id)
    .bind(start)
    .bind(start + chrono::Duration::hours(2))
    .execute(db)
    .await
    .unwrap();
    i64::from(id)
}

/// A day no other test's batch uses.
fn unique_day() -> NaiveDate {
    let offset = (Uuid::new_v4().as_u128() % 200_000) as i64;
    NaiveDate::from_ymd_opt(1500, 1, 1).unwrap() + chrono::Duration::days(offset)
}

async fn batch(db: &PgPool, school: i32, status: &str, events: &[i64]) -> (Uuid, NaiveDate) {
    let day = unique_day();
    let window_end: DateTime<Utc> = Utc::now();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO public.instagram_publish_batches \
             (account_key, school_id, local_date, window_start, window_end, status) \
         VALUES ('uwaterloo', $1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(school)
    .bind(day)
    .bind(window_end - chrono::Duration::days(1))
    .bind(window_end)
    .bind(status)
    .fetch_one(db)
    .await
    .unwrap();
    for (position, event) in events.iter().enumerate() {
        add_item(db, id, *event, position as i32 + 1).await;
    }
    (id, day)
}

async fn add_item(db: &PgPool, batch: Uuid, event: i64, position: i32) {
    sqlx::query(
        "INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position) \
         VALUES ($1, 'uwaterloo', $2, $3)",
    )
    .bind(batch)
    .bind(event as i32)
    .bind(position)
    .execute(db)
    .await
    .unwrap();
}

/// The school's connected account, with a token Python encrypted under `KEY`.
async fn connect_account(db: &PgPool, school: i32) {
    sqlx::query(
        "INSERT INTO public.instagram_publishing_accounts (account_key, instagram_user_id, \
             instagram_username, encrypted_access_token, expires_at, last_validated_at, school_id) \
         VALUES ('uwaterloo', '17841400000000001', 'wat2do.uwaterloo', $1, now() + interval '30 days', now(), $2) \
         ON CONFLICT (account_key) DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token, \
             expires_at = EXCLUDED.expires_at, requires_reauthorization = false, enabled = true",
    )
    .bind(TOKEN)
    .bind(school)
    .execute(db)
    .await
    .unwrap();
}

fn slide_ids(batch: &batches::Batch) -> Vec<i32> {
    batch
        .items
        .iter()
        .filter_map(|item| item.row.event_id)
        .collect()
}

#[tokio::test]
async fn a_draft_is_read_saved_and_claimed_as_python_did() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let first = event(&db, school, "Mahjong Night", 3).await;
    let second = event(&db, school, "Resume Clinic", 4).await;
    let third = event(&db, school, "Pancake Breakfast", 5).await;
    let ended = event(&db, school, "Last Week's Social", -7).await;
    let (id, day) = batch(
        &db,
        school,
        "ready_for_review",
        &[first, second, third, ended],
    )
    .await;

    // A draft shows only the slides it could still post, with a live caption.
    let draft = batches::get_batch(&db, id).await.unwrap();
    assert_eq!(
        slide_ids(&draft),
        [first, second, third].map(|id| id as i32)
    );
    assert!(
        draft
            .row
            .caption
            .starts_with("1. Mahjong Night - Carousel Club\n")
    );
    assert!(draft.row.caption.contains("uwaterloo.wat2do.io"));
    assert!(draft.new_event_count >= 4);
    let json = serde_json::to_value(&draft).unwrap();
    assert_eq!(json["items"][0]["event"]["title"], "Mahjong Night");

    let (page, total) = batches::list_batches(
        &db,
        Some("ready_for_review"),
        Some(day),
        Pagination {
            page: 1,
            page_size: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(total, 1);
    assert_eq!((page[0].item_count, page[0].eligible_count), (4, 3));

    // The editor's order and copy are saved under the version lock.
    let saved = batches::update_batch(
        &db,
        id,
        batches::DraftUpdate {
            version: 1,
            caption_intro: "Our picks".into(),
            cover_body: "Three things".into(),
            event_ids: vec![third, first, second],
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.row.version, 2);
    assert_eq!(
        slide_ids(&saved),
        [third, first, second].map(|id| id as i32)
    );
    assert!(
        saved
            .row
            .caption
            .starts_with("Our picks\n\n1. Pancake Breakfast")
    );
    assert_eq!(saved.row.cover_body, "Three things");
    let stale = batches::update_batch(
        &db,
        id,
        batches::DraftUpdate {
            version: 1,
            caption_intro: String::new(),
            cover_body: String::new(),
            event_ids: vec![first],
        },
    )
    .await;
    assert!(matches!(stale, Err(ApiError::Conflict(_))));
    let ineligible = batches::update_batch(
        &db,
        id,
        batches::DraftUpdate {
            version: 2,
            caption_intro: String::new(),
            cover_body: String::new(),
            event_ids: vec![first, ended],
        },
    )
    .await;
    assert!(
        matches!(ineligible, Err(ApiError::Validation { ref detail, .. }) if detail.starts_with(&format!("Cannot add or save event IDs: {ended}.")))
    );

    // The claim locks the draft and drops the slide it will not post.
    add_item(&db, id, ended, 4).await;
    connect_account(&db, school).await;
    let claimed = batches::claim_batch(&db, KEY, id, 2).await.unwrap();
    assert_eq!(claimed.row.status, "publishing");
    assert_eq!(claimed.row.version, 3);
    assert_eq!(
        claimed.row.instagram_user_id.as_deref(),
        Some("17841400000000001")
    );
    assert_eq!(
        slide_ids(&claimed),
        [third, first, second].map(|id| id as i32)
    );
    let stored: Vec<i32> = sqlx::query_scalar(
        "SELECT event_id FROM public.instagram_publish_items WHERE batch_id = $1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(stored, [third, first, second].map(|id| id as i32));
    assert!(matches!(
        batches::claim_batch(&db, KEY, id, 3).await,
        Err(ApiError::Validation { .. })
    ));

    // The dashboard shows when the school last received a notification.
    let seen: DateTime<Utc> = sqlx::query_scalar(
        "INSERT INTO public.instagram_notifications (school_id, intended_recipient_id, \
             push_id, push_category, materialized_media_count, materialization_status) \
         VALUES ($1, '17841400000000001', $2, 'subscription_daily_digest', 0, 'complete') \
         RETURNING first_seen_at",
    )
    .bind(school)
    .bind(format!("dashboard-{}", Uuid::new_v4()))
    .fetch_one(&db)
    .await
    .unwrap();
    let dashboard = accounts::list(&db).await.unwrap();
    let account = dashboard
        .iter()
        .find(|account| account.account_key == "uwaterloo")
        .unwrap();
    assert_eq!(account.username, "wat2do.uwaterloo");
    // Other tests may record a later one for the same school.
    assert!(account.last_notification_at >= Some(seen));
}

#[tokio::test]
async fn too_few_slides_or_an_unreadable_key_are_never_claimed() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let first = event(&db, school, "Board Games", 3).await;
    let second = event(&db, school, "Study Hall", 4).await;
    let (id, _) = batch(&db, school, "failed", &[first, second]).await;
    connect_account(&db, school).await;
    let refused = batches::claim_batch(&db, KEY, id, 1).await;
    assert!(
        matches!(refused, Err(ApiError::Validation { ref detail, .. }) if detail == "Choose at least 3 event slides before publishing")
    );
    let third = event(&db, school, "Pottery", 5).await;
    add_item(&db, id, third, 3).await;
    let wrong_key =
        batches::claim_batch(&db, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", id, 1).await;
    assert!(
        matches!(wrong_key, Err(ApiError::Validation { ref detail, .. }) if detail == "Stored Instagram access token could not be decrypted")
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM public.instagram_publish_batches WHERE id = $1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "failed");
    assert!(matches!(
        batches::get_batch(&db, Uuid::new_v4()).await,
        Err(ApiError::NotFound(_))
    ));
}

#[tokio::test]
async fn songs_are_listed_once_however_they_are_capitalized() {
    // test_songs_are_added_once_regardless_of_case, test_deleting_a_missing_song_is_not_found
    let Some(db) = database() else { return };
    let name = format!("sza  saturn {}", Uuid::new_v4().simple());
    let song = songs::add(&db, &name, true).await.unwrap();
    assert_eq!(song.query, name.replace("  ", " "));
    assert!(song.asian_campuses_only);
    assert!(matches!(
        songs::add(&db, &name.to_uppercase(), false).await,
        Err(ApiError::Conflict(_))
    ));
    assert!(
        songs::list(&db)
            .await
            .unwrap()
            .iter()
            .any(|listed| listed.id == song.id)
    );
    songs::delete(&db, song.id).await.unwrap();
    assert!(matches!(
        songs::delete(&db, song.id).await,
        Err(ApiError::NotFound(_))
    ));
}

#[tokio::test]
async fn approving_a_candidate_lists_its_club_and_rejecting_creates_nothing() {
    // test_approving_creates_the_club_when_the_school_has_none,
    // test_rejecting_creates_nothing_and_decisions_on_settled_rows_are_skipped
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let admin = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO public.users (id, email, auth_id, full_name) VALUES ($1, $2, $3, 'Admin')",
    )
    .bind(admin)
    .bind(format!("admin-{}@example.com", admin.simple()))
    .bind(admin.to_string())
    .execute(&db)
    .await
    .unwrap();
    let suffix = &Uuid::new_v4().simple().to_string()[..12];
    let mut ids = Vec::new();
    for (handle, score) in [
        (format!("approve{suffix}"), 90),
        (format!("reject{suffix}"), 20),
    ] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO public.instagram_follow_candidates (school_id, handle, name, source, score) \
             VALUES ($1, $2, 'Mahjong Club', 'crawl', $3) RETURNING id",
        )
        .bind(school)
        .bind(&handle)
        .bind(score as i16)
        .fetch_one(&db)
        .await
        .unwrap();
        ids.push((id, handle));
    }
    let (listed, total) = follow_candidates::list(
        &db,
        Some("uwaterloo"),
        "pending",
        Pagination {
            page: 1,
            page_size: 100,
        },
    )
    .await
    .unwrap();
    assert!(total >= 2);
    assert!(listed.iter().any(|candidate| candidate.handle == ids[0].1));
    assert!(matches!(
        follow_candidates::list(
            &db,
            Some("no-such-school"),
            "pending",
            Pagination {
                page: 1,
                page_size: 1
            }
        )
        .await,
        Err(ApiError::NotFound(_))
    ));

    let decisions = vec![
        (ids[0].0, "approved".to_owned()),
        (ids[1].0, "rejected".to_owned()),
        (Uuid::new_v4(), "approved".to_owned()),
    ];
    let counts = follow_candidates::decide(&db, &decisions, admin)
        .await
        .unwrap();
    assert_eq!(
        counts,
        follow_candidates::DecisionCounts {
            approved: 1,
            rejected: 1
        }
    );
    let (club_id, decided_by): (Option<i32>, Option<Uuid>) = sqlx::query_as(
        "SELECT club_id, decided_by FROM public.instagram_follow_candidates WHERE id = $1",
    )
    .bind(ids[0].0)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(decided_by, Some(admin));
    let (name, ig, status): (String, Option<String>, String) =
        sqlx::query_as("SELECT club_name, ig, status FROM public.clubs WHERE id = $1")
            .bind(club_id.unwrap())
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        (name.as_str(), ig.as_deref(), status.as_str()),
        ("Mahjong Club", Some(ids[0].1.as_str()), "approved")
    );
    let rejected: Option<i32> =
        sqlx::query_scalar("SELECT club_id FROM public.instagram_follow_candidates WHERE id = $1")
            .bind(ids[1].0)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(rejected, None);
    // Settled accounts are skipped.
    let again = follow_candidates::decide(&db, &decisions, admin)
        .await
        .unwrap();
    assert_eq!(again, follow_candidates::DecisionCounts::default());
}
