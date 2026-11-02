//! More of pydantic's lax parsing for query parameters: floats, unbounded
//! integers, lists, literals and datetimes (`speedate`), with pydantic's
//! error types and messages.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde_json::{Value, json};

use super::{Field, ValidationIssue};

/// Float bounds, as in `Query(ge=0, le=100_000)`.
#[derive(Debug, Clone, Copy, Default)]
pub struct FloatLimits {
    ge: Option<f64>,
    le: Option<f64>,
}

impl FloatLimits {
    pub fn ge(mut self, bound: f64) -> Self {
        self.ge = Some(bound);
        self
    }
    pub fn le(mut self, bound: f64) -> Self {
        self.le = Some(bound);
        self
    }
}

/// pydantic's message shows a bound as Python prints it (`100000`, `0.5`).
fn bound_text(bound: f64) -> String {
    if bound.fract() == 0.0 && bound.abs() < 1e16 {
        format!("{}", bound as i64)
    } else {
        format!("{bound}")
    }
}

/// pydantic's lax `float` from a string: trimmed, single underscores between
/// digits, `inf` / `nan` in any case, overflow to infinity.
pub fn parse_python_float(raw: &str) -> Option<f64> {
    let text = raw.trim();
    let cleaned = if text.contains('_') {
        let bytes = text.as_bytes();
        let valid = bytes.iter().enumerate().all(|(index, byte)| {
            *byte != b'_'
                || (index > 0
                    && index + 1 < bytes.len()
                    && bytes[index - 1].is_ascii_digit()
                    && bytes[index + 1].is_ascii_digit())
        });
        if !valid {
            return None;
        }
        text.replace('_', "")
    } else {
        text.to_owned()
    };
    cleaned.parse::<f64>().ok()
}

/// An integer pydantic accepted: one that fits `i64`, or a larger one (Python
/// ints are unbounded) that Postgres will refuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PyInt {
    Small(i64),
    Huge,
}

/// pydantic's lax `int` from a string, without an upper bound.
pub fn parse_unbounded_int(raw: &str) -> Option<PyInt> {
    if let Some(value) = super::parse_python_int(raw) {
        return Some(PyInt::Small(value));
    }
    // The same grammar with the magnitude replaced by a small one tells
    // whether only the size failed.
    let text = raw.trim();
    let unsigned = text.trim_start_matches(['+', '-']);
    if text.len() - unsigned.len() > 1 {
        return None;
    }
    let whole = unsigned
        .split_once('.')
        .map_or(unsigned, |(whole, _)| whole);
    let significant = whole.replace('_', "");
    let probe = text.replacen(whole, "1", 1);
    (significant.len() >= 19 && super::parse_python_int(&probe).is_some() && {
        // Underscore placement still has to be valid in the original.
        !whole.starts_with('_')
            && !whole.ends_with('_')
            && !whole.contains("__")
            && whole.bytes().all(|b| b.is_ascii_digit() || b == b'_')
    })
    .then_some(PyInt::Huge)
}

/// A datetime as pydantic parsed it: aware, or naive (read as UTC by Postgres).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PyDateTimeInput {
    Aware(DateTime<FixedOffset>),
    Naive(NaiveDateTime),
}

impl PyDateTimeInput {
    /// The instant a PostgREST filter compared: naive values are UTC (the database's zone).
    pub fn to_utc(self) -> DateTime<Utc> {
        match self {
            Self::Aware(value) => value.with_timezone(&Utc),
            Self::Naive(value) => value.and_utc(),
        }
    }
}

const TOO_SHORT: &str = "input is too short";
const EXTRA: &str = "unexpected extra characters at the end of the input";
const DATE_SEPARATOR: &str = "invalid date separator, expected `-`";
const TOO_SMALL: &str = "dates before 0000 are not supported as unix timestamps";
const TOO_LARGE: &str = "dates after 9999 are not supported as unix timestamps";

