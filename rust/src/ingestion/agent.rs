//! Let Haiku ingest one captured source straight into events and positions
//! (`services/ingestion/agent.py`).
//!
//! The agent reads the source, inspects what is already listed, and writes the
//! result itself through a database login scoped to events and positions. Its
//! instructions live in `prompt.md`; this module prepares the source and applies
//! the side effects of what the agent changed.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, NaiveDateTime, TimeDelta, Utc};
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde_json::{Value, json};
use sqlx::PgPool;
use url::Url;

use super::changes;
use super::prompt::{self, ImageLine, poster_reference};
use crate::claude::{self, Agent};
use crate::constants::BUCKET_EVENT_IMAGES;
use crate::controlbox::INGESTION;
use crate::images::{fetch_image, is_carousel_post, single_post_video_url};
use crate::schools;
use crate::settings::settings;
use crate::storage::{store_image, upload_video_from_url};
use crate::text::normalize_scraped_text;

pub const WORKDIR_PREFIX: &str = "wat2do-ingestion-";

static SHORTCODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)").expect("valid regex"));

/// One source image saved for the agent to view, kept until a row claims it.
struct Image {
    file: String,
    data: Vec<u8>,
    content_type: String,
    video_url: Option<String>,
}

/// Have the agent bring the database in line with one source; true if it changed anything.
pub async fn ingest(
    pool: &PgPool,
    post: &Value,
    school_slug: &str,
    source: &str,
    publisher_ig: Option<&str>,
    carousel_requested: bool,
) -> Result<bool> {
    let source_url = post["url"].as_str().context("the source has no url")?;
    if already_imported(pool, source_url).await? {
        return Ok(true);
    }
    let Some(school) = schools::by_slug(pool, school_slug).await? else {
        bail!("School is not registered");
    };
    let caption = normalize_scraped_text(
        post.get("caption")
            .or_else(|| post.get("text"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    let token = uuid::Uuid::new_v4().simple().to_string()[..12].to_owned();
    let workdir = tempfile::Builder::new().prefix(WORKDIR_PREFIX).tempdir()?;
    let images = download_images(post, workdir.path(), is_instagram(source_url)).await?;
    let handles = candidate_handles(post);
    let owner = owner_club(pool, &handles, publisher_ig, school.id).await?;
    let posted_at = posted_at(post, source_url);
    let rendered = prompt::render(&prompt::Source {
        post,
        source,
        school: &school,
        carousel_requested,
        caption: &caption,
        images: images
            .iter()
            .map(|image| ImageLine {
                file: &image.file,
                is_video: image.video_url.is_some(),
            })
            .collect(),
        token: &token,
        owner: &owner,
        coauthors: handles.get(1..).unwrap_or_default(),
        posted_at,
        now: Utc::now(),
    });
    // Allow for clock skew between this Mac and the database's added_at.
    let started = Utc::now() - TimeDelta::minutes(5);
    let outcome = run(&rendered, workdir.path()).await;
    store_chosen_posters(pool, &token, &images).await?;
    cover_posterless_events(pool, source_url, &images, started).await?;
    changes::stamp_new_rows(pool, source_url, &caption, posted_at, started).await?;
    changes::drain(pool, false).await?;
    Ok(outcome? != "nothing")
}

pub fn is_instagram(source_url: &str) -> bool {
    Url::parse(source_url)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.trim_start_matches("www.") == "instagram.com")
        })
        .unwrap_or(false)
}

