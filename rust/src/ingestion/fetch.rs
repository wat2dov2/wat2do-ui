//! Reading public Instagram posts and profiles the way a logged-out browser
//! sees them (`services/ingestion/instagram_fetch.py`).
//!
//! No account, cookie or session ID is involved: the request carries only a
//! browser TLS fingerprint. A post's details come from the JSON Instagram
//! embeds in its public page, projected into the post shape the agent reads.
//! A profile comes from its public page rendered logged out by Lightpanda.

use std::sync::LazyLock;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat};
use regex::Regex;
use serde_json::{Map, Value, json};
use wreq_util::Emulation;

use crate::controlbox::INGESTION;

static JSON_SCRIPT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<script type="application/json"[^>]*>(.*?)</script>"#).expect("valid regex")
});
// Instagram's grey silhouette for accounts that never set a picture.
const DEFAULT_PICTURE: &str = "44884218_345707102882519_2446069589734326272_n";

/// Instagram refused the logged-out request; nothing about the post is known.
#[derive(Debug)]
pub struct FetchBlocked(pub String);

impl std::fmt::Display for FetchBlocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FetchBlocked {}

fn client() -> Result<wreq::Client, FetchBlocked> {
    // `fetch_impersonate` names the browser family; the newest profile of it is used.
    let emulation = match INGESTION.fetch_impersonate.as_str() {
        "chrome" => Emulation::Chrome149,
        other => {
            return Err(FetchBlocked(format!(
                "unsupported fetch_impersonate {other}"
            )));
        }
    };
    wreq::Client::builder()
        .emulation(emulation)
        // Compressed responses are decoded only where asked for (page_image).
        .gzip(false)
        .deflate(false)
        .brotli(false)
        .redirect(wreq::redirect::Policy::limited(30))
        .timeout(Duration::from_secs_f64(INGESTION.fetch_timeout_seconds))
        .build()
        .map_err(|_| FetchBlocked("Instagram client could not start".into()))
}

struct Page {
    status: u16,
    url: String,
    body: String,
}

async fn get(url: &str, iframe: bool) -> Result<Page, FetchBlocked> {
    let mut request = client()?.get(url);
    if iframe {
        for (name, value) in [
            ("Accept", "text/html,application/xhtml+xml"),
            ("Sec-Fetch-Dest", "iframe"),
            ("Sec-Fetch-Mode", "navigate"),
            ("Sec-Fetch-Site", "cross-site"),
            ("Referer", "https://wat2do.io/"),
        ] {
            request = request.header(name, value);
        }
    }
    let failed = |_| FetchBlocked("Instagram request failed".into());
    let response = request.send().await.map_err(failed)?;
    let status = response.status().as_u16();
    let url = response.uri().to_string();
    let body = response.text().await.map_err(failed)?;
    Ok(Page { status, url, body })
}

/// The post, or None when its page has no post (usually deleted or private).
pub async fn fetch_post(shortcode: &str) -> Result<Option<Value>, FetchBlocked> {
    let page = get(&format!("https://www.instagram.com/p/{shortcode}/"), false).await?;
    if page.url.contains("/accounts/login") || page.status == 429 {
        return Err(FetchBlocked("Instagram asked for a login".into()));
    }
    if page.status == 404 {
        return Ok(None);
    }
    if page.status != 200 {
        return Err(FetchBlocked(format!(
            "Instagram answered HTTP {}",
            page.status
        )));
    }
    Ok(post_media(&page.body, shortcode).and_then(|media| project(&media, shortcode)))
}

/// A profile's display name and picture, read from its rendered public page.
#[derive(Debug, Default, PartialEq)]
pub struct Profile {
    pub name: Option<String>,
    pub picture_url: Option<String>,
}

/// Where the logged-out profile renderer (Lightpanda) is installed.
pub fn profile_renderer() -> std::path::PathBuf {
    crate::launch_agents::home().join(&INGESTION.profile_renderer)
}

/// `fetch_profile`: an empty profile when it is renamed, deleted or did not render.
///
/// Instagram stopped serving profile embeds in November 2026 (every `/embed/` page
/// is an error page now), and a plain request gets only the app shell, so the
/// public profile page is rendered logged out by Lightpanda, which fills in the
/// same `og:title` and `og:image` tags a browser sees. No cookie is involved.
pub async fn fetch_profile(handle: &str) -> Result<Profile, FetchBlocked> {
    let render = tokio::process::Command::new(profile_renderer())
        .args(["fetch", "--dump", "html", "--wait-until", "networkidle"])
        .arg(format!("https://www.instagram.com/{handle}/"))
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let timeout = Duration::from_secs_f64(INGESTION.profile_render_timeout_seconds);
    let html = match tokio::time::timeout(timeout, render).await {
        Ok(Ok(output)) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => return Ok(Profile::default()),
    };
    rendered_profile(&html, handle)
}