fn digits(bytes: &[u8], error: &'static str) -> Result<u32, &'static str> {
    bytes.iter().try_fold(0u32, |value, byte| {
        if byte.is_ascii_digit() {
            Ok(value * 10 + u32::from(byte - b'0'))
        } else {
            Err(error)
        }
    })
}

/// speedate's `Date::parse_bytes_partial`: `YYYY-MM-DD` at the start.
fn parse_date(bytes: &[u8]) -> Result<NaiveDate, &'static str> {
    if bytes.len() < 10 {
        return Err(TOO_SHORT);
    }
    let year = digits(&bytes[0..4], "invalid character in year")?;
    if bytes[4] != b'-' {
        return Err(DATE_SEPARATOR);
    }
    let month = digits(&bytes[5..7], "invalid character in month")?;
    if bytes[7] != b'-' {
        return Err(DATE_SEPARATOR);
    }
    let day = digits(&bytes[8..10], "invalid character in day")?;
    if !(1..=12).contains(&month) {
        return Err("month value is outside expected range of 1-12");
    }
    NaiveDate::from_ymd_opt(year as i32, month, day)
        .filter(|_| day >= 1)
        .ok_or("day value is outside expected range")
}

/// speedate's RFC 3339 datetime; `None` on any failure.
fn parse_rfc3339(bytes: &[u8]) -> Option<PyDateTimeInput> {
    let date = parse_date(bytes).ok()?;
    if !matches!(bytes.get(10)?, b'T' | b't' | b' ' | b'_') {
        return None;
    }
    let time = &bytes[11..];
    if time.len() < 5 || time[2] != b':' {
        return None;
    }
    let hour = digits(&time[0..2], "").ok()?;
    let minute = digits(&time[3..5], "").ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    let mut position = 5;
    let mut second = 0;
    let mut micros = 0;
    if time.get(position) == Some(&b':') {
        second = digits(time.get(position + 1..position + 3)?, "").ok()?;
        if second > 59 {
            return None;
        }
        position += 3;
        if matches!(time.get(position), Some(b'.' | b',')) {
            position += 1;
            let start = position;
            while time.get(position).is_some_and(u8::is_ascii_digit) {
                position += 1;
            }
            if position == start {
                return None;
            }
            // Digits beyond microseconds are truncated.
            let fraction = &time[start..position.min(start + 6)];
            micros = digits(fraction, "").ok()? * 10u32.pow(6 - fraction.len() as u32);
        }
    }
    let naive = date.and_time(NaiveTime::from_hms_micro_opt(hour, minute, second, micros)?);
    let offset = match time.get(position) {
        None => return Some(PyDateTimeInput::Naive(naive)),
        Some(b'Z' | b'z') => {
            position += 1;
            0
        }
        Some(sign @ (b'+' | b'-')) => {
            let hours = digits(time.get(position + 1..position + 3)?, "").ok()?;
            position += 3;
            if time.get(position) == Some(&b':') {
                position += 1;
            }
            let minutes = digits(time.get(position..position + 2)?, "").ok()?;
            position += 2;
            if hours > 23 || minutes > 59 {
                return None;
            }
            let seconds = (hours * 3600 + minutes * 60) as i32;
            if *sign == b'-' { -seconds } else { seconds }
        }
        Some(_) => return None,
    };
    if position != time.len() {
        return None;
    }
    let offset = FixedOffset::east_opt(offset)?;
    Some(PyDateTimeInput::Aware(
        offset.from_local_datetime(&naive).single()?,
    ))
}

/// A unix timestamp in speedate's grammar: `[+-]digits[.digits]`.
enum Number {
    Int(i64),
    Float(f64),
}

