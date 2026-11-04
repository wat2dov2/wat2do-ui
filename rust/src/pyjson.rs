//! JSON text and value semantics exactly as Python's `json` module and truthiness see
//! them, for files, output and stored state that must stay byte for byte what the
//! Python services produced.
//!
//! `json.dumps` separates with `", "` and `": "` (or newlines and indents), escapes
//! non-ASCII, and prints floats with `repr`. Python also treats `True == 1` and empty
//! containers as false.

use serde_json::{Map, Value};

/// `json.dumps(value)`, or `json.dumps(value, indent=n)` with `Some(n)`. Keys keep the
/// value's order.
pub fn dumps(value: &Value, indent: Option<usize>) -> String {
    let mut out = String::new();
    write_value(&mut out, value, false, indent, 0);
    out
}

/// `json.dumps(value, sort_keys=True)`, indented like [`dumps`].
pub fn dumps_sorted(value: &Value, indent: Option<usize>) -> String {
    let mut out = String::new();
    write_value(&mut out, value, true, indent, 0);
    out
}

/// `json.dumps(text)` for one string.
pub fn string(text: &str) -> String {
    let mut out = String::new();
    write_string(&mut out, text);
    out
}

fn write_value(out: &mut String, value: &Value, sort: bool, indent: Option<usize>, depth: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                out.push_str(&integer.to_string());
            } else if let Some(integer) = number.as_u64() {
                out.push_str(&integer.to_string());
            } else {
                out.push_str(&float_repr(number.as_f64().unwrap_or(f64::NAN)));
            }
        }
        Value::String(text) => write_string(out, text),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                    if indent.is_none() {
                        out.push(' ');
                    }
                }
                newline(out, indent, depth + 1);
                write_value(out, item, sort, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push(']');
        }
        Value::Object(map) => write_object(out, map, sort, indent, depth),
    }
}

fn write_object(
    out: &mut String,
    map: &Map<String, Value>,
    sort: bool,
    indent: Option<usize>,
    depth: usize,
) {
    if map.is_empty() {
        out.push_str("{}");
        return;
    }
    let mut entries: Vec<(&String, &Value)> = map.iter().collect();
    if sort {
        // Python sorts str keys by code point, as Rust's str ordering does.
        entries.sort_by(|left, right| left.0.cmp(right.0));
    }
    out.push('{');
    for (index, (key, item)) in entries.into_iter().enumerate() {
        if index > 0 {
            out.push(',');
            if indent.is_none() {
                out.push(' ');
            }
        }
        newline(out, indent, depth + 1);
        write_string(out, key);
        out.push_str(": ");
        write_value(out, item, sort, indent, depth + 1);
    }
    newline(out, indent, depth);
    out.push('}');
}

fn newline(out: &mut String, indent: Option<usize>, depth: usize) {
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * depth));
    }
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            ' '..='~' => out.push(character),
            _ => {
                let mut units = [0u16; 2];
                for unit in character.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out.push('"');
}

/// Python's `repr(float)`: the shortest round-tripping digits, fixed notation for
/// decimal exponents from -4 to 15 and `1e+16` style beyond.
pub fn float_repr(value: f64) -> String {
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
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("{:e} has an exponent");
    let exponent: i32 = exponent.parse().expect("{:e} exponent is an integer");
    let digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let sign = if value < 0.0 { "-" } else { "" };
    if (-4..16).contains(&exponent) {
        let point = exponent + 1;
        let text = if point <= 0 {
            format!("0.{}{}", "0".repeat((-point) as usize), digits)
        } else if point as usize >= digits.len() {
            format!("{}{}.0", digits, "0".repeat(point as usize - digits.len()))
        } else {
            format!(
                "{}.{}",
                &digits[..point as usize],
                &digits[point as usize..]
            )
        };
        format!("{sign}{text}")
    } else {
        let fraction = if digits.len() > 1 {
            format!("{}.{}", &digits[..1], &digits[1..])
        } else {
            digits.clone()
        };
        let exponent_sign = if exponent < 0 { '-' } else { '+' };
        format!("{sign}{fraction}e{exponent_sign}{:02}", exponent.abs())
    }
}

