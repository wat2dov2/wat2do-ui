//! The poster image a directory's event page advertises
//! (`services/scraper/page_image.py`).
//!
//! Directory pages state their event image in an Open Graph or Twitter meta tag
//! or in JSON-LD, which the Haiku directory agent cannot see through WebFetch's
//! Markdown. Reading it here, deterministically, is why directory events get a
//! poster at all; without it they fall back to the directory club's logo.

use std::future::Future;
use std::sync::LazyLock;
use std::time::Duration;

use anyhow::{Result, bail};
use futures_util::StreamExt;
use regex::{Regex, RegexBuilder};
use serde_json::Value;
use url::Url;

use crate::images::resolves_publicly;
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

/// GET `url` the way a plain HTTP client does (curl's user-agent, compressed
/// bodies decoded, redirects followed) and keep at most `max_bytes` of the
/// decoded body. Every hop must be http(s) on a host whose addresses are all
/// public, since the URLs come from pages and agents.
pub async fn download(url: &str, timeout: Duration, max_bytes: usize) -> Result<Vec<u8>> {
    download_from(url, None, timeout, max_bytes, |hop| async move {
        is_public_url(&hop).await
    })
    .await
}

/// [`download`], but POSTing `body` as JSON to `url` itself; a redirect is
/// followed with a plain GET, the way a browser follows one.
pub async fn post_json(
    url: &str,
    body: &str,
    timeout: Duration,
    max_bytes: usize,
) -> Result<Vec<u8>> {
    download_from(url, Some(body), timeout, max_bytes, |hop| async move {
        is_public_url(&hop).await
    })
    .await
}

async fn is_public_url(url: &Url) -> bool {
    let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https") && resolves_publicly(host, port).await
}

