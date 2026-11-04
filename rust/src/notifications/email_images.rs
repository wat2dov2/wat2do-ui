//! Posters re-encoded as small JPEGs and carried inside notification emails
//! (`services/notifications/email_images.py`).
//!
//! Outlook blocks remote images from unfamiliar senders and cannot show WebP,
//! so every poster is downloaded, resized and embedded as a JPEG. Any failure
//! returns None and the caller links the original URL instead.
//!
//! Resizing reproduces Pillow's Lanczos resampling (`Image.resize` with a crop
//! box, as `ImageOps.fit` calls it) in the same fixed-point arithmetic, so the
//! pixels match what the Python service embedded; the JPEG is encoded like
//! Pillow's (`quality`, 4:2:0 averaged chroma, one interleaved baseline scan),
//! with the standard Huffman tables rather than Pillow's optimized ones.

use std::io::Cursor;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use image::{DynamicImage, ImageDecoder, ImageReader, RgbImage};

use crate::controlbox::EMAIL_DELIVERY;
use crate::email::InlineImage;

/// Redirects followed per download, as httpx follows them.
const MAX_REDIRECTS: usize = 20;

static CLIENT: LazyLock<wreq::Client> = LazyLock::new(|| {
    let timeout = Duration::from_secs_f64(EMAIL_DELIVERY.image_timeout_seconds);
    wreq::Client::builder()
        .connect_timeout(timeout)
        .read_timeout(timeout)
        .redirect(wreq::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .expect("static HTTP client configuration")
});

/// Download `url` and return it as an embeddable JPEG, or None to link it instead.
///
/// `square` center-crops like the app's event grid; otherwise the poster keeps
/// its shape and is only narrowed to `width`.
pub async fn email_image(
    url: Option<&str>,
    content_id: &str,
    width: u32,
    square: bool,
) -> Option<Arc<InlineImage>> {
    let url = url.filter(|url| !url.is_empty())?;
    let prepared = async {
        let data = download(url).await?;
        let quality = EMAIL_DELIVERY.image_quality;
        tokio::task::spawn_blocking(move || prepare(&data, width, square, quality)).await?
    };
    match prepared.await {
        Ok(content) => Some(Arc::new(InlineImage {
            content_id: content_id.to_owned(),
            filename: format!("{content_id}.jpg"),
            content_type: "image/jpeg".to_owned(),
            content,
        })),
        Err(error) => {
            tracing::warn!("Could not prepare image for embedding: {url} ({error:#})");
            None
        }
    }
}

/// The full-width poster at the top of single-event emails.
pub async fn event_hero_image(url: Option<&str>) -> Option<Arc<InlineImage>> {
    email_image(url, "event-image", EMAIL_DELIVERY.hero_image_px, false).await
}

async fn download(url: &str) -> Result<Vec<u8>> {
    let response = CLIENT.get(url).send().await?.error_for_status()?;
    let mut data = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        data.extend_from_slice(&chunk?);
        if data.len() > EMAIL_DELIVERY.image_max_bytes {
            bail!(
                "image is larger than {} bytes",
                EMAIL_DELIVERY.image_max_bytes
            );
        }
    }
    Ok(data)
}

/// Decode, upright by EXIF orientation, fit or narrow, and encode as JPEG.
fn prepare(data: &[u8], width: u32, square: bool, quality: u8) -> Result<Vec<u8>> {
    let mut decoder = ImageReader::new(Cursor::new(data))
        .with_guessed_format()?
        .into_decoder()
        .context("unsupported image")?;
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    let image = image.to_rgb8();
    let (source_width, source_height) = image.dimensions();
    let image = if square {
        let (left, top, crop_width, crop_height) = fit_box(source_width, source_height);
        resample(
            &image,
            width,
            width,
            [left, top, left + crop_width, top + crop_height],
        )
    } else if source_width > width {
        let height = ((f64::from(source_height) * f64::from(width) / f64::from(source_width))
            .round_ties_even() as u32)
            .max(1);
        resample(
            &image,
            width,
            height,
            [0.0, 0.0, source_width as f32, source_height as f32],
        )
    } else {
        image
    };
    encode_jpeg(&image, quality)
}

