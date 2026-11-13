//! The ingestion agent's database side against a real Postgres loaded with our
//! schema.
//!
//! They run only when `WAT2DO_TEST_DATABASE_URL` names that database (CI's
//! "Rust database tests" job). Every test makes its own school and sources, so
//! the tests run in parallel without seeing each other's rows.

use chrono::{DateTime, NaiveDateTime, TimeDelta, TimeZone, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::agent::ingest;
use super::club_directories::queue;
use super::title_svgs::{Checked, featured_to_draw};
use crate::api::test_database::database;
use crate::time_zones::Tz;

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

/// The agent converts every school time with `local_to_utc` and reads it back
/// with `utc_to_local`; both must agree with the tz database Rust bundles,
/// whatever tz database this Postgres was built with.
#[tokio::test]
async fn school_times_in_postgres_follow_the_bundled_tz_database() {
    let Some(db) = database() else { return };
    let mut zones: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT timezone::text FROM public.schools")
            .fetch_all(&db)
            .await
            .unwrap();
    zones.extend(["America/Vancouver", "America/Edmonton", "America/Winnipeg"].map(String::from));
    // Every six hours through three winters, so each transition and each
    // missing fall-back is crossed.
    let start: DateTime<Utc> = "2025-10-01T00:00:00Z".parse().unwrap();
    let instants: Vec<DateTime<Utc>> = (0..4 * 365 * 3)
        .map(|step| start + TimeDelta::hours(6 * step))
        .collect();
    for name in zones {
        let zone: Tz = name.parse().unwrap();
        let walls: Vec<NaiveDateTime> = sqlx::query_scalar(
            "SELECT public.utc_to_local(instant, $2) FROM unnest($1::timestamptz[]) AS instant",
        )
        .bind(&instants)
        .bind(&name)
        .fetch_all(&db)
        .await
        .unwrap();
        let expected: Vec<NaiveDateTime> = instants
            .iter()
            .map(|instant| instant.with_timezone(&zone).naive_local())
            .collect();
        assert_eq!(walls, expected, "utc_to_local in {name}");

        // Wall times that exist exactly once read back to their instant.
        let unambiguous: Vec<NaiveDateTime> = expected
            .into_iter()
            .filter(|wall| zone.from_local_datetime(wall).single().is_some())
            .collect();
        let back: Vec<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT public.local_to_utc(wall, $2) FROM unnest($1::timestamp[]) AS wall",
        )
        .bind(&unambiguous)
        .bind(&name)
        .fetch_all(&db)
        .await
        .unwrap();
        let expected: Vec<DateTime<Utc>> = unambiguous
            .iter()
            .map(|wall| zone.from_local_datetime(wall).unwrap().with_timezone(&Utc))
            .collect();
        assert_eq!(back, expected, "local_to_utc in {name}");
    }
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

#[tokio::test]
async fn featured_events_to_come_are_drawn_until_a_drawing_spells_their_title_and_renders_cleanly()
{
    let Some(db) = database() else { return };
    let (school, slug) = school(&db).await;
    let event = |starts_in: TimeDelta, title_svg: Option<&'static str>| {
        let db = db.clone();
        async move {
            let id = listed(
                &db,
                school,
                &instagram_post(),
                "https://example.com/poster.jpg",
            )
            .await;
            sqlx::query("UPDATE public.events SET title_svg = $2 WHERE id = $1")
                .bind(id)
                .bind(title_svg)
                .execute(&db)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO public.event_dates (event_id, dtstart_utc, dtend_utc) \
                 VALUES ($1, now() + $2, now() + $2 + interval '2 hours')",
            )
            .bind(id)
            .bind(starts_in)
            .execute(&db)
            .await
            .unwrap();
            id
        }
    };
    let day = TimeDelta::days(1);
    let spelled = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 90"><text x="200" y="66" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="56" fill="#ffd400" textLength="330" lengthAdjust="spacingAndGlyphs">GAMES NIGHT</text></svg>"##;
    let misspelled = r#"<svg viewBox="0 0 400 80"><text>WEEK AHEAD</text></svg>"#;
    // Spelled, but with no font size it would set flat across the card.
    let flat = r#"<svg viewBox="0 0 400 80"><text x="200" y="60" text-anchor="middle" textLength="360">GAMES NIGHT</text></svg>"#;
    let undrawn = event(day * 2, None).await;
    let unshapely = event(day * 3, Some(flat)).await;
    let wrong = event(day, Some(misspelled)).await;
    let drawn = event(day, Some(spelled)).await;
    let over = event(-day, None).await;
    let unposted = event(day, None).await;
    // Featured whatever its date; an event that is not featured is never drawn.
    let far = event(day * 40, None).await;
    let far_featured = event(day * 40, None).await;
    // A club that asked to stay out of carousels is not featured, even for a slide posted before.
    let opted_out = event(day * 2, None).await;
    let handle = format!("optout{}", &Uuid::new_v4().simple().to_string()[..10]);
    sqlx::query("UPDATE public.events SET ig_handle = $2 WHERE id = $1")
        .bind(opted_out)
        .bind(format!("@{handle}"))
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.instagram_excluded_clubs (ig_handle) VALUES ($1)")
        .bind(&handle)
        .execute(&db)
        .await
        .unwrap();
    let carousel: Uuid = sqlx::query_scalar(
        "INSERT INTO public.instagram_publish_batches (account_key, school_id, local_date, \
             window_start, window_end, status, caption_intro, cover_body) \
         VALUES ($1, $2, current_date, now() - interval '2 days', now() - interval '1 day', \
             'publishing', 'Our picks', 'Good things') RETURNING id",
    )
    .bind(&slug)
    .bind(school)
    .fetch_one(&db)
    .await
    .unwrap();
    for (position, event) in [
        undrawn,
        wrong,
        drawn,
        over,
        unshapely,
        opted_out,
        far_featured,
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO public.instagram_publish_items \
                 (batch_id, account_key, event_id, position, published_at) \
             VALUES ($1, $2, $3, $4, now())",
        )
        .bind(carousel)
        .bind(&slug)
        .bind(event)
        .bind(position as i32 + 1)
        .execute(&db)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO public.instagram_publish_items (batch_id, account_key, event_id, position) \
         VALUES ($1, $2, $3, 8)",
    )
    .bind(carousel)
    .bind(&slug)
    .bind(unposted)
    .execute(&db)
    .await
    .unwrap();

    let ours = [
        undrawn,
        wrong,
        drawn,
        over,
        unposted,
        unshapely,
        opted_out,
        far,
        far_featured,
    ]
    .map(i64::from);
    let due: Vec<(i64, bool)> = featured_to_draw(&db, &mut Checked::default())
        .await
        .unwrap()
        .into_iter()
        .filter(|(event, _)| ours.contains(&event.id))
        .map(|(event, drawing)| (event.id, drawing.is_some()))
        .collect();
    // Featured events only, soonest first, each with whether it has a drawing a new
    // one replaces. The opted-out club's event is not featured, so it is not drawn.
    let i = i64::from;
    assert_eq!(
        due,
        [
            (i(wrong), true),
            (i(undrawn), false),
            (i(unshapely), true),
            (i(far_featured), false),
        ]
    );
}