/// Python truthiness of a JSON value.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

/// A JSON number (or bool, which Python treats as an int) as f64.
pub fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
        Value::Number(number) => number.as_f64(),
        _ => None,
    }
}

/// Python `==` between two JSON values: numbers and bools compare by value.
pub fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(_) | Value::Bool(_), Value::Number(_) | Value::Bool(_)) => {
            number(left) == number(right)
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| equal(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .all(|(key, value)| right.get(key).is_some_and(|other| equal(value, other)))
        }
        _ => left == right,
    }
}

/// Python's `str(value)` for a JSON value, as f-strings and `str()` render it.
pub fn str(value: &Value) -> String {
    match value {
        Value::Null => "None".to_owned(),
        Value::Bool(true) => "True".to_owned(),
        Value::Bool(false) => "False".to_owned(),
        Value::String(text) => text.clone(),
        Value::Number(number) if number.is_f64() => float_repr(number.as_f64().unwrap_or(f64::NAN)),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dumps_matches_python_json_dumps() {
        assert_eq!(
            dumps(&json!({"b": 1, "a": [1, "x"]}), None),
            r#"{"b": 1, "a": [1, "x"]}"#
        );
        assert_eq!(
            dumps_sorted(&json!({"b": 1, "a": {}}), None),
            r#"{"a": {}, "b": 1}"#
        );
        assert_eq!(
            dumps(&json!("é\u{1F600}\"\n\u{1}"), None),
            r#""\u00e9\ud83d\ude00\"\n\u0001""#
        );
        assert_eq!(dumps(&json!(["a", "b"]), None), r#"["a", "b"]"#);
        assert_eq!(
            dumps_sorted(&json!({"b": [1, 2], "a": {"c": null}, "d": []}), Some(2)),
            "{\n  \"a\": {\n    \"c\": null\n  },\n  \"b\": [\n    1,\n    2\n  ],\n  \"d\": []\n}"
        );
    }

    #[test]
    fn floats_print_like_python_repr() {
        for (value, expected) in [
            (1793628344.5709288, "1793628344.5709288"),
            (30.0, "30.0"),
            (0.25, "0.25"),
            (1e16, "1e+16"),
            (1e15, "1000000000000000.0"),
            (0.0001, "0.0001"),
            (0.00001, "1e-05"),
            (-2.5, "-2.5"),
            (1.5e-7, "1.5e-07"),
            (123456789012345680.0, "1.2345678901234568e+17"),
        ] {
            assert_eq!(float_repr(value), expected);
        }
    }

    #[test]
    fn truthiness_and_equality_follow_python() {
        assert!(!truthy(&json!(false)));
        assert!(!truthy(&json!("")));
        assert!(!truthy(&json!(0)));
        assert!(truthy(&json!("paused")));
        assert!(equal(&json!(true), &json!(1)));
        assert!(equal(&json!(1.0), &json!(1)));
        assert!(!equal(&json!("1"), &json!(1)));
    }

    // Expected strings are Python 3.12's json.dumps output for the same values.
    #[test]
    fn indented_like_python() {
        let value = json!([{"url": "https://x/\u{e9}", "status": "done", "starts": [], "n": 3, "x": null, "q": "a\"b\\\u{7f}\u{1F600}\n"}]);
        assert_eq!(
            dumps(&value, Some(1)),
            "[\n {\n  \"url\": \"https://x/\\u00e9\",\n  \"status\": \"done\",\n  \"starts\": [],\n  \
             \"n\": 3,\n  \"x\": null,\n  \"q\": \"a\\\"b\\\\\\u007f\\ud83d\\ude00\\n\"\n }\n]"
        );
        assert_eq!(
            dumps(&json!({"events": [], "positions": {}}), Some(1)),
            "{\n \"events\": [],\n \"positions\": {}\n}"
        );
    }

    #[test]
    fn inline_like_python() {
        assert_eq!(
            dumps(
                &json!({"done": 2, "failed": 0, "list": [1, true, "\u{e9}"]}),
                None
            ),
            r#"{"done": 2, "failed": 0, "list": [1, true, "\u00e9"]}"#
        );
        assert_eq!(dumps(&json!({}), None), "{}");
    }
}