/// `ImageOps.fit(image, (n, n))`'s centered square crop box: left, top, width, height.
fn fit_box(width: u32, height: u32) -> (f32, f32, f32, f32) {
    let (width, height) = (f64::from(width), f64::from(height));
    let (crop_width, crop_height) = if width / height >= 1.0 {
        (height, height)
    } else {
        (width, width)
    };
    (
        ((width - crop_width) * 0.5) as f32,
        ((height - crop_height) * 0.5) as f32,
        crop_width as f32,
        crop_height as f32,
    )
}

fn encode_jpeg(image: &RgbImage, quality: u8) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, quality);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_2_2);
    encoder.set_chroma_subsampling_method(jpeg_encoder::ChromaSubsamplingMethod::Average);
    // Optimized tables would make the encoder write one scan per component,
    // which some decoders misread; one interleaved scan with the standard tables
    // is what every decoder handles.
    let (width, height) = image.dimensions();
    encoder.encode(
        image.as_raw(),
        u16::try_from(width)?,
        u16::try_from(height)?,
        jpeg_encoder::ColorType::Rgb,
    )?;
    number_components_from_one(&mut out)?;
    Ok(out)
}

/// JFIF numbers the Y, Cb and Cr components 1, 2 and 3, as libjpeg writes them;
/// the encoder numbers them from 0, which some decoders misread. The ids appear
/// only in the frame header and the scan header before the image data.
fn number_components_from_one(jpeg: &mut [u8]) -> Result<()> {
    let mut at = 2;
    loop {
        let (Some(&0xFF), Some(&marker)) = (jpeg.get(at), jpeg.get(at + 1)) else {
            bail!("unexpected JPEG layout");
        };
        let length = usize::from(u16::from_be_bytes([jpeg[at + 2], jpeg[at + 3]]));
        let body = at + 4;
        match marker {
            // Baseline frame header: precision, height, width, count, then 3 bytes per component.
            0xC0 => {
                for component in 0..usize::from(jpeg[body + 5]) {
                    jpeg[body + 6 + component * 3] += 1;
                }
            }
            // Scan header: count, then 2 bytes per component; the image data follows.
            0xDA => {
                for component in 0..usize::from(jpeg[body]) {
                    jpeg[body + 1 + component * 2] += 1;
                }
                return Ok(());
            }
            _ => {}
        }
        at += 2 + length;
    }
}

// Pillow's Resample.c: Lanczos-3 coefficients normalized to 22-bit fixed point.
const PRECISION_BITS: u32 = 32 - 8 - 2;
const LANCZOS_SUPPORT: f64 = 3.0;

fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        return 1.0;
    }
    let x = x * std::f64::consts::PI;
    x.sin() / x
}

fn lanczos(x: f64) -> f64 {
    if (-LANCZOS_SUPPORT..LANCZOS_SUPPORT).contains(&x) {
        sinc(x) * sinc(x / 3.0)
    } else {
        0.0
    }
}

/// One output pixel's first input pixel, its input pixel count and fixed-point weights.
struct Coefficients {
    bounds: Vec<(usize, usize)>,
    weights: Vec<Vec<i32>>,
}

/// `precompute_coeffs` + `normalize_coeffs_8bpc`.
fn coefficients(in_size: u32, in0: f32, in1: f32, out_size: u32) -> Coefficients {
    let scale = f64::from(in1 - in0) / f64::from(out_size);
    let filter_scale = scale.max(1.0);
    let support = LANCZOS_SUPPORT * filter_scale;
    let mut bounds = Vec::with_capacity(out_size as usize);
    let mut weights = Vec::with_capacity(out_size as usize);
    for xx in 0..out_size {
        let center = f64::from(in0) + (f64::from(xx) + 0.5) * scale;
        // C truncates toward zero, then clamps.
        let xmin = ((center - support + 0.5) as i64).max(0);
        let xmax = ((center + support + 0.5) as i64).min(i64::from(in_size)) - xmin;
        let mut row: Vec<f64> = (0..xmax.max(0))
            .map(|x| lanczos(((x + xmin) as f64 - center + 0.5) / filter_scale))
            .collect();
        let total: f64 = row.iter().sum();
        if total != 0.0 {
            for weight in &mut row {
                *weight /= total;
            }
        }
        weights.push(
            row.into_iter()
                .map(|weight| {
                    let scaled = weight * f64::from(1_u32 << PRECISION_BITS);
                    (if weight < 0.0 {
                        scaled - 0.5
                    } else {
                        scaled + 0.5
                    }) as i32
                })
                .collect(),
        );
        bounds.push((xmin as usize, xmax.max(0) as usize));
    }
    Coefficients { bounds, weights }
}

