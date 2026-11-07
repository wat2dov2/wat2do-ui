//! Validated uploads to Cloudflare R2 through its S3 API (`services/storage_service.py`).
//!
//! A file in bucket `event-images` named `<uuid>.jpg` is the object
//! `event-images/<uuid>.jpg` in `STORAGE_BUCKET_NAME` and is served at
//! `$STORAGE_PUBLIC_BASE_URL/event-images/<uuid>.jpg`, with the immutable
//! `Cache-Control` and validated `Content-Type` the object carries.
//!
//! Every upload is checked against its bucket's rules first: an allowed
//! content type, a size limit, and bytes that really are what they claim.
//! SVGs are sanitized (whatever type the client declared), and raster images
//! are re-encoded from their pixels, which drops EXIF, XMP and other metadata;
//! event posters are also scaled down to the rendition width. Posters and
//! raster club logos get a WebP thumbnail next to them (`Thumbnail`,
//! `thumbnail_key`) for the pages that draw them small.

use std::io::Cursor;
use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Context, Result, bail};
use aws_sdk_s3::config::{
    BehaviorVersion, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation,
};
use aws_sdk_s3::primitives::ByteStream;
use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use tokio::sync::OnceCell;

use crate::constants::{
    BUCKET_AVATARS, BUCKET_CLAIM_PROOFS, BUCKET_CLUB_LOGOS, BUCKET_EVENT_IMAGES,
    BUCKET_EVENT_VIDEOS, BUCKET_QR_ASSETS, MAX_AVATAR_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES,
};
use crate::controlbox::UPLOADS;
use crate::settings::Settings;
use crate::svg_sanitize::{looks_like_svg, sanitize_svg};

// Pillow's default lossy WebP quality, which the Python service saved with.
const WEBP_QUALITY: f32 = 80.0;
/// Pillow refuses to open an image of more pixels than this
/// (`2 * Image.MAX_IMAGE_PIXELS`, a decompression bomb).
const MAX_DECODED_PIXELS: u64 = 2 * 89_478_485;
/// botocore's standard retry mode with `max_attempts=4`, as the Python client had.
const S3_MAX_ATTEMPTS: u32 = 4;

/// `ValidationError` from `validate_and_prepare`: the message clients see,
/// and whether it was the size limit (`code="file_too_large"`, a 413).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadRefused {
    pub detail: String,
    pub too_large: bool,
}

impl UploadRefused {
    fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
            too_large: false,
        }
    }
}

impl std::fmt::Display for UploadRefused {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.detail)
    }
}

impl std::error::Error for UploadRefused {}

/// `_DEFAULT_BUCKETS`: each bucket's accepted content types, in order.
pub fn allowed_mime_types(bucket: &str) -> Vec<String> {
    let images = |types: &[&str]| types.iter().map(|mime| (*mime).to_owned()).collect();
    match bucket {
        // Shared verbatim with the frontend file picker, so it lives in the control box.
        BUCKET_EVENT_IMAGES => UPLOADS.event_image_allowed_mime_types.clone(),
        BUCKET_EVENT_VIDEOS => images(&["video/mp4"]),
        BUCKET_AVATARS | BUCKET_CLAIM_PROOFS => images(&["image/jpeg", "image/png", "image/webp"]),
        BUCKET_CLUB_LOGOS | BUCKET_QR_ASSETS => {
            images(&["image/jpeg", "image/png", "image/webp", "image/svg+xml"])
        }
        _ => Vec::new(),
    }
}

/// `get_file_size_limit`: the bucket's size limit, `MAX_IMAGE_SIZE_BYTES` for any other.
pub fn file_size_limit(bucket: &str) -> usize {
    match bucket {
        BUCKET_EVENT_IMAGES => UPLOADS.event_image_max_size_bytes,
        BUCKET_EVENT_VIDEOS => UPLOADS.event_video_max_size_bytes,
        BUCKET_AVATARS | BUCKET_CLUB_LOGOS => MAX_AVATAR_SIZE_BYTES,
        _ => MAX_IMAGE_SIZE_BYTES,
    }
}

/// `_MIME_TO_EXT`: the stored object's extension comes from the validated
/// type only, never the client's filename.
fn extension(content_type: &str) -> &'static str {
    match content_type {
        "video/mp4" => ".mp4",
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/svg+xml" => ".svg",
        _ => ".bin",
    }
}

/// `validate_and_prepare`: check an upload against its bucket's rules and
/// return the bytes to store with their final content type.
pub fn validate_and_prepare(
    bucket: &str,
    data: Vec<u8>,
    content_type: Option<&str>,
) -> Result<(Vec<u8>, String), UploadRefused> {
    let Some(content_type) = content_type.filter(|content_type| !content_type.is_empty()) else {
        return Err(UploadRefused::new("Missing content type"));
    };
    let allowed = allowed_mime_types(bucket);
    if !allowed.iter().any(|mime| mime == content_type) {
        return Err(UploadRefused::new(format!(
            "File type {content_type} not allowed. Accepted: {}",
            allowed.join(", ")
        )));
    }
    let limit = file_size_limit(bucket);
    if data.len() > limit {
        return Err(too_large(limit));
    }
    if content_type == "video/mp4" {
        // ISO base media files name their container in an ftyp box; never
        // serve arbitrary bytes merely labelled video/mp4.
        if data.len() < 16 || &data[4..8] != b"ftyp" {
            return Err(UploadRefused::new("Uploaded file is not an MP4 video."));
        }
        return Ok((data, content_type.to_owned()));
    }
    // The bytes decide, not the declared type: an SVG sent as "image/png" is
    // still an SVG, and is sanitized (or refused) as one.
    if looks_like_svg(&data) {
        if !allowed.iter().any(|mime| mime == "image/svg+xml") {
            return Err(UploadRefused::new(
                "SVG content detected but SVG uploads are not allowed for this resource.",
            ));
        }
        return match sanitize_svg(&data) {
            Ok(clean) => Ok((clean, "image/svg+xml".to_owned())),
            Err(reason) => {
                tracing::warn!("Invalid SVG upload for {bucket}: {reason}");
                Err(UploadRefused::new(format!("Invalid SVG file: {reason}")))
            }
        };
    }
    if content_type == "image/svg+xml" {
        return Err(UploadRefused::new(
            "File declared as SVG but content is not valid SVG.",
        ));
    }
    if matches!(
        content_type,
        "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    ) {
        // Posters are the only images served at scale, so they are sized once
        // on the way in rather than resampled for every viewer.
        let max_width =
            (bucket == BUCKET_EVENT_IMAGES).then_some(UPLOADS.event_image_rendition_width_pixels);
        let prepared = prepare_rendition(&data, content_type, max_width).map_err(|error| {
            tracing::warn!("Image metadata strip failed for {content_type}: {error:#}");
            UploadRefused::new("Uploaded file could not be decoded as a valid image.")
        })?;
        return Ok((prepared, content_type.to_owned()));
    }
    Ok((data, content_type.to_owned()))
}

