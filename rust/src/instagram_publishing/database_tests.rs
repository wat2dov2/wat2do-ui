//! The carousel jobs against a real Postgres loaded with our schema, with the
//! Graph API, the slide renderer and media storage replaced by local
//! stand-ins (ported from `test_service.py`, `test_credentials.py` and
//! `test_stats.py`).
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job). Every test makes its own school, so the tests
//! run in parallel without seeing each other's events or drafts.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::drafts::{self, Outcome};
use super::fake_http::{Reply, json_reply, serve};
use super::publishing::Publisher;
use super::selection::DraftSelection;
use super::tokens::{DueAccount, refresh_account};
use super::{Refused, stats};
use crate::api::routes::instagram_publishing::batches;
use crate::api::routes::instagram_publishing::credentials::decrypt_token;
use crate::api::routes::instagram_publishing::credentials::tests::{KEY, TOKEN};
use crate::api::test_database::database;
use crate::settings::Settings;
use crate::storage::recording;

const USER_ID: &str = "17841400000000001";

/// A school of its own, so no other test's events reach its drafts.
async fn school(db: &PgPool) -> (i32, String) {
    let slug = format!("carousel-{}", &Uuid::new_v4().simple().to_string()[..12]);
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

/// An event added `added_hours` ago (negative is earlier), with one date
/// `starts_in` from now; postable unless `category` is `None`.
async fn event(
    db: &PgPool,
    school: i32,
    title: &str,
    added: Duration,
    starts_in: Duration,
    category: Option<&str>,
) -> i64 {
    let id: i32 = sqlx::query_scalar(
        "INSERT INTO public.events (title, location, club, ig_handle, school_id, category, \
             source_image_url, added_at, price) \
         VALUES ($1, 'SLC', 'Carousel Club', 'carouselclub', $2, $3, \
             'https://example.com/poster.jpg', now() + $4, 5) RETURNING id",
    )
    .bind(title)
    .bind(school)
    .bind(category)
    .bind(added)
    .fetch_one(db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc) \
         VALUES ($1, now() + $2, now() + $2 + interval '2 hours')",
    )
    .bind(id)
    .bind(starts_in)
    .execute(db)
    .await
    .unwrap();
    i64::from(id)
}

async fn batch(
    db: &PgPool,
    school: i32,
    account_key: &str,
    day: NaiveDate,
    status: &str,
    events: &[i64],
) -> Uuid {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO public.instagram_publish_batches (account_key, school_id, local_date, \
             window_start, window_end, status, caption_intro, cover_body, sticker_selections) \
         VALUES ($1, $2, $3, now() - interval '30 days', now() - interval '29 days', $4, \
             'Our picks', 'Three good things', $5) RETURNING id",
    )
    .bind(account_key)
    .bind(school)
    .bind(day)
    .bind(status)
    .bind(json!(
        events
            .iter()
            .map(|id| (id.to_string(), json!(["Free Pizza", "Reg. Required"])))
            .collect::<serde_json::Map<_, _>>()
    ))
    .fetch_one(db)
    .await
    .unwrap();
    for (position, event) in events.iter().enumerate() {
        sqlx::query(
            "INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(account_key)
        .bind(*event as i32)
        .bind(position as i32 + 1)
        .execute(db)
        .await
        .unwrap();
    }
    id
}

/// The school's connected account, holding a token Python encrypted under `KEY`.
async fn connect(db: &PgPool, school: i32, account_key: &str, expires_in: Duration) {
    sqlx::query(
        "INSERT INTO public.instagram_publishing_accounts (account_key, instagram_user_id, \
             instagram_username, encrypted_access_token, expires_at, last_validated_at, school_id) \
         VALUES ($1, $2, 'wat2do.test', $3, now() + $4, now(), $5)",
    )
    .bind(account_key)
    .bind(format!("{}{}", &USER_ID[..10], school % 1_000_000))
    .bind(TOKEN)
    .bind(expires_in)
    .bind(school)
    .execute(db)
    .await
    .unwrap();
}

async fn account_user_id(db: &PgPool, account_key: &str) -> String {
    sqlx::query_scalar(
        "SELECT instagram_user_id FROM public.instagram_publishing_accounts WHERE account_key = $1",
    )
    .bind(account_key)
    .fetch_one(db)
    .await
    .unwrap()
}

