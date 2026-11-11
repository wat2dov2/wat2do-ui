//! `list_account_stats` (`services/instagram_publishing/stats.py`): every
//! connected account with its latest snapshot, follower history and newest
//! posts, for the admin's social dashboard. The daily snapshot job
//! (`wat2do-instagram stats`, `crate::instagram_publishing::stats`) writes these tables.
//! Each account also carries when its school last received an Instagram
//! notification, so the dashboard can flag a phone that stopped sending them.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::api::errors::ApiError;
use crate::api::json;
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::db::read_with_retry;
use crate::time_zones::Tz;

/// `InstagramFollowerCountResponse`.
#[derive(Debug, Serialize, PartialEq)]
pub struct FollowerCount {
    pub captured_on: NaiveDate,
    pub followers_count: i32,
}

/// `InstagramAccountPostResponse`.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Post {
    pub media_id: String,
    pub media_type: String,
    pub media_product_type: Option<String>,
    pub caption: Option<String>,
    pub image_url: Option<String>,
    pub permalink: String,
    #[serde(serialize_with = "json::datetime")]
    pub posted_at: DateTime<Utc>,
    pub like_count: Option<i32>,
    pub comments_count: Option<i32>,
    /// Set only on carousels wat2do published, where the emulator adds the song.
    #[sqlx(skip)]
    pub music_status: Option<String>,
    #[sqlx(skip)]
    pub music_track: Option<String>,
    #[serde(skip)]
    pub account_key: String,
}

/// `InstagramAccountStatsResponse`.
#[derive(Debug, Serialize)]
pub struct AccountStats {
    pub account_key: String,
    pub username: String,
    pub name: Option<String>,
    pub profile_picture_url: Option<String>,
    pub followers_count: Option<i32>,
    pub follows_count: Option<i32>,
    pub media_count: Option<i32>,
    #[serde(serialize_with = "json::option_datetime")]
    pub captured_at: Option<DateTime<Utc>>,
    pub requires_reauthorization: bool,
    #[serde(serialize_with = "json::datetime")]
    pub token_expires_at: DateTime<Utc>,
    /// When the school's newest notification was first seen; none when it
    /// never received one.
    #[serde(serialize_with = "json::option_datetime")]
    pub last_notification_at: Option<DateTime<Utc>>,
    pub followers_history: Vec<FollowerCount>,
    pub posts: Vec<Post>,
}