fn parse_number(text: &str) -> Option<Number> {
    let body = text.strip_prefix(['+', '-']).unwrap_or(text);
    let (whole, fraction) = match body.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (body, None),
    };
    if !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.is_none_or(|f| f.bytes().all(|b| b.is_ascii_digit()))
        || (whole.is_empty() && fraction.is_none_or(str::is_empty))
    {
        return None;
    }
    match fraction {
        None => text.parse::<i64>().ok().map(Number::Int),
        Some(_) => {
            let normalized = format!(
                "{}{}{}",
                if text.starts_with('-') { "-" } else { "" },
                if whole.is_empty() { "0" } else { whole },
                &body[whole.len()..]
            );
            normalized
                .trim_end_matches('.')
                .parse::<f64>()
                .ok()
                .map(Number::Float)
        }
    }
}

/// speedate's `from_timestamp`: seconds, or milliseconds above 2e10.
fn from_timestamp(timestamp: i64, extra_micros: i64) -> Result<DateTime<Utc>, &'static str> {
    let (seconds, micros) = if timestamp.unsigned_abs() <= 20_000_000_000 {
        (timestamp, 0)
    } else {
        (
            timestamp.div_euclid(1000),
            timestamp.rem_euclid(1000) * 1000,
        )
    };
    let micros = micros + extra_micros;
    let seconds = seconds + micros.div_euclid(1_000_000);
    if seconds < -62_167_219_200 {
        return Err(TOO_SMALL);
    }
    if seconds > 253_402_300_799 {
        return Err(TOO_LARGE);
    }
    DateTime::from_timestamp(seconds, (micros.rem_euclid(1_000_000) * 1000) as u32).ok_or(TOO_SMALL)
}

fn timestamp(number: Number) -> Result<DateTime<Utc>, &'static str> {
    match number {
        Number::Int(value) => from_timestamp(value, 0),
        Number::Float(value) => {
            let whole = value.floor();
            let micros = ((value - whole) * 1_000_000.0).round() as i64;
            from_timestamp(whole as i64, micros)
        }
    }
}

/// pydantic's lax `datetime` from a string: RFC 3339, a unix timestamp, or a
/// bare date at midnight; the error is the date parser's, as pydantic reports it.
pub fn parse_python_datetime(raw: &str) -> Result<PyDateTimeInput, &'static str> {
    let bytes = raw.as_bytes();
    if let Some(parsed) = parse_rfc3339(bytes) {
        return Ok(parsed);
    }
    let number = parse_number(raw);
    if let Some(number) = &number {
        let copy = match number {
            Number::Int(value) => Number::Int(*value),
            Number::Float(value) => Number::Float(*value),
        };
        if let Ok(instant) = timestamp(copy) {
            return Ok(PyDateTimeInput::Aware(instant.fixed_offset()));
        }
    }
    // `datetime_from_date_parsing`: a bare date becomes midnight.
    let date_error = match parse_date(bytes) {
        Ok(date) if bytes.len() == 10 => {
            return Ok(PyDateTimeInput::Naive(date.and_time(NaiveTime::MIN)));
        }
        Ok(_) => EXTRA,
        Err(error) => error,
    };
    match number {
        Some(number) => Err(timestamp(number).err().unwrap_or(date_error)),
        None => Err(date_error),
    }
}