/// A day no other test's batch uses.
fn unique_day() -> NaiveDate {
    let offset = (Uuid::new_v4().as_u128() % 200_000) as i64;
    NaiveDate::from_ymd_opt(1500, 1, 1).unwrap() + Duration::days(offset)
}

fn settings(render_url: &str) -> Settings {
    let variables = BTreeMap::from([
        ("DATABASE_URL", "postgres://unused".to_owned()),
        ("INSTAGRAM_TOKEN_ENCRYPTION_KEY", KEY.to_owned()),
        ("INSTAGRAM_SLIDE_RENDER_URL", render_url.to_owned()),
        ("INSTAGRAM_SLIDE_RENDER_SECRET", "render-secret".to_owned()),
    ]);
    Settings::from_lookup(|name| variables.get(name).cloned()).unwrap()
}

fn jpeg() -> Vec<u8> {
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::new(4, 4))
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Jpeg,
        )
        .unwrap();
    bytes
}

#[tokio::test]
async fn candidates_are_new_events_then_unposted_upcoming_ones() {
    // test_load_candidates_*, test_draft_candidates_fill_with_unposted_upcoming_events
    // and test_unposted_upcoming_skips_posted_and_unusable_events
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    let hour = Duration::hours(1);
    let day = Duration::days(1);
    let later = event(&db, school, "Later", -hour, day * 3, Some("Business")).await;
    let sooner = event(&db, school, "Sooner", -hour, day, Some("Business")).await;
    let uncategorized = event(&db, school, "No category", -hour, day, None).await;
    let too_soon = event(&db, school, "Too soon", -hour, hour * 2, Some("Business")).await;
    let requested = event(
        &db,
        school,
        "Requested",
        -day * 30,
        day * 4,
        Some("Arts & Culture"),
    )
    .await;
    sqlx::query("UPDATE public.events SET carousel_requested_at = now() WHERE id = $1")
        .bind(requested as i32)
        .execute(&db)
        .await
        .unwrap();
    let earlier = event(&db, school, "Earlier", -day * 10, day * 5, Some("Health")).await;
    let posted = event(&db, school, "Posted", -day * 10, day * 2, Some("Health")).await;
    let posted_batch = batch(&db, school, &slug, unique_day(), "published", &[posted]).await;
    sqlx::query(
        "UPDATE public.instagram_publish_items SET published_at = now() WHERE batch_id = $1",
    )
    .bind(posted_batch)
    .execute(&db)
    .await
    .unwrap();

    let now = Utc::now();
    let candidates = drafts::draft_candidates(&db, &slug, now - day, now)
        .await
        .unwrap();
    let picked: Vec<(i64, bool)> = candidates
        .iter()
        .map(|event| (event.id, event.new))
        .collect();
    assert_eq!(
        picked,
        [
            (sooner, true),
            (later, true),
            (requested, true),
            (earlier, false)
        ]
    );
    for left_out in [uncategorized, too_soon, posted] {
        assert!(!picked.iter().any(|(id, _)| *id == left_out));
    }
    let first = &candidates[0];
    assert_eq!(first.tz, "America/Toronto");
    assert_eq!(first.price, Some(json!(5)));
    assert_eq!(first.packet_summary()["title"], "Sooner");

    // Every registered school gets a packet; this one has no draft today.
    let packets = drafts::list_draft_candidates(&db, now).await.unwrap();
    let packet = packets
        .iter()
        .find(|packet| packet.account_key == slug)
        .unwrap();
    assert_eq!(packet.status, drafts::NEEDS_REVIEW);
    assert!(!packet.publishing_connected);
    let open = packet.open.as_ref().unwrap();
    assert!(
        open.caption_intro
            .starts_with(&format!("Fresh events at {slug}"))
    );
    assert_eq!(open.events.len(), 4);
}

fn selection(slug: &str, picks: Value) -> DraftSelection {
    DraftSelection::new(
        slug,
        Utc::now() - Duration::seconds(1),
        "Your next campus plans",
        "Film and conversation",
        &picks,
    )
    .unwrap()
}

