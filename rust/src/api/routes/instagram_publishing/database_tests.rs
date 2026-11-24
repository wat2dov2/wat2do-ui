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
use super::{accounts, batches, follow_candidates, follows, songs};
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
    let (id, _) = batch(&db, school, "failed", &[first]).await;
    connect_account(&db, school).await;
    let refused = batches::claim_batch(&db, KEY, id, 1).await;
    assert!(
        matches!(refused, Err(ApiError::Validation { ref detail, .. }) if detail == "Choose at least 2 event slides before publishing")
    );
    let second = event(&db, school, "Study Hall", 4).await;
    add_item(&db, id, second, 2).await;
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
    let new_song = songs::NewSong {
        query: name.clone(),
        asian_campuses_only: true,
        ..Default::default()
    };
    let song = songs::add(&db, &new_song).await.unwrap();
    assert_eq!(song.query, name.replace("  ", " "));
    assert!(song.asian_campuses_only);
    assert!(!song.french_campuses_only);
    let shouted = songs::NewSong {
        query: name.to_uppercase(),
        ..Default::default()
    };
    assert!(matches!(
        songs::add(&db, &shouted).await,
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
        None,
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
            None,
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

#[tokio::test]
async fn approving_a_directory_row_gives_its_club_the_account() {
    // test_approving_a_row_found_for_a_club_gives_that_club_its_account
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
    let club: i32 = sqlx::query_scalar(
        "INSERT INTO public.clubs (club_name, club_type, school_id, status) \
         VALUES ($1, 'independent', $2, 'approved') RETURNING id",
    )
    .bind(format!("Chess Club {suffix}"))
    .bind(school)
    .fetch_one(&db)
    .await
    .unwrap();
    let handle = format!("chess{suffix}");
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO public.instagram_follow_candidates \
             (school_id, handle, name, source, found_via, club_id) \
         VALUES ($1, $2, 'Chess Club', 'directory', ARRAY['WUSA Clubs'], $3) RETURNING id",
    )
    .bind(school)
    .bind(&handle)
    .bind(club)
    .fetch_one(&db)
    .await
    .unwrap();

    let counts = follow_candidates::decide(&db, &[(id, "approved".to_owned())], admin)
        .await
        .unwrap();
    assert_eq!(counts.approved, 1);
    let (club_id,): (Option<i32>,) =
        sqlx::query_as("SELECT club_id FROM public.instagram_follow_candidates WHERE id = $1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(club_id, Some(club));
    let ig: Option<String> = sqlx::query_scalar("SELECT ig FROM public.clubs WHERE id = $1")
        .bind(club)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(ig.as_deref(), Some(handle.as_str()));
    let made: i64 = sqlx::query_scalar("SELECT count(*) FROM public.clubs WHERE ig = $1")
        .bind(&handle)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(made, 1);
}

#[tokio::test]
async fn followed_candidates_list_newest_first_and_filter_by_days() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let suffix = &Uuid::new_v4().simple().to_string()[..12];
    // Followed an hour ago, two days ago and ten days ago.
    let mut handles = Vec::new();
    for (index, hours_ago) in [1, 48, 240].into_iter().enumerate() {
        let handle = format!("followed{index}{suffix}");
        sqlx::query(
            "INSERT INTO public.instagram_follow_candidates \
             (school_id, handle, source, status, followed_at) \
             VALUES ($1, $2, 'crawl', 'followed', now() - make_interval(hours => $3))",
        )
        .bind(school)
        .bind(&handle)
        .bind(hours_ago)
        .execute(&db)
        .await
        .unwrap();
        handles.push(handle);
    }
    let ours = |listed: Vec<follow_candidates::Candidate>| -> Vec<String> {
        listed
            .into_iter()
            .map(|candidate| candidate.handle)
            .filter(|handle| handle.ends_with(suffix))
            .collect()
    };
    let page = Pagination {
        page: 1,
        page_size: 100,
    };
    let (every, _) = follow_candidates::list(&db, Some("uwaterloo"), "followed", None, page)
        .await
        .unwrap();
    assert_eq!(ours(every), handles);
    let (recent, total) =
        follow_candidates::list(&db, Some("uwaterloo"), "followed", Some(3), page)
            .await
            .unwrap();
    assert!(total >= 2);
    let recent_handles: Vec<String> = recent.iter().map(|c| c.handle.clone()).collect();
    assert!(recent_handles.contains(&handles[0]) && recent_handles.contains(&handles[1]));
    assert!(!recent_handles.contains(&handles[2]));
    assert!(
        recent
            .windows(2)
            .all(|pair| pair[0].status_changed_at >= pair[1].status_changed_at)
    );
    sqlx::query("DELETE FROM public.instagram_follow_candidates WHERE handle LIKE '%' || $1")
        .bind(suffix)
        .execute(&db)
        .await
        .unwrap();
}

/// Insert a follow candidate for `school` in `status` with the given follow times
/// (hours ago); returns its id.
async fn follow_row(
    db: &PgPool,
    school: i32,
    handle: &str,
    status: &str,
    followed_hours_ago: Option<i64>,
    seen_hours_ago: Option<i64>,
    unfollowed_hours_ago: Option<i64>,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO public.instagram_follow_candidates \
         (school_id, handle, source, status, followed_at, seen_following_at, unfollowed_at) \
         VALUES ($1, $2, 'crawl', $3, now() - make_interval(hours => $4), \
                 now() - make_interval(hours => $5), now() - make_interval(hours => $6)) \
         RETURNING id",
    )
    .bind(school)
    .bind(handle)
    .bind(status)
    .bind(followed_hours_ago.map(|hours| hours as i32))
    .bind(seen_hours_ago.map(|hours| hours as i32))
    .bind(unfollowed_hours_ago.map(|hours| hours as i32))
    .fetch_one(db)
    .await
    .unwrap()
}

