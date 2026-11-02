//! JSON exactly as FastAPI writes it: pydantic's datetime and date formats,
//! and `json.dumps` floats (`repr`), so a ported route's bytes match.
//!
//! Use the serde helpers on response fields:
//!
//! ```text
//! #[serde(serialize_with = "json::datetime")]      created_at: DateTime<Utc>,
//! #[serde(serialize_with = "json::option_datetime")] paid_at: Option<DateTime<Utc>>,
//! #[serde(serialize_with = "json::float")]          mean_minutes: f64,
//! #[serde(serialize_with = "json::value")]          filters: serde_json::Value,
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

/// Python's `repr(float)`, which `json.dumps` writes: the shortest digits that
/// round-trip, in positional notation for exponents -4 to 15 and otherwise
/// as `1e-05` / `1.5e+16`.
pub fn python_float(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
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
    if (-4..16).contains(&exponent) {
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
    format!("{sign}{mantissa}e{exponent_sign}{:02}", exponent.abs())
}

/// A float as `json.dumps` writes it.
pub fn float<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    PyValue(&number(*value)).serialize_into(serializer)
}

pub fn option_float<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => float(value, serializer),
        None => serializer.serialize_none(),
    }
}

fn number(value: f64) -> Value {
    serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
}

/// A JSON value (a `jsonb` column) as Python re-serializes what PostgREST
/// returned: floats through `repr`, everything else unchanged.
pub fn value<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    PyValue(value).serialize_into(serializer)
}

pub fn option_value<S: Serializer>(
    value: &Option<Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) => PyValue(value).serialize_into(serializer),
        None => serializer.serialize_none(),
    }
}

/// Serializes a `Value` with Python's float text.
pub struct PyValue<'a>(pub &'a Value);

impl PyValue<'_> {
    fn serialize_into<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.serialize(serializer)
    }
}

impl serde::Serialize for PyValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Number(number) if number.is_f64() => {
                // A raw value keeps "1e-05" as Python writes it; serde_json's
                // own float writer would print "1e-5".
                let text = python_float(number.as_f64().unwrap_or_default());
                serde_json::value::RawValue::from_string(text)
                    .map_err(serde::ser::Error::custom)?
                    .serialize(serializer)
            }
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&PyValue(item))?;
                }
                seq.end()
            }
            Value::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, item) in entries {
                    map.serialize_entry(key, &PyValue(item))?;
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
    dump(value, &mut out);
    out
}

fn dump(value: &Value, out: &mut String) {
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
        Value::String(text) => {
            out.push_str(&serde_json::to_string(text).expect("string serializes"));
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                dump(item, out);
            }
            out.push(']');
        }
        Value::Object(entries) => {
            out.push('{');
            for (index, (key, item)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push_str(", ");
                }
                out.push_str(&serde_json::to_string(key).expect("string serializes"));
                out.push_str(": ");
                dump(item, out);
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
    fn json_values_use_python_floats() {
        let value = json!({"a": 0.00001, "b": [1, 2.5, "x"], "c": null, "d": 1e16});
        assert_eq!(
            serde_json::to_string(&PyValue(&value)).unwrap(),
            r#"{"a":1e-05,"b":[1,2.5,"x"],"c":null,"d":1e+16}"#
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