/// The size limit's refusal (`code="file_too_large"`).
pub fn too_large(limit: usize) -> UploadRefused {
    UploadRefused {
        detail: format!("File too large. Max {} MB.", limit / (1024 * 1024)),
        too_large: true,
    }
}

/// Whether the image holds more than one frame, which is never resampled
/// (one resample would flatten the animation), as Pillow's `is_animated`.
fn is_animated(data: &[u8], format: Option<ImageFormat>) -> bool {
    match format {
        Some(ImageFormat::Gif) => GifDecoder::new(Cursor::new(data))
            .ok()
            .is_some_and(|decoder| decoder.into_frames().take(2).count() > 1),
        Some(ImageFormat::WebP) => WebPDecoder::new(Cursor::new(data))
            .ok()
            .is_some_and(|decoder| decoder.has_animation()),
        Some(ImageFormat::Png) => PngDecoder::new(Cursor::new(data))
            .ok()
            .and_then(|decoder| decoder.is_apng().ok())
            .unwrap_or(false),
        _ => false,
    }
}

fn mime_format(content_type: &str) -> ImageFormat {
    match content_type {
        "image/jpeg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::WebP,
        "image/gif" => ImageFormat::Gif,
        _ => ImageFormat::Png,
    }
}

/// `prepare_image_rendition`: re-encode from pixels only, which drops every
/// metadata block; an image wider than `max_width` is scaled down to it
/// (never up), keeping its aspect ratio. Animations keep their size.
pub fn prepare_rendition(
    data: &[u8],
    content_type: &str,
    max_width: Option<u32>,
) -> Result<Vec<u8>> {
    let reader = ImageReader::new(Cursor::new(data)).with_guessed_format()?;
    let detected = reader.format();
    let Some(detected) = detected else {
        bail!("cannot identify image file");
    };
    let (width, height) = ImageReader::new(Cursor::new(data))
        .with_guessed_format()?
        .into_dimensions()?;
    if u64::from(width) * u64::from(height) > MAX_DECODED_PIXELS {
        bail!("Image size ({width}x{height} pixels) exceeds the decompression bomb limit");
    }
    let animated = is_animated(data, Some(detected));
    let mut out = Vec::new();
    if animated && detected == ImageFormat::Gif {
        // Every frame is re-encoded, at its own size.
        let frames = GifDecoder::new(Cursor::new(data))?
            .into_frames()
            .collect_frames()?;
        let mut encoder = GifEncoder::new(&mut out);
        encoder.set_repeat(Repeat::Infinite)?;
        encoder.encode_frames(frames)?;
        drop(encoder);
        return Ok(out);
    }
    let decoded = reader.decode()?;
    let (image, format) = match max_width {
        Some(max_width) if !animated && decoded.width() > max_width => {
            // A resized Pillow image has no format of its own: it is saved
            // in the format the declared type names.
            (narrower(decoded, max_width), mime_format(content_type))
        }
        _ => (decoded, detected),
    };
    match format {
        ImageFormat::Jpeg => {
            JpegEncoder::new_with_quality(&mut out, UPLOADS.event_image_rendition_quality)
                .encode_image(&DynamicImage::ImageRgb8(image.to_rgb8()))?;
        }
        ImageFormat::WebP => {
            let encoded = if image.color().has_alpha() {
                webp::Encoder::from_rgba(&image.to_rgba8(), image.width(), image.height())
                    .encode(WEBP_QUALITY)
            } else {
                webp::Encoder::from_rgb(&image.to_rgb8(), image.width(), image.height())
                    .encode(WEBP_QUALITY)
            };
            out = encoded.to_vec();
        }
        ImageFormat::Gif => image.write_to(&mut Cursor::new(&mut out), ImageFormat::Gif)?,
        _ => image.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)?,
    }
    Ok(out)
}

/// `scale_to_width`: an image scaled down to `width` wide, keeping its aspect
/// ratio; a narrower one is left alone, since enlarging adds bytes without
/// adding detail.
fn narrower(image: DynamicImage, width: u32) -> DynamicImage {
    if image.width() <= width {
        return image;
    }
    // Python's round() rounds halves to even.
    let height = (f64::from(image.height()) * (f64::from(width) / f64::from(image.width())))
        .round_ties_even();
    image.resize_exact(width, (height as u32).max(1), FilterType::Lanczos3)
}

/// `scale_to_fit`: an image scaled down so neither side is longer than `size`,
/// keeping its aspect ratio; a smaller one is left alone.
fn within(image: DynamicImage, size: u32) -> DynamicImage {
    if image.height() <= image.width() {
        return narrower(image, size);
    }
    if image.height() <= size {
        return image;
    }
    // Python's round() rounds halves to even.
    let width = (f64::from(image.width()) * (f64::from(size) / f64::from(image.height())))
        .round_ties_even();
    image.resize_exact((width as u32).max(1), size, FilterType::Lanczos3)
}

/// `thumbnail_path`: the thumbnail's key next to image `key`
/// (`event-images/<uuid>.jpg` -> `event-images/<uuid>.thumb.webp`).
pub fn thumbnail_key(key: &str) -> String {
    let stem = Path::new(key).with_extension("");
    format!("{}{}", stem.to_string_lossy(), UPLOADS.thumbnail_suffix)
}

/// The thumbnail an image is stored with (`services/image_thumbnails.py`), so
/// the pages that draw it small never download the original and nothing
/// resizes images on request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Thumbnail {
    /// A poster's, at most the event image thumbnail width wide, for poster frames.
    EventImage,
    /// A raster club logo's, at most the club logo thumbnail size on its
    /// longest side, for logos drawn at 64 CSS pixels or less.
    ClubLogo,
}