impl Field<'_> {
    fn push_issue(
        &mut self,
        kind: &str,
        msg: String,
        input: Value,
        loc: Vec<Value>,
        ctx: Option<Value>,
    ) {
        self.validator.push(ValidationIssue {
            kind: kind.to_owned(),
            loc,
            msg,
            input,
            ctx,
        });
    }

    /// An optional bounded float (`float | None = Query(None, ge=.., le=..)`).
    pub fn optional_float(mut self, limits: FloatLimits) -> Option<f64> {
        let raw = self.raw?;
        let loc = self.loc();
        let Some(value) = parse_python_float(raw) else {
            self.push_issue(
                "float_parsing",
                "Input should be a valid number, unable to parse string as a number".to_owned(),
                json!(raw),
                loc,
                None,
            );
            return None;
        };
        if let Some(bound) = limits.ge.filter(|bound| value < *bound) {
            self.push_issue(
                "greater_than_equal",
                format!(
                    "Input should be greater than or equal to {}",
                    bound_text(bound)
                ),
                json!(raw),
                loc,
                Some(json!({ "ge": bound })),
            );
            return None;
        }
        if let Some(bound) = limits.le.filter(|bound| {
            // NaN fails too, as in pydantic.
            !matches!(
                value.partial_cmp(bound),
                Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
            )
        }) {
            self.push_issue(
                "less_than_equal",
                format!(
                    "Input should be less than or equal to {}",
                    bound_text(bound)
                ),
                json!(raw),
                loc,
                Some(json!({ "le": bound })),
            );
            return None;
        }
        Some(value)
    }

    /// An optional boolean (`bool | None = Query(None)`).
    pub fn optional_bool(self) -> Option<bool> {
        self.raw?;
        Some(self.bool_or(false))
    }

    /// One of `choices` (a `Literal`), else `default`.
    pub fn literal_or(mut self, default: &'static str, choices: &[&'static str]) -> &'static str {
        let Some(raw) = self.raw else { return default };
        if let Some(choice) = choices.iter().find(|choice| **choice == raw) {
            return choice;
        }
        let quoted: Vec<String> = choices.iter().map(|choice| format!("'{choice}'")).collect();
        let expected = match quoted.split_last() {
            Some((last, [])) => last.clone(),
            Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
            None => String::new(),
        };
        let loc = self.loc();
        self.push_issue(
            "literal_error",
            format!("Input should be {expected}"),
            json!(raw),
            loc,
            Some(json!({ "expected": expected })),
        );
        default
    }

    /// A required integer of any size (`event_id: int` in a path).
    pub fn unbounded_int(mut self) -> PyInt {
        let Some(raw) = self.raw else {
            let loc = self.loc();
            self.push_issue(
                "missing",
                "Field required".to_owned(),
                Value::Null,
                loc,
                None,
            );
            return PyInt::Small(0);
        };
        match parse_unbounded_int(raw) {
            Some(value) => value,
            None => {
                let loc = self.loc();
                self.push_issue(
                    "int_parsing",
                    "Input should be a valid integer, unable to parse string as an integer"
                        .to_owned(),
                    json!(raw),
                    loc,
                    None,
                );
                PyInt::Small(0)
            }
        }
    }

    /// An optional `datetime` (`datetime | None = Query(None)`).
    pub fn optional_datetime(mut self) -> Option<PyDateTimeInput> {
        let raw = self.raw?;
        match parse_python_datetime(raw) {
            Ok(value) => Some(value),
            Err(error) => {
                let loc = self.loc();
                self.push_issue(
                    "datetime_from_date_parsing",
                    format!("Input should be a valid datetime or date, {error}"),
                    json!(raw),
                    loc,
                    Some(json!({ "error": error })),
                );
                None
            }
        }
    }
}

/// Repeated query parameters (`list[...] | None = Query(None)`).
pub struct ListField<'a> {
    pub(super) validator: &'a mut super::Validator,
    pub(super) name: &'a str,
    pub(super) values: Vec<&'a str>,
}

impl ListField<'_> {
    /// Every value, or `None` when the parameter is absent.
    pub fn strings(self) -> Option<Vec<String>> {
        (!self.values.is_empty()).then(|| self.values.iter().map(|v| (*v).to_owned()).collect())
    }

    /// Every value as an integer; each bad one is reported at its index.
    pub fn ints(self) -> Option<Vec<PyInt>> {
        if self.values.is_empty() {
            return None;
        }
        let mut parsed = Vec::with_capacity(self.values.len());
        for (index, raw) in self.values.iter().enumerate() {
            match parse_unbounded_int(raw) {
                Some(value) => parsed.push(value),
                None => self.validator.push(ValidationIssue::new(
                    "int_parsing",
                    vec![json!("query"), json!(self.name), json!(index)],
                    "Input should be a valid integer, unable to parse string as an integer",
                    json!(raw),
                )),
            }
        }
        Some(parsed)
    }
}

