//! The accounts school accounts followed on their own, day by day, for the
//! admin Clubs page's Automated follows tab: every account the crawl or a
//! school's club directory found, the scorer's rating of it, its newest posts,
//! and the events those accounts brought in.
//!
//! A follow's newest posts are the ones the scorer read when it rated the
//! account (`instagram_follow_candidates.recent_posts`) together with the
//! posts ingestion heard about since (`ingestion_items`, by the post's owner),
//! newest first. Instagram's picture links are signed and expire after a few
//! days, so a picture whose link has expired is left out.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::events::store;
use crate::api::json;
use crate::api::messages::FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND;
use crate::api::pagination::Pagination;
use crate::constants::{FOLLOW_SOURCE_CRAWL, FOLLOW_SOURCE_DIRECTORY};
use crate::db::read_with_retry;

/// The sources whose accounts were found and followed without a person
/// asking: the crawl of Following lists and the club directory agents.
pub const AUTOMATED_SOURCES: &[&str] = &[FOLLOW_SOURCE_CRAWL, FOLLOW_SOURCE_DIRECTORY];
/// Posts shown for each follow.
pub const POSTS_PER_FOLLOW: usize = 3;

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum AutomatedFollowSource {
    Crawl,
    Directory,
}

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum AutomatedFollowStatus {
    Approved,
    Followed,
    Unfollow,
    Rejected,
}

#[derive(ToSchema)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum ScoreVerdict {
    Approve,
    Review,
    Reject,
}

/// One of an account's newest posts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FollowPostResponse {
    pub url: String,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime)]
    pub posted_at: Option<DateTime<Utc>>,
    pub caption: String,
    /// The post's picture, only while Instagram's signed link is still live.
    pub image: Option<String>,
}

/// An account a school account followed on its own, with the scorer's rating
/// and its newest posts.
#[derive(Debug, Serialize, ToSchema)]
pub struct AutomatedFollowResponse {
    pub id: Uuid,
    pub school: String,
    pub handle: String,
    pub name: Option<String>,
    #[schema(value_type = AutomatedFollowSource, inline)]
    pub source: String,
    // `followed` while the school still follows it; an account a later audit
    // dropped is `unfollow` (waiting) or `rejected` (done). A doc comment here
    // would turn the inline enum into an intersection in the generated types.
    #[schema(value_type = AutomatedFollowStatus, inline)]
    pub status: String,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub followed_at: DateTime<Utc>,
    /// The scorer's rating out of 100.
    #[schema(minimum = 0, maximum = 100)]
    pub score: Option<i16>,
    #[schema(value_type = Option<ScoreVerdict>, inline)]
    pub verdict: Option<String>,
    /// Why the scorer rated it so.
    pub reason: Option<String>,
    /// The followed accounts that follow it, or the directory that lists it.
    pub found_via: Vec<String>,
    pub followers_count: Option<i32>,
    /// Up to three of its newest posts, newest first.
    pub recent_posts: Vec<FollowPostResponse>,
}

crate::paginated_schema!(
    PaginatedAutomatedFollows,
    PaginatedResponse_AutomatedFollowResponse_,
    AutomatedFollowResponse
);

/// An event added from an account a school account followed on its own.
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct FollowedAccountEventResponse {
    pub id: i32,
    pub school: String,
    pub title: String,
    #[serde(serialize_with = "json::option_datetime")]
    #[schema(value_type = Option<String>, format = DateTime)]
    pub added_at: Option<DateTime<Utc>>,
    pub image_url: Option<String>,
    /// The followed account that hosts it, and when it was followed.
    pub handle: String,
    #[serde(serialize_with = "json::datetime")]
    #[schema(value_type = String, format = DateTime)]
    pub followed_at: DateTime<Utc>,
}

crate::paginated_schema!(
    PaginatedFollowedAccountEvents,
    PaginatedResponse_FollowedAccountEventResponse_,
    FollowedAccountEventResponse
);

/// Which follows to read: one school or every school, within a time window.
#[derive(Debug, Clone)]
pub struct Window {
    pub school: Option<String>,
    pub since: DateTime<Utc>,
    pub until: DateTime<Utc>,
}