impl Thumbnail {
    /// `Thumbnail.of`: the thumbnail stored beside `path` in `bucket`, if it
    /// has one. SVG logos are small already, so they have none.
    pub fn of(bucket: &str, path: &str) -> Option<Self> {
        match bucket {
            BUCKET_EVENT_IMAGES => Some(Self::EventImage),
            BUCKET_CLUB_LOGOS if !path.to_ascii_lowercase().ends_with(".svg") => {
                Some(Self::ClubLogo)
            }
            _ => None,
        }
    }

    /// `Thumbnail.make`: the WebP thumbnail of an image's bytes; an animated
    /// image's is its first frame.
    pub fn make(self, data: &[u8]) -> Result<Vec<u8>> {
        let mut decoder = ImageReader::new(Cursor::new(data))
            .with_guessed_format()?
            .into_decoder()?;
        let orientation = decoder.orientation()?;
        let mut image = DynamicImage::from_decoder(decoder)
            .context("Uploaded file could not be decoded as a valid image.")?;
        image.apply_orientation(orientation);
        let (image, quality) = match self {
            Self::EventImage => (
                narrower(image, UPLOADS.event_image_thumbnail_width_pixels),
                UPLOADS.event_image_thumbnail_quality,
            ),
            Self::ClubLogo => (
                within(image, UPLOADS.club_logo_thumbnail_size_pixels),
                UPLOADS.club_logo_thumbnail_quality,
            ),
        };
        let pixels = if image.color().has_alpha() {
            DynamicImage::ImageRgba8(image.to_rgba8())
        } else {
            DynamicImage::ImageRgb8(image.to_rgb8())
        };
        let encoder = webp::Encoder::from_image(&pixels).map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(encoder.encode(f32::from(quality)).to_vec())
    }
}

/// `_is_safe_storage_path`: a plain bucket-relative name, never absolute,
/// blank or climbing out of the bucket with `..`.
pub fn is_safe_storage_path(path: &str) -> bool {
    if crate::text::python_strip(path).is_empty() {
        return false;
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return false;
    }
    if path.split('/').any(|segment| segment == "..")
        || path.split('\\').any(|segment| segment == "..")
    {
        return false;
    }
    // `os.path.normpath` drops empty and "." segments; what is left must not
    // start with "..".
    path.split('/')
        .find(|segment| !segment.is_empty() && *segment != ".")
        .is_none_or(|first| !first.starts_with(".."))
}

/// The S3 API bucket uploads go to (Cloudflare R2 in production, the local
/// S3 server in development) and the public URL that serves it
/// (`StorageService`). Storage has its own endpoint and keys; SES keeps the
/// AWS credentials. The S3 client is created on first use.
pub struct Storage {
    bucket_name: String,
    public_base_url: String,
    endpoint_url: String,
    access_key_id: String,
    secret_access_key: String,
    client: OnceCell<aws_sdk_s3::Client>,
}

impl Storage {
    pub fn new(settings: &Settings) -> Self {
        Self {
            bucket_name: settings.storage_bucket_name.clone(),
            public_base_url: settings.storage_public_base_url.clone(),
            endpoint_url: settings.storage_endpoint_url.clone(),
            access_key_id: settings.storage_access_key_id.clone(),
            secret_access_key: settings.storage_secret_access_key.clone(),
            client: OnceCell::new(),
        }
    }

    /// Storage that talks to S3 through `client` (tests record its requests).
    pub fn with_client(
        client: aws_sdk_s3::Client,
        bucket_name: &str,
        public_base_url: &str,
    ) -> Self {
        Self {
            bucket_name: bucket_name.to_owned(),
            public_base_url: public_base_url.trim_end_matches('/').to_owned(),
            endpoint_url: String::new(),
            access_key_id: String::new(),
            secret_access_key: String::new(),
            client: OnceCell::new_with(Some(client)),
        }
    }

    /// `_get_s3_client`: path-style requests with botocore's standard retries
    /// (4 attempts), and checksums only where the API requires them, which R2
    /// and the local server both accept.
    async fn client(&self) -> Result<&aws_sdk_s3::Client> {
        if let Some(client) = self.client.get() {
            return Ok(client);
        }
        if self.endpoint_url.is_empty()
            || self.access_key_id.is_empty()
            || self.secret_access_key.is_empty()
        {
            bail!(
                "S3 storage is not configured. Set STORAGE_ENDPOINT_URL, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY."
            );
        }
        Ok(self
            .client
            .get_or_init(|| async {
                let shared = aws_config::defaults(BehaviorVersion::latest())
                    .region(Region::new("auto"))
                    .endpoint_url(&self.endpoint_url)
                    .credentials_provider(Credentials::new(
                        &self.access_key_id,
                        &self.secret_access_key,
                        None,
                        None,
                        "storage",
                    ))
                    .retry_config(
                        aws_config::retry::RetryConfig::standard()
                            .with_max_attempts(S3_MAX_ATTEMPTS),
                    )
                    .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
                    .response_checksum_validation(ResponseChecksumValidation::WhenRequired)
                    .load()
                    .await;
                let config = aws_sdk_s3::config::Builder::from(&shared)
                    .force_path_style(true)
                    .build();
                aws_sdk_s3::Client::from_conf(config)
            })
            .await)
    }

    fn require_configuration(&self) -> Result<()> {
        if self.bucket_name.is_empty() || self.public_base_url.is_empty() {
            bail!(
                "S3 storage is not configured. Set STORAGE_BUCKET_NAME and STORAGE_PUBLIC_BASE_URL."
            );
        }
        Ok(())
    }

    /// `_object_key`: the key of `bucket`/`path`, which is also its URL path
    /// below the public base URL, or `None` when it is not a plain file in a
    /// known bucket.
    fn object_key(bucket: &str, path: &str) -> Option<String> {
        (!allowed_mime_types(bucket).is_empty() && is_safe_storage_path(path))
            .then(|| format!("{bucket}/{path}"))
    }

