//! JSON exactly as FastAPI writes it: pydantic's datetime, date and float
//! formats for routes with a `response_model` (every ported route so far),
//! and `json.dumps`'s `repr` floats for routes without one, so a ported
//! route's bytes match.
//!
//! Use the serde helpers on response fields:
//!
//! ```text
//! #[serde(serialize_with = "json::datetime")]        created_at: DateTime<Utc>,
//! #[serde(serialize_with = "json::option_datetime")] paid_at: Option<DateTime<Utc>>,
//! #[serde(serialize_with = "json::float")]           mean_minutes: f64,      // NaN -> null
//! #[serde(serialize_with = "json::value")]           filters: serde_json::Value,
//! #[serde(serialize_with = "json::repr_value")]      body: Value,            // no response_model
//! ```

use std::fmt::Write as _;

use chrono::{DateTime, NaiveDate, Timelike, Utc};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use serde_json::Value;

/// pydantic's datetime: `2024-10-01T12:34:56Z`, or with `.123456` when the
/// microseconds are not zero. Postgres `timestamptz` values reach Python in
/// UTC, which pydantic writes as `Z`.
pub fn format_datetime(value: &DateTime<Utc>) -> String {
    let micros = value.nanosecond() / 1000 % 1_000_000;
    let mut text = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    if micros != 0 {
        let _ = write!(text, ".{micros:06}");
    }
    text.push('Z');
    text
}

pub fn datetime<S: Serializer>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&format_datetime(value))
}

pub fn option_datetime<S: Serializer>(
    value: &Option<DateTime<Utc>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => datetime(value, serializer),
        None => serializer.serialize_none(),
    }
}

/// pydantic's date: `2024-10-01`.
pub fn option_date<S: Serializer>(
    value: &Option<NaiveDate>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => serializer.serialize_str(&value.format("%Y-%m-%d").to_string()),
        None => serializer.serialize_none(),
    }
}

/// pydantic-core's JSON for a float, which FastAPI writes for every route
/// with a `response_model` (also inside `Any` and `dict` fields): the
/// shortest round-trip digits, positional for exponents -5 to 15
/// (`0.00001`, `123456789.0`) and otherwise `1e-7` / `1.5e+16`, with no
/// exponent padding; NaN and infinities are `null` (`ser_json_inf_nan`).
/// `None` stands for that `null`.
pub fn pydantic_float(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    Some(shortest_float(value, -5, false))
}

/// Python's `repr(float)`, which `json.dumps` writes (routes without a
/// `response_model`, and sizes measured with `json.dumps`): positional for
/// exponents -4 to 15, otherwise `1e-05` / `1.5e+16` with a two-digit
/// exponent; `NaN`, `Infinity` and `-Infinity` as Python writes them.
pub fn python_float(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    shortest_float(value, -4, true)
}

/// The shortest round-trip digits of a finite float, positional for decimal
/// exponents from `lowest_positional` to 15, else scientific (with the
/// exponent zero-padded to two digits when `pad_exponent`).
fn shortest_float(value: f64, lowest_positional: i32, pad_exponent: bool) -> String {
    if value == 0.0 {
        return if value.is_sign_negative() {
            "-0.0"
        } else {
            "0.0"
        }
        .to_owned();
    }
    // `{:e}` writes the shortest round-trip digits, e.g. "1.2345e4".
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific.split_once('e').expect("exponent");
    let exponent: i32 = exponent.parse().expect("integer exponent");
    let (sign, mantissa) = match mantissa.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", mantissa),
    };
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    if (lowest_positional..16).contains(&exponent) {
        let point = exponent + 1;
        let text = if point <= 0 {
            format!("0.{}{digits}", "0".repeat((-point) as usize))
        } else if point as usize >= digits.len() {
            format!("{digits}{}.0", "0".repeat(point as usize - digits.len()))
        } else {
            let (whole, fraction) = digits.split_at(point as usize);
            format!("{whole}.{fraction}")
        };
        return format!("{sign}{text}");
    }
    let (first, rest) = digits.split_at(1);
    let mantissa = if rest.is_empty() {
        first.to_owned()
    } else {
        format!("{first}.{rest}")
    };
    let exponent_sign = if exponent < 0 { '-' } else { '+' };
    if pad_exponent {
        format!("{sign}{mantissa}e{exponent_sign}{:02}", exponent.abs())
    } else {
        format!("{sign}{mantissa}e{exponent_sign}{}", exponent.abs())
    }
}

/// Which float text a value is written with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FloatStyle {
    /// pydantic-core (routes with a `response_model`).
    Pydantic,
    /// `json.dumps` (routes without one).
    Repr,
}