static OG_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<meta property="og:(title|image)" content="([^"]*)""#).expect("valid regex")
});
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<title>([^<]*)").expect("valid regex"));
const TITLE_SUFFIX: &str = " • Instagram photos and videos";

/// The profile in a rendered page; blocked when Instagram showed its login wall.
fn rendered_profile(html: &str, handle: &str) -> Result<Profile, FetchBlocked> {
    let mut title = None;
    let mut image = None;
    for captures in OG_TAG.captures_iter(html) {
        let value = htmlize::unescape(&captures[2]).into_owned();
        match &captures[1] {
            "title" => title = title.or(Some(value)),
            _ => image = image.or(Some(value)),
        }
    }
    let Some(title) = title else {
        let page_title = TITLE
            .captures(html)
            .map(|captures| captures[1].trim().to_owned())
            .unwrap_or_default();
        // A gone handle names itself; anything else without profile tags is a wall.
        if page_title.starts_with("Profile isn't available") {
            return Ok(Profile::default());
        }
        return Err(FetchBlocked(format!(
            "Instagram rendered no profile ({page_title})"
        )));
    };
    let name = title
        .strip_suffix(TITLE_SUFFIX)
        .unwrap_or(&title)
        .trim()
        .strip_suffix(&format!("(@{handle})"))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned);
    Ok(Profile {
        name,
        picture_url: image.filter(|picture| !picture.contains(DEFAULT_PICTURE)),
    })
}

/// The fullest embedded copy of this post; the page also embeds other posts.
fn post_media(html: &str, shortcode: &str) -> Option<Map<String, Value>> {
    let mut best: Option<Map<String, Value>> = None;
    for captures in JSON_SCRIPT.captures_iter(html) {
        let Ok(data) = serde_json::from_str::<Value>(&captures[1]) else {
            continue;
        };
        walk(&data, &mut |node| {
            if node.get("code").and_then(Value::as_str) == Some(shortcode)
                && node.contains_key("taken_at")
                && best.as_ref().is_none_or(|best| node.len() > best.len())
            {
                best = Some(node.clone());
            }
        });
    }
    best
}

fn walk(node: &Value, visit: &mut impl FnMut(&Map<String, Value>)) {
    match node {
        Value::Object(map) => {
            visit(map);
            map.values().for_each(|value| walk(value, visit));
        }
        Value::Array(values) => values.iter().for_each(|value| walk(value, visit)),
        _ => {}
    }
}

/// The URL of the largest candidate; the first wins a tie, as in Python.
fn largest(candidates: Option<&Value>) -> Option<String> {
    let mut best: Option<(i64, &str)> = None;
    for candidate in candidates.and_then(Value::as_array).into_iter().flatten() {
        let Some(url) = candidate
            .get("url")
            .and_then(Value::as_str)
            .filter(|url| !url.is_empty())
        else {
            continue;
        };
        let size = candidate.get("width").and_then(Value::as_i64).unwrap_or(0)
            * candidate.get("height").and_then(Value::as_i64).unwrap_or(0);
        if best.is_none_or(|(best_size, _)| size > best_size) {
            best = Some((size, url));
        }
    }
    best.map(|(_, url)| url.to_owned())
}

fn slide(media: &Value) -> Map<String, Value> {
    let video = largest(media.get("video_versions"));
    let image = largest(
        media
            .get("image_versions2")
            .and_then(|v| v.get("candidates")),
    );
    let mut slide = Map::new();
    slide.insert(
        "type".into(),
        json!(if video.is_some() { "Video" } else { "Image" }),
    );
    slide.insert("displayUrl".into(), json!(image));
    slide.insert("videoUrl".into(), json!(video));
    slide
}

fn usernames(entries: impl Iterator<Item = Value>) -> Vec<Value> {
    entries
        .filter_map(|entry| {
            entry
                .get("username")
                .and_then(Value::as_str)
                .filter(|n| !n.is_empty())
                .map(str::to_owned)
        })
        .map(|name| json!({"username": name}))
        .collect()
}

fn truthy_object(value: Option<&Value>) -> Option<&Value> {
    value.filter(|value| value.as_object().is_some_and(|map| !map.is_empty()))
}

