//! Downloading post images and videos (`services/scraper/image_uploader.py`).
//!
//! Every URL, and every redirect it leads to, must be HTTPS on port 443 and
//! resolve only to public addresses; Instagram media must come from Meta's CDN.

use std::net::IpAddr;
use std::time::Duration;

use anyhow::{Result, bail};
use futures_util::StreamExt;
use url::Url;

use crate::controlbox::SCRAPING;

// Instagram's CDN occasionally rejects requests without a realistic browser UA.
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const CONTENT_TYPE_FALLBACK: &str = "image/jpeg";
const MAX_REDIRECTS: usize = 20;
// New Meta shards must be added here rather than opening the fetch to any host.
const ALLOWED_HOST_SUFFIXES: [&str; 2] = [".cdninstagram.com", ".fbcdn.net"];

fn client() -> Result<wreq::Client> {
    Ok(wreq::Client::builder()
        // Compressed responses are decoded only where asked for (page_image).
        .gzip(false)
        .deflate(false)
        .brotli(false)
        .user_agent(USER_AGENT)
        .redirect(wreq::redirect::Policy::none())
        .build()?)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                // Shared address space (100.64/10) and reserved ranges (240/4, 0/8).
                || (a == 100 && (64..128).contains(&b))
                || a >= 240
                || a == 0)
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(mapped));
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00 // unique local
                || (first & 0xffc0) == 0xfe80 // link local
                || first == 0x2001 && v6.segments()[1] == 0x0db8) // documentation
        }
    }
}

/// `_is_safe_image_url`: HTTPS, an allowed host, and public addresses only.
pub async fn is_safe_url(url: &str, allow_all_domains: bool) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    if !matches!(parsed.port(), None | Some(443)) {
        return false;
    }
    let Some(host) = parsed
        .host_str()
        .map(str::to_lowercase)
        .filter(|host| !host.is_empty())
    else {
        return false;
    };
    if !allow_all_domains
        && !ALLOWED_HOST_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(suffix))
    {
        return false;
    }
    resolves_publicly(&host, 443).await
}

/// Every address `host` resolves to is public; a DNS failure counts as not public,
/// so a transient resolution error never opens a fetch.
pub async fn resolves_publicly(host: &str, port: u16) -> bool {
    let Ok(addresses) = tokio::net::lookup_host((host.trim_matches(['[', ']']), port)).await else {
        return false;
    };
    let addresses: Vec<_> = addresses.collect();
    !addresses.is_empty() && addresses.iter().all(|address| is_public(address.ip()))
}

/// `fetch_image`: one image's bytes and content type, or None when it cannot be used.
pub async fn fetch_image(url: &str, allow_all_domains: bool) -> Option<(Vec<u8>, String)> {
    if !is_safe_url(url, allow_all_domains).await {
        tracing::warn!("Refusing to fetch image - URL not allowed by safety check");
        return None;
    }
    let response = match follow_safely(url, allow_all_domains).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!("Image download failed ({error})");
            return None;
        }
    };
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.contains('/'))
        .unwrap_or(CONTENT_TYPE_FALLBACK)
        .to_owned();
    let data = match tokio::time::timeout(DOWNLOAD_TIMEOUT, response.bytes()).await {
        Ok(Ok(data)) => data.to_vec(),
        _ => {
            tracing::warn!("Image download failed while reading the body");
            return None;
        }
    };
    if allow_all_domains {
        let minimum = SCRAPING.directory_minimum_image_dimension_pixels;
        match image::ImageReader::new(std::io::Cursor::new(&data))
            .with_guessed_format()
            .ok()
            .and_then(|reader| reader.into_dimensions().ok())
        {
            Some((width, height)) if width.min(height) < minimum => {
                tracing::info!("Dropping undersized directory image");
                return None;
            }
            Some(_) => {}
            None => {
                tracing::warn!("Image could not be decoded");
                return None;
            }
        }
    }
    Some((data, content_type))
}

