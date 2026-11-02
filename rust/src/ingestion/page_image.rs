//! The poster image a directory's event page advertises
//! (`services/scraper/page_image.py`).
//!
//! Directory pages state their event image in an Open Graph or Twitter meta tag
//! or in JSON-LD, which the Haiku directory agent cannot see through WebFetch's
//! Markdown. Reading it here, deterministically, is why directory events get a
//! poster at all; without it they fall back to the directory club's logo.

use std::sync::LazyLock;
use std::time::Duration;

use anyhow::{Result, bail};
use futures_util::StreamExt;
use regex::{Regex, RegexBuilder};
use serde_json::Value;

use crate::urls::urljoin;

// Some WAFs reject a full browser user-agent from a non-browser HTTP client.
const USER_AGENT: &str = "curl/8.7.1";
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
// The poster lives in <head>; a couple of megabytes is far more than enough.
const MAX_PAGE_BYTES: usize = 2_000_000;
// httpx's limit, which the Python services followed.
const MAX_REDIRECTS: usize = 20;

fn insensitive(pattern: &str) -> Regex {
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .dot_matches_new_line(true)
        .build()
        .expect("valid regex")
}

static META: LazyLock<Regex> = LazyLock::new(|| insensitive(r"<meta\b[^>]*>"));
static LD_JSON: LazyLock<Regex> = LazyLock::new(|| {
    insensitive(r#"<script\b[^>]*type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>"#)
});
static CONTENT: LazyLock<Regex> =
    LazyLock::new(|| insensitive(r#"content\s*=\s*["']([^"']+)["']"#));
// Path fragments that mark a site's own default/logo asset, not an event's poster.
// Event uploads live under /content/, /upload/ and the like, so those are kept; a
// page whose og:image is a default keeps the event's club-logo fallback instead.
static GENERIC_ASSET: LazyLock<Regex> = LazyLock::new(|| {
    insensitive(r"/system/|/clientlibs/|/static/|(?:^|[/\-_])(?:default|placeholder)[\-_.]")
});

/// GET `url` the way a plain HTTP client does (curl's user-agent, redirects
/// followed) and keep at most `max_bytes` of the body.
pub async fn download(url: &str, timeout: Duration, max_bytes: usize) -> Result<Vec<u8>> {
    let client = wreq::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(wreq::redirect::Policy::limited(MAX_REDIRECTS))
        .connect_timeout(timeout)
        .read_timeout(timeout)
        .build()?;
    let response = client.get(url).header("Accept", "*/*").send().await?;
    let status = response.status();
    if !status.is_success() {
        bail!("HTTP {}", status.as_u16());
    }
    let mut body = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        body.extend_from_slice(&chunk?);
        if body.len() >= max_bytes {
            break;
        }
    }
    body.truncate(max_bytes);
    Ok(body)
}

/// The absolute https poster URL a scraped event page advertises, or None.
pub async fn fetch_event_poster(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    let page = download(url, FETCH_TIMEOUT, MAX_PAGE_BYTES).await.ok()?;
    extract_poster(&String::from_utf8_lossy(&page), url)
}

/// og:image, then twitter:image, then a JSON-LD image, resolved against
/// `base_url`. http posters and the site's own default/logo assets give None,
/// so the event keeps its club-logo fallback.
pub fn extract_poster(html: &str, base_url: &str) -> Option<String> {
    let candidate = meta_content(html, "og:image")
        .or_else(|| meta_content(html, "og:image:url"))
        .or_else(|| meta_content(html, "twitter:image"))
        .or_else(|| jsonld_image(html))?;
    let poster = absolute_https(base_url, &candidate)?;
    (!GENERIC_ASSET.is_match(&poster)).then_some(poster)
}

/// The content of the first `<meta property|name="key">` tag, any attribute order.
fn meta_content(html: &str, key: &str) -> Option<String> {
    let names = insensitive(&format!(
        r#"(?:property|name)\s*=\s*["']{}["']"#,
        regex::escape(key)
    ));
    META.find_iter(html)
        .map(|tag| tag.as_str())
        .filter(|tag| names.is_match(tag))
        .find_map(|tag| {
            CONTENT
                .captures(tag)
                .map(|found| found[1].to_owned())
                .filter(|content| !content.trim().is_empty())
        })
}

fn jsonld_image(html: &str) -> Option<String> {
    LD_JSON.captures_iter(html).find_map(|block| {
        let data: Value = serde_json::from_str(block[1].trim()).ok()?;
        let mut nodes = Vec::new();
        ld_nodes(&data, &mut nodes);
        nodes
            .into_iter()
            .find_map(|node| node.get("image").and_then(ld_image_url))
    })
}

/// Every object in a JSON-LD value, through lists and `@graph`.
fn ld_nodes<'a>(data: &'a Value, nodes: &mut Vec<&'a serde_json::Map<String, Value>>) {
    match data {
        Value::Array(items) => items.iter().for_each(|item| ld_nodes(item, nodes)),
        Value::Object(node) => {
            nodes.push(node);
            if let Some(Value::Array(graph)) = node.get("@graph") {
                graph.iter().for_each(|item| ld_nodes(item, nodes));
            }
        }
        _ => {}
    }
}

fn ld_image_url(image: &Value) -> Option<String> {
    match image {
        Value::String(url) if !url.is_empty() => Some(url.clone()),
        Value::Object(image) => image
            .get("url")
            .and_then(Value::as_str)
            .filter(|url| !url.is_empty())
            .map(str::to_owned),
        Value::Array(images) => images.iter().find_map(ld_image_url),
        _ => None,
    }
}

fn absolute_https(base_url: &str, candidate: &str) -> Option<String> {
    let absolute = urljoin(base_url, &htmlize::unescape(candidate.trim()))?;
    absolute
        .to_lowercase()
        .starts_with("https://")
        .then_some(absolute)
}

#[cfg(test)]
mod tests {
    use super::extract_poster;

    const BASE: &str = "https://events.example.edu/events/jam/";

    fn poster(html: &str) -> Option<String> {
        extract_poster(html, BASE)
    }

    #[test]
    fn prefers_og_image_absolute() {
        assert_eq!(
            poster(r#"<meta property="og:image" content="https://cdn.example.edu/poster.png">"#)
                .as_deref(),
            Some("https://cdn.example.edu/poster.png")
        );
    }

    #[test]
    fn resolves_relative_and_unescapes_entities() {
        assert_eq!(
            poster(r#"<meta property="og:image" content="/img/p.png?a=1&amp;b=2">"#).as_deref(),
            Some("https://events.example.edu/img/p.png?a=1&b=2")
        );
    }

    #[test]
    fn protocol_relative_becomes_https() {
        assert_eq!(
            poster(r#"<meta name="og:image" content="//cdn.example.edu/p.png">"#).as_deref(),
            Some("https://cdn.example.edu/p.png")
        );
    }

    #[test]
    fn attribute_order_does_not_matter() {
        assert_eq!(
            poster(r#"<meta content="https://cdn.example.edu/p.png" property="og:image"/>"#)
                .as_deref(),
            Some("https://cdn.example.edu/p.png")
        );
    }

    #[test]
    fn og_image_wins_over_twitter_and_jsonld() {
        let html = concat!(
            r#"<meta property="og:image" content="https://cdn.example.edu/og.png">"#,
            r#"<meta name="twitter:image" content="https://cdn.example.edu/t.png">"#,
            r#"<script type="application/ld+json">{"@type":"Event","#,
            r#""image":"https://cdn.example.edu/ld.png"}</script>"#,
        );
        assert_eq!(
            poster(html).as_deref(),
            Some("https://cdn.example.edu/og.png")
        );
    }

    #[test]
    fn falls_back_to_twitter_image() {
        assert_eq!(
            poster(r#"<meta name="twitter:image" content="https://cdn.example.edu/t.png">"#)
                .as_deref(),
            Some("https://cdn.example.edu/t.png")
        );
    }

    #[test]
    fn falls_back_to_jsonld_event_image_object() {
        let html = concat!(
            r#"<script type="application/ld+json">"#,
            r#"{"@type":"Event","image":{"url":"https://cdn.example.edu/ld.png"}}</script>"#,
        );
        assert_eq!(
            poster(html).as_deref(),
            Some("https://cdn.example.edu/ld.png")
        );
    }

    #[test]
    fn jsonld_graph_with_list_image() {
        let html = concat!(
            r#"<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},"#,
            r#"{"@type":"Event","image":["https://cdn.example.edu/first.png","x"]}]}</script>"#,
        );
        assert_eq!(
            poster(html).as_deref(),
            Some("https://cdn.example.edu/first.png")
        );
    }

    #[test]
    fn http_only_poster_is_rejected() {
        assert_eq!(
            poster(r#"<meta property="og:image" content="http://insecure.example.edu/p.png">"#),
            None
        );
    }

    #[test]
    fn no_poster_returns_none() {
        assert_eq!(poster("<html><head><title>Jam</title></head></html>"), None);
    }

    #[test]
    fn malformed_jsonld_is_ignored() {
        assert_eq!(
            poster(r#"<script type="application/ld+json">{not valid json}</script>"#),
            None
        );
    }

    #[test]
    fn a_blank_meta_falls_through_to_the_next_source() {
        let html = concat!(
            r#"<meta property="og:image" content="  ">"#,
            r#"<META NAME="Twitter:Image" CONTENT="https://cdn.example.edu/t.png">"#,
        );
        assert_eq!(
            poster(html).as_deref(),
            Some("https://cdn.example.edu/t.png")
        );
    }

    #[test]
    fn an_unbalanced_ipv6_poster_is_no_poster() {
        assert_eq!(
            poster(r#"<meta property="og:image" content="https://[bad/p.png">"#),
            None
        );
    }

    #[test]
    fn site_default_and_system_logos_are_rejected() {
        // Sites serve these when an event has no image of its own.
        assert_eq!(
            poster(concat!(
                r#"<meta property="og:image" "#,
                r#"content="https://www.concordia.ca/etc/designs/concordia/clientlibs/img/news-default.jpg">"#,
            )),
            None
        );
        assert_eq!(
            poster(
                r#"<meta property="og:image" content="https://www.wlu.ca/images/system/laurier-logo.jpg">"#
            ),
            None
        );
    }

    #[test]
    fn event_upload_and_content_posters_are_kept() {
        assert_eq!(
            poster(concat!(
                r#"<meta property="og:image" "#,
                r#"content="https://www.concordia.ca/content/shared/en/events/x.img.png/1.jpg">"#,
            ))
            .as_deref(),
            Some("https://www.concordia.ca/content/shared/en/events/x.img.png/1.jpg")
        );
        assert_eq!(
            poster(concat!(
                r#"<meta property="og:image" "#,
                r#"content="https://cornell.campusgroups.com/upload/cornell/2026/poster.png">"#,
            ))
            .as_deref(),
            Some("https://cornell.campusgroups.com/upload/cornell/2026/poster.png")
        );
    }
}