fn write_float<S: Serializer>(
    value: f64,
    style: FloatStyle,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let text = match style {
        FloatStyle::Pydantic => match pydantic_float(value) {
            Some(text) => text,
            None => return serializer.serialize_none(),
        },
        FloatStyle::Repr => python_float(value),
    };
    // A raw value keeps the text as Python writes it; serde_json's own float
    // writer would print "1e-5" and "1e16".
    serde_json::value::RawValue::from_string(text)
        .map_err(serde::ser::Error::custom)?
        .serialize(serializer)
}

/// A float as FastAPI writes it in a response model.
pub fn float<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    write_float(*value, FloatStyle::Pydantic, serializer)
}

pub fn option_float<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => float(value, serializer),
        None => serializer.serialize_none(),
    }
}

/// A fixed-size float array (`tuple[float, float]`) as pydantic writes it.
pub fn option_float_array<S: Serializer, const N: usize>(
    value: &Option<[f64; N]>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    struct Element(f64);
    impl Serialize for Element {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            float(&self.0, serializer)
        }
    }
    match value {
        Some(values) => {
            let mut seq = serializer.serialize_seq(Some(N))?;
            for value in values {
                seq.serialize_element(&Element(*value))?;
            }
            seq.end()
        }
        None => serializer.serialize_none(),
    }
}

/// A JSON value (a `jsonb` column) inside a response model, as pydantic
/// re-serializes what PostgREST returned: floats in pydantic's format,
/// everything else unchanged.
pub fn value<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    PyValue(value).serialize(serializer)
}

pub fn option_value<S: Serializer>(
    value: &Option<Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => PyValue(value).serialize(serializer),
        None => serializer.serialize_none(),
    }
}

/// A JSON value returned by a route without a `response_model`, which
/// FastAPI writes with `json.dumps` (`repr` floats).
pub fn repr_value<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    StyledValue(value, FloatStyle::Repr).serialize(serializer)
}

/// Serializes a `Value` with pydantic's float text.
pub struct PyValue<'a>(pub &'a Value);

impl serde::Serialize for PyValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        StyledValue(self.0, FloatStyle::Pydantic).serialize(serializer)
    }
}

struct StyledValue<'a>(&'a Value, FloatStyle);

impl serde::Serialize for StyledValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let style = self.1;
        match self.0 {
            Value::Number(number) if number.is_f64() => {
                write_float(number.as_f64().unwrap_or_default(), style, serializer)
            }
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&StyledValue(item, style))?;
                }
                seq.end()
            }
            Value::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, item) in entries {
                    map.serialize_entry(key, &StyledValue(item, style))?;
                }
                map.end()
            }
            other => other.serialize(serializer),
        }
    }
}

/// `json.dumps(value, ensure_ascii=False)` with its default separators
/// (`", "` and `": "`), as Python measures a value's encoded size.
pub fn python_dumps(value: &Value) -> String {
    let mut out = String::new();
    dump(value, &mut out, Dumps::DEFAULT);
    out
}

/// `json.dumps(value, separators=(",", ":"))`: compact, with non-ASCII
/// characters escaped (`ensure_ascii`), as a metadata size limit measures it.
pub fn python_dumps_compact(value: &Value) -> String {
    let mut out = String::new();
    dump(value, &mut out, Dumps::COMPACT_ASCII);
    out
}

#[derive(Clone, Copy)]
struct Dumps {
    item_separator: &'static str,
    key_separator: &'static str,
    ascii: bool,
}

impl Dumps {
    const DEFAULT: Self = Self {
        item_separator: ", ",
        key_separator: ": ",
        ascii: false,
    };
    const COMPACT_ASCII: Self = Self {
        item_separator: ",",
        key_separator: ":",
        ascii: true,
    };
}

fn dump_string(text: &str, out: &mut String, style: Dumps) {
    let quoted = serde_json::to_string(text).expect("string serializes");
    if !style.ascii {
        out.push_str(&quoted);
        return;
    }
    for character in quoted.chars() {
        if character.is_ascii() {
            out.push(character);
        } else {
            let mut units = [0u16; 2];
            for unit in character.encode_utf16(&mut units) {
                let _ = write!(out, "\\u{unit:04x}");
            }
        }
    }
}

