//! A ticket's code: the secret printed in its QR code, which holds the link
//! to the ticket's page. Anyone who has the link sees the ticket; a club's
//! members who open it can admit it.

use anyhow::Result;
use image::{GrayImage, ImageFormat, Luma};
use qrcode::{Color, EcLevel, QrCode};

use crate::api::secrets::token_base32;

/// 15 random bytes are 24 base32 characters: unguessable, and easy to type
/// at the door when a phone screen will not scan.
const CODE_BYTES: usize = 15;
/// Pixels per QR module, and modules of white border around the code: large
/// enough for a door scanner to read off a dimmed phone screen.
const QR_SCALE: u32 = 8;
const QR_BORDER: u32 = 2;

pub fn new_code() -> String {
    token_base32(CODE_BYTES)
}

/// The stored form of whatever was scanned or typed: a ticket link (its last
/// path segment) or a code with spaces, dashes or lower-case letters.
pub fn normalize(scanned: &str) -> String {
    let trimmed = scanned.trim().trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    // A link may carry a query (`?refund=1`) or fragment after the code.
    let code = last.split(['?', '#']).next().unwrap_or_default();
    code.chars()
        .filter(|c| !matches!(c, ' ' | '-'))
        .flat_map(char::to_uppercase)
        .collect()
}

/// The page a ticket's QR code opens, on the event's school's site.
pub fn ticket_url(school_frontend_url: &str, code: &str) -> String {
    format!("{school_frontend_url}/tickets/{code}")
}

/// A PNG of the QR code for `url`, black on white.
pub fn qr_png(url: &str) -> Result<Vec<u8>> {
    let code = QrCode::with_error_correction_level(url.as_bytes(), EcLevel::M)?;
    let modules = code.width() as u32;
    let colors = code.to_colors();
    let side = (modules + 2 * QR_BORDER) * QR_SCALE;
    let image = GrayImage::from_fn(side, side, |x, y| {
        let (column, row) = (x / QR_SCALE, y / QR_SCALE);
        let inside = (QR_BORDER..QR_BORDER + modules).contains(&column)
            && (QR_BORDER..QR_BORDER + modules).contains(&row);
        let dark = inside
            && colors[((row - QR_BORDER) * modules + (column - QR_BORDER)) as usize] == Color::Dark;
        Luma([if dark { 0 } else { 255 }])
    });
    let mut png = std::io::Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png)?;
    Ok(png.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_24_unambiguous_characters() {
        let code = new_code();
        assert_eq!(code.len(), 24);
        assert_eq!(normalize(&code), code);
    }

    #[test]
    fn a_scanned_link_or_a_typed_code_reads_as_the_stored_code() {
        let code = "7KQ2MZ4PABCDEFGHIJKLMNOP";
        for scanned in [
            "https://uwaterloo.wat2do.io/tickets/7KQ2MZ4PABCDEFGHIJKLMNOP",
            "https://uwaterloo.wat2do.io/tickets/7KQ2MZ4PABCDEFGHIJKLMNOP/",
            "https://uwaterloo.wat2do.io/tickets/7KQ2MZ4PABCDEFGHIJKLMNOP?refund=1",
            " 7kq2 mz4p abcd efgh ijkl mnop ",
            "7KQ2-MZ4P-ABCD-EFGH-IJKL-MNOP",
        ] {
            assert_eq!(normalize(scanned), code, "{scanned}");
        }
    }

    #[test]
    fn the_qr_code_is_a_square_png_with_a_white_border() {
        let png = qr_png("https://uwaterloo.wat2do.io/tickets/7KQ2MZ4PABCDEFGHIJKLMNOP").unwrap();
        let image = image::load_from_memory_with_format(&png, ImageFormat::Png)
            .unwrap()
            .to_luma8();
        assert_eq!(image.width(), image.height());
        assert_eq!(image.width() % QR_SCALE, 0);
        // The border is white and the finder pattern's corner just inside it is black.
        assert_eq!(image.get_pixel(0, 0).0, [255]);
        let corner = QR_BORDER * QR_SCALE;
        assert_eq!(image.get_pixel(corner, corner).0, [0]);
    }
}