/// A post already listed is not ingested again.
async fn already_imported(pool: &PgPool, source_url: &str) -> Result<bool> {
    let shortcode = is_instagram(source_url)
        .then(|| Url::parse(source_url).ok())
        .flatten()
        .and_then(|url| SHORTCODE.captures(url.path()).map(|c| c[1].to_owned()));
    let query = match &shortcode {
        Some(_) => {
            "SELECT EXISTS (SELECT 1 FROM public.events WHERE source_url ILIKE '%/' || $1 || '%' \
             AND substring(source_url FROM '/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)') = $1)"
        }
        None => {
            "SELECT EXISTS (SELECT 1 FROM public.events WHERE source_url = $1) \
             OR EXISTS (SELECT 1 FROM public.positions WHERE source_url = $1)"
        }
    };
    Ok(sqlx::query_scalar(query)
        .bind(shortcode.as_deref().unwrap_or(source_url))
        .fetch_one(pool)
        .await?)
}

/// Owner first, then coauthors, each once, lowercased and without "@".
pub fn candidate_handles(post: &Value) -> Vec<String> {
    let owner = post
        .get("ownerUsername")
        .and_then(Value::as_str)
        .into_iter();
    let coauthors = post
        .get("coauthors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|coauthor| match coauthor {
            Value::Object(map) => map.get("username").and_then(Value::as_str),
            other => other.as_str(),
        });
    let mut handles: Vec<String> = Vec::new();
    for handle in owner.chain(coauthors) {
        let cleaned = handle.trim().trim_start_matches('@').to_lowercase();
        if !cleaned.is_empty() && !handles.contains(&cleaned) {
            handles.push(cleaned);
        }
    }
    handles
}

/// Image URLs from a fetched Instagram post or a directory page.
fn image_urls(post: &Value) -> Vec<String> {
    let from = |values: Option<&Value>, key: Option<&str>| -> Vec<String> {
        values
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|entry| match (entry, key) {
                (Value::Object(map), Some(key)) => {
                    map.get(key).and_then(Value::as_str).unwrap_or("")
                }
                (Value::String(url), None) => url.as_str(),
                (Value::Object(map), None) => map.get("url").and_then(Value::as_str).unwrap_or(""),
                _ => "",
            })
            .map(str::to_owned)
            .collect()
    };
    let mut images = from(post.get("images"), None);
    if !images.iter().any(|url| !url.is_empty()) {
        images = from(post.get("childPosts"), Some("displayUrl"));
    }
    if !images.iter().any(|url| !url.is_empty()) {
        images = vec![
            post.get("displayUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        ];
    }
    images.into_iter().filter(|url| !url.is_empty()).collect()
}

/// Each carousel video's poster URL, mapped to its downloadable source.
fn video_urls(post: &Value) -> HashMap<String, String> {
    let records: Vec<&Value> = if is_carousel_post(post) {
        post.get("childPosts")
            .and_then(Value::as_array)
            .map(|c| c.iter().collect())
            .unwrap_or_default()
    } else {
        vec![post]
    };
    records
        .into_iter()
        .filter_map(|record| {
            let video = record
                .get("videoUrl")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())?;
            let poster = record
                .get("displayUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            Some((poster.to_owned(), video.to_owned()))
        })
        .collect()
}

fn extension(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".jpg",
    }
}

/// Download each image once for the agent to view; nothing is stored yet.
async fn download_images(
    post: &Value,
    workdir: &std::path::Path,
    instagram: bool,
) -> Result<Vec<Image>> {
    let videos = video_urls(post);
    let fallback = single_post_video_url(post);
    let mut images = Vec::new();
    for url in image_urls(post)
        .into_iter()
        .take(INGESTION.max_images_per_item)
    {
        let Some((data, content_type)) = fetch_image(&url, !instagram).await else {
            continue;
        };
        let file = format!("image-{}{}", images.len(), extension(&content_type));
        tokio::fs::write(workdir.join(&file), &data).await?;
        images.push(Image {
            file,
            data,
            content_type,
            video_url: videos.get(&url).cloned().or_else(|| fallback.clone()),
        });
    }
    Ok(images)
}

