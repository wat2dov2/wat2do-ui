//! JSON exactly as FastAPI writes a `response_model`: pydantic-core's
//! `dump_json`, compact, with pydantic's float and datetime formats.
//!
//! serde_json already escapes strings the same way (control characters as
//! `\uXXXX` in lower case, everything else verbatim). Floats differ: pydantic
//! writes plain decimals for exponents -5 to 15 (`0.00001`, `100000.0`) and
//! `1e-6` / `1e+16` outside them, where serde_json writes `1e-5` and `1e16`.
//! Datetimes are written by `PyDateTime`.

use std::io;

use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Timelike, Utc};
use serde::{Serialize, Serializer};

/// serde_json's compact output with pydantic's float format.
#[derive(Clone, Copy, Debug, Default)]
pub struct PydanticFormatter;

impl serde_json::ser::Formatter for PydanticFormatter {
    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        writer.write_all(format_float(value).as_bytes())
    }

    fn write_f32<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f32) -> io::Result<()> {
        self.write_f64(writer, f64::from(value))
    }
}

/// pydantic-core's JSON for a float (`TypeAdapter(float).dump_json`).
pub fn format_float(value: f64) -> String {
    if !value.is_finite() {
        // `ser_json_inf_nan="null"`, pydantic's default.
        return "null".to_owned();
    }
    if value == 0.0 {
        return if value.is_sign_negative() {
            "-0.0"
        } else {
            "0.0"
        }
        .to_owned();
    }
    // Rust's `{:e}` is the shortest round-trip form: "-1.2345e-7".
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific.split_once('e').expect("exponent");
    let exponent: i32 = exponent.parse().expect("integer exponent");
    let (sign, mantissa) = match mantissa.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", mantissa),
    };
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    if (-5..16).contains(&exponent) {
        let point = exponent + 1;
        let body = if point <= 0 {
            format!("0.{}{digits}", "0".repeat((-point) as usize))
        } else if point as usize >= digits.len() {
            format!("{digits}{}.0", "0".repeat(point as usize - digits.len()))
        } else {
            let (whole, fraction) = digits.split_at(point as usize);
            format!("{whole}.{fraction}")
        };
        format!("{sign}{body}")
    } else {
        let exponent_sign = if exponent < 0 { "-" } else { "+" };
        format!("{sign}{mantissa}e{exponent_sign}{}", exponent.abs())
    }
}

/// pydantic's JSON for an aware UTC datetime: `2026-11-02T18:00:00Z`, with
/// six fractional digits only when there are microseconds.
pub fn format_datetime(value: &DateTime<Utc>) -> String {
    let micros = value.nanosecond() / 1_000;
    if micros == 0 {
        value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    } else {
        format!("{}.{micros:06}Z", value.format("%Y-%m-%dT%H:%M:%S"))
    }
}

/// A UTC datetime that serializes as pydantic does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PyDateTime(pub DateTime<Utc>);

impl Serialize for PyDateTime {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format_datetime(&self.0))
    }
}

impl From<DateTime<Utc>> for PyDateTime {
    fn from(value: DateTime<Utc>) -> Self {
        Self(value)
    }
}

/// `value` as FastAPI's response body bytes.
pub fn to_vec<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    let mut out = Vec::with_capacity(256);
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, PydanticFormatter);
    value
        .serialize(&mut serializer)
        .expect("response models always serialize");
    out
}

/// A JSON response body written like FastAPI's, with its status.
pub struct PyJson<T>(pub StatusCode, pub T);

impl<T: Serialize> IntoResponse for PyJson<T> {
    fn into_response(self) -> Response {
        let mut response = (self.0, to_vec(&self.1)).into_response();
        response
            .headers_mut()
            .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        response
    }
}

/// A 200 JSON response.
pub fn ok<T: Serialize>(value: T) -> Response {
    PyJson(StatusCode::OK, value).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn floats_match_pydantic_core() {
        // Generated with pydantic 2.14: [repr(value), TypeAdapter(float).dump_json(value)].
        let corpus: Vec<(String, String)> =
            serde_json::from_str(include_str!("testdata/pydantic_floats.json")).unwrap();
        assert!(corpus.len() > 100);
        for (python_repr, expected) in corpus {
            let value: f64 = python_repr.parse().unwrap();
            assert_eq!(format_float(value), expected, "{python_repr}");
        }
        assert_eq!(format_float(f64::NAN), "null");
        assert_eq!(format_float(f64::INFINITY), "null");
    }

    #[test]
    fn datetimes_match_pydantic() {
        let whole = Utc.with_ymd_and_hms(2026, 11, 2, 18, 0, 0).unwrap();
        assert_eq!(format_datetime(&whole), "2026-11-02T18:00:00Z");
        let fraction = whole + chrono::Duration::microseconds(123_000);
        assert_eq!(format_datetime(&fraction), "2026-11-02T18:00:00.123000Z");
        let micro = whole + chrono::Duration::microseconds(1);
        assert_eq!(format_datetime(&micro), "2026-11-02T18:00:00.000001Z");
    }

    #[test]
    fn strings_escape_like_pydantic() {
        // TypeAdapter(str).dump_json of U+0000..U+0020, DEL, NEL, LS, PS, quote, backslash, slash.
        let text: String = (0u32..=0x20)
            .map(|code| char::from_u32(code).unwrap())
            .chain("\u{7f}\u{85}\u{2028}\u{2029}\"\\/é😀<>&".chars())
            .collect();
        let expected = "\"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f \u{7f}\u{85}\u{2028}\u{2029}\\\"\\\\/é😀<>&\"";
        assert_eq!(String::from_utf8(to_vec(&text)).unwrap(), expected);
    }
}