async fn school_id(db: &PgPool, school: Option<&str>) -> Result<Option<i64>, ApiError> {
    match school.filter(|school| !school.is_empty()) {
        Some(school) => {
            Ok(Some(store::school_id(db, school).await?.ok_or_else(
                || ApiError::not_found(FOLLOW_CANDIDATE_SCHOOL_NOT_FOUND),
            )?))
        }
        None => Ok(None),
    }
}

/// An automated follow as read, before its posts are merged.
#[derive(sqlx::FromRow)]
struct FollowRow {
    total: i64,
    id: Uuid,
    school_id: i32,
    school: String,
    handle: String,
    name: Option<String>,
    source: String,
    status: String,
    followed_at: DateTime<Utc>,
    score: Option<i16>,
    verdict: Option<String>,
    reason: Option<String>,
    found_via: Vec<String>,
    followers_count: Option<i32>,
    recent_posts: sqlx::types::Json<Vec<StoredPost>>,
}

/// A post as `recent_posts` keeps it; a malformed one reads as nothing.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct StoredPost {
    url: Option<String>,
    posted_at: Option<String>,
    caption: Option<String>,
    image: Option<String>,
}

/// A post ingestion heard about, by its owner.
#[derive(sqlx::FromRow)]
struct HeardPost {
    school_id: i32,
    handle: String,
    url: String,
    posted_at: Option<String>,
    caption: Option<String>,
    image: Option<String>,
}

/// The window's automated follows, newest first, with their newest posts.
pub async fn list(
    db: &PgPool,
    window: &Window,
    pagination: Pagination,
) -> Result<(Vec<AutomatedFollowResponse>, i64), ApiError> {
    let school_id = school_id(db, window.school.as_deref()).await?;
    let rows: Vec<FollowRow> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT count(*) OVER () AS total, c.id, c.school_id, s.slug AS school, c.handle, \
                    c.name, c.source, c.status, c.followed_at, c.score, c.verdict, c.reason, \
                    c.found_via, c.followers_count, c.recent_posts \
             FROM public.instagram_follow_candidates c \
             JOIN public.schools s ON s.id = c.school_id \
             WHERE c.followed_at >= $1 AND c.followed_at < $2 AND c.source = ANY($3) \
               AND ($4::int8 IS NULL OR c.school_id = $4) \
             ORDER BY c.followed_at DESC, c.id LIMIT $5 OFFSET $6",
        )
        .bind(window.since)
        .bind(window.until)
        .bind(AUTOMATED_SOURCES)
        .bind(school_id)
        .bind(pagination.page_size)
        .bind(pagination.offset())
        .fetch_all(db)
    })
    .await?;
    let total = rows.first().map_or(0, |row| row.total);
    let heard = heard_posts(db, &rows).await?;
    let now = Utc::now();
    let items = rows
        .into_iter()
        .map(|row| {
            let heard = heard
                .get(&(row.school_id, row.handle.clone()))
                .map(Vec::as_slice)
                .unwrap_or_default();
            let recent_posts = newest_posts(&row.recent_posts, heard, now);
            AutomatedFollowResponse {
                id: row.id,
                school: row.school,
                handle: row.handle,
                name: row.name,
                source: row.source,
                status: row.status,
                followed_at: row.followed_at,
                score: row.score,
                verdict: row.verdict,
                reason: row.reason,
                found_via: row.found_via,
                followers_count: row.followers_count,
                recent_posts,
            }
        })
        .collect();
    Ok((items, total))
}

