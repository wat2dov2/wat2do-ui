//! Carousel slide rasterization (`rendering.py`).
//!
//! Slides are HTML templates in the frontend
//! (`src/features/admin/components/instagram/slides`), drawn by the website's
//! render route (`INSTAGRAM_SLIDE_RENDER_URL`). At publish time this posts
//! each slide's live event data there and stores the JPEG it returns in media
//! storage; nothing is drawn before then. Each slide also becomes a 9:16
//! story frame ([`story_frame`]) for the account's story.

use std::time::Duration;

use anyhow::{Result, anyhow, bail};
use futures_util::StreamExt;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{ImageFormat, Rgb, RgbImage};
use serde_json::{Value, json};

use crate::api::json::httpx_json;
use crate::constants::BUCKET_EVENT_IMAGES;
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::settings::Settings;
use crate::storage::Storage;

const MAX_RENDERED_IMAGE_BYTES: usize = 15 * 1024 * 1024;
/// A story is 9:16; Instagram crops or pads anything else its own way.
const STORY_WIDTH: u32 = 1080;
const STORY_HEIGHT: u32 = 1920;
/// How many of a slide's outermost rows (or columns) give the colour its
/// background carries on in past the slide.
const EDGE_ROWS: u32 = 6;

/// A drawn slide: where it is stored and its JPEG.
#[derive(Debug)]
pub struct Rendered {
    pub url: String,
    pub jpeg: Vec<u8>,
}

/// The render route and the storage its slides go to.
pub struct Renderer<'a> {
    url: String,
    secret: String,
    timeout: Duration,
    storage: &'a Storage,
}

impl<'a> Renderer<'a> {
    pub fn new(settings: &Settings, storage: &'a Storage) -> Self {
        Self {
            url: settings.instagram_slide_render_url.clone(),
            secret: settings.instagram_slide_render_secret.clone(),
            timeout: Duration::from_secs_f64(settings.instagram_slide_render_timeout_seconds),
            storage,
        }
    }

    /// `render_event_asset`: one event's slide.
    pub async fn event(&self, event: &Value) -> Result<Rendered> {
        self.upload(json!({"kind": "event", "event": event, "school": event.get("school")}))
            .await
    }

    /// `render_cover_asset`: the cover, compiled from the carousel's events.
    pub async fn cover(
        &self,
        events: &[Value],
        school: &str,
        body: &str,
        local_date: &str,
        new_event_count: i64,
        batch_kind: &str,
    ) -> Result<Rendered> {
        if events.is_empty() {
            bail!("at least one event is required to render a cover");
        }
        self.upload(json!({
            "kind": "cover",
            "batch_kind": batch_kind,
            "events": events,
            "school": school,
            "body": body,
            "local_date": local_date,
            "new_event_count": new_event_count,
        }))
        .await
    }

    /// `render_outro_asset`: the last slide, listing the window's other events.
    pub async fn outro(
        &self,
        events: &[Value],
        school: &str,
        batch_kind: &str,
    ) -> Result<Rendered> {
        self.upload(json!({
            "kind": "outro",
            "batch_kind": batch_kind,
            "events": events,
            "school": school,
        }))
        .await
    }

    async fn upload(&self, slide: Value) -> Result<Rendered> {
        let jpeg = self.render(&slide).await?;
        let url = self
            .storage
            .upload(BUCKET_EVENT_IMAGES, jpeg.clone(), "image/jpeg")
            .await?;
        Ok(Rendered { url, jpeg })
    }

    /// A slide's story frame, stored: its URL.
    pub async fn story_frame(&self, slide: &Rendered) -> Result<String> {
        let jpeg = story_frame(&slide.jpeg)?;
        self.storage
            .upload(BUCKET_EVENT_IMAGES, jpeg, "image/jpeg")
            .await
    }