/// Follow redirects by hand so every destination passes the safety check.
async fn follow_safely(url: &str, allow_all_domains: bool) -> Result<wreq::Response> {
    let client = client()?;
    let mut current = Url::parse(url)?;
    for _ in 0..=MAX_REDIRECTS {
        let response =
            tokio::time::timeout(DOWNLOAD_TIMEOUT, client.get(current.as_str()).send()).await??;
        let status = response.status().as_u16();
        if !matches!(status, 301 | 302 | 303 | 307 | 308) {
            return Ok(response.error_for_status()?);
        }
        let Some(location) = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
        else {
            bail!("Image redirect could not be resolved");
        };
        current = current.join(location)?;
        if !is_safe_url(current.as_str(), allow_all_domains).await {
            bail!("Image redirect destination is not allowed");
        }
    }
    bail!("Image redirect could not be resolved")
}

/// `download_video`: bounded MP4 bytes from the same trusted CDN as post images.
pub async fn download_video(url: &str, maximum_bytes: usize, timeout: Duration) -> Result<Vec<u8>> {
    if url.is_empty() {
        bail!("Instagram did not return a downloadable video for this post.");
    }
    if !is_safe_url(url, false).await {
        bail!("Instagram returned an unsupported video host.");
    }
    let download = async {
        let response = client()?.get(url).send().await?.error_for_status()?;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("")
            .to_lowercase();
        if content_type != "video/mp4" && content_type != "application/octet-stream" {
            bail!("Instagram did not return an MP4 video.");
        }
        let mut payload = Vec::new();
        let mut chunks = response.bytes_stream();
        while let Some(chunk) = chunks.next().await {
            let chunk = chunk?;
            if payload.len() + chunk.len() > maximum_bytes {
                bail!("Video exceeds the {maximum_bytes}-byte media limit.");
            }
            payload.extend_from_slice(&chunk);
        }
        Ok(payload)
    };
    let payload = tokio::time::timeout(timeout, download).await??;
    if payload.is_empty() {
        bail!("Instagram returned an empty video.");
    }
    Ok(payload)
}

/// `is_carousel_post`: a declared carousel stays one even when its children are missing.
pub fn is_carousel_post(post: &serde_json::Value) -> bool {
    post.get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase()
        == "sidecar"
        || post
            .get("childPosts")
            .and_then(|value| value.as_array())
            .is_some_and(|c| !c.is_empty())
}

/// `single_post_video_url`: a standalone video's posters all describe the same media.
pub fn single_post_video_url(post: &serde_json::Value) -> Option<String> {
    if is_carousel_post(post) {
        return None;
    }
    post.get("videoUrl")
        .and_then(|value| value.as_str())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unsafe_urls_are_refused_before_any_lookup() {
        assert!(!is_safe_url("http://scontent.cdninstagram.com/a.jpg", false).await);
        assert!(!is_safe_url("https://user:pw@scontent.cdninstagram.com/a.jpg", false).await);
        assert!(!is_safe_url("https://scontent.cdninstagram.com:8443/a.jpg", false).await);
        assert!(!is_safe_url("https://example.com/a.jpg", false).await);
        assert!(!is_safe_url("https://127.0.0.1/a.jpg", true).await);
        assert!(!is_safe_url("https://[::1]/a.jpg", true).await);
    }

    #[test]
    fn private_and_reserved_addresses_are_not_public() {
        for address in [
            "10.0.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "240.0.0.1",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(!is_public(address.parse().unwrap()), "{address}");
        }
        assert!(is_public("157.240.1.1".parse().unwrap()));
    }

    #[test]
    fn carousel_detection_matches_python() {
        let carousel = serde_json::json!({"type": "Sidecar"});
        let video = serde_json::json!({"type": "Video", "videoUrl": "https://v"});
        assert!(is_carousel_post(&carousel));
        assert_eq!(single_post_video_url(&video).as_deref(), Some("https://v"));
        assert_eq!(single_post_video_url(&carousel), None);
    }
}
