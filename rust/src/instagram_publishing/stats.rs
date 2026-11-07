//! Every publishing account's followers and recent posts, read once a day
//! from the Graph API (`stats.py`).
//!
//! The Mac's daily `io.wat2do.instagram-account-stats` timer runs
//! `wat2do-instagram stats`, which refreshes expiring tokens first, then
//! writes a follower snapshot per account per day and replaces each
//! account's newest posts. The admin's social dashboard reads these tables
//! (`api/routes/instagram_publishing/accounts.rs`).

use std::collections::BTreeMap;

use anyhow::{Result, anyhow, bail};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use super::job_error;
use super::meta::MetaClient;
use crate::api::routes::instagram_publishing::credentials::load_account_credentials;
use crate::controlbox::INSTAGRAM_PUBLISHING;

/// `snapshot_accounts`: read every account whose token still works; one
/// failure never stops the rest.
pub async fn snapshot_accounts(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    now: DateTime<Utc>,
) -> Result<BTreeMap<String, i64>> {
    let accounts: Vec<String> = sqlx::query_scalar(
        "SELECT account_key FROM public.instagram_publishing_accounts \
         WHERE requires_reauthorization = false ORDER BY account_key",
    )
    .fetch_all(db)
    .await?;
    let mut outcomes = BTreeMap::new();
    for account_key in accounts {
        let outcome =
            match snapshot_account(db, encryption_key, graph_host, &account_key, now).await {
                Ok(()) => "captured",
                Err(error) => {
                    tracing::error!(
                        "Instagram stats snapshot failed account_key={account_key}: {error:#}"
                    );
                    "failed"
                }
            };
        *outcomes.entry(outcome.to_owned()).or_insert(0) += 1;
    }
    Ok(outcomes)
}

/// `int(value or 0)`.
fn count(profile: &Map<String, Value>, field: &str) -> Result<i64> {
    match profile.get(field) {
        Some(value) if crate::pyjson::truthy(value) => value
            .as_i64()
            .or_else(|| value.as_f64().map(|number| number.trunc() as i64))
            .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
            .ok_or_else(|| anyhow!("Instagram returned an invalid {field}")),
        _ => Ok(0),
    }
}

/// One account's snapshot for today and its newest posts.
pub async fn snapshot_account(
    db: &PgPool,
    encryption_key: &str,
    graph_host: &str,
    account_key: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    let credentials = load_account_credentials(db, encryption_key, account_key, now)
        .await
        .map_err(job_error)?;
    let client = MetaClient::with_host(graph_host, &credentials.access_token)?;
    let profile = client.get_profile().await?;
    let profile_id = profile
        .get("id")
        .map(crate::pyjson::str)
        .unwrap_or("None".into());
    if profile_id != credentials.instagram_user_id {
        bail!("Instagram profile identity does not match the stored account");
    }
    let media = client
        .list_recent_media(INSTAGRAM_PUBLISHING.stats_media_limit)
        .await?;
    let username = profile
        .get("username")
        .map(crate::pyjson::str)
        .ok_or_else(|| anyhow!("'username'"))?;
    let rows = media
        .iter()
        .map(|item| media_row(account_key, item, now))
        .collect::<Result<Vec<Value>>>()?;

    let mut transaction = db.begin().await?;
    sqlx::query(
        "INSERT INTO public.instagram_account_snapshots (account_key, captured_on, username, \
             name, profile_picture_url, followers_count, follows_count, media_count, captured_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (account_key, captured_on) DO UPDATE SET username = EXCLUDED.username, \
             name = EXCLUDED.name, profile_picture_url = EXCLUDED.profile_picture_url, \
             followers_count = EXCLUDED.followers_count, follows_count = EXCLUDED.follows_count, \
             media_count = EXCLUDED.media_count, captured_at = EXCLUDED.captured_at",
    )
    .bind(account_key)
    .bind(super::drafts::local_date(now))
    .bind(username)
    .bind(text_or_null(profile.get("name")))
    .bind(text_or_null(profile.get("profile_picture_url")))
    .bind(count(&profile, "followers_count")? as i32)
    .bind(count(&profile, "follows_count")? as i32)
    .bind(count(&profile, "media_count")? as i32)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO public.instagram_account_media (media_id, account_key, media_type, \
             media_product_type, caption, image_url, permalink, posted_at, like_count, \
             comments_count, refreshed_at) \
         SELECT media_id, account_key, media_type, media_product_type, caption, image_url, \
             permalink, posted_at, like_count, comments_count, refreshed_at \
         FROM jsonb_to_recordset($1) AS media (media_id text, account_key text, media_type text, \
             media_product_type text, caption text, image_url text, permalink text, \
             posted_at timestamptz, like_count int, comments_count int, refreshed_at timestamptz) \
         ON CONFLICT (media_id) DO UPDATE SET account_key = EXCLUDED.account_key, \
             media_type = EXCLUDED.media_type, media_product_type = EXCLUDED.media_product_type, \
             caption = EXCLUDED.caption, image_url = EXCLUDED.image_url, \
             permalink = EXCLUDED.permalink, posted_at = EXCLUDED.posted_at, \
             like_count = EXCLUDED.like_count, comments_count = EXCLUDED.comments_count, \
             refreshed_at = EXCLUDED.refreshed_at",
    )
    .bind(Value::Array(rows.clone()))
    .execute(&mut *transaction)
    .await?;
    // Posts that fell out of the newest window, or were deleted, leave the dashboard.
    let kept: Vec<String> = rows
        .iter()
        .filter_map(|row| row["media_id"].as_str().map(str::to_owned))
        .collect();
    sqlx::query(
        "DELETE FROM public.instagram_account_media \
         WHERE account_key = $1 AND NOT media_id = ANY($2)",
    )
    .bind(account_key)
    .bind(&kept)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(())
}