/// The newest posts ingestion heard about from each follow on the page.
async fn heard_posts(
    db: &PgPool,
    rows: &[FollowRow],
) -> Result<HashMap<(i32, String), Vec<HeardPost>>, ApiError> {
    if rows.is_empty() {
        return Ok(HashMap::new());
    }
    let schools: Vec<i32> = rows.iter().map(|row| row.school_id).collect();
    let handles: Vec<&str> = rows.iter().map(|row| row.handle.as_str()).collect();
    let posts: Vec<HeardPost> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT p.school_id, p.handle, p.url, p.posted_at, p.caption, p.image \
             FROM unnest($1::int4[], $2::text[]) AS f(school_id, handle) \
             CROSS JOIN LATERAL ( \
                 SELECT i.school_id, f.handle, i.source_url AS url, \
                        i.post ->> 'timestamp' AS posted_at, i.post ->> 'caption' AS caption, \
                        i.post ->> 'displayUrl' AS image \
                 FROM public.ingestion_items i \
                 WHERE i.source = 'instagram' AND i.school_id = f.school_id \
                   AND i.post ->> 'ownerUsername' = f.handle \
                 ORDER BY i.created_at DESC LIMIT $3) AS p",
        )
        .bind(&schools)
        .bind(&handles)
        .bind(POSTS_PER_FOLLOW as i64)
        .fetch_all(db)
    })
    .await?;
    let mut by_follow: HashMap<(i32, String), Vec<HeardPost>> = HashMap::new();
    for post in posts {
        by_follow
            .entry((post.school_id, post.handle.clone()))
            .or_default()
            .push(post);
    }
    Ok(by_follow)
}

/// The newest `POSTS_PER_FOLLOW` posts of the stored and heard ones, each once.
fn newest_posts(
    stored: &[StoredPost],
    heard: &[HeardPost],
    now: DateTime<Utc>,
) -> Vec<FollowPostResponse> {
    let known = stored
        .iter()
        .filter_map(|post| {
            Some((
                post.url.clone()?,
                post.posted_at.as_deref(),
                post.caption.as_deref(),
                post.image.as_deref(),
            ))
        })
        .chain(heard.iter().map(|post| {
            (
                post.url.clone(),
                post.posted_at.as_deref(),
                post.caption.as_deref(),
                post.image.as_deref(),
            )
        }));
    let mut seen = HashSet::new();
    let mut posts: Vec<FollowPostResponse> = known
        .filter(|(url, ..)| seen.insert(url.clone()))
        .map(|(url, posted_at, caption, image)| FollowPostResponse {
            url,
            posted_at: posted_at
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc)),
            caption: caption.unwrap_or_default().to_owned(),
            image: image
                .filter(|image| live_image(image, now))
                .map(str::to_owned),
        })
        .collect();
    posts.sort_by_key(|post| std::cmp::Reverse(post.posted_at));
    posts.truncate(POSTS_PER_FOLLOW);
    posts
}

/// Whether an Instagram picture link still loads: its signed `oe` parameter
/// is the hex Unix time it expires. A link without one is kept.
fn live_image(image: &str, now: DateTime<Utc>) -> bool {
    let Ok(url) = url::Url::parse(image) else {
        return false;
    };
    match url.query_pairs().find(|(name, _)| name == "oe") {
        Some((_, expiry)) => {
            i64::from_str_radix(&expiry, 16).is_ok_and(|expiry| expiry > now.timestamp())
        }
        None => true,
    }
}