/// The publishing club as the agent is told it; ingestion never invents a club.
async fn owner_club(
    pool: &PgPool,
    handles: &[String],
    publisher_ig: Option<&str>,
    school_id: i32,
) -> Result<String> {
    let publisher: Vec<String> = publisher_ig
        .map(|ig| ig.trim().trim_start_matches('@').to_lowercase())
        .filter(|ig| !ig.is_empty())
        .into_iter()
        .collect();
    let candidates = if handles.is_empty() {
        &publisher[..]
    } else {
        handles
    };
    let Some(first) = candidates.first() else {
        return Ok("unknown; find the host named in the source".to_owned());
    };
    for handle in candidates {
        let club: Option<(i32, String)> = sqlx::query_as(
            "SELECT id, club_name FROM public.clubs WHERE ig = $1 AND school_id = $2 ORDER BY id LIMIT 1",
        )
        .bind(handle)
        .bind(school_id)
        .fetch_optional(pool)
        .await?;
        if let Some((id, name)) = club {
            return Ok(format!(
                "{} (clubs.id = {id}, Instagram @{handle})",
                name.trim()
            ));
        }
    }
    Ok(format!("@{first} (not registered at this school)"))
}

/// When an Instagram post went up; directory pages have no post time.
fn posted_at(post: &Value, source_url: &str) -> Option<DateTime<Utc>> {
    if !is_instagram(source_url) {
        return None;
    }
    let value = post.get("timestamp").and_then(Value::as_str)?;
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
                .ok()
                .map(|naive| naive.and_utc())
        })
}

/// Run the agent and return its reported outcome: `added`, `updated` or `nothing`.
async fn run(prompt: &str, workdir: &std::path::Path) -> Result<String> {
    let schema = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["outcome", "summary"],
        "properties": {
            "outcome": {"enum": ["added", "updated", "nothing"]},
            "summary": {"type": "string"},
        },
    });
    let answer = claude::run_agent(
        prompt,
        workdir,
        Agent {
            model: &INGESTION.model,
            tools: &["Read", "Bash"],
            allowed_tools: &["Read(./**)", "Bash(psql:*)"],
            schema: &schema,
            timeout: Duration::from_secs(INGESTION.model_timeout_seconds),
            env: agent_environment()?,
        },
    )
    .await
    .map_err(|error| anyhow::anyhow!("Ingestion agent {error}"))?;
    match answer.get("outcome").and_then(Value::as_str) {
        Some(outcome @ ("added" | "updated" | "nothing")) => Ok(outcome.to_owned()),
        _ => bail!("Ingestion agent gave no outcome"),
    }
}

/// Claude Code plus the scoped database login psql uses.
fn agent_environment() -> Result<HashMap<String, String>> {
    let database = Url::parse(&settings()?.ingest_agent_database_url)
        .ok()
        .filter(|url| url.host_str().is_some() && !url.username().is_empty())
        .context("INGEST_AGENT_DATABASE_URL is not configured")?;
    let decode = |value: &str| percent_decode_str(value).decode_utf8_lossy().into_owned();
    // The URL's own sslmode wins; the Mac's loopback Postgres has no TLS, so
    // forcing `require` there made every agent query fail.
    let ssl_mode = database
        .query_pairs()
        .find(|(key, _)| key == "sslmode")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| "prefer".to_owned());
    let mut env = claude::claude_environment();
    env.extend([
        (
            "PGHOST".to_owned(),
            database.host_str().unwrap_or_default().to_owned(),
        ),
        (
            "PGPORT".to_owned(),
            database.port().unwrap_or(5432).to_string(),
        ),
        ("PGUSER".to_owned(), decode(database.username())),
        (
            "PGPASSWORD".to_owned(),
            decode(database.password().unwrap_or("")),
        ),
        (
            "PGDATABASE".to_owned(),
            Some(database.path().trim_start_matches('/'))
                .filter(|p| !p.is_empty())
                .unwrap_or("postgres")
                .to_owned(),
        ),
        ("PGSSLMODE".to_owned(), ssl_mode),
        ("PGAPPNAME".to_owned(), "wat2do-ingestion-agent".to_owned()),
    ]);
    Ok(env)
}