async fn download_from<F, Allowed>(
    url: &str,
    mut body: Option<&str>,
    timeout: Duration,
    max_bytes: usize,
    allowed: F,
) -> Result<Vec<u8>>
where
    F: Fn(Url) -> Allowed,
    Allowed: Future<Output = bool>,
{
    let client = wreq::Client::builder()
        .user_agent(USER_AGENT)
        // Redirects are followed by hand so each destination is checked.
        .redirect(wreq::redirect::Policy::none())
        .connect_timeout(timeout)
        .read_timeout(timeout)
        .build()?;
    let mut current = Url::parse(url)?;
    for _ in 0..=MAX_REDIRECTS {
        if !allowed(current.clone()).await {
            bail!("refusing a non-public address");
        }
        let request = match body.take() {
            Some(body) => client
                .post(current.as_str())
                .header("Content-Type", "application/json")
                .body(body.to_owned()),
            None => client.get(current.as_str()),
        };
        let response = request.header("Accept", "*/*").send().await?;
        let status = response.status();
        if status.is_redirection()
            && let Some(location) = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
        {
            current = current.join(location)?;
            continue;
        }
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
        return Ok(body);
    }
    bail!("too many redirects")
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
mod download_tests {
    use std::io::Write;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    /// A status line, extra headers and body.
    type Reply = (&'static str, Vec<(&'static str, String)>, Vec<u8>);

    /// A one-request-per-connection HTTP server answering each request with
    /// `respond("METHOD path") -> (status line, extra headers, body)`.
    async fn serve(respond: fn(&str) -> Reply) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&requests);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                counter.fetch_add(1, Ordering::SeqCst);
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let Ok(read) = socket.read(&mut buffer).await else {
                        break;
                    };
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                // Read a POSTed body too, so closing the socket never resets it.
                let header_end = request
                    .windows(4)
                    .position(|w| w == b"\r\n\r\n")
                    .map_or(request.len(), |end| end + 4);
                let length = String::from_utf8_lossy(&request[..header_end])
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                while request.len() < header_end + length {
                    match socket.read(&mut buffer).await {
                        Ok(read) if read > 0 => request.extend_from_slice(&buffer[..read]),
                        _ => break,
                    }
                }
                let text = String::from_utf8_lossy(&request);
                let mut words = text.split_whitespace();
                let method = words.next().unwrap_or("GET");
                let path = words.next().unwrap_or("/");
                let (status, headers, body) = respond(&format!("{method} {path}"));
                let mut response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    body.len()
                );
                for (name, value) in headers {
                    response.push_str(&format!("{name}: {value}\r\n"));
                }
                response.push_str("\r\n");
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.write_all(&body).await;
                let _ = socket.shutdown().await;
            }
        });
        (base, requests)
    }

    fn gzipped(text: &str) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(text.as_bytes()).unwrap();
        encoder.finish().unwrap()
    }

    fn pages(request: &str) -> Reply {
        match request.split_once(' ').map_or(request, |(_, path)| path) {
            "/start" => ("302 Found", vec![("Location", "/final".into())], vec![]),
            "/final" => ("200 OK", vec![], b"hello".to_vec()),
            "/to-private" => (
                "301 Moved",
                vec![("Location", "/private/admin".into())],
                vec![],
            ),
            "/gzip" => (
                "200 OK",
                vec![("Content-Encoding", "gzip".into())],
                gzipped(&"x".repeat(5000)),
            ),
            "/loop" => ("302 Found", vec![("Location", "/loop".into())], vec![]),
            _ => ("404 Not Found", vec![], vec![]),
        }
    }

    /// Stands in for the public-address check: the test server is on loopback,
    /// so only `/private` paths count as non-public.
    async fn not_private(url: Url) -> bool {
        !url.path().starts_with("/private")
    }

    const SECOND: Duration = Duration::from_secs(1);

    #[tokio::test]
    async fn redirects_are_followed_and_each_hop_is_checked() {
        let (base, _) = serve(pages).await;
        let body = download_from(&format!("{base}/start"), None, SECOND, 100, not_private).await;
        assert_eq!(body.unwrap(), b"hello");
        let refused = download_from(
            &format!("{base}/to-private"),
            None,
            SECOND,
            100,
            not_private,
        )
        .await;
        assert_eq!(
            refused.unwrap_err().to_string(),
            "refusing a non-public address"
        );
        let missing = download_from(&format!("{base}/nope"), None, SECOND, 100, not_private).await;
        assert_eq!(missing.unwrap_err().to_string(), "HTTP 404");
    }

    fn methods(request: &str) -> Reply {
        match request {
            "POST /listing" => ("303 See Other", vec![("Location", "/after".into())], vec![]),
            other => ("200 OK", vec![], other.as_bytes().to_vec()),
        }
    }

    #[tokio::test]
    async fn a_json_body_is_posted_and_its_redirect_followed_with_a_get() {
        let (base, requests) = serve(methods).await;
        let posted = download_from(
            &format!("{base}/listing"),
            Some("{\"page\": 1}"),
            SECOND,
            100,
            not_private,
        )
        .await;
        assert_eq!(posted.unwrap(), b"GET /after");
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        let plain = download_from(&format!("{base}/listing"), None, SECOND, 100, not_private).await;
        assert_eq!(plain.unwrap(), b"GET /listing");
    }

    #[tokio::test]
    async fn compressed_bodies_are_decoded_and_capped_by_decoded_bytes() {
        let (base, _) = serve(pages).await;
        let whole = download_from(&format!("{base}/gzip"), None, SECOND, 10_000, not_private).await;
        assert_eq!(whole.unwrap(), "x".repeat(5000).into_bytes());
        let capped = download_from(&format!("{base}/gzip"), None, SECOND, 1000, not_private).await;
        assert_eq!(capped.unwrap(), "x".repeat(1000).into_bytes());
    }

    #[tokio::test]
    async fn at_most_twenty_redirects_are_followed() {
        let (base, requests) = serve(pages).await;
        let looped = download_from(&format!("{base}/loop"), None, SECOND, 100, not_private).await;
        assert_eq!(looped.unwrap_err().to_string(), "too many redirects");
        assert_eq!(requests.load(Ordering::SeqCst), MAX_REDIRECTS + 1);
    }

    #[tokio::test]
    async fn loopback_private_and_non_web_addresses_are_refused() {
        for url in [
            "http://127.0.0.1/",
            "https://[::1]/",
            "http://10.0.0.1:8080/",
            "https://192.168.1.1/",
            "https://169.254.169.254/latest/meta-data/",
            "https://localhost/",
            "ftp://8.8.8.8/",
        ] {
            assert!(!is_public_url(&Url::parse(url).unwrap()).await, "{url}");
            assert_eq!(
                download(url, SECOND, 100).await.unwrap_err().to_string(),
                "refusing a non-public address",
                "{url}"
            );
        }
    }
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