async fn follow_status(db: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM public.instagram_follow_candidates WHERE id = $1")
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn rejecting_an_account_the_school_may_still_follow_queues_its_unfollow() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let suffix = &Uuid::new_v4().simple().to_string()[..12];
    // (status, followed, seen on the school's list, unfollowed) hours ago, and the
    // status a rejection leaves.
    let cases = [
        ("followed", None, None, None, "unfollow"),
        // A tapped follow whose bell step failed stays approved.
        ("approved", Some(5), None, None, "unfollow"),
        // The school's own Following list showed an account the crawl found.
        ("pending", None, Some(1), None, "unfollow"),
        // Unfollowed since it was last seen or followed.
        ("pending", Some(9), Some(8), Some(2), "rejected"),
        ("pending", None, None, None, "rejected"),
        // The emulator finishing an unfollow.
        ("unfollow", Some(9), None, None, "rejected"),
    ];
    let mut rows = Vec::new();
    for (index, (status, followed, seen, unfollowed, expected)) in cases.iter().enumerate() {
        let handle = format!("reject{index}{suffix}");
        let id = follow_row(&db, school, &handle, status, *followed, *seen, *unfollowed).await;
        rows.push((id, *expected));
    }
    for (id, _) in &rows {
        sqlx::query(
            "UPDATE public.instagram_follow_candidates SET status = 'rejected' WHERE id = $1",
        )
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    }
    for (index, (id, expected)) in rows.iter().enumerate() {
        assert_eq!(follow_status(&db, *id).await, *expected, "case {index}");
    }
    sqlx::query("DELETE FROM public.instagram_follow_candidates WHERE handle LIKE '%' || $1")
        .bind(suffix)
        .execute(&db)
        .await
        .unwrap();
}

#[tokio::test]
async fn deleting_a_club_rejects_its_account_so_a_followed_one_is_unfollowed() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    let suffix = &Uuid::new_v4().simple().to_string()[..12];
    let mut rows = Vec::new();
    for (status, expected) in [
        ("followed", "unfollow"),
        ("approved", "rejected"),
        ("pending", "rejected"),
    ] {
        let handle = format!("club{status}{suffix}");
        let club: i32 = sqlx::query_scalar(
            "INSERT INTO public.clubs (club_name, ig, club_type, school_id, submitted, status) \
             VALUES ('Deleted Club', $1, 'independent', $2, true, 'approved') RETURNING id",
        )
        .bind(format!("@{handle}"))
        .bind(school)
        .fetch_one(&db)
        .await
        .unwrap();
        let id = follow_row(&db, school, &handle, status, None, None, None).await;
        sqlx::query("DELETE FROM public.clubs WHERE id = $1")
            .bind(club)
            .execute(&db)
            .await
            .unwrap();
        rows.push((id, expected));
    }
    for (id, expected) in rows {
        assert_eq!(follow_status(&db, id).await, expected);
        let reason: Option<String> = sqlx::query_scalar(
            "SELECT reason FROM public.instagram_follow_candidates WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(reason.as_deref(), Some("Its club was deleted"));
    }
    sqlx::query("DELETE FROM public.instagram_follow_candidates WHERE handle LIKE '%' || $1")
        .bind(suffix)
        .execute(&db)
        .await
        .unwrap();
}