/// The events added within the window from accounts followed on their own,
/// newest first.
pub async fn events(
    db: &PgPool,
    window: &Window,
    pagination: Pagination,
) -> Result<(Vec<FollowedAccountEventResponse>, i64), ApiError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        total: i64,
        #[sqlx(flatten)]
        event: FollowedAccountEventResponse,
    }
    let school_id = school_id(db, window.school.as_deref()).await?;
    let rows: Vec<Row> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT count(*) OVER () AS total, e.id, s.slug AS school, e.title, e.added_at, \
                    e.source_image_url AS image_url, c.handle, c.followed_at \
             FROM public.events e \
             JOIN public.instagram_follow_candidates c \
               ON c.club_id = e.club_id AND c.school_id = e.school_id \
             JOIN public.schools s ON s.id = e.school_id \
             WHERE e.added_at >= $1 AND e.added_at < $2 AND c.followed_at IS NOT NULL \
               AND c.source = ANY($3) AND ($4::int8 IS NULL OR e.school_id = $4) \
             ORDER BY e.added_at DESC, e.id LIMIT $5 OFFSET $6",
        )
        .bind(window.since)
        .bind(window.until)
        .bind(AUTOMATED_SOURCES)
        .bind(school_id)
        .bind(pagination.page_size)
        .bind(pagination.offset())
        .fetch_all(db)
    })
    .await?;
    let total = rows.first().map_or(0, |row| row.total);
    Ok((rows.into_iter().map(|row| row.event).collect(), total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-23T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn stored(code: &str, posted_at: &str, image: Option<&str>) -> StoredPost {
        StoredPost {
            url: Some(format!("https://www.instagram.com/p/{code}/")),
            posted_at: Some(posted_at.to_owned()),
            caption: Some(format!("{code} caption")),
            image: image.map(str::to_owned),
        }
    }

    fn heard(code: &str, posted_at: &str) -> HeardPost {
        HeardPost {
            school_id: 1,
            handle: "uwboardgames".into(),
            url: format!("https://www.instagram.com/p/{code}/"),
            posted_at: Some(posted_at.to_owned()),
            caption: None,
            image: None,
        }
    }

    #[test]
    fn the_newest_three_posts_come_from_the_score_and_from_ingestion_once_each() {
        let posts = newest_posts(
            &[
                stored("A", "2026-11-01T10:00:00+00:00", None),
                stored("B", "2026-11-10T10:00:00+00:00", None),
                stored("C", "2026-10-01T10:00:00+00:00", None),
                StoredPost::default(),
            ],
            &[
                heard("D", "2026-11-20T21:01:41+00:00"),
                heard("B", "2026-11-10T10:00:00+00:00"),
            ],
            now(),
        );
        let codes: Vec<&str> = posts.iter().map(|post| &post.url[28..29]).collect();
        assert_eq!(codes, ["D", "B", "A"]);
        // The scorer's copy of a post ingestion also heard about is the one kept.
        assert_eq!(posts[1].caption, "B caption");
        assert_eq!(posts[0].caption, "");
    }

    #[test]
    fn a_picture_shows_only_while_its_signed_link_is_live() {
        // 0x6B0AE105 is 2026-11-28; 0x6A000000 is 2026-05-10.
        let live = "https://instagram.fykz2-1.fna.fbcdn.net/v/a.jpg?stp=x&oe=6B0AE105&_nc_sid=1";
        let expired = "https://instagram.fykz2-1.fna.fbcdn.net/v/b.jpg?oe=6A000000";
        assert!(live_image(live, now()));
        assert!(!live_image(expired, now()));
        assert!(live_image("https://example.com/poster.jpg", now()));
        assert!(!live_image("not a link", now()));
        let posts = newest_posts(
            &[
                stored("A", "2026-11-01T10:00:00+00:00", Some(live)),
                stored("B", "2026-11-02T10:00:00+00:00", Some(expired)),
            ],
            &[],
            now(),
        );
        assert_eq!(posts[0].image, None);
        assert_eq!(posts[1].image.as_deref(), Some(live));
    }

    #[test]
    fn a_follow_serializes_in_the_schema_order() {
        let follow = AutomatedFollowResponse {
            id: Uuid::from_u128(1),
            school: "uwaterloo".into(),
            handle: "uwboardgames".into(),
            name: Some("UW Board Games Club".into()),
            source: "crawl".into(),
            status: "followed".into(),
            followed_at: now(),
            score: Some(88),
            verdict: Some("approve".into()),
            reason: Some("Weekly board game nights".into()),
            found_via: vec!["uwmsa".into()],
            followers_count: Some(840),
            recent_posts: vec![FollowPostResponse {
                url: "https://www.instagram.com/p/A/".into(),
                posted_at: None,
                caption: "Catan".into(),
                image: None,
            }],
        };
        assert_eq!(
            serde_json::to_string(&follow).unwrap(),
            r#"{"id":"00000000-0000-0000-0000-000000000001","school":"uwaterloo","handle":"uwboardgames","name":"UW Board Games Club","source":"crawl","status":"followed","followed_at":"2026-11-23T12:00:00Z","score":88,"verdict":"approve","reason":"Weekly board game nights","found_via":["uwmsa"],"followers_count":840,"recent_posts":[{"url":"https://www.instagram.com/p/A/","posted_at":null,"caption":"Catan","image":null}]}"#
        );
    }
}