impl super::Validator {
    pub fn query_list<'a>(
        &'a mut self,
        query: &'a super::QueryParams,
        name: &'a str,
    ) -> ListField<'a> {
        let values = query.all(name);
        ListField {
            validator: self,
            name,
            values,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{QueryParams, Validator};
    use super::*;

    /// FastAPI's answers to the feed's query parameters (generated by
    /// `GET /events/` echoing what it parsed): datetimes, floats, booleans,
    /// literals and lists.
    #[test]
    fn feed_parameters_parse_like_fastapi() {
        let corpus: Vec<Value> =
            serde_json::from_str(include_str!("../events/testdata/feed_params.json")).unwrap();
        for case in corpus {
            let query: Vec<(String, String)> =
                serde_json::from_value(case["query"].clone()).unwrap();
            let names: Vec<&str> = query.iter().map(|(name, _)| name.as_str()).collect();
            // Only single-parameter cases of the types parsed here.
            if names.len() != 1 {
                continue;
            }
            let encoded: String = form_urlencoded::Serializer::new(String::new())
                .extend_pairs(query.iter())
                .finish();
            let params = QueryParams::parse(Some(&encoded));
            let mut check = Validator::default();
            let name = names[0];
            let parsed: Value = match name {
                "start_utc" => match check.query(&params, name).optional_datetime() {
                    Some(PyDateTimeInput::Aware(value)) => {
                        json!({"iso": value.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, false), "aware": true})
                    }
                    Some(PyDateTimeInput::Naive(value)) => {
                        json!({"iso": value.format("%Y-%m-%dT%H:%M:%S%.f").to_string(), "aware": false})
                    }
                    None => Value::Null,
                },
                "min_price" => json!(
                    check
                        .query(&params, name)
                        .optional_float(FloatLimits::default().ge(0.0).le(100_000.0))
                ),
                "registration" => json!(check.query(&params, name).optional_bool()),
                "has_food" => json!(check.query(&params, name).bool_or(false)),
                "sort_by" => json!(
                    check
                        .query(&params, name)
                        .literal_or("date", &["date", "title", "location", "price", "added_at"])
                ),
                "sort_order" => json!(
                    check
                        .query(&params, name)
                        .literal_or("asc", &["asc", "desc"])
                ),
                _ => continue,
            };
            let status = case["status"].as_i64().unwrap();
            match check.finish() {
                Ok(()) => {
                    assert_eq!(status, 200, "{query:?} should fail");
                    let expected = &case["body"][name];
                    if name == "start_utc" {
                        let expected_dt = expected["iso"].as_str().unwrap();
                        // Python's isoformat: compare instants and awareness.
                        assert_eq!(parsed["aware"], expected["aware"], "{query:?}");
                        let python = expected_dt.replace("+00:00", "Z");
                        let ours = parsed["iso"].as_str().unwrap().replace("+00:00", "Z");
                        let normalize = |s: &str| {
                            DateTime::parse_from_rfc3339(s)
                                .map(|d| d.timestamp_micros())
                                .unwrap_or_else(|_| {
                                    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                                        .unwrap()
                                        .and_utc()
                                        .timestamp_micros()
                                })
                        };
                        assert_eq!(normalize(&ours), normalize(&python), "{query:?}");
                    } else if name == "min_price" {
                        let python: f64 = expected.as_str().unwrap().parse().unwrap();
                        assert_eq!(parsed.as_f64().unwrap(), python, "{query:?}");
                    } else {
                        assert_eq!(&parsed, expected, "{query:?}");
                    }
                }
                Err(crate::api::errors::ApiError::RequestValidation(issues)) => {
                    assert_eq!(status, 422, "{query:?} should pass");
                    assert_eq!(json!(issues), case["body"]["detail"], "{query:?}");
                }
                Err(other) => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn datetime_edges_match_speedate() {
        let ok = |raw: &str| parse_python_datetime(raw).unwrap().to_utc().to_rfc3339();
        assert_eq!(ok("2026-11-02_10:00"), "2026-11-02T10:00:00+00:00");
        assert_eq!(ok("+1700000000"), "2023-11-14T22:13:20+00:00");
        assert_eq!(ok("1."), "1970-01-01T00:00:01+00:00");
        assert_eq!(ok(".5"), "1970-01-01T00:00:00.500+00:00");
        assert_eq!(ok("-1.5"), "1969-12-31T23:59:58.500+00:00");
        assert_eq!(ok("1700000000.1234567"), "2023-11-14T22:13:20.123457+00:00");
        assert_eq!(ok("1700000000.9999999"), "2023-11-14T22:13:21+00:00");
        assert_eq!(ok("20000000001"), "1970-08-20T11:33:20.001+00:00");
        assert_eq!(ok("-20000000001"), "1969-05-14T12:26:39.999+00:00");
        assert_eq!(ok("253402300799999"), "9999-12-31T23:59:59.999+00:00");
        assert_eq!(ok("2026-11-02T10:00:00+23:59"), "2026-11-01T10:01:00+00:00");
        assert_eq!(ok("2024-02-29T00:00Z"), "2024-02-29T00:00:00+00:00");
        let err = |raw: &str| parse_python_datetime(raw).unwrap_err();
        assert_eq!(err("99999999999999999999"), DATE_SEPARATOR);
        assert_eq!(err("9999999999999999"), TOO_LARGE);
        assert_eq!(err("253402300800000"), TOO_LARGE);
        assert_eq!(err("2026-11-02T10:00.5"), EXTRA);
        assert_eq!(err("2026-11-02T10:00:00+05:60"), EXTRA);
        assert_eq!(err("2026-02-29"), "day value is outside expected range");
        assert_eq!(err("  "), TOO_SHORT);
        assert_eq!(err("2026-11-02T"), EXTRA);
        assert_eq!(err("1e3"), TOO_SHORT);
    }

    #[test]
    fn unbounded_ints_and_lists() {
        assert_eq!(parse_unbounded_int("12"), Some(PyInt::Small(12)));
        assert_eq!(
            parse_unbounded_int("99999999999999999999"),
            Some(PyInt::Huge)
        );
        assert_eq!(
            parse_unbounded_int("-99999999999999999999"),
            Some(PyInt::Huge)
        );
        assert_eq!(
            parse_unbounded_int("9_999_999_999_999_999_999"),
            Some(PyInt::Huge)
        );
        assert_eq!(parse_unbounded_int("x"), None);
        assert_eq!(parse_unbounded_int(""), None);
        let corpus: Vec<Value> =
            serde_json::from_str(include_str!("../events/testdata/feed_params.json")).unwrap();
        let lists: Vec<&Value> = corpus
            .iter()
            .filter(|case| {
                let names: Vec<&str> = case["query"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p[0].as_str().unwrap())
                    .collect();
                names.len() > 1 && names.iter().all(|n| *n == "club_ids")
                    || names == ["ids"]
                    || names == ["ids", "ids"]
            })
            .collect();
        assert!(!lists.is_empty());
        for case in lists {
            let query: Vec<(String, String)> =
                serde_json::from_value(case["query"].clone()).unwrap();
            let encoded: String = form_urlencoded::Serializer::new(String::new())
                .extend_pairs(query.iter())
                .finish();
            let params = QueryParams::parse(Some(&encoded));
            let mut check = Validator::default();
            let name = query[0].0.as_str();
            check.query_list(&params, name).ints();
            match check.finish() {
                Ok(()) => assert_eq!(case["status"], 200),
                Err(crate::api::errors::ApiError::RequestValidation(issues)) => {
                    assert_eq!(json!(issues), case["body"]["detail"])
                }
                Err(other) => panic!("{other:?}"),
            }
        }
    }
}
