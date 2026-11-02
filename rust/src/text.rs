//! `core/sanitize.py`: text cleaning shared by the API and ingestion.

use std::sync::LazyLock;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use regex::{Captures, Regex};
use unicode_general_category::{GeneralCategory, get_general_category};

/// Python's `str.isspace` (Unicode whitespace plus the separators U+001C to U+001F).
pub fn python_space(character: char) -> bool {
    character.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&character)
}

/// Python's `\w` for `str` patterns: `str.isalnum()` or underscore.
fn python_word(character: char) -> bool {
    use GeneralCategory::*;
    character == '_'
        || matches!(
            get_general_category(character),
            UppercaseLetter
                | LowercaseLetter
                | TitlecaseLetter
                | ModifierLetter
                | OtherLetter
                | DecimalNumber
                | LetterNumber
                | OtherNumber
        )
}

/// Python's `str.strip()`.
pub fn python_strip(value: &str) -> &str {
    value.trim_matches(python_space)
}

/// `sanitize_postgrest_value`: keep letters, digits, underscores, whitespace,
/// hyphens, apostrophes and `%`; collapse whitespace runs; trim. Search
/// routes apply it so a ported route matches the same rows Python matched.
pub fn sanitize_postgrest_value(value: &str) -> String {
    let kept: String = value
        .chars()
        .filter(|character| {
            python_word(*character)
                || python_space(*character)
                || matches!(character, '-' | '\'' | '%')
        })
        .collect();
    let mut collapsed = String::with_capacity(kept.len());
    let mut run: Vec<char> = Vec::new();
    for character in kept.chars() {
        if python_space(character) {
            run.push(character);
            continue;
        }
        flush_space(&mut collapsed, &mut run);
        collapsed.push(character);
    }
    flush_space(&mut collapsed, &mut run);
    collapsed.trim_matches(python_space).to_owned()
}

/// A single whitespace character stays as it is; a run of two or more becomes one space.
fn flush_space(out: &mut String, run: &mut Vec<char>) {
    match run.len() {
        0 => {}
        1 => out.push(run[0]),
        _ => out.push(' '),
    }
    run.clear();
}

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

/// `parse_iso_datetime`: an ISO 8601 string as UTC, a naive value read as
/// UTC; `None` for anything Python's `datetime.fromisoformat` refuses.
pub fn parse_iso_datetime(value: &str) -> Option<DateTime<Utc>> {
    if value.is_empty() {
        return None;
    }
    let value = match value.strip_suffix('Z') {
        Some(rest) => format!("{rest}+00:00"),
        None => value.to_owned(),
    };
    let characters: Vec<char> = value.chars().collect();
    let (date, rest) = parse_iso_date(&characters)?;
    if rest.is_empty() {
        return Some(date.and_time(NaiveTime::MIN).and_utc());
    }
    // Any single character separates the date from the time.
    let (time, offset) = parse_iso_time(&rest[1..])?;
    let local = NaiveDateTime::new(date, time);
    Some((local - offset).and_utc())
}

fn digits(characters: &[char], count: usize) -> Option<u32> {
    let slice = characters.get(..count)?;
    slice.iter().try_fold(0u32, |total, character| {
        Some(
            total * 10
                + character
                    .to_digit(10)
                    .filter(|_| character.is_ascii_digit())?,
        )
    })
}

fn parse_iso_date(characters: &[char]) -> Option<(NaiveDate, &[char])> {
    let year = digits(characters, 4)? as i32;
    let rest = &characters[4..];
    let extended = rest.first() == Some(&'-');
    let rest = if extended { &rest[1..] } else { rest };
    if rest.first() == Some(&'W') {
        let week = digits(&rest[1..], 2)?;
        let mut rest = &rest[3..];
        let mut weekday = 1;
        let has_day = if extended {
            rest.first() == Some(&'-')
        } else {
            rest.first().is_some_and(char::is_ascii_digit)
        };
        if has_day {
            rest = if extended { &rest[1..] } else { rest };
            weekday = digits(rest, 1)?;
            rest = &rest[1..];
        }
        let date = NaiveDate::from_isoywd_opt(
            year,
            week,
            chrono::Weekday::try_from(u8::try_from(weekday.checked_sub(1)?).ok()?).ok()?,
        )?;
        return Some((date, rest));
    }
    let month = digits(rest, 2)?;
    let rest = &rest[2..];
    let rest = if extended {
        rest.strip_prefix(&['-'][..])?
    } else {
        rest
    };
    let day = digits(rest, 2)?;
    Some((NaiveDate::from_ymd_opt(year, month, day)?, &rest[2..]))
}

/// `HH[:MM[:SS[.ffffff]]]` or `HH[MM[SS[.ffffff]]]`, then an optional UTC offset.
fn parse_iso_time(characters: &[char]) -> Option<(NaiveTime, Duration)> {
    let split = characters
        .iter()
        .position(|character| matches!(character, '+' | '-'))
        .unwrap_or(characters.len());
    let (clock, offset) = characters.split_at(split);
    let mut fields = [0u32; 3];
    let mut rest = clock;
    let extended = clock.get(2) == Some(&':');
    for (index, field) in fields.iter_mut().enumerate() {
        if index > 0 {
            if rest.is_empty() || matches!(rest.first(), Some('.' | ',')) {
                break;
            }
            if extended {
                rest = rest.strip_prefix(&[':'][..])?;
            }
        }
        *field = digits(rest, 2)?;
        rest = &rest[2..];
    }
    let mut micros = 0;
    if let Some(fraction) = rest
        .strip_prefix(&['.'][..])
        .or_else(|| rest.strip_prefix(&[','][..]))
    {
        if fraction.is_empty() || !fraction.iter().all(char::is_ascii_digit) {
            return None;
        }
        let kept: String = fraction.iter().take(6).collect();
        micros = format!("{kept:0<6}").parse().ok()?;
        rest = &[];
    }
    if !rest.is_empty() {
        return None;
    }
    let time = NaiveTime::from_hms_micro_opt(fields[0], fields[1], fields[2], micros)?;
    Some((time, parse_offset(offset)?))
}

