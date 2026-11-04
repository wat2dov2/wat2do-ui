//! Validated uploads to the media directory (`services/storage_service.py`).
//!
//! A file in bucket `event-images` named `<uuid>.jpg` lives at
//! `$MEDIA_ROOT/event-images/<uuid>.jpg` and is served by the web server at
//! `$STORAGE_PUBLIC_BASE_URL/event-images/<uuid>.jpg`.
//!
//! Raster images are always re-encoded from their pixels, which drops EXIF, XMP
//! and other metadata; event posters are also scaled down to the rendition width.

use std::io::Cursor;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, DynamicImage, ImageFormat, ImageReader};

use crate::constants::{
    BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES, BUCKET_EVENT_VIDEOS, MAX_AVATAR_SIZE_BYTES,
};
use crate::controlbox::UPLOADS;
use crate::launch_agents::atomic_write;
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

/// `upload_file`: store prepared bytes under a random name and return the public URL.
pub async fn upload(bucket_name: &str, data: Vec<u8>, content_type: &str) -> Result<String> {
    let settings = settings()?;
    if settings.media_root.is_empty() || settings.storage_public_base_url.is_empty() {
        bail!("Media storage is not configured. Set MEDIA_ROOT and STORAGE_PUBLIC_BASE_URL.");
    }
    let media_root = PathBuf::from(&settings.media_root);
    let public_base_url = settings.storage_public_base_url.clone();
    let bucket_name = bucket_name.to_owned();
    let content_type = content_type.to_owned();
    tokio::task::spawn_blocking(move || {
        store_file(
            &media_root,
            &public_base_url,
            &bucket_name,
            &data,
            &content_type,
        )
    })
    .await
    .context("media write task failed")?
}

/// Write `data` as a new file in its bucket under `media_root`, which the web
/// server serves at `public_base_url`, and return the file's public URL.
fn store_file(
    media_root: &Path,
    public_base_url: &str,
    bucket_name: &str,
    data: &[u8],
    content_type: &str,
) -> Result<String> {
    if !media_root.is_absolute() {
        bail!("MEDIA_ROOT must be an absolute path.");
    }
    // Only a known bucket names a directory; the file name is ours.
    bucket(bucket_name)?;
    let name = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        extension(content_type)
    );
    let path = media_root.join(bucket_name).join(&name);
    // Readers see no file or the whole file: a flushed temporary file in the
    // bucket directory is renamed into place.
    atomic_write(&path, data).context("media write failed")?;
    // Media is public, and the web server may run as another user.
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))?;
    Ok(format!("{public_base_url}/{bucket_name}/{name}"))
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
    fn stored_files_land_whole_in_their_bucket_at_the_public_url() {
        let media = tempfile::tempdir().unwrap();
        let url = store_file(
            media.path(),
            "https://wat2do.io/media",
            BUCKET_EVENT_IMAGES,
            b"poster",
            "image/jpeg",
        )
        .unwrap();
        let name = url
            .strip_prefix("https://wat2do.io/media/event-images/")
            .unwrap();
        assert!(name.ends_with(".jpg"));
        let bucket = media.path().join(BUCKET_EVENT_IMAGES);
        assert_eq!(std::fs::read(bucket.join(name)).unwrap(), b"poster");
        let mode = std::fs::metadata(bucket.join(name))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o644);
        // Only the renamed file remains; no temporary file is left beside it.
        let names: Vec<_> = std::fs::read_dir(&bucket)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [name]);
    }

    #[test]
    fn files_are_stored_only_in_known_buckets_under_an_absolute_root() {
        let media = tempfile::tempdir().unwrap();
        let store = |root: &Path, bucket_name: &str| {
            store_file(
                root,
                "https://wat2do.io/media",
                bucket_name,
                b"x",
                "image/png",
            )
        };
        assert!(store(media.path(), "../outside").is_err());
        assert!(store(media.path(), "unknown").is_err());
        assert!(store(Path::new("media"), BUCKET_CLUB_LOGOS).is_err());
        assert_eq!(std::fs::read_dir(media.path()).unwrap().count(), 0);
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