    /// `upload_file`: store prepared bytes under a random name and return
    /// the public URL. An image's thumbnail is stored first, so a poster or
    /// logo is never published without the thumbnail its pages ask for.
    pub async fn upload(&self, bucket: &str, data: Vec<u8>, content_type: &str) -> Result<String> {
        let path = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            extension(content_type)
        );
        self.require_configuration()?;
        let Some(key) = Self::object_key(bucket, &path) else {
            bail!("Invalid storage asset path");
        };
        if let Some(thumbnail) = Thumbnail::of(bucket, &path) {
            let image = data.clone();
            let small = tokio::task::spawn_blocking(move || thumbnail.make(&image))
                .await
                .context("thumbnail task")??;
            self.put(&thumbnail_key(&key), small, "image/webp").await?;
        }
        self.put(&key, data, content_type).await?;
        Ok(format!("{}/{key}", self.public_base_url))
    }

    /// `store_image`: validate fetched image bytes (an event poster over the
    /// size limit is scaled down first) and upload them; None on any failure.
    pub async fn store_image(
        &self,
        data: Vec<u8>,
        content_type: &str,
        bucket_name: &str,
    ) -> Option<String> {
        let (prepared, content_type) =
            match validate_and_prepare_oversized(bucket_name, data, content_type) {
                Ok(prepared) => prepared,
                Err(error) => {
                    tracing::warn!("Failed to prepare image for {bucket_name} ({error})");
                    return None;
                }
            };
        match self.upload(bucket_name, prepared, &content_type).await {
            Ok(url) => Some(url),
            Err(error) => {
                tracing::warn!("Failed to upload image to {bucket_name} ({error:#})");
                None
            }
        }
    }

    /// `_put_object`: one immutable object. An SVG is served as an
    /// attachment, so a browser never renders it inline in the storage origin.
    async fn put(&self, key: &str, data: Vec<u8>, content_type: &str) -> Result<()> {
        let mut request = self
            .client()
            .await?
            .put_object()
            .bucket(&self.bucket_name)
            .key(key)
            .body(ByteStream::from(data))
            .content_type(content_type)
            .cache_control("public, max-age=31536000, immutable");
        if content_type == "image/svg+xml" {
            request = request.content_disposition("attachment");
        }
        request.send().await.context("S3 upload failed")?;
        Ok(())
    }

    /// `delete_file`: remove one object, with its thumbnail if it has one; a
    /// suspicious path is refused and a failed delete only logged.
    /// Unconfigured storage is an error.
    pub async fn delete_file(&self, bucket: &str, path: &str) -> Result<()> {
        self.require_configuration()?;
        let Some(key) = Self::object_key(bucket, path) else {
            tracing::warn!("Refusing to delete suspicious path {bucket}/{path}");
            return Ok(());
        };
        let mut keys = vec![key];
        if Thumbnail::of(bucket, path).is_some() {
            keys.push(thumbnail_key(&keys[0]));
        }
        for key in keys {
            let deleted = match self.client().await {
                Ok(client) => client
                    .delete_object()
                    .bucket(&self.bucket_name)
                    .key(&key)
                    .send()
                    .await
                    .map(|_| ())
                    .map_err(anyhow::Error::from),
                Err(error) => Err(error),
            };
            if let Err(error) = deleted {
                tracing::warn!("Failed to delete {key}: {error:#}");
            }
        }
        Ok(())
    }

    /// `path_from_url`: the object path of one of our public URLs in
    /// `bucket`, or `None` for any other URL (which is then left alone).
    pub fn path_from_url(&self, url: &str, bucket: &str) -> Option<String> {
        if self.public_base_url.is_empty() {
            return None;
        }
        let (parsed, _) = crate::urls::urlparse(url).ok()?;
        let (base, _) = crate::urls::urlparse(&self.public_base_url).ok()?;
        if parsed.scheme != base.scheme || parsed.netloc != base.netloc {
            return None;
        }
        let marker = format!("{}/{bucket}/", base.path.trim_end_matches('/'));
        let path = parsed.path.strip_prefix(&marker)?;
        is_safe_storage_path(path).then(|| path.to_owned())
    }
}

/// The storage of this process, from its settings (the ingestion processor's
/// downloads; the API server keeps its own in `AppState`).
pub fn shared() -> Result<&'static Storage> {
    static SHARED: OnceLock<Storage> = OnceLock::new();
    let settings = crate::settings::settings()?;
    Ok(SHARED.get_or_init(|| Storage::new(settings)))
}

/// `store_image` with this process's storage: the ingestion processor's
/// posters and club logos.
pub async fn store_image(data: Vec<u8>, content_type: &str, bucket_name: &str) -> Option<String> {
    match shared() {
        Ok(storage) => storage.store_image(data, content_type, bucket_name).await,
        Err(error) => {
            tracing::warn!("Failed to upload image to {bucket_name} ({error:#})");
            None
        }
    }
}