    /// `_render`: the JPEG the route draws for `slide`.
    async fn render(&self, slide: &Value) -> Result<Vec<u8>> {
        if self.url.is_empty() {
            bail!("Instagram slide renderer URL is not configured");
        }
        let client = wreq::Client::builder()
            .timeout(self.timeout)
            .redirect(wreq::redirect::Policy::none())
            .gzip(false)
            .deflate(false)
            .brotli(false)
            .build()?;
        let mut request = client
            .post(&self.url)
            .header("Accept", "image/jpeg")
            .header("Content-Type", "application/json")
            .body(httpx_json(slide));
        if !self.secret.is_empty() {
            request = request.bearer_auth(&self.secret);
        }
        let response = request
            .send()
            .await
            .map_err(|error| anyhow!("{}", error.without_uri()))?;
        let status = response.status();
        if !status.is_success() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            bail!(status_error(
                status.as_u16(),
                &self.url,
                location.as_deref()
            ));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_lowercase();
        if !content_type.starts_with("image/jpeg") {
            bail!("Instagram slide renderer did not return a JPEG");
        }
        let mut payload = Vec::new();
        let mut chunks = response.bytes_stream();
        while let Some(chunk) = chunks.next().await {
            payload.extend_from_slice(&chunk.map_err(|error| anyhow!("{}", error.without_uri()))?);
            if payload.len() > MAX_RENDERED_IMAGE_BYTES {
                bail!("Instagram slide renderer returned an oversized image");
            }
        }
        if payload.is_empty() {
            bail!("Instagram slide renderer returned an empty image");
        }
        Ok(payload)
    }
}

/// A slide as a 9:16 story frame: the whole slide in the middle, as large as
/// the frame allows, with each edge's own colour carried on to the frame's
/// edges, so nothing of the slide is cut off and its background runs on
/// without a seam.
pub fn story_frame(slide_jpeg: &[u8]) -> Result<Vec<u8>> {
    let slide = image::load_from_memory_with_format(slide_jpeg, ImageFormat::Jpeg)?.to_rgb8();
    let (width, height) = slide.dimensions();
    if width == 0 || height == 0 {
        bail!("a slide has no pixels");
    }
    let fit = (f64::from(STORY_WIDTH) / f64::from(width))
        .min(f64::from(STORY_HEIGHT) / f64::from(height));
    let fitted_width = ((f64::from(width) * fit).round() as u32).clamp(1, STORY_WIDTH);
    let fitted_height = ((f64::from(height) * fit).round() as u32).clamp(1, STORY_HEIGHT);
    let fitted = if (fitted_width, fitted_height) == (width, height) {
        slide
    } else {
        imageops::resize(&slide, fitted_width, fitted_height, FilterType::Lanczos3)
    };

    // A slide wider than 9:16 leaves bands above and below it, a narrower
    // one bands beside it; each band is the colour of the edge it touches.
    let edge = EDGE_ROWS.min(fitted_width).min(fitted_height);
    let mut frame = if fitted_height < STORY_HEIGHT {
        let top = median_colour(
            (0..edge).flat_map(|y| (0..fitted_width).map(move |x| (x, y))),
            &fitted,
        );
        let bottom = median_colour(
            (fitted_height - edge..fitted_height)
                .flat_map(|y| (0..fitted_width).map(move |x| (x, y))),
            &fitted,
        );
        RgbImage::from_fn(STORY_WIDTH, STORY_HEIGHT, |_, y| {
            if y < STORY_HEIGHT / 2 { top } else { bottom }
        })
    } else {
        let left = median_colour(
            (0..edge).flat_map(|x| (0..fitted_height).map(move |y| (x, y))),
            &fitted,
        );
        let right = median_colour(
            (fitted_width - edge..fitted_width)
                .flat_map(|x| (0..fitted_height).map(move |y| (x, y))),
            &fitted,
        );
        RgbImage::from_fn(STORY_WIDTH, STORY_HEIGHT, |x, _| {
            if x < STORY_WIDTH / 2 { left } else { right }
        })
    };
    imageops::overlay(
        &mut frame,
        &fitted,
        i64::from((STORY_WIDTH - fitted_width) / 2),
        i64::from((STORY_HEIGHT - fitted_height) / 2),
    );

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, INSTAGRAM_PUBLISHING.story_frame_jpeg_quality)
        .encode_image(&frame)?;
    Ok(jpeg)
}

/// The colour most of these pixels are, each channel's median, so a doodle
/// or a speck of JPEG noise along an edge does not tint the band.
fn median_colour(pixels: impl Iterator<Item = (u32, u32)>, image: &RgbImage) -> Rgb<u8> {
    let mut histograms = [[0u32; 256]; 3];
    let mut count = 0u32;
    for (x, y) in pixels {
        for (histogram, value) in histograms.iter_mut().zip(image.get_pixel(x, y).0) {
            histogram[usize::from(value)] += 1;
        }
        count += 1;
    }
    Rgb(histograms.map(|histogram| {
        let mut seen = 0;
        histogram
            .iter()
            .position(|&n| {
                seen += n;
                seen * 2 >= count
            })
            .unwrap_or_default() as u8
    }))
}

