//! Validated uploads to S3, served through CloudFront (`services/storage_service.py`).
//!
//! A file in bucket `event-images` named `<uuid>.jpg` is the object
//! `event-images/<uuid>.jpg` in `STORAGE_BUCKET_NAME` and is served at
//! `$STORAGE_PUBLIC_BASE_URL/event-images/<uuid>.jpg`, with the immutable
//! `Cache-Control` and validated `Content-Type` the object carries.
//!
//! Raster images are always re-encoded from their pixels, which drops EXIF, XMP
//! and other metadata; event posters are also scaled down to the rendition width.

use std::io::Cursor;

use anyhow::{Context, Result, bail};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::ServerSideEncryption;
use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, DynamicImage, ImageFormat, ImageReader};
use tokio::sync::OnceCell;

use crate::constants::{
    BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES, BUCKET_EVENT_VIDEOS, MAX_AVATAR_SIZE_BYTES,
};
use crate::controlbox::UPLOADS;
use crate::settings::settings;

// Pillow's default lossy WebP quality, which the Python service saved with.
const WEBP_QUALITY: f32 = 80.0;

struct Bucket {
    allowed: Vec<String>,
    limit: usize,
}

fn bucket(name: &str) -> Result<Bucket> {
    let images = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    Ok(match name {
        BUCKET_EVENT_IMAGES => Bucket {
            allowed: UPLOADS.event_image_allowed_mime_types.clone(),
            limit: UPLOADS.event_image_max_size_bytes,
        },
        BUCKET_EVENT_VIDEOS => Bucket {
            allowed: vec!["video/mp4".into()],
            limit: UPLOADS.event_video_max_size_bytes,
        },
        BUCKET_CLUB_LOGOS => Bucket {
            allowed: images.iter().map(|mime| (*mime).to_owned()).collect(),
            limit: MAX_AVATAR_SIZE_BYTES,
        },
        _ => bail!("unknown storage bucket {name}"),
    })
}

fn extension(content_type: &str) -> &'static str {
    match content_type {
        "video/mp4" => ".mp4",
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".bin",
    }
}

fn looks_like_svg(data: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&data[..data.len().min(1024)]).to_lowercase();
    head.contains("<svg")
}

/// `validate_and_prepare`: check the bucket's rules and return bytes safe to serve.
pub fn validate_and_prepare(
    bucket_name: &str,
    data: Vec<u8>,
    content_type: &str,
) -> Result<Vec<u8>> {
    let rules = bucket(bucket_name)?;
    if !rules.allowed.iter().any(|allowed| allowed == content_type) {
        bail!("File type {content_type} not allowed");
    }
    if data.len() > rules.limit {
        bail!("File too large");
    }
    if content_type == "video/mp4" {
        // ISO media files name their container in an ftyp box.
        if data.len() < 16 || &data[4..8] != b"ftyp" {
            bail!("Uploaded file is not an MP4 video.");
        }
        return Ok(data);
    }
    // SVGs are sanitized in Python; nothing Rust stores is ever an SVG, so refuse one.
    if looks_like_svg(&data) || content_type == "image/svg+xml" {
        bail!("SVG uploads are not handled here");
    }
    let max_width =
        (bucket_name == BUCKET_EVENT_IMAGES).then_some(UPLOADS.event_image_rendition_width_pixels);
    prepare_rendition(&data, content_type, max_width)
}

/// `prepare_image_rendition`: re-encode from pixels only, narrower than `max_width`.
pub fn prepare_rendition(
    data: &[u8],
    content_type: &str,
    max_width: Option<u32>,
) -> Result<Vec<u8>> {
    let reader = ImageReader::new(Cursor::new(data)).with_guessed_format()?;
    let format = reader
        .format()
        .or_else(|| ImageFormat::from_mime_type(content_type));
    let mut out = Vec::new();
    if format == Some(ImageFormat::Gif) {
        let frames = GifDecoder::new(Cursor::new(data))?
            .into_frames()
            .collect_frames()?;
        if frames.len() > 1 {
            // Animation keeps its size; one resample would flatten it.
            let mut encoder = GifEncoder::new(&mut out);
            encoder.set_repeat(Repeat::Infinite)?;
            encoder.encode_frames(frames)?;
            drop(encoder);
            return Ok(out);
        }
    }
    let decoded = reader
        .decode()
        .context("Uploaded file could not be decoded as a valid image.")?;
    let image = match max_width {
        Some(width) if decoded.width() > width => {
            let height =
                ((decoded.height() as f64) * (width as f64 / decoded.width() as f64)).round();
            decoded.resize_exact(width, (height as u32).max(1), FilterType::Lanczos3)
        }
        _ => decoded,
    };
    match format.unwrap_or(ImageFormat::Png) {
        ImageFormat::Jpeg => {
            JpegEncoder::new_with_quality(&mut out, UPLOADS.event_image_rendition_quality)
                .encode_image(&DynamicImage::ImageRgb8(image.to_rgb8()))?;
        }
        ImageFormat::WebP => {
            let rgba = DynamicImage::ImageRgba8(image.to_rgba8());
            let encoder = webp::Encoder::from_image(&rgba).map_err(|e| anyhow::anyhow!("{e}"))?;
            out = encoder.encode(WEBP_QUALITY).to_vec();
        }
        ImageFormat::Gif => image.write_to(&mut Cursor::new(&mut out), ImageFormat::Gif)?,
        _ => image.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)?,
    }
    Ok(out)
}

static S3: OnceCell<aws_sdk_s3::Client> = OnceCell::const_new();

