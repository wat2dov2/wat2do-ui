//! JSON written exactly as Python's `json.dumps` writes it (ASCII-only strings,
//! its separators and indents), for files and output that must stay
//! byte-for-byte what the Python services produced.

use serde_json::Value;

/// `json.dumps(value)`, or `json.dumps(value, indent=n)` with `Some(n)`.
/// Keys keep the value's order; a `BTreeMap` serialized first gives `sort_keys=True`.
pub fn dumps(value: &Value, indent: Option<usize>) -> String {
    let mut out = String::new();
    write(value, indent, 0, &mut out);
    out
}

fn write(value: &Value, indent: Option<usize>, depth: usize, out: &mut String) {
    // Before each item: ", " inline, or a comma and a new indented line.
    let separate = |out: &mut String, index: usize, depth: usize| match indent {
        None if index > 0 => out.push_str(", "),
        None => {}
        Some(width) => {
            if index > 0 {
                out.push(',');
            }
            out.push('\n');
            out.push_str(&" ".repeat(width * depth));
        }
    };
    let close = |out: &mut String, depth: usize| {
        if let Some(width) = indent {
            out.push('\n');
            out.push_str(&" ".repeat(width * depth));
        }
    };
    match value {
        Value::String(text) => write_string(text, out),
        Value::Array(items) if !items.is_empty() => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                separate(out, index, depth + 1);
                write(item, indent, depth + 1, out);
            }
            close(out, depth);
            out.push(']');
        }
        Value::Object(map) if !map.is_empty() => {
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                separate(out, index, depth + 1);
                write_string(key, out);
                out.push_str(": ");
                write(item, indent, depth + 1, out);
            }
            close(out, depth);
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            ' '..='~' => out.push(c),
            _ => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::dumps;
    use serde_json::json;

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