fn clip8(value: i32) -> u8 {
    if value >= (1 << PRECISION_BITS << 8) {
        255
    } else if value <= 0 {
        0
    } else {
        (value >> PRECISION_BITS) as u8
    }
}

fn convolve(pixels: impl Iterator<Item = [u8; 3]>, weights: &[i32]) -> [u8; 3] {
    let mut sums = [1_i32 << (PRECISION_BITS - 1); 3];
    for (pixel, weight) in pixels.zip(weights) {
        for (sum, channel) in sums.iter_mut().zip(pixel) {
            *sum += i32::from(channel) * weight;
        }
    }
    sums.map(clip8)
}

/// `Image.resize((width, height), LANCZOS, box)` for an RGB image.
fn resample(image: &RgbImage, width: u32, height: u32, area: [f32; 4]) -> RgbImage {
    let (in_width, in_height) = image.dimensions();
    let need_horizontal = width != in_width || area[0] != 0.0 || area[2] != width as f32;
    let need_vertical = height != in_height || area[1] != 0.0 || area[3] != height as f32;
    let horizontal = coefficients(in_width, area[0], area[2], width);
    let mut vertical = coefficients(in_height, area[1], area[3], height);

    let mut source = std::borrow::Cow::Borrowed(image);
    if need_horizontal {
        // Only the rows the vertical pass reads.
        let first_row = vertical.bounds.first().map_or(0, |bound| bound.0);
        let last_row = vertical
            .bounds
            .last()
            .map_or(0, |(start, count)| start + count);
        for bound in &mut vertical.bounds {
            bound.0 -= first_row;
        }
        let rows = (last_row - first_row) as u32;
        let mut narrowed = RgbImage::new(width, rows);
        for y in 0..rows {
            for (x, ((start, count), weights)) in horizontal
                .bounds
                .iter()
                .zip(&horizontal.weights)
                .enumerate()
            {
                let pixels = (*start..start + count)
                    .map(|column| image.get_pixel(column as u32, y + first_row as u32).0);
                narrowed.put_pixel(x as u32, y, image::Rgb(convolve(pixels, weights)));
            }
        }
        source = std::borrow::Cow::Owned(narrowed);
    }
    if !need_vertical {
        return source.into_owned();
    }
    let mut out = RgbImage::new(source.width(), height);
    for (y, ((start, count), weights)) in vertical.bounds.iter().zip(&vertical.weights).enumerate()
    {
        for x in 0..source.width() {
            let pixels = (*start..start + count).map(|row| source.get_pixel(x, row as u32).0);
            out.put_pixel(x, y as u32, image::Rgb(convolve(pixels, weights)));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageFormat;

    fn poster(format: ImageFormat, width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_pixel(width, height, image::Rgb([255, 0, 0]));
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image)
            .write_to(&mut out, format)
            .unwrap();
        out.into_inner()
    }

    fn decoded(jpeg: &[u8]) -> DynamicImage {
        let reader = ImageReader::new(Cursor::new(jpeg))
            .with_guessed_format()
            .unwrap();
        assert_eq!(reader.format(), Some(ImageFormat::Jpeg));
        reader.decode().unwrap()
    }

    #[test]
    fn every_poster_format_becomes_a_square_jpeg() {
        for format in [
            ImageFormat::Jpeg,
            ImageFormat::Png,
            ImageFormat::WebP,
            ImageFormat::Gif,
        ] {
            let jpeg = prepare(&poster(format, 800, 1000), 480, true, 80).unwrap();
            let image = decoded(&jpeg);
            assert_eq!((image.width(), image.height()), (480, 480), "{format:?}");
            let pixel = image.to_rgb8().get_pixel(240, 240).0;
            assert!(
                pixel[0] > 240 && pixel[1] < 15 && pixel[2] < 15,
                "{format:?} {pixel:?}"
            );
        }
    }

    #[test]
    fn flat_posters_keep_their_colour_and_jfif_component_ids() {
        // A single-colour poster is the case decoders get wrong when a JPEG
        // has one scan per component.
        let jpeg = encode_jpeg(&RgbImage::from_pixel(16, 16, image::Rgb([255, 0, 0])), 80).unwrap();
        let pixel = decoded(&jpeg).to_rgb8().get_pixel(8, 8).0;
        assert!(
            pixel[0] > 240 && pixel[1] < 15 && pixel[2] < 15,
            "{pixel:?}"
        );
        let frame = jpeg
            .windows(2)
            .position(|pair| pair == [0xFF, 0xC0])
            .unwrap();
        // Count 3, then ids 1, 2, 3 at three-byte strides.
        assert_eq!(jpeg[frame + 9], 3);
        assert_eq!(
            [jpeg[frame + 10], jpeg[frame + 13], jpeg[frame + 16]],
            [1, 2, 3]
        );
    }

    #[test]
    fn the_hero_keeps_its_shape_and_never_enlarges() {
        let wide =
            decoded(&prepare(&poster(ImageFormat::Png, 2400, 3000), 1200, false, 80).unwrap());
        assert_eq!((wide.width(), wide.height()), (1200, 1500));
        let small =
            decoded(&prepare(&poster(ImageFormat::Png, 300, 200), 1200, false, 80).unwrap());
        assert_eq!((small.width(), small.height()), (300, 200));
    }

    #[test]
    fn unusable_posters_are_refused() {
        assert!(prepare(b"not an image", 480, true, 80).is_err());
    }

    #[tokio::test]
    async fn a_missing_poster_is_linked_instead() {
        assert!(email_image(None, "event-1", 480, true).await.is_none());
        assert!(email_image(Some(""), "event-1", 480, true).await.is_none());
    }

    #[test]
    fn fit_crops_the_center_like_pillow() {
        assert_eq!(fit_box(800, 1000), (0.0, 100.0, 800.0, 800.0));
        assert_eq!(fit_box(1081, 1080), (0.5, 0.0, 1080.0, 1080.0));
        assert_eq!(fit_box(500, 500), (0.0, 0.0, 500.0, 500.0));
    }

    /// A 7x5 gradient fitted to 3x3 and narrowed to 4 wide, from Pillow 12.3:
    /// `ImageOps.fit(image, (3, 3), Image.LANCZOS)` and `image.resize((4, 3), Image.LANCZOS)`.
    #[test]
    fn resampling_matches_pillow_exactly() {
        let source = RgbImage::from_fn(7, 5, |x, y| {
            image::Rgb([
                (x * 37 + y * 11) as u8,
                (255 - x * 29 - y * 7) as u8,
                ((x * y * 13) % 256) as u8,
            ])
        });
        let (left, top, crop_width, crop_height) = fit_box(7, 5);
        let square = resample(
            &source,
            3,
            3,
            [left, top, left + crop_width, top + crop_height],
        );
        assert_eq!(square.into_raw(), PILLOW_FIT_3X3.to_vec());
        let narrowed = resample(&source, 4, 3, [0.0, 0.0, 7.0, 5.0]);
        assert_eq!(narrowed.into_raw(), PILLOW_RESIZE_4X3.to_vec());
    }

    const PILLOW_FIT_3X3: [u8; 27] = [
        48, 219, 5, 115, 166, 13, 181, 113, 17, 66, 207, 31, 132, 154, 76, 202, 101, 136, 84, 195,
        54, 156, 142, 159, 201, 89, 135,
    ];
    const PILLOW_RESIZE_4X3: [u8; 36] = [
        18, 242, 2, 80, 193, 9, 149, 139, 16, 209, 90, 19, 36, 230, 10, 99, 181, 53, 166, 127, 105,
        240, 78, 164, 54, 218, 17, 115, 169, 106, 196, 115, 163, 165, 66, 114,
    ];
}