async fn s3() -> Result<&'static aws_sdk_s3::Client> {
    let region = settings()?.aws_region.clone();
    Ok(S3
        .get_or_init(|| async {
            let config = aws_config::from_env()
                .region(aws_config::Region::new(region))
                .load()
                .await;
            aws_sdk_s3::Client::new(&config)
        })
        .await)
}

/// `upload_file`: store prepared bytes under a random name and return the public URL.
pub async fn upload(bucket_name: &str, data: Vec<u8>, content_type: &str) -> Result<String> {
    let settings = settings()?;
    if settings.storage_bucket_name.is_empty() || settings.storage_public_base_url.is_empty() {
        bail!("S3 storage is not configured. Set STORAGE_BUCKET_NAME and STORAGE_PUBLIC_BASE_URL.");
    }
    let key = new_object_key(bucket_name, content_type)?;
    s3().await?
        .put_object()
        .bucket(&settings.storage_bucket_name)
        .key(&key)
        .body(ByteStream::from(data))
        .content_type(content_type)
        .cache_control("public, max-age=31536000, immutable")
        .server_side_encryption(ServerSideEncryption::Aes256)
        .send()
        .await
        .context("S3 upload failed")?;
    Ok(format!("{}/{key}", settings.storage_public_base_url))
}

/// The key of a new object, which is also its URL path below the public base
/// URL: a known bucket, then a random name with the content type's extension.
fn new_object_key(bucket_name: &str, content_type: &str) -> Result<String> {
    bucket(bucket_name)?;
    Ok(format!(
        "{bucket_name}/{}{}",
        uuid::Uuid::new_v4().simple(),
        extension(content_type)
    ))
}

/// `store_image`: validate fetched image bytes and upload them; None on any failure.
pub async fn store_image(data: Vec<u8>, content_type: &str, bucket_name: &str) -> Option<String> {
    let prepared = validate_and_prepare_oversized(bucket_name, data, content_type);
    match prepared {
        Ok(prepared) => match upload(bucket_name, prepared, content_type).await {
            Ok(url) => Some(url),
            Err(error) => {
                tracing::warn!("Failed to upload image to {bucket_name} ({error:#})");
                None
            }
        },
        Err(error) => {
            tracing::warn!("Failed to prepare image for {bucket_name} ({error:#})");
            None
        }
    }
}

/// An event poster over the size limit is scaled down before the limit is checked.
fn validate_and_prepare_oversized(
    bucket_name: &str,
    data: Vec<u8>,
    content_type: &str,
) -> Result<Vec<u8>> {
    if bucket_name == BUCKET_EVENT_IMAGES && data.len() > bucket(bucket_name)?.limit {
        let smaller = prepare_rendition(
            &data,
            content_type,
            Some(UPLOADS.event_image_rendition_width_pixels),
        )?;
        return validate_and_prepare(bucket_name, smaller, content_type);
    }
    validate_and_prepare(bucket_name, data, content_type)
}

/// `upload_video_from_url`: persist a post's video; a failure keeps only the poster.
pub async fn upload_video_from_url(url: &str) -> Option<String> {
    let result = async {
        let data = crate::images::download_video(
            url,
            UPLOADS.event_video_max_size_bytes,
            std::time::Duration::from_secs(UPLOADS.event_video_download_timeout_seconds),
        )
        .await?;
        let prepared = validate_and_prepare(BUCKET_EVENT_VIDEOS, data, "video/mp4")?;
        upload(BUCKET_EVENT_VIDEOS, prepared, "video/mp4").await
    }
    .await;
    match result {
        Ok(url) => Some(url),
        Err(_) => {
            // Signed provider URLs must not reach the logs.
            tracing::warn!("Unable to persist Instagram video; retaining its image poster.");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        let image = DynamicImage::new_rgb8(width, height);
        let mut out = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Jpeg)
            .unwrap();
        out
    }

    #[test]
    fn posters_are_scaled_to_the_rendition_width() {
        let prepared =
            validate_and_prepare(BUCKET_EVENT_IMAGES, jpeg(2160, 1080), "image/jpeg").unwrap();
        let decoded = image::load_from_memory(&prepared).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1080, 540));
    }

    #[test]
    fn objects_are_named_randomly_inside_known_buckets_only() {
        let key = new_object_key(BUCKET_EVENT_IMAGES, "image/jpeg").unwrap();
        let name = key.strip_prefix("event-images/").unwrap();
        assert_eq!(name.len(), 32 + ".jpg".len());
        assert!(name.ends_with(".jpg"));
        assert_ne!(
            key,
            new_object_key(BUCKET_EVENT_IMAGES, "image/jpeg").unwrap()
        );
        assert!(new_object_key("../outside", "image/png").is_err());
        assert!(new_object_key("unknown", "image/png").is_err());
    }

    #[test]
    fn logos_keep_their_size_and_bad_types_are_refused() {
        let prepared =
            validate_and_prepare(BUCKET_CLUB_LOGOS, jpeg(320, 320), "image/jpeg").unwrap();
        assert_eq!(image::load_from_memory(&prepared).unwrap().width(), 320);
        assert!(validate_and_prepare(BUCKET_EVENT_IMAGES, jpeg(10, 10), "image/heic").is_err());
        assert!(
            validate_and_prepare(BUCKET_EVENT_IMAGES, b"<svg></svg>".to_vec(), "image/png")
                .is_err()
        );
        assert!(
            validate_and_prepare(
                BUCKET_EVENT_VIDEOS,
                b"not a video at all".to_vec(),
                "video/mp4"
            )
            .is_err()
        );
    }
}