fn project(media: &Map<String, Value>, shortcode: &str) -> Option<Value> {
    let media = Value::Object(media.clone());
    let owner = truthy_object(media.get("user"))
        .or_else(|| truthy_object(media.get("owner")))
        .and_then(|owner| owner.get("username"))
        .and_then(Value::as_str)?;
    let taken_at = media.get("taken_at").and_then(Value::as_i64)?;
    let children: Vec<Value> = media
        .get("carousel_media")
        .and_then(Value::as_array)
        .map(|children| children.iter().filter(|c| c.is_object()).cloned().collect())
        .unwrap_or_default();
    let cover = slide(children.first().unwrap_or(&media));
    if cover.get("displayUrl").is_none_or(Value::is_null) {
        return None;
    }
    let tagged = media
        .get("usertags")
        .and_then(|tags| tags.get("in"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tag| tag.get("user").cloned());
    let coauthors = media
        .get("coauthor_producers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut post = Map::new();
    post.insert(
        "url".into(),
        json!(format!("https://www.instagram.com/p/{shortcode}/")),
    );
    post.insert("ownerUsername".into(), json!(owner));
    post.insert(
        "timestamp".into(),
        json!(DateTime::from_timestamp(taken_at, 0)?.to_rfc3339_opts(SecondsFormat::Secs, false)),
    );
    post.insert(
        "caption".into(),
        json!(
            media
                .get("caption")
                .and_then(|c| c.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("")
        ),
    );
    post.extend(cover.clone());
    let kind = if children.is_empty() {
        cover["type"].clone()
    } else {
        json!("Sidecar")
    };
    post.insert("type".into(), kind);
    post.insert(
        "childPosts".into(),
        Value::Array(
            children
                .iter()
                .map(|child| Value::Object(slide(child)))
                .collect(),
        ),
    );
    post.insert(
        "coauthors".into(),
        Value::Array(usernames(coauthors.into_iter())),
    );
    post.insert("taggedUsers".into(), Value::Array(usernames(tagged)));
    Some(Value::Object(post))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_the_fullest_copy_of_the_post() {
        let media = json!({
            "code": "ABC", "taken_at": 1_761_955_200, "user": {"username": "club"},
            "caption": {"text": "Jam night"},
            "carousel_media": [
                {"image_versions2": {"candidates": [
                    {"url": "https://a/small.jpg", "width": 100, "height": 100},
                    {"url": "https://a/big.jpg", "width": 1080, "height": 1080}]}},
                {"image_versions2": {"candidates": [{"url": "https://a/2.jpg", "width": 1, "height": 1}]},
                 "video_versions": [{"url": "https://a/2.mp4", "width": 1, "height": 1}]}
            ],
            "coauthor_producers": [{"username": "friend"}, {"username": ""}],
            "usertags": {"in": [{"user": {"username": "tagged"}}]}
        });
        let html = format!(
            r#"<script type="application/json" data-x>{{"a": {{"code": "ABC", "taken_at": 1}}, "b": {media}}}</script>"#
        );
        let post = post_media(&html, "ABC")
            .and_then(|m| project(&m, "ABC"))
            .unwrap();
        assert_eq!(post["ownerUsername"], "club");
        assert_eq!(post["timestamp"], "2025-11-01T00:00:00+00:00");
        assert_eq!(post["type"], "Sidecar");
        assert_eq!(post["displayUrl"], "https://a/big.jpg");
        assert_eq!(post["childPosts"][1]["videoUrl"], "https://a/2.mp4");
        assert_eq!(post["coauthors"], json!([{"username": "friend"}]));
        assert_eq!(post["taggedUsers"], json!([{"username": "tagged"}]));
    }

    #[test]
    fn rendered_profile_reads_name_picture_and_gone_handles() {
        let page = |title: &str, image: &str| {
            format!(
                r#"<title>x</title><meta property="og:image" content="{image}"><meta property="og:title" content="{title}">"#
            )
        };
        assert_eq!(
            rendered_profile(
                &page(
                    "Dance &amp; Co (@uw.dance) • Instagram photos and videos",
                    "https://x/a.jpg?a=1&amp;b=2"
                ),
                "uw.dance"
            )
            .unwrap(),
            Profile {
                name: Some("Dance & Co".into()),
                picture_url: Some("https://x/a.jpg?a=1&b=2".into())
            }
        );
        assert_eq!(
            rendered_profile(
                &page(
                    "@uw.dance • Instagram photos and videos",
                    &format!("https://x/{DEFAULT_PICTURE}.jpg")
                ),
                "uw.dance"
            )
            .unwrap(),
            Profile::default()
        );
        assert_eq!(
            rendered_profile("<title>Profile isn't available • Instagram</title>", "gone").unwrap(),
            Profile::default()
        );
        assert!(rendered_profile("<title>Login • Instagram</title>", "club").is_err());
    }
}