#[tokio::test]
async fn automated_follows_of_a_day_come_with_their_newest_posts_and_events() {
    let Some(db) = database() else { return };
    let school = uwaterloo(&db).await;
    // A day of its own, so other tests' follows never fall in the window.
    let since = unique_day().and_hms_opt(5, 0, 0).unwrap().and_utc();
    let window = follows::Window {
        school: Some("uwaterloo".into()),
        since,
        until: since + chrono::Duration::days(1),
    };
    let suffix = &Uuid::new_v4().simple().to_string()[..12];
    let follow = async |handle: String, source: &str, hours: i64| -> (Uuid, i32) {
        let club: i32 = sqlx::query_scalar(
            "INSERT INTO public.clubs (club_name, ig, club_type, school_id, status) \
             VALUES ($1, $1, 'independent', $2, 'approved') RETURNING id",
        )
        .bind(&handle)
        .bind(school)
        .fetch_one(&db)
        .await
        .unwrap();
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO public.instagram_follow_candidates \
                 (school_id, handle, source, status, score, verdict, club_id, followed_at, recent_posts) \
             VALUES ($1, $2, $3, 'followed', 91, 'approve', $4, $5, $6) RETURNING id",
        )
        .bind(school)
        .bind(&handle)
        .bind(source)
        .bind(club)
        .bind(since + chrono::Duration::hours(hours))
        .bind(serde_json::json!([
            {"url": format!("https://www.instagram.com/p/old{suffix}/"),
             "posted_at": "2026-10-01T10:00:00+00:00", "caption": "Old", "image": null},
        ]))
        .fetch_one(&db)
        .await
        .unwrap();
        (id, club)
    };
    let (newest, newest_club) = follow(format!("newest{suffix}"), "crawl", 20).await;
    let (directory, _) = follow(format!("directory{suffix}"), "directory", 2).await;
    let (_, listed_club) = follow(format!("listed{suffix}"), "club", 10).await;
    let (_, earlier_club) = follow(format!("earlier{suffix}"), "crawl", -5).await;
    sqlx::query(
        "INSERT INTO public.ingestion_items (source_url, school_id, source, status, post) \
         VALUES ($1, $2, 'instagram', 'done', $3)",
    )
    .bind(format!("https://www.instagram.com/p/new{suffix}/"))
    .bind(school)
    .bind(serde_json::json!({
        "ownerUsername": format!("newest{suffix}"),
        "timestamp": "2026-11-20T21:01:41+00:00",
        "caption": "Games night",
        "displayUrl": "https://instagram.fykz2-1.fna.fbcdn.net/v/a.jpg?oe=6A000000",
    }))
    .execute(&db)
    .await
    .unwrap();
    let page = Pagination {
        page: 1,
        page_size: 100,
    };
    let (listed, total) = follows::list(&db, &window, page).await.unwrap();
    // Only the crawl's and the directories' follows within the day, newest first.
    assert_eq!(total, 2);
    let ids: Vec<Uuid> = listed.iter().map(|follow| follow.id).collect();
    assert_eq!(ids, [newest, directory]);
    let posts: Vec<(&str, &str)> = listed[0]
        .recent_posts
        .iter()
        .map(|post| (post.caption.as_str(), post.url.as_str()))
        .collect();
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[0].0, "Games night");
    assert_eq!(posts[1].0, "Old");
    // Its picture link expired in May 2026.
    assert_eq!(listed[0].recent_posts[0].image, None);
    assert_eq!(listed[0].score, Some(91));

    for (club, hours, title) in [
        (newest_club, 21, "Catan night"),
        (listed_club, 21, "Listed club social"),
        (earlier_club, 3, "Earlier follow's event"),
        (newest_club, 30, "Tomorrow's event"),
    ] {
        sqlx::query(
            "INSERT INTO public.events (title, location, club, school_id, club_id, added_at) \
             VALUES ($1, 'SLC', 'Club', $2, $3, $4)",
        )
        .bind(title)
        .bind(school)
        .bind(club)
        .bind(since + chrono::Duration::hours(hours))
        .execute(&db)
        .await
        .unwrap();
    }
    let (events, total) = follows::events(&db, &window, page).await.unwrap();
    let titles: Vec<&str> = events.iter().map(|event| event.title.as_str()).collect();
    assert_eq!(total, 2);
    assert_eq!(titles, ["Catan night", "Earlier follow's event"]);
    assert_eq!(events[0].handle, format!("newest{suffix}"));

    assert!(matches!(
        follows::list(
            &db,
            &follows::Window {
                school: Some("no-such-school".into()),
                ..window
            },
            page
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
}