/// A text column's value: `None` stays null, anything else as `str()` writes it.
fn text_or_null(value: Option<&Value>) -> Option<String> {
    value
        .filter(|value| !value.is_null())
        .map(crate::pyjson::str)
}

/// `_media_row`: one post as the dashboard lists it.
fn media_row(account_key: &str, item: &Value, now: DateTime<Utc>) -> Result<Value> {
    let field = |name: &str| item.get(name).filter(|value| !value.is_null());
    let required = |name: &str| {
        field(name)
            .map(crate::pyjson::str)
            .ok_or_else(|| anyhow!("'{name}'"))
    };
    // A video's media_url is the video itself; its thumbnail is the picture to show.
    let image_url = if item.get("media_type").and_then(Value::as_str) == Some("VIDEO") {
        field("thumbnail_url")
    } else {
        field("media_url")
    };
    Ok(json!({
        "media_id": required("id")?,
        "account_key": account_key,
        "media_type": field("media_type")
            .filter(|value| crate::pyjson::truthy(value))
            .map_or("IMAGE".to_owned(), crate::pyjson::str),
        "media_product_type": field("media_product_type"),
        "caption": field("caption"),
        "image_url": image_url,
        "permalink": required("permalink")?,
        "posted_at": required("timestamp")?,
        "like_count": field("like_count"),
        "comments_count": field("comments_count"),
        "refreshed_at": super::isoformat(&now),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn reels_show_their_thumbnail_and_rows_keep_python_fields() {
        // test_snapshot_records_the_day_and_replaces_the_newest_posts
        let now = Utc.with_ymd_and_hms(2026, 10, 24, 11, 0, 0).unwrap();
        let carousel = json!({
            "id": "1790", "media_type": "CAROUSEL_ALBUM", "media_product_type": "FEED",
            "caption": "Fresh events", "media_url": "https://cdn.example/1790.jpg",
            "permalink": "https://www.instagram.com/p/ABC123/",
            "timestamp": "2026-10-23T13:59:50+0000", "like_count": 41, "comments_count": 3,
        });
        let reel = json!({
            "id": "1791", "media_type": "VIDEO", "media_product_type": "REELS",
            "media_url": "https://cdn.example/1791.mp4", "thumbnail_url": "https://cdn.example/1791.jpg",
            "permalink": "https://www.instagram.com/reel/DEF456/",
            "timestamp": "2026-10-22T13:59:50+0000", "like_count": 9, "comments_count": 0,
        });
        let rows: Vec<Value> = [carousel, reel]
            .iter()
            .map(|item| media_row("uwaterloo", item, now).unwrap())
            .collect();
        assert_eq!(rows[0]["image_url"], "https://cdn.example/1790.jpg");
        assert_eq!(rows[1]["image_url"], "https://cdn.example/1791.jpg");
        assert_eq!(rows[0]["posted_at"], "2026-10-23T13:59:50+0000");
        assert_eq!(rows[1]["caption"], Value::Null);
        assert_eq!(rows[0]["refreshed_at"], "2026-10-24T11:00:00+00:00");
        // The snapshot's day is Toronto's.
        assert_eq!(
            super::super::drafts::local_date(now).to_string(),
            "2026-10-24"
        );
        let untyped = media_row(
            "uwaterloo",
            &json!({"id": 5, "permalink": "p", "timestamp": "t"}),
            now,
        )
        .unwrap();
        assert_eq!(untyped["media_type"], "IMAGE");
        assert_eq!(untyped["media_id"], "5");
    }

    #[test]
    fn missing_counts_read_as_zero() {
        let profile = json!({"followers_count": 1200, "follows_count": null});
        let profile = profile.as_object().unwrap();
        assert_eq!(count(profile, "followers_count").unwrap(), 1200);
        assert_eq!(count(profile, "follows_count").unwrap(), 0);
        assert_eq!(count(profile, "media_count").unwrap(), 0);
    }
}