/// An event poster over the size limit is scaled down before the limit is checked.
fn validate_and_prepare_oversized(
    bucket_name: &str,
    data: Vec<u8>,
    content_type: &str,
) -> Result<(Vec<u8>, String), UploadRefused> {
    if bucket_name == BUCKET_EVENT_IMAGES && data.len() > file_size_limit(bucket_name) {
        let smaller = prepare_rendition(
            &data,
            content_type,
            Some(UPLOADS.event_image_rendition_width_pixels),
        )
        .map_err(|error| UploadRefused::new(format!("{error:#}")))?;
        return validate_and_prepare(bucket_name, smaller, Some(content_type));
    }
    validate_and_prepare(bucket_name, data, Some(content_type))
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
        let (prepared, content_type) =
            validate_and_prepare(BUCKET_EVENT_VIDEOS, data, Some("video/mp4"))?;
        shared()?
            .upload(BUCKET_EVENT_VIDEOS, prepared, &content_type)
            .await
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

/// An S3 client whose requests never leave the process: each is recorded
/// and answered `200`, for tests of what would be stored.
#[cfg(test)]
pub mod recording {
    use std::sync::{Arc, Mutex};

    use aws_sdk_s3::config::http::{HttpRequest, HttpResponse};
    use aws_sdk_s3::config::{Credentials, HttpClient, Region, RuntimeComponents};
    use aws_smithy_runtime_api::client::http::{
        HttpConnector, HttpConnectorFuture, HttpConnectorSettings, SharedHttpConnector,
    };
    use aws_smithy_runtime_api::shared::IntoShared;
    use aws_smithy_types::body::SdkBody;

    /// One request as S3 would have received it.
    #[derive(Debug, Clone)]
    pub struct Recorded {
        pub method: String,
        pub uri: String,
        pub headers: Vec<(String, String)>,
        pub body: Vec<u8>,
    }

    /// Where the recording client sends its path-style requests.
    const ENDPOINT: &str = "https://storage.example.test";

    impl Recorded {
        /// The object key the request names (`<endpoint>/<bucket>/<key>`).
        pub fn key(&self) -> &str {
            let path = self.uri.split('?').next().unwrap_or_default();
            path.strip_prefix(ENDPOINT)
                .and_then(|path| path.trim_start_matches('/').split_once('/'))
                .map_or("", |(_, key)| key)
        }

        pub fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.as_str())
        }
    }

    #[derive(Debug, Clone, Default)]
    pub struct Recorder(pub Arc<Mutex<Vec<Recorded>>>);

    impl HttpConnector for Recorder {
        fn call(&self, request: HttpRequest) -> HttpConnectorFuture {
            let recorded = Recorded {
                method: request.method().to_owned(),
                uri: request.uri().to_owned(),
                headers: request
                    .headers()
                    .iter()
                    .map(|(name, value)| (name.to_owned(), value.to_owned()))
                    .collect(),
                body: request.body().bytes().unwrap_or_default().to_vec(),
            };
            self.0.lock().unwrap().push(recorded);
            HttpConnectorFuture::ready(Ok(HttpResponse::new(
                200.try_into().unwrap(),
                SdkBody::empty(),
            )))
        }
    }

    impl HttpClient for Recorder {
        fn http_connector(
            &self,
            _settings: &HttpConnectorSettings,
            _components: &RuntimeComponents,
        ) -> SharedHttpConnector {
            self.clone().into_shared()
        }
    }

    /// A storage that records instead of uploading, and what it recorded.
    pub fn storage(bucket_name: &str, public_base_url: &str) -> (super::Storage, Recorder) {
        let recorder = Recorder::default();
        let config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            .region(Region::new("auto"))
            .endpoint_url(ENDPOINT)
            .force_path_style(true)
            .credentials_provider(Credentials::new("test", "test", None, None, "test"))
            .http_client(recorder.clone())
            .build();
        (
            super::Storage::with_client(
                aws_sdk_s3::Client::from_conf(config),
                bucket_name,
                public_base_url,
            ),
            recorder,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::new_rgb8(width, height);
        let mut out = Vec::new();
        image.write_to(&mut Cursor::new(&mut out), format).unwrap();
        out
    }

    fn jpeg(width: u32, height: u32) -> Vec<u8> {
        encoded(width, height, ImageFormat::Jpeg)
    }

    fn refused(result: Result<(Vec<u8>, String), UploadRefused>) -> UploadRefused {
        result.expect_err("refused")
    }

    #[test]
    fn posters_are_scaled_to_the_rendition_width() {
        // test_event_posters_are_stored_at_the_rendition_width
        let (prepared, content_type) =
            validate_and_prepare(BUCKET_EVENT_IMAGES, jpeg(2160, 1080), Some("image/jpeg"))
                .unwrap();
        let decoded = image::load_from_memory(&prepared).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1080, 540));
        assert_eq!(content_type, "image/jpeg");
    }

    #[test]
    fn narrow_posters_and_other_buckets_keep_their_size() {
        // test_a_poster_narrower_than_the_rendition_width_is_left_alone
        let (prepared, _) =
            validate_and_prepare(BUCKET_EVENT_IMAGES, jpeg(320, 240), Some("image/jpeg")).unwrap();
        let decoded = image::load_from_memory(&prepared).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (320, 240));
        let (logo, _) =
            validate_and_prepare(BUCKET_CLUB_LOGOS, jpeg(2400, 320), Some("image/jpeg")).unwrap();
        assert_eq!(image::load_from_memory(&logo).unwrap().width(), 2400);
    }

    #[test]
    fn a_resized_image_is_saved_in_the_declared_format() {
        // Pillow's resized image has no format: a wide PNG declared as JPEG becomes a JPEG.
        let (prepared, _) = validate_and_prepare(
            BUCKET_EVENT_IMAGES,
            encoded(2000, 10, ImageFormat::Png),
            Some("image/jpeg"),
        )
        .unwrap();
        assert_eq!(image::guess_format(&prepared).unwrap(), ImageFormat::Jpeg);
        // Unresized, it keeps the format its bytes are in.
        let (kept, _) = validate_and_prepare(
            BUCKET_EVENT_IMAGES,
            encoded(20, 10, ImageFormat::Png),
            Some("image/jpeg"),
        )
        .unwrap();
        assert_eq!(image::guess_format(&kept).unwrap(), ImageFormat::Png);
    }

    #[test]
    fn heights_round_half_to_even_like_python() {
        // 2160 x 1 scaled to 1080 wide is 0.5 high, and 2160 x 5 is 2.5.
        let (prepared, _) = validate_and_prepare(
            BUCKET_EVENT_IMAGES,
            encoded(2160, 1, ImageFormat::Png),
            Some("image/png"),
        )
        .unwrap();
        // 0.5 rounds to 0, then the height is kept at least 1.
        assert_eq!(image::load_from_memory(&prepared).unwrap().height(), 1);
        let (prepared, _) = validate_and_prepare(
            BUCKET_EVENT_IMAGES,
            encoded(2160, 5, ImageFormat::Png),
            Some("image/png"),
        )
        .unwrap();
        // 2.5 rounds to 2.
        assert_eq!(image::load_from_memory(&prepared).unwrap().height(), 2);
    }

    #[test]
    fn exif_is_stripped() {
        // test_validate_and_prepare_strips_exif_directly: an APP1 block with
        // a recognisable value does not survive the re-encode.
        let mut source = jpeg(4, 4);
        let exif = b"Exif\x00\x00MM\x00*\x00\x00\x00\x08\x00\x01\x01\x0f\x00\x02\x00\x00\x00\x06\x00\x00\x00\x1a\x00\x00\x00\x00LEAKED";
        let mut segment = vec![0xFF, 0xE1];
        segment.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        segment.extend_from_slice(exif);
        source.splice(2..2, segment);
        assert!(source.windows(6).any(|window| window == b"LEAKED"));
        let (cleaned, content_type) =
            validate_and_prepare(BUCKET_AVATARS, source, Some("image/jpeg")).unwrap();
        assert_eq!(content_type, "image/jpeg");
        assert!(!cleaned.windows(6).any(|window| window == b"LEAKED"));
    }

    #[test]
    fn refusals_carry_pythons_messages() {
        assert_eq!(
            refused(validate_and_prepare(
                BUCKET_QR_ASSETS,
                b"hello".to_vec(),
                Some("text/plain")
            )),
            UploadRefused::new(
                "File type text/plain not allowed. Accepted: image/jpeg, image/png, image/webp, image/svg+xml"
            )
        );
        assert_eq!(
            refused(validate_and_prepare(BUCKET_QR_ASSETS, b"x".to_vec(), None)).detail,
            "Missing content type"
        );
        assert_eq!(
            refused(validate_and_prepare(
                BUCKET_QR_ASSETS,
                b"x".to_vec(),
                Some("")
            ))
            .detail,
            "Missing content type"
        );
        assert_eq!(
            refused(validate_and_prepare(
                "unknown",
                b"x".to_vec(),
                Some("image/png")
            ))
            .detail,
            "File type image/png not allowed. Accepted: "
        );
        let big = refused(validate_and_prepare(
            BUCKET_AVATARS,
            vec![0; MAX_AVATAR_SIZE_BYTES + 1],
            Some("image/png"),
        ));
        assert_eq!(big.detail, "File too large. Max 2 MB.");
        assert!(big.too_large);
        // The type is checked before the size.
        assert!(
            !refused(validate_and_prepare(
                BUCKET_AVATARS,
                vec![0; MAX_AVATAR_SIZE_BYTES + 1],
                Some("text/plain")
            ))
            .too_large
        );
        assert_eq!(
            refused(validate_and_prepare(
                BUCKET_QR_ASSETS,
                Vec::new(),
                Some("image/png")
            ))
            .detail,
            "Uploaded file could not be decoded as a valid image."
        );
        assert_eq!(
            refused(validate_and_prepare(
                BUCKET_EVENT_VIDEOS,
                b"<html>no video</html>".to_vec(),
                Some("video/mp4")
            ))
            .detail,
            "Uploaded file is not an MP4 video."
        );
    }

    #[test]
    fn svgs_are_sanitized_whatever_type_was_declared() {
        let malicious = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert('xss')</script><rect width=\"50\" height=\"50\"/></svg>";
        for declared in ["image/svg+xml", "image/png"] {
            let (clean, content_type) =
                validate_and_prepare(BUCKET_QR_ASSETS, malicious.to_vec(), Some(declared)).unwrap();
            assert_eq!(content_type, "image/svg+xml");
            let text = String::from_utf8(clean).unwrap();
            assert!(!text.contains("<script") && !text.contains("alert"));
            assert!(text.contains("<rect"));
        }
        // test_svg_disguised_as_png_blocked_on_non_svg_bucket
        let error = refused(validate_and_prepare(
            BUCKET_EVENT_IMAGES,
            malicious.to_vec(),
            Some("image/png"),
        ));
        assert_eq!(
            error.detail,
            "SVG content detected but SVG uploads are not allowed for this resource."
        );
        // test_upload_svg_rejects_invalid_xml / non_svg_root
        let error = refused(validate_and_prepare(
            BUCKET_QR_ASSETS,
            b"not xml at all".to_vec(),
            Some("image/svg+xml"),
        ));
        assert_eq!(
            error.detail,
            "File declared as SVG but content is not valid SVG."
        );
        let error = refused(validate_and_prepare(
            BUCKET_QR_ASSETS,
            b"<html><body>hi</body></html>".to_vec(),
            Some("image/svg+xml"),
        ));
        assert!(error.detail.contains("SVG"), "{error}");
    }

    #[test]
    fn mp4_needs_its_container_box() {
        // test_video_storage_validates_container_and_retains_mp4_content_type
        let data = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42".to_vec();
        let (prepared, content_type) =
            validate_and_prepare(BUCKET_EVENT_VIDEOS, data.clone(), Some("video/mp4")).unwrap();
        assert_eq!((prepared, content_type.as_str()), (data, "video/mp4"));
    }

    #[test]
    fn bucket_rules_match_the_python_service() {
        // test_upload_contract_matches_event_image_bucket
        assert_eq!(
            allowed_mime_types(BUCKET_EVENT_IMAGES),
            ["image/jpeg", "image/png", "image/webp", "image/gif"]
        );
        assert_eq!(file_size_limit(BUCKET_EVENT_IMAGES), 5 * 1024 * 1024);
        assert_eq!(file_size_limit(BUCKET_AVATARS), 2 * 1024 * 1024);
        assert_eq!(file_size_limit(BUCKET_CLUB_LOGOS), 2 * 1024 * 1024);
        assert_eq!(file_size_limit(BUCKET_QR_ASSETS), 5 * 1024 * 1024);
        assert_eq!(file_size_limit(BUCKET_CLAIM_PROOFS), 5 * 1024 * 1024);
        assert_eq!(file_size_limit("unknown"), MAX_IMAGE_SIZE_BYTES);
        assert_eq!(
            allowed_mime_types(BUCKET_CLAIM_PROOFS),
            ["image/jpeg", "image/png", "image/webp"]
        );
    }

    #[test]
    fn storage_paths_never_leave_the_bucket() {
        for (path, safe) in [
            ("abc123.png", true),
            ("a/b.png", true),
            ("./a.png", true),
            ("", false),
            ("   ", false),
            ("/etc/passwd", false),
            ("\\x", false),
            ("../shared.png", false),
            ("a/../b", false),
            ("a\\..\\b", false),
            ("..foo", false),
            ("./..foo", false),
        ] {
            assert_eq!(is_safe_storage_path(path), safe, "{path:?}");
        }
    }

    #[test]
    fn urls_map_back_to_paths_only_inside_the_bucket() {
        // test_path_from_url_rejects_traversal
        let (storage, _) = recording::storage("wat2do-test-assets", "https://wat2do.io/media");
        assert_eq!(
            storage.path_from_url(
                "https://wat2do.io/media/event-images/abc123.png",
                "event-images"
            ),
            Some("abc123.png".to_owned())
        );
        for url in [
            "https://wat2do.io/media/event-images/../shared.png",
            "https://wat2do.io/media/event-images//etc/passwd",
            "http://wat2do.io/media/event-images/a.png",
            "https://evil.io/media/event-images/a.png",
            "https://wat2do.io/media/avatars/a.png",
            "https://wat2do.io/event-images/a.png",
        ] {
            assert_eq!(storage.path_from_url(url, "event-images"), None, "{url}");
        }
        // urlparse keeps `;params` out of the path.
        assert_eq!(
            storage.path_from_url("https://wat2do.io/media/avatars/a.png;x", "avatars"),
            Some("a.png".to_owned())
        );
        let (unconfigured, _) = recording::storage("bucket", "");
        assert_eq!(
            unconfigured.path_from_url("https://wat2do.io/media/avatars/a.png", "avatars"),
            None
        );
    }

    fn key_of(request: &recording::Recorded) -> &str {
        assert!(
            request.uri.contains("/wat2do-test-media/"),
            "{}",
            request.uri
        );
        request.key()
    }

    #[tokio::test]
    async fn uploads_are_immutable_objects_at_their_public_url() {
        // test_upload_file_writes_an_immutable_s3_object_at_its_public_url
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io/");
        let url = storage
            .upload("avatars", b"image-bytes".to_vec(), "image/png")
            .await
            .unwrap();
        assert!(url.starts_with("https://media.wat2do.io/avatars/"));
        assert!(url.ends_with(".png"));
        let put = recorder.0.lock().unwrap()[0].clone();
        assert_eq!(put.method, "PUT");
        // The key is the public URL's path below STORAGE_PUBLIC_BASE_URL.
        assert_eq!(url, format!("https://media.wat2do.io/{}", key_of(&put)));
        assert_eq!(put.body, b"image-bytes");
        assert_eq!(put.header("content-type"), Some("image/png"));
        assert_eq!(
            put.header("cache-control"),
            Some("public, max-age=31536000, immutable")
        );
        assert_eq!(put.header("x-amz-server-side-encryption"), None);
        assert_eq!(put.header("content-disposition"), None);
        // test_upload_svg_sets_content_disposition_attachment
        storage
            .upload("qr-assets", b"<svg/>".to_vec(), "image/svg+xml")
            .await
            .unwrap();
        let svg = recorder.0.lock().unwrap()[1].clone();
        assert_eq!(svg.header("content-disposition"), Some("attachment"));
        let key = key_of(&svg);
        assert!(
            key.starts_with("qr-assets/") && key.ends_with(".svg"),
            "{key}"
        );
        // test_video_storage_...: no attachment for video, and its own extension.
        let video = storage
            .upload("event-videos", b"v".to_vec(), "video/mp4")
            .await
            .unwrap();
        assert!(video.ends_with(".mp4"));
        // test_storage_refuses_paths_outside_their_bucket
        assert!(
            storage
                .upload("..", b"x".to_vec(), "image/png")
                .await
                .is_err()
        );
        assert!(
            storage
                .upload("unknown", b"x".to_vec(), "image/png")
                .await
                .is_err()
        );
        assert_eq!(recorder.0.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn an_event_image_is_stored_after_its_thumbnail() {
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io");
        let url = storage
            .upload(BUCKET_EVENT_IMAGES, jpeg(1080, 1350), "image/jpeg")
            .await
            .unwrap();
        let requests = recorder.0.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        let poster = key_of(&requests[1]);
        assert_eq!(url, format!("https://media.wat2do.io/{poster}"));
        assert_eq!(key_of(&requests[0]), thumbnail_key(poster));
        assert_eq!(requests[0].header("content-type"), Some("image/webp"));
        let thumbnail = image::load_from_memory(&requests[0].body).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (640, 800));
        // Bytes that are no image store nothing.
        assert!(
            storage
                .upload(BUCKET_EVENT_IMAGES, b"not an image".to_vec(), "image/jpeg")
                .await
                .is_err()
        );
        assert_eq!(recorder.0.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn deletes_touch_only_the_expected_keys() {
        // test_delete_file_deletes_only_the_expected_s3_key
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io");
        storage.delete_file("avatars", "abc123.jpg").await.unwrap();
        // test_storage_refuses_paths_outside_their_bucket
        for (bucket, path) in [
            ("avatars", "../secret.jpg"),
            ("avatars", "/etc/passwd"),
            ("..", "secret.jpg"),
            ("unknown", "image.jpg"),
        ] {
            storage.delete_file(bucket, path).await.unwrap();
        }
        let requests = recorder.0.lock().unwrap().clone();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "DELETE");
        assert_eq!(key_of(&requests[0]), "avatars/abc123.jpg");
        // An event image and a raster club logo go with their thumbnails; an
        // SVG logo has none.
        storage
            .delete_file(BUCKET_EVENT_IMAGES, "abc.jpg")
            .await
            .unwrap();
        storage
            .delete_file(BUCKET_CLUB_LOGOS, "logo.png")
            .await
            .unwrap();
        storage
            .delete_file(BUCKET_CLUB_LOGOS, "vector.svg")
            .await
            .unwrap();
        let requests = recorder.0.lock().unwrap().clone();
        assert!(requests.iter().all(|request| request.method == "DELETE"));
        let deleted: Vec<_> = requests[1..].iter().map(key_of).collect();
        assert_eq!(
            deleted,
            [
                "event-images/abc.jpg",
                "event-images/abc.thumb.webp",
                "organization-logos/logo.png",
                "organization-logos/logo.thumb.webp",
                "organization-logos/vector.svg",
            ]
        );
        let (unconfigured, _) = recording::storage("", "https://media.wat2do.io");
        assert!(unconfigured.delete_file("avatars", "a.jpg").await.is_err());
        assert!(
            unconfigured
                .upload("avatars", b"x".to_vec(), "image/png")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn the_client_needs_its_own_endpoint_and_keys() {
        // test_storage_client_uses_its_own_endpoint_and_keys
        let storage = Storage {
            bucket_name: "media".into(),
            public_base_url: "https://media.wat2do.io".into(),
            endpoint_url: "https://account.r2.cloudflarestorage.com".into(),
            access_key_id: "storage-key".into(),
            secret_access_key: String::new(),
            client: OnceCell::new(),
        };
        let error = storage
            .upload("avatars", b"x".to_vec(), "image/png")
            .await
            .unwrap_err();
        assert!(
            format!("{error:#}").contains("STORAGE_SECRET_ACCESS_KEY"),
            "{error:#}"
        );
    }

    #[test]
    fn thumbnails_are_small_webps_named_like_pythons() {
        assert_eq!(
            thumbnail_key("event-images/abc.jpg"),
            "event-images/abc.thumb.webp"
        );
        assert_eq!(
            thumbnail_key("event-images/abc.webp"),
            "event-images/abc.thumb.webp"
        );
        assert_eq!(
            thumbnail_key("organization-logos/abc.png"),
            "organization-logos/abc.thumb.webp"
        );
        let thumbnail = Thumbnail::EventImage.make(&jpeg(1080, 1350)).unwrap();
        assert_eq!(image::guess_format(&thumbnail).unwrap(), ImageFormat::WebP);
        let decoded = image::load_from_memory(&thumbnail).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (640, 800));
        let small =
            image::load_from_memory(&Thumbnail::EventImage.make(&jpeg(200, 100)).unwrap()).unwrap();
        assert_eq!((small.width(), small.height()), (200, 100));
    }

    #[test]
    fn only_posters_and_raster_logos_have_thumbnails() {
        assert_eq!(
            Thumbnail::of(BUCKET_EVENT_IMAGES, "abc.jpg"),
            Some(Thumbnail::EventImage)
        );
        for path in ["abc.jpg", "abc.png", "abc.webp"] {
            assert_eq!(
                Thumbnail::of(BUCKET_CLUB_LOGOS, path),
                Some(Thumbnail::ClubLogo),
                "{path}"
            );
        }
        for (bucket, path) in [
            (BUCKET_CLUB_LOGOS, "abc.svg"),
            (BUCKET_CLUB_LOGOS, "abc.SVG"),
            (BUCKET_AVATARS, "abc.jpg"),
            (BUCKET_QR_ASSETS, "abc.png"),
            (BUCKET_EVENT_VIDEOS, "abc.mp4"),
        ] {
            assert_eq!(Thumbnail::of(bucket, path), None, "{bucket}/{path}");
        }
    }

    #[test]
    fn logo_thumbnails_fit_their_longest_side_and_keep_transparency() {
        // Python's scale_to_fit gives the same sizes.
        for ((width, height), fitted) in [
            ((1080, 1080), (144, 144)),
            ((1080, 540), (144, 72)),
            ((600, 1200), (72, 144)),
            ((100, 50), (100, 50)),
            ((50, 100), (50, 100)),
        ] {
            let image = encoded(width, height, ImageFormat::Png);
            let thumbnail = Thumbnail::ClubLogo.make(&image).unwrap();
            assert_eq!(image::guess_format(&thumbnail).unwrap(), ImageFormat::WebP);
            let decoded = image::load_from_memory(&thumbnail).unwrap();
            assert_eq!((decoded.width(), decoded.height()), fitted);
        }
        let mut clear = Vec::new();
        DynamicImage::new_rgba8(320, 320)
            .write_to(&mut Cursor::new(&mut clear), ImageFormat::Png)
            .unwrap();
        let thumbnail =
            image::load_from_memory(&Thumbnail::ClubLogo.make(&clear).unwrap()).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (144, 144));
        assert!(thumbnail.color().has_alpha());
        assert!(Thumbnail::ClubLogo.make(b"not an image").is_err());
    }

    #[tokio::test]
    async fn an_uploaded_raster_logo_is_stored_after_its_thumbnail() {
        // What `/uploads/club-logo/{club_id}` stores (`uploads::replace`).
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io");
        let url = storage
            .upload(
                BUCKET_CLUB_LOGOS,
                encoded(1080, 1080, ImageFormat::Png),
                "image/png",
            )
            .await
            .unwrap();
        let requests = recorder.0.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        let logo = key_of(&requests[1]);
        assert!(
            logo.starts_with("organization-logos/") && logo.ends_with(".png"),
            "{logo}"
        );
        assert_eq!(url, format!("https://media.wat2do.io/{logo}"));
        assert_eq!(key_of(&requests[0]), thumbnail_key(logo));
        assert_eq!(requests[0].header("content-type"), Some("image/webp"));
        assert_eq!(
            requests[0].header("cache-control"),
            Some("public, max-age=31536000, immutable")
        );
        let thumbnail = image::load_from_memory(&requests[0].body).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (144, 144));
        // An SVG logo is stored alone.
        storage
            .upload(BUCKET_CLUB_LOGOS, b"<svg/>".to_vec(), "image/svg+xml")
            .await
            .unwrap();
        let requests = recorder.0.lock().unwrap().clone();
        assert_eq!(requests.len(), 3);
        assert!(key_of(&requests[2]).ends_with(".svg"));
    }

    #[tokio::test]
    async fn an_instagram_profile_picture_is_stored_as_a_logo_after_its_thumbnail() {
        // What the ingestion processor's club logo lane stores (`club_logos.rs`).
        let (storage, recorder) =
            recording::storage("wat2do-test-media", "https://media.wat2do.io");
        let url = storage
            .store_image(jpeg(320, 320), "image/jpeg", BUCKET_CLUB_LOGOS)
            .await
            .unwrap();
        let requests = recorder.0.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        let logo = key_of(&requests[1]);
        assert_eq!(url, format!("https://media.wat2do.io/{logo}"));
        assert!(logo.ends_with(".jpg"), "{logo}");
        assert_eq!(key_of(&requests[0]), thumbnail_key(logo));
        assert_eq!(requests[0].header("content-type"), Some("image/webp"));
        let thumbnail = image::load_from_memory(&requests[0].body).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (144, 144));
        // Bytes that are no image store nothing.
        assert_eq!(
            storage
                .store_image(b"not an image".to_vec(), "image/jpeg", BUCKET_CLUB_LOGOS)
                .await,
            None
        );
        assert_eq!(recorder.0.lock().unwrap().len(), 2);
    }

    #[test]
    fn an_animated_gifs_thumbnail_is_its_first_frame() {
        use image::{Delay, Frame, Rgba, RgbaImage};
        let frames = [Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255])].map(|color| {
            Frame::from_parts(
                RgbaImage::from_pixel(800, 400, color),
                0,
                0,
                Delay::from_numer_denom_ms(100, 1),
            )
        });
        let mut gif = Vec::new();
        let mut encoder = GifEncoder::new(&mut gif);
        encoder.encode_frames(frames).unwrap();
        drop(encoder);
        let thumbnail =
            image::load_from_memory(&Thumbnail::EventImage.make(&gif).unwrap()).unwrap();
        assert_eq!(thumbnail.width(), 640);
        let pixel = thumbnail.to_rgb8().get_pixel(10, 10).0;
        assert!(pixel[0] > 200 && pixel[2] < 50);
    }
}