fn dump(value: &Value, out: &mut String, style: Dumps) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => {
            if number.is_f64() {
                out.push_str(&python_float(number.as_f64().unwrap_or_default()));
            } else {
                out.push_str(&number.to_string());
            }
        }
        Value::String(text) => dump_string(text, out, style),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push_str(style.item_separator);
                }
                dump(item, out, style);
            }
            out.push(']');
        }
        Value::Object(entries) => {
            out.push('{');
            for (index, (key, item)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push_str(style.item_separator);
                }
                dump_string(key, out, style);
                out.push_str(style.key_separator);
                dump(item, out, style);
            }
            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    #[test]
    fn datetimes_match_pydantic() {
        // pydantic: {"t":"2024-10-01T12:34:56.123000Z"} and {"t":"2024-10-01T12:34:56Z"}
        let at = Utc.with_ymd_and_hms(2024, 10, 1, 12, 34, 56).unwrap();
        assert_eq!(format_datetime(&at), "2024-10-01T12:34:56Z");
        let at = at + chrono::Duration::microseconds(123_000);
        assert_eq!(format_datetime(&at), "2024-10-01T12:34:56.123000Z");
        let at =
            Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap() + chrono::Duration::microseconds(1);
        assert_eq!(format_datetime(&at), "2024-01-01T00:00:00.000001Z");
    }

    #[test]
    fn floats_match_python_repr() {
        for (value, expected) in [
            (1.0, "1.0"),
            (60.0, "60.0"),
            (0.1, "0.1"),
            (0.1 + 0.2, "0.30000000000000004"),
            (37.037 / 3.0, "12.345666666666666"),
            (0.0001, "0.0001"),
            (0.00001, "1e-05"),
            (0.000012345, "1.2345e-05"),
            (1e16, "1e+16"),
            (1.5e16, "1.5e+16"),
            (123456789012345.6, "123456789012345.6"),
            (999999999999999.9, "999999999999999.9"),
            (1e15, "1000000000000000.0"),
            (-2.5, "-2.5"),
            (0.0, "0.0"),
            (-0.0, "-0.0"),
            (1e300, "1e+300"),
            (5e-324, "5e-324"),
        ] {
            assert_eq!(python_float(value), expected, "{value}");
        }
    }

    #[test]
    fn floats_match_a_pydantic_corpus() {
        // [repr(value), TypeAdapter(float).dump_json(value)] from pydantic 2.14
        // (shared with the events port; checked against the backend venv).
        let corpus: Vec<(String, String)> =
            serde_json::from_str(include_str!("testdata/pydantic_floats.json")).unwrap();
        assert!(corpus.len() > 100);
        for (python_repr, expected) in corpus {
            let value: f64 = python_repr.parse().unwrap();
            assert_eq!(
                pydantic_float(value).as_deref(),
                Some(expected.as_str()),
                "{python_repr}"
            );
            // And the repr side round-trips Python's own text.
            assert_eq!(python_float(value), python_repr, "{python_repr}");
        }
    }

    #[test]
    fn floats_match_pydantic_core() {
        // FastAPI 0.162 / pydantic 2.14, a response_model with these floats:
        // [0.00001,1e-7,1e+16,123456789.0,-0.0,null,null,0.30000000000000004,
        //  0.000030000000000000004,1.2345678901234568e+16,1e+300,5e-324]
        for (value, expected) in [
            (0.00001, Some("0.00001")),
            (1e-7, Some("1e-7")),
            (1e16, Some("1e+16")),
            (123456789.0, Some("123456789.0")),
            (-0.0, Some("-0.0")),
            (f64::NAN, None),
            (f64::INFINITY, None),
            (f64::NEG_INFINITY, None),
            (0.1 + 0.2, Some("0.30000000000000004")),
            (1e-5 * 3.0, Some("0.000030000000000000004")),
            (12345678901234567.0, Some("1.2345678901234568e+16")),
            (1e300, Some("1e+300")),
            (5e-324, Some("5e-324")),
            (2.5e20, Some("2.5e+20")),
            (1e15, Some("1000000000000000.0")),
        ] {
            assert_eq!(pydantic_float(value).as_deref(), expected, "{value}");
        }
    }

    #[test]
    fn json_values_use_pydantic_floats_and_repr_on_request() {
        let value = json!({"a": 0.00001, "b": [1, 2.5, "x"], "c": null, "d": 1e16, "e": 1e-7});
        assert_eq!(
            serde_json::to_string(&PyValue(&value)).unwrap(),
            r#"{"a":0.00001,"b":[1,2.5,"x"],"c":null,"d":1e+16,"e":1e-7}"#
        );
        #[derive(serde::Serialize)]
        struct Repr(#[serde(serialize_with = "repr_value")] Value);
        // FastAPI without a response_model: {"f":[1e-05,1e+16]}
        assert_eq!(
            serde_json::to_string(&Repr(json!({"f": [0.00001, 1e16]}))).unwrap(),
            r#"{"f":[1e-05,1e+16]}"#
        );
        #[derive(serde::Serialize)]
        struct Floats {
            #[serde(serialize_with = "float")]
            x: f64,
            #[serde(serialize_with = "option_float")]
            y: Option<f64>,
        }
        assert_eq!(
            serde_json::to_string(&Floats {
                x: f64::NAN,
                y: Some(1e16)
            })
            .unwrap(),
            r#"{"x":null,"y":1e+16}"#
        );
    }

    #[test]
    fn dumps_uses_default_separators() {
        let value = json!({"q": "é\n", "n": [1, 2.0], "t": true});
        assert_eq!(
            python_dumps(&value),
            "{\"q\": \"é\\n\", \"n\": [1, 2.0], \"t\": true}"
        );
    }
}