/// The stored poster and its video; a row's old video goes with its old poster.
async fn store_poster(image: Option<&Image>) -> (Option<String>, Option<String>) {
    let Some(image) = image else {
        return (None, None);
    };
    let poster = store_image(image.data.clone(), &image.content_type, BUCKET_EVENT_IMAGES).await;
    let video = match (&poster, &image.video_url) {
        (Some(_), Some(url)) => upload_video_from_url(url).await,
        _ => None,
    };
    (poster, video)
}

/// Store only the images the agent chose as posters and point their rows at them.
async fn store_chosen_posters(pool: &PgPool, token: &str, images: &[Image]) -> Result<()> {
    let prefix = poster_reference(token, 0).trim_end_matches('0').to_owned();
    let mut stored: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for table in ["events", "positions"] {
        let references: Vec<String> = sqlx::query_scalar(&format!(
            "SELECT DISTINCT source_image_url FROM public.{table} WHERE source_image_url LIKE $1 || '%'"
        ))
        .bind(&prefix)
        .fetch_all(pool)
        .await?;
        for reference in references {
            if !stored.contains_key(&reference) {
                let index = reference
                    .strip_prefix(&prefix)
                    .and_then(|index| index.parse::<usize>().ok());
                stored.insert(
                    reference.clone(),
                    store_poster(index.and_then(|i| images.get(i))).await,
                );
            }
            let (poster, video) = &stored[&reference];
            sqlx::query(&format!(
                "UPDATE public.{table} SET source_image_url = $2, source_video_url = $3 WHERE source_image_url = $1"
            ))
            .bind(&reference)
            .bind(poster)
            .bind(video)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// Give events the agent created without a poster the source's cover image,
/// so posts with no flyer do not show a placeholder card.
async fn cover_posterless_events(
    pool: &PgPool,
    source_url: &str,
    images: &[Image],
    since: DateTime<Utc>,
) -> Result<()> {
    let Some(cover) = images.first() else {
        return Ok(());
    };
    let ids: Vec<i32> = sqlx::query_scalar(
        "SELECT id FROM public.events WHERE source_url = $1 AND added_at >= $2 AND source_image_url IS NULL",
    )
    .bind(source_url)
    .bind(since)
    .fetch_all(pool)
    .await?;
    if ids.is_empty() {
        return Ok(());
    }
    let (poster, video) = store_poster(Some(cover)).await;
    sqlx::query(
        "UPDATE public.events SET source_image_url = $2, source_video_url = $3 WHERE id = ANY($1)",
    )
    .bind(&ids)
    .bind(poster)
    .bind(video)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_and_images_follow_the_python_rules() {
        let post = json!({
            "ownerUsername": "@Club", "coauthors": [{"username": "friend"}, "club", ""],
            "type": "Sidecar",
            "childPosts": [
                {"displayUrl": "https://a/1.jpg"},
                {"displayUrl": "https://a/2.jpg", "videoUrl": "https://a/2.mp4"}
            ],
        });
        assert_eq!(candidate_handles(&post), vec!["club", "friend"]);
        assert_eq!(
            image_urls(&post),
            vec!["https://a/1.jpg", "https://a/2.jpg"]
        );
        assert_eq!(
            video_urls(&post).get("https://a/2.jpg").map(String::as_str),
            Some("https://a/2.mp4")
        );
        let directory = json!({"images": [{"url": "https://d/1.png"}, "https://d/2.png"]});
        assert_eq!(
            image_urls(&directory),
            vec!["https://d/1.png", "https://d/2.png"]
        );
    }

    #[test]
    fn post_time_is_read_only_from_instagram() {
        let post = json!({"timestamp": "2026-10-25T14:00:00+00:00"});
        assert!(posted_at(&post, "https://www.instagram.com/p/ABC/").is_some());
        assert!(posted_at(&post, "https://uwaterloo.ca/events/1").is_none());
    }
}