#[derive(sqlx::FromRow)]
pub struct Account {
    pub account_key: String,
    pub instagram_username: String,
    pub requires_reauthorization: bool,
    pub expires_at: DateTime<Utc>,
    pub last_notification_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Snapshot {
    pub account_key: String,
    pub captured_on: NaiveDate,
    pub username: String,
    pub name: Option<String>,
    pub profile_picture_url: Option<String>,
    pub followers_count: i32,
    pub follows_count: i32,
    pub media_count: i32,
    pub captured_at: DateTime<Utc>,
}

/// The first day of the follower history: `stats_history_days` days, today included.
fn history_start(now: DateTime<Utc>) -> Result<NaiveDate, ApiError> {
    let control = &*INSTAGRAM_PUBLISHING;
    let zone: Tz = control.generation_timezone.parse().map_err(|_| {
        ApiError::Internal(anyhow::anyhow!("no zone {:?}", control.generation_timezone))
    })?;
    Ok(now.with_timezone(&zone).date_naive() - Duration::days(control.stats_history_days - 1))
}

/// Each account with its snapshots (oldest first) and posts (newest first).
pub fn assemble(
    accounts: Vec<Account>,
    snapshots: Vec<Snapshot>,
    posts: Vec<Post>,
) -> Vec<AccountStats> {
    let mut history: HashMap<String, Vec<Snapshot>> = HashMap::new();
    for snapshot in snapshots {
        history
            .entry(snapshot.account_key.clone())
            .or_default()
            .push(snapshot);
    }
    let mut posts_by_account: HashMap<String, Vec<Post>> = HashMap::new();
    for post in posts {
        posts_by_account
            .entry(post.account_key.clone())
            .or_default()
            .push(post);
    }
    accounts
        .into_iter()
        .map(|account| {
            let days = history.remove(&account.account_key).unwrap_or_default();
            let latest = days.last().cloned();
            AccountStats {
                username: latest
                    .as_ref()
                    .map(|latest| latest.username.clone())
                    .filter(|username| !username.is_empty())
                    .unwrap_or(account.instagram_username),
                name: latest.as_ref().and_then(|latest| latest.name.clone()),
                profile_picture_url: latest
                    .as_ref()
                    .and_then(|latest| latest.profile_picture_url.clone()),
                followers_count: latest.as_ref().map(|latest| latest.followers_count),
                follows_count: latest.as_ref().map(|latest| latest.follows_count),
                media_count: latest.as_ref().map(|latest| latest.media_count),
                captured_at: latest.as_ref().map(|latest| latest.captured_at),
                requires_reauthorization: account.requires_reauthorization,
                token_expires_at: account.expires_at,
                last_notification_at: account.last_notification_at,
                followers_history: days
                    .iter()
                    .map(|day| FollowerCount {
                        captured_on: day.captured_on,
                        followers_count: day.followers_count,
                    })
                    .collect(),
                posts: posts_by_account
                    .remove(&account.account_key)
                    .unwrap_or_default(),
                account_key: account.account_key,
            }
        })
        .collect()
}

/// `list_account_stats`.
pub async fn list(db: &PgPool) -> Result<Vec<AccountStats>, ApiError> {
    let start = history_start(Utc::now())?;
    let accounts: Vec<Account> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT a.account_key, a.instagram_username, a.requires_reauthorization, \
                 a.expires_at, n.last_notification_at \
             FROM public.instagram_publishing_accounts a \
             LEFT JOIN (SELECT school_id, max(first_seen_at) AS last_notification_at \
                 FROM public.instagram_notifications GROUP BY school_id) n \
               ON n.school_id = a.school_id \
             ORDER BY a.account_key",
        )
        .fetch_all(db)
    })
    .await?;
    let snapshots: Vec<Snapshot> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT account_key, captured_on, username, name, profile_picture_url, \
             followers_count, follows_count, media_count, captured_at \
             FROM public.instagram_account_snapshots WHERE captured_on >= $1 \
             ORDER BY captured_on, account_key",
        )
        .bind(start)
        .fetch_all(db)
    })
    .await?;
    let mut posts: Vec<Post> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT media_id, account_key, media_type, media_product_type, caption, image_url, \
             permalink, posted_at, like_count, comments_count \
             FROM public.instagram_account_media ORDER BY posted_at DESC, media_id",
        )
        .fetch_all(db)
    })
    .await?;
    // The emulator's song outcome for each post wat2do published as a carousel.
    if let Some(oldest) = posts.iter().map(|post| post.posted_at).min() {
        let songs: Vec<(String, Option<String>, Option<String>)> = read_with_retry(|| {
            sqlx::query_as(
                "SELECT meta_media_id, music_status, music_track \
                 FROM public.instagram_publish_batches \
                 WHERE meta_media_id IS NOT NULL AND published_at >= $1 ORDER BY id",
            )
            .bind(oldest)
            .fetch_all(db)
        })
        .await?;
        let songs: HashMap<String, (Option<String>, Option<String>)> = songs
            .into_iter()
            .map(|(media_id, status, track)| (media_id, (status, track)))
            .collect();
        for post in &mut posts {
            if let Some((status, track)) = songs.get(&post.media_id) {
                post.music_status = status.clone();
                post.music_track = track.clone();
            }
        }
    }
    Ok(assemble(accounts, snapshots, posts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 13, 0, 0).unwrap()
    }

    fn snapshot(day: u32, followers: i32) -> Snapshot {
        Snapshot {
            account_key: "uwaterloo".into(),
            captured_on: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            username: "wat2do.uwaterloo".into(),
            name: Some("Wat2Do Waterloo".into()),
            profile_picture_url: None,
            followers_count: followers,
            follows_count: 10,
            media_count: 40,
            captured_at: at(day),
        }
    }

    fn account(key: &str) -> Account {
        Account {
            account_key: key.into(),
            instagram_username: format!("wat2do.{key}"),
            requires_reauthorization: false,
            expires_at: at(30),
            last_notification_at: None,
        }
    }

    #[test]
    fn every_account_shows_its_latest_snapshot_history_and_posts() {
        // test_admin_reads_every_account_at_once
        let post = Post {
            media_id: "1790".into(),
            media_type: "CAROUSEL_ALBUM".into(),
            media_product_type: None,
            caption: None,
            image_url: None,
            permalink: "https://www.instagram.com/p/ABC123/".into(),
            posted_at: at(23),
            like_count: Some(41),
            comments_count: Some(3),
            music_status: Some("added".into()),
            music_track: Some("Houdini by Dua Lipa".into()),
            account_key: "uwaterloo".into(),
        };
        let uwaterloo = Account {
            last_notification_at: Some(at(24)),
            ..account("uwaterloo")
        };
        let stats = assemble(
            vec![account("queensu"), uwaterloo],
            vec![snapshot(23, 1190), snapshot(24, 1200)],
            vec![post],
        );
        let value = serde_json::to_value(&stats).unwrap();
        assert_eq!(
            value[0],
            serde_json::json!({
                "account_key": "queensu",
                "username": "wat2do.queensu",
                "name": null,
                "profile_picture_url": null,
                "followers_count": null,
                "follows_count": null,
                "media_count": null,
                "captured_at": null,
                "requires_reauthorization": false,
                "token_expires_at": "2026-10-30T13:00:00Z",
                "last_notification_at": null,
                "followers_history": [],
                "posts": [],
            })
        );
        assert_eq!(value[1]["followers_count"], 1200);
        assert_eq!(value[1]["captured_at"], "2026-10-24T13:00:00Z");
        assert_eq!(value[1]["last_notification_at"], "2026-10-24T13:00:00Z");
        assert_eq!(
            value[1]["followers_history"],
            serde_json::json!([
                {"captured_on": "2026-10-23", "followers_count": 1190},
                {"captured_on": "2026-10-24", "followers_count": 1200},
            ])
        );
        assert_eq!(
            value[1]["posts"][0],
            serde_json::json!({
                "media_id": "1790",
                "media_type": "CAROUSEL_ALBUM",
                "media_product_type": null,
                "caption": null,
                "image_url": null,
                "permalink": "https://www.instagram.com/p/ABC123/",
                "posted_at": "2026-10-23T13:00:00Z",
                "like_count": 41,
                "comments_count": 3,
                "music_status": "added",
                "music_track": "Houdini by Dua Lipa",
            })
        );
    }

    #[test]
    fn history_covers_the_configured_days_in_toronto() {
        // 2026-10-24 01:00 UTC is still the 23rd in Toronto.
        let now = Utc.with_ymd_and_hms(2026, 10, 24, 1, 0, 0).unwrap();
        assert_eq!(
            history_start(now).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
                - Duration::days(INSTAGRAM_PUBLISHING.stats_history_days - 1)
        );
    }
}