fn parse_offset(characters: &[char]) -> Option<Duration> {
    let Some((sign, rest)) = characters.split_first() else {
        return Some(Duration::zero());
    };
    let sign = if *sign == '-' { -1 } else { 1 };
    let (time, _) = parse_iso_time(rest).filter(|(_, nested)| nested.is_zero())?;
    let seconds = i64::from(chrono::Timelike::num_seconds_from_midnight(&time));
    if seconds >= 24 * 3600 {
        return None;
    }
    Some(
        Duration::seconds(sign * seconds)
            + Duration::microseconds(sign * i64::from(chrono::Timelike::nanosecond(&time) / 1000)),
    )
}

#[cfg(test)]
mod tests {
    use super::{normalize_scraped_text, parse_iso_datetime, sanitize_postgrest_value};

    #[test]
    fn sanitize_postgrest_value_matches_python() {
        // Expected values come from core.sanitize.sanitize_postgrest_value.
        for (input, expected) in [
            ("pizza night", "pizza night"),
            ("end-of-term", "end-of-term"),
            ("dean's list", "dean's list"),
            ("caf\u{e9}", "caf\u{e9}"),
            ("Room 101", "Room 101"),
            ("%term%", "%term%"),
            (
                "a]],secret_col.eq.1,title.ilike.[%b",
                "asecret_coleq1titleilike%b",
            ),
            ("col.ilike.val", "colilikeval"),
            ("a(b)c", "abc"),
            ("test,secret_column.eq.admin", "testsecret_columneqadmin"),
            ("", ""),
            (".,()[]{}", ""),
            ("  too   many   spaces  ", "too many spaces"),
            ("a;b", "ab"),
            ("a\\b", "ab"),
            ("a\"b", "ab"),
            ("a`b", "ab"),
            ("e\u{301}cole", "ecole"),
            ("x\u{b2}y", "x\u{b2}y"),
            ("\u{4e00}\u{4e8c}", "\u{4e00}\u{4e8c}"),
            ("a\u{203f}b", "ab"),
            ("a\u{1c}b\u{1f}c", "a\u{1c}b\u{1f}c"),
            ("tab\there", "tab\there"),
            ("new\nline", "new\nline"),
            ("emoji \u{1f389} ok", "emoji ok"),
            ("under_score", "under_score"),
            ("\u{661}\u{662}", "\u{661}\u{662}"),
            ("x\u{a0}y", "x\u{a0}y"),
            ("\u{2028}z", "z"),
            ("a\u{200b}b", "ab"),
            ("\u{216b} roman", "\u{216b} roman"),
        ] {
            assert_eq!(sanitize_postgrest_value(input), expected, "{input:?}");
        }
    }

    #[test]
    fn parse_iso_datetime_matches_python() {
        // Expected values come from core.sanitize.parse_iso_datetime (Python 3.12).
        for (input, expected) in [
            ("2026-09-12T12:00:00Z", Some("2026-09-12T12:00:00+00:00")),
            ("2026-09-12T12:00:00", Some("2026-09-12T12:00:00+00:00")),
            (
                "2026-09-12T12:00:00-04:00",
                Some("2026-09-12T16:00:00+00:00"),
            ),
            (
                "2026-09-12T01:00:00+05:30",
                Some("2026-09-11T19:30:00+00:00"),
            ),
            ("2026-02-30T12:00:00Z", None),
            ("invalid", None),
            ("", None),
            ("2026-09-12", Some("2026-09-12T00:00:00+00:00")),
            ("2026-09-12 12:00", Some("2026-09-12T12:00:00+00:00")),
            (
                "2026-09-12T12:00:00.123456Z",
                Some("2026-09-12T12:00:00.123456+00:00"),
            ),
            (
                "2026-09-12T12:00:00.1Z",
                Some("2026-09-12T12:00:00.100+00:00"),
            ),
            (
                "2026-09-12T12:00:00.1234567Z",
                Some("2026-09-12T12:00:00.123456+00:00"),
            ),
            ("20260912T120000Z", Some("2026-09-12T12:00:00+00:00")),
            ("2026-09-12T12Z", Some("2026-09-12T12:00:00+00:00")),
            ("2026-W37-6", Some("2026-09-12T00:00:00+00:00")),
            (
                "2026-09-12T12:00:00+0530",
                Some("2026-09-12T06:30:00+00:00"),
            ),
            ("2026-09-12x12:00:00", Some("2026-09-12T12:00:00+00:00")),
            ("2026-09-12T24:00:00", None),
            (
                "2026-09-12T12:00:00,5Z",
                Some("2026-09-12T12:00:00.500+00:00"),
            ),
            (
                "2026-09-12T12:00:00.123+00:00",
                Some("2026-09-12T12:00:00.123+00:00"),
            ),
            ("2026-09-12T12:00:00z", None),
        ] {
            let parsed = parse_iso_datetime(input);
            let expected =
                expected.map(|text| chrono::DateTime::parse_from_rfc3339(text).unwrap().to_utc());
            assert_eq!(parsed, expected, "{input:?}");
        }
    }

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