#[tokio::test]
async fn choices_are_saved_once_a_day_and_checked_first() {
    // test_codex_saves_choices_and_reads_back_admin_draft,
    // test_codex_never_replaces_existing_daily_batch,
    // test_codex_rejects_other_school_choices_before_database_write and
    // test_unconnected_school_can_save_a_review_draft
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    let film = event(
        &db,
        school,
        "Film night",
        -Duration::hours(1),
        Duration::days(1),
        Some("Arts & Culture"),
    )
    .await;
    let games = event(
        &db,
        school,
        "Games night",
        -Duration::hours(1),
        Duration::days(2),
        Some("Games & Recreation"),
    )
    .await;

    let stranger = selection(
        &slug,
        json!([{"event_id": 999_999_999, "sticker_labels": ["Free"]}]),
    );
    let refused = drafts::save_review_draft(&db, &stranger).await.unwrap_err();
    assert_eq!(
        refused.downcast_ref::<Refused>(),
        Some(&Refused(
            "Draft choices must contain distinct eligible events".into()
        ))
    );
    let future = DraftSelection {
        window_end: Utc::now() + Duration::hours(1),
        ..stranger
    };
    assert!(drafts::save_review_draft(&db, &future).await.is_err());

    let chosen = selection(
        &slug,
        json!([
            {"event_id": games, "sticker_labels": ["Free Pizza", "Board Games"]},
            {"event_id": film, "sticker_labels": ["Movie Night"]},
        ]),
    );
    let (outcome, id) = drafts::save_review_draft(&db, &chosen).await.unwrap();
    assert_eq!(outcome, Outcome::Saved);
    let draft = batches::get_batch(&db, id).await.unwrap();
    assert_eq!(draft.row.status, "ready_for_review");
    assert_eq!(draft.row.instagram_user_id, None);
    assert_eq!(draft.row.cover_body, "Film and conversation");
    assert!(
        draft
            .row
            .caption
            .starts_with("Your next campus plans\n\n1. Games night - @carouselclub\n")
    );
    assert_eq!(
        draft
            .items
            .iter()
            .filter_map(|item| item.row.event_id)
            .collect::<Vec<_>>(),
        [games as i32, film as i32]
    );
    let stored: Value = sqlx::query_scalar(
        "SELECT sticker_selections FROM public.instagram_publish_batches WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        stored,
        json!({games.to_string(): ["Free Pizza", "Board Games"], film.to_string(): ["Movie Night"]})
    );

    // A later run the same day never replaces it.
    assert_eq!(
        drafts::save_review_draft(&db, &chosen).await.unwrap(),
        (Outcome::Existing, id)
    );
    let packets = drafts::list_draft_candidates(&db, Utc::now())
        .await
        .unwrap();
    let packet = packets
        .iter()
        .find(|packet| packet.account_key == slug)
        .unwrap();
    assert_eq!(
        (packet.batch_id, packet.status.as_str()),
        (Some(id), "ready_for_review")
    );
    assert!(packet.open.is_none());
}

#[tokio::test]
async fn a_school_with_nothing_new_saves_an_empty_checkpoint() {
    // test_codex_empty_pool_saves_an_empty_daily_checkpoint
    let Some(db) = database() else { return };
    let (_, slug) = school(&db).await;
    let (outcome, id) = drafts::save_review_draft(&db, &selection(&slug, json!([])))
        .await
        .unwrap();
    assert_eq!(outcome, Outcome::Empty);
    let status: String =
        sqlx::query_scalar("SELECT status FROM public.instagram_publish_batches WHERE id = $1")
            .bind(id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "empty");
}

/// A Graph API stand-in that accepts every container and the carousel.
fn graph_reply(request: &super::fake_http::Recorded, user_id: &str) -> Reply {
    let target = request.target.as_str();
    if request.method == "POST" && target == format!("/v25.0/{user_id}/media_publish") {
        return json_reply(json!({"id": "media-1"}));
    }
    if request.method == "POST" {
        return json_reply(json!({"id": format!("container-{}", request.body.len())}));
    }
    if target.starts_with("/v25.0/media-1?") {
        return json_reply(json!({"permalink": "https://www.instagram.com/p/ABC123/"}));
    }
    json_reply(json!({"status_code": "FINISHED"}))
}

