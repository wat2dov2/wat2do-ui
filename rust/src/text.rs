//! `core.sanitize.normalize_scraped_text`: decode serialized newlines and
//! Unicode escapes in scraped social text, leaving other backslashes alone.

use std::sync::LazyLock;

use regex::{Captures, Regex};

static JSON_TEXT_ESCAPE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\\r\\n|\\n|\\u[dD][89aAbB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}",
    )
    .expect("valid regex")
});

pub fn normalize_scraped_text(text: &str) -> String {
    JSON_TEXT_ESCAPE
        .replace_all(text, |captures: &Captures| decode(&captures[0]))
        .into_owned()
}

fn decode(escaped: &str) -> String {
    match escaped {
        r"\r\n" | r"\n" => "\n".to_owned(),
        _ => {
            let units: Vec<u16> = escaped
                .split(r"\u")
                .filter(|unit| !unit.is_empty())
                .map(|unit| u16::from_str_radix(unit, 16).expect("matched hex"))
                .collect();
            // A lone surrogate stays escaped rather than producing invalid text.
            String::from_utf16(&units).unwrap_or_else(|_| escaped.to_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_scraped_text;

    #[test]
    fn decodes_escapes_and_keeps_other_backslashes() {
        assert_eq!(normalize_scraped_text(r"a\nb\r\nc"), "a\nb\nc");
        assert_eq!(normalize_scraped_text(r"caf\u00e9 \ud83c\udf89"), "café 🎉");
        assert_eq!(
            normalize_scraped_text(r"lone \ud83c here"),
            r"lone \ud83c here"
        );
        assert_eq!(normalize_scraped_text(r"C:\path \t"), r"C:\path \t");
    }
}