/// httpx's `raise_for_status` message for a response that is not a success.
fn status_error(status: u16, url: &str, location: Option<&str>) -> String {
    let kind = match status {
        100..=199 => "Informational response",
        300..=399 => "Redirect response",
        400..=499 => "Client error",
        _ => "Server error",
    };
    let reason = wreq::StatusCode::from_u16(status)
        .ok()
        .and_then(|code| code.canonical_reason())
        .unwrap_or("");
    let mut message = format!("{kind} '{status} {reason}' for url '{url}'");
    if let (300..=399, Some(location)) = (status, location) {
        message.push_str(&format!("\nRedirect location: '{location}'"));
    }
    message.push_str(&format!(
        "\nFor more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/{status}"
    ));
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instagram_publishing::fake_http::serve;
    use crate::storage::recording;

    fn event(id: i64) -> Value {
        json!({
            "id": id,
            "title": format!("Campus Event {id}"),
            "description": "An evening of games.\nBring a friend!",
            "category": "Games & Recreation",
            "club": "Wat2Do Club",
            "location": "Student Life Centre",
            "school": "uwaterloo",
            "price": 5.0,
            "dtstart_utc": "2026-07-25T23:30:00+00:00",
            "tz": "America/Toronto",
        })
    }

    fn renderer<'a>(url: &str, storage: &'a Storage) -> Renderer<'a> {
        Renderer {
            url: url.to_owned(),
            secret: "shared-secret".into(),
            timeout: Duration::from_secs(5),
            storage,
        }
    }

    #[tokio::test]
    async fn slides_post_live_event_data_and_store_the_jpeg() {
        // test_render_event_asset_posts_the_event_and_uploads_the_jpeg and
        // test_render_cover_asset_posts_every_slide_event_and_the_body
        let jpeg = image::RgbImage::new(4, 4);
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(jpeg)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let rendered = bytes.clone();
        let site = serve(move |_| (200, "image/jpeg", rendered.clone())).await;
        let (storage, uploads) = recording::storage("media", "https://media.test");
        let renderer = renderer(&format!("{}/render", site.url), &storage);

        let slide = renderer.event(&event(1)).await.unwrap();
        let url = &slide.url;
        assert!(url.starts_with("https://media.test/event-images/") && url.ends_with(".jpg"));
        assert_eq!(slide.jpeg, bytes, "the slide keeps the JPEG it stored");
        renderer
            .cover(
                &[event(1), event(2)],
                "uwaterloo",
                "This week",
                "2026-07-25",
                4,
                "events",
            )
            .await
            .unwrap();

        let requests = site.recorded();
        assert_eq!(requests[0].target, "/render");
        assert_eq!(
            requests[0].header("authorization"),
            Some("Bearer shared-secret")
        );
        assert_eq!(requests[0].header("accept"), Some("image/jpeg"));
        // httpx's compact JSON, floats as Python writes them.
        assert_eq!(
            requests[0].text(),
            "{\"kind\":\"event\",\"event\":{\"id\":1,\"title\":\"Campus Event 1\",\"description\":\"An evening of games.\\nBring a friend!\",\"category\":\"Games & Recreation\",\"club\":\"Wat2Do Club\",\"location\":\"Student Life Centre\",\"school\":\"uwaterloo\",\"price\":5.0,\"dtstart_utc\":\"2026-07-25T23:30:00+00:00\",\"tz\":\"America/Toronto\"},\"school\":\"uwaterloo\"}"
        );
        let cover = requests[1].json();
        assert_eq!(cover["kind"], "cover");
        assert_eq!(cover["events"][1]["id"], 2);
        assert_eq!(cover["body"], "This week");
        assert_eq!(cover["new_event_count"], 4);
        // Each slide is stored with the thumbnail every event image gets.
        let uploads = uploads.0.lock().unwrap();
        assert_eq!(uploads.len(), 4);
        assert_eq!(uploads[1].body, bytes);
        assert_eq!(uploads[1].header("content-type"), Some("image/jpeg"));
    }

    #[tokio::test]
    async fn outros_and_employer_covers_name_their_kind() {
        // test_employer_cover_passes_its_kind_to_the_shared_renderer and
        // test_render_outro_asset_posts_the_other_events_even_when_there_are_none
        let site = serve(|_| (200, "image/jpeg", vec![0xff, 0xd8])).await;
        let (storage, _) = recording::storage("media", "https://media.test");
        let renderer = renderer(&site.url, &storage);
        // The recording storage cannot thumbnail these bytes; the request is what matters.
        let _ = renderer.outro(&[], "uwaterloo", "events").await;
        let _ = renderer
            .outro(&[event(3)], "uwaterloo", "employers_on_campus")
            .await;
        let _ = renderer
            .cover(&[event(1)], "uwaterloo", "", "", 0, "employers_on_campus")
            .await;
        let requests = site.recorded();
        assert_eq!(
            requests[0].text(),
            r#"{"kind":"outro","batch_kind":"events","events":[],"school":"uwaterloo"}"#
        );
        assert_eq!(requests[1].json()["events"][0]["id"], 3);
        assert_eq!(requests[1].json()["batch_kind"], "employers_on_campus");
        assert_eq!(requests[2].json()["batch_kind"], "employers_on_campus");
    }

    #[tokio::test]
    async fn bad_renders_fail_with_python_messages() {
        // test_render_rejects_a_non_jpeg_response, test_render_requires_a_configured_renderer
        // and test_render_cover_asset_requires_at_least_one_event
        let (storage, _) = recording::storage("media", "https://media.test");
        let html = serve(|_| (200, "text/html", b"<html>".to_vec())).await;
        assert_eq!(
            renderer(&html.url, &storage)
                .event(&event(1))
                .await
                .unwrap_err()
                .to_string(),
            "Instagram slide renderer did not return a JPEG"
        );
        assert_eq!(
            renderer("", &storage)
                .event(&event(1))
                .await
                .unwrap_err()
                .to_string(),
            "Instagram slide renderer URL is not configured"
        );
        assert_eq!(
            renderer(&html.url, &storage)
                .cover(&[], "uwaterloo", "", "", 0, "events")
                .await
                .unwrap_err()
                .to_string(),
            "at least one event is required to render a cover"
        );
        let empty = serve(|_| (200, "image/jpeg", Vec::new())).await;
        assert_eq!(
            renderer(&empty.url, &storage)
                .event(&event(1))
                .await
                .unwrap_err()
                .to_string(),
            "Instagram slide renderer returned an empty image"
        );
        let down = serve(|_| (503, "text/plain", b"busy".to_vec())).await;
        let url = format!("{}/api/render", down.url);
        assert_eq!(
            renderer(&url, &storage)
                .event(&event(1))
                .await
                .unwrap_err()
                .to_string(),
            format!(
                "Server error '503 Service Unavailable' for url '{url}'\n\
                 For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503"
            )
        );
    }

    /// A JPEG of this size, its top half one colour and its bottom half another.
    fn halves(width: u32, height: u32, top: [u8; 3], bottom: [u8; 3]) -> Vec<u8> {
        let image = image::RgbImage::from_fn(width, height, |_, y| {
            image::Rgb(if y < height / 2 { top } else { bottom })
        });
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        bytes
    }

    #[test]
    fn a_story_frame_holds_the_whole_slide_and_carries_its_edges_on() {
        const RED: [u8; 3] = [200, 40, 40];
        const BLUE: [u8; 3] = [30, 60, 200];
        let near = |frame: &image::RgbImage, (x, y): (u32, u32), colour: [u8; 3]| {
            let pixel = frame.get_pixel(x, y);
            assert!(
                pixel
                    .0
                    .iter()
                    .zip(colour)
                    .all(|(&channel, want)| channel.abs_diff(want) <= 8),
                "{x},{y} is {pixel:?}, not {colour:?}"
            );
        };
        let frame = |jpeg: Vec<u8>| {
            let frame = image::load_from_memory(&story_frame(&jpeg).unwrap())
                .unwrap()
                .to_rgb8();
            assert_eq!(frame.dimensions(), (STORY_WIDTH, STORY_HEIGHT));
            frame
        };

        // A carousel slide (4:5) keeps its size, centred, so its middle row
        // lands on the frame's; above and below run on in its edge colours.
        let slide = frame(halves(1080, 1350, RED, BLUE));
        for point in [(540, 10), (0, 300), (540, 940)] {
            near(&slide, point, RED);
        }
        for point in [(540, 980), (1079, 1620), (540, 1910)] {
            near(&slide, point, BLUE);
        }

        // Any other shape is scaled to fit whole: a wide one spans the width.
        let wide = frame(halves(400, 200, RED, BLUE));
        for point in [(0, 700), (540, 940), (540, 100)] {
            near(&wide, point, RED);
        }
        for point in [(1079, 1220), (540, 980), (540, 1800)] {
            near(&wide, point, BLUE);
        }

        assert!(story_frame(b"not a jpeg").is_err());
    }
}