#[tokio::test]
async fn a_claimed_batch_is_drawn_from_live_events_and_posted() {
    // test_publish_batch_renders_the_slides_from_live_event_data and
    // test_publish_batch_posts_only_a_batch_the_api_claimed
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    connect(&db, school, &slug, Duration::days(30)).await;
    let user_id = account_user_id(&db, &slug).await;
    let ids = [
        event(
            &db,
            school,
            "Mahjong Night",
            -Duration::hours(1),
            Duration::days(2),
            Some("Games & Recreation"),
        )
        .await,
        event(
            &db,
            school,
            "Pancake Breakfast",
            -Duration::hours(1),
            Duration::days(3),
            Some("Health"),
        )
        .await,
        event(
            &db,
            school,
            "Open Mic",
            -Duration::hours(1),
            Duration::days(4),
            Some("Arts & Culture"),
        )
        .await,
    ];
    let id = batch(&db, school, &slug, unique_day(), "ready_for_review", &ids).await;

    let image = jpeg();
    let site = serve(move |_| (200, "image/jpeg", image.clone())).await;
    let graph_user = user_id.clone();
    let graph = serve(move |request| graph_reply(request, &graph_user)).await;
    let settings = settings(&format!("{}/api/render-instagram-slide", site.url));
    let (storage, _) = recording::storage("media", "https://media.test");
    let publisher = Publisher::new(&db, &settings, &storage).with_graph(&graph.url);

    // Only a batch the API claimed is posted.
    assert_eq!(
        publisher.publish_batch(id).await.unwrap(),
        "ready_for_review"
    );
    assert!(graph.recorded().is_empty());
    batches::claim_batch(&db, KEY, id, 1).await.unwrap();
    assert_eq!(publisher.publish_batch(id).await.unwrap(), "published");

    let renders: Vec<Value> = site
        .recorded()
        .iter()
        .map(|request| request.json())
        .collect();
    assert_eq!(
        renders
            .iter()
            .map(|slide| slide["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["cover", "event", "event", "event", "outro"]
    );
    let cover = &renders[0];
    assert_eq!(cover["school"], slug.as_str());
    assert_eq!(cover["body"], "Three good things");
    assert_eq!(cover["events"][0]["title"], "Mahjong Night");
    assert_eq!(
        cover["events"][0]["sticker_labels"],
        json!(["Free Pizza", "Reg. Required"])
    );
    assert_eq!(cover["events"][0]["tz"], "America/Toronto");
    assert!(cover["events"][0].get("occurrences").is_none());
    assert!(
        cover["events"][0]["dtstart_utc"]
            .as_str()
            .unwrap()
            .ends_with("+00:00")
    );
    assert_eq!(renders[1]["event"]["id"], ids[0]);
    assert_eq!(renders[1]["school"], slug.as_str());
    assert_eq!(
        site.recorded()[0].header("authorization"),
        Some("Bearer render-secret")
    );

    let requests = graph.recorded();
    assert!(
        requests
            .iter()
            .all(|request| request.header("authorization") == Some("Bearer token-value"))
    );
    let carousel = requests
        .iter()
        .find(|request| request.text().starts_with("media_type=CAROUSEL"))
        .unwrap();
    let published = batches::get_batch(&db, id).await.unwrap();
    assert!(carousel.text().ends_with(&format!(
        "&caption={}",
        &super::meta::urlencode(&[("c", &published.row.caption)])[2..]
    )));
    assert_eq!(published.row.meta_media_id.as_deref(), Some("media-1"));
    assert_eq!(
        published.row.permalink.as_deref(),
        Some("https://www.instagram.com/p/ABC123/")
    );
    assert_eq!(published.row.music_status.as_deref(), Some("pending"));
    assert!(
        published
            .row
            .published_cover_url
            .as_deref()
            .unwrap()
            .starts_with("https://media.test/event-images/")
    );
    assert!(published.row.published_outro_url.is_some());
    assert!(
        published
            .items
            .iter()
            .all(|item| item.row.published_asset_url.is_some() && item.row.published_at.is_some())
    );
}

#[tokio::test]
async fn a_failed_post_is_recorded_on_the_batch() {
    // test_background_publish_records_failure
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    connect(&db, school, &slug, Duration::days(30)).await;
    let ids = [
        event(
            &db,
            school,
            "One",
            -Duration::hours(1),
            Duration::days(2),
            Some("Health"),
        )
        .await,
        event(
            &db,
            school,
            "Two",
            -Duration::hours(1),
            Duration::days(3),
            Some("Health"),
        )
        .await,
        event(
            &db,
            school,
            "Three",
            -Duration::hours(1),
            Duration::days(4),
            Some("Health"),
        )
        .await,
    ];
    let id = batch(&db, school, &slug, unique_day(), "ready_for_review", &ids).await;
    let image = jpeg();
    let site = serve(move |_| (200, "image/jpeg", image.clone())).await;
    let graph = serve(|_| {
        (
            400,
            "application/json",
            br#"{"error": {"message": "Invalid image"}}"#.to_vec(),
        )
    })
    .await;
    let settings = settings(&site.url);
    let (storage, _) = recording::storage("media", "https://media.test");
    batches::claim_batch(&db, KEY, id, 1).await.unwrap();
    let status = Publisher::new(&db, &settings, &storage)
        .with_graph(&graph.url)
        .publish_batch(id)
        .await
        .unwrap();
    assert_eq!(status, "failed");
    let message: Option<String> = sqlx::query_scalar(
        "SELECT error_message FROM public.instagram_publish_batches WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(message.as_deref(), Some("Invalid image"));
}

#[tokio::test]
async fn the_morning_publish_leaves_thin_and_unclaimable_drafts() {
    // test_a_carousel_under_three_events_is_never_published and
    // test_publish_ready_drafts_publishes_todays_drafts_one_by_one
    let Some(db) = database() else { return };
    let day = unique_day();
    let (thin_school, thin) = school(&db).await;
    let only = event(
        &db,
        thin_school,
        "Alone",
        -Duration::hours(1),
        Duration::days(2),
        Some("Health"),
    )
    .await;
    batch(&db, thin_school, &thin, day, "ready_for_review", &[only]).await;
    // An account that needs reauthorization cannot be claimed.
    let (locked_school, locked) = school(&db).await;
    connect(&db, locked_school, &locked, Duration::days(30)).await;
    sqlx::query("UPDATE public.instagram_publishing_accounts SET requires_reauthorization = true WHERE account_key = $1")
        .bind(&locked)
        .execute(&db)
        .await
        .unwrap();
    let mut ids = Vec::new();
    for title in ["A", "B", "C"] {
        ids.push(
            event(
                &db,
                locked_school,
                title,
                -Duration::hours(1),
                Duration::days(2),
                Some("Health"),
            )
            .await,
        );
    }
    batch(&db, locked_school, &locked, day, "ready_for_review", &ids).await;

    let settings = settings("");
    let (storage, _) = recording::storage("media", "https://media.test");
    let now = Utc
        .from_local_datetime(&day.and_hms_opt(16, 0, 0).unwrap())
        .unwrap();
    let outcomes = Publisher::new(&db, &settings, &storage)
        .publish_ready_drafts(now)
        .await
        .unwrap();
    assert_eq!(
        outcomes,
        BTreeMap::from([("skipped".into(), 1), ("too_few_events".into(), 1)])
    );
}

async fn due(db: &PgPool, account_key: &str) -> DueAccount {
    sqlx::query_as(
        "SELECT account_key, instagram_user_id, encrypted_access_token \
         FROM public.instagram_publishing_accounts WHERE account_key = $1",
    )
    .bind(account_key)
    .fetch_one(db)
    .await
    .unwrap()
}

#[tokio::test]
async fn tokens_are_refreshed_or_their_account_marked() {
    // test_refresh_replaces_token_and_expiry_after_revalidating_identity and
    // test_refresh_failure_marks_only_that_account_for_reauthorization
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    connect(&db, school, &slug, Duration::days(2)).await;
    let user_id = account_user_id(&db, &slug).await;
    let identity = user_id.clone();
    let graph = serve(move |request| {
        if request.target.starts_with("/refresh_access_token") {
            json_reply(json!({"access_token": "refreshed-token", "expires_in": 5_184_000}))
        } else {
            json_reply(json!({"id": identity, "username": "renamed.handle"}))
        }
    })
    .await;
    let now = Utc::now();
    assert!(
        refresh_account(&db, KEY, &graph.url, &due(&db, &slug).await, now)
            .await
            .unwrap()
    );
    let (token, expires_at, username): (String, DateTime<Utc>, String) = sqlx::query_as(
        "SELECT encrypted_access_token, expires_at, instagram_username \
         FROM public.instagram_publishing_accounts WHERE account_key = $1",
    )
    .bind(&slug)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(decrypt_token(KEY, &token).unwrap(), "refreshed-token");
    assert_eq!(username, "renamed.handle");
    assert!(
        (expires_at - (now + Duration::seconds(5_184_000)))
            .num_seconds()
            .abs()
            < 1
    );
    // The refresh request carried the token Python had stored.
    assert!(
        graph.recorded()[0]
            .target
            .ends_with("access_token=token-value")
    );

    let revoked = serve(|_| {
        (
            400,
            "application/json",
            br#"{"error": {"message": "revoked refreshed-token"}}"#.to_vec(),
        )
    })
    .await;
    assert!(
        !refresh_account(&db, KEY, &revoked.url, &due(&db, &slug).await, now)
            .await
            .unwrap()
    );
    let (marked, error): (bool, Option<String>) = sqlx::query_as(
        "SELECT requires_reauthorization, refresh_error \
         FROM public.instagram_publishing_accounts WHERE account_key = $1",
    )
    .bind(&slug)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(marked);
    assert_eq!(error.as_deref(), Some("revoked [REDACTED]"));
}

#[tokio::test]
async fn stats_record_the_day_and_replace_the_newest_posts() {
    // test_snapshot_records_the_day_and_replaces_the_newest_posts and
    // test_snapshot_refuses_a_token_for_another_account
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    connect(&db, school, &slug, Duration::days(30)).await;
    let user_id = account_user_id(&db, &slug).await;
    let media_id = |n: u32| format!("{school}{n}");
    let posts = json!([
        {"id": media_id(1), "media_type": "CAROUSEL_ALBUM", "media_url": "https://cdn.example/1.jpg",
         "permalink": "https://www.instagram.com/p/A/", "timestamp": "2026-10-23T13:59:50+0000", "like_count": 41},
        {"id": media_id(2), "media_type": "VIDEO", "media_url": "https://cdn.example/2.mp4",
         "thumbnail_url": "https://cdn.example/2.jpg", "permalink": "https://www.instagram.com/reel/B/",
         "timestamp": "2026-10-22T13:59:50+0000"},
    ]);
    let profile_id = user_id.clone();
    let listed = posts.clone();
    let graph = serve(move |request| {
        if request.target.starts_with("/v25.0/me/media") {
            json_reply(json!({"data": listed}))
        } else {
            json_reply(
                json!({"id": profile_id, "username": "wat2do.test", "followers_count": 1200}),
            )
        }
    })
    .await;
    let now = Utc::now();
    stats::snapshot_account(&db, KEY, &graph.url, &slug, now)
        .await
        .unwrap();
    let followers: i32 = sqlx::query_scalar(
        "SELECT followers_count FROM public.instagram_account_snapshots \
         WHERE account_key = $1 AND captured_on = $2",
    )
    .bind(&slug)
    .bind(drafts::local_date(now))
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(followers, 1200);
    let images: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT media_id, image_url FROM public.instagram_account_media \
         WHERE account_key = $1 ORDER BY posted_at DESC",
    )
    .bind(&slug)
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(
        images,
        [
            (media_id(1), Some("https://cdn.example/1.jpg".to_owned())),
            (media_id(2), Some("https://cdn.example/2.jpg".to_owned())),
        ]
    );

    // A token for another account is refused before anything is written.
    let other = serve(|_| json_reply(json!({"id": "9999", "username": "someone"}))).await;
    let refused = stats::snapshot_account(&db, KEY, &other.url, &slug, now).await;
    assert_eq!(
        refused.unwrap_err().to_string(),
        "Instagram profile identity does not match the stored account"
    );
}
