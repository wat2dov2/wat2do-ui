//! Request validation with FastAPI's 422 body:
//! `{"detail": [{"type", "loc", "msg", "input", "ctx"?}, ...]}`.
//!
//! The frontend's `ApiError` shows each issue as `[loc] msg`, so the types and
//! messages here are pydantic's, word for word. Like pydantic, every invalid
//! parameter is reported, not only the first:
//!
//! ```text
//! let mut check = Validator::default();
//! let days = check.query(&query, "days").int_or(7, Limits::default().ge(1).le(30));
//! check.finish()?;
//! ```

use std::collections::HashMap;

use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::{HeaderMap, header};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uuid::Uuid;

use super::errors::ApiError;

/// One entry of FastAPI's 422 `detail` list.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ValidationIssue {
    #[serde(rename = "type")]
    pub kind: String,
    pub loc: Vec<Value>,
    pub msg: String,
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ctx: Option<Value>,
}

impl ValidationIssue {
    pub fn new(kind: &str, loc: Vec<Value>, msg: impl Into<String>, input: Value) -> Self {
        Self {
            kind: kind.to_owned(),
            loc,
            msg: msg.into(),
            input,
            ctx: None,
        }
    }

    pub fn with_ctx(mut self, ctx: Value) -> Self {
        self.ctx = Some(ctx);
        self
    }

    pub fn missing(loc: Vec<Value>, input: Value) -> Self {
        Self::new("missing", loc, "Field required", input)
    }
}

/// Numeric bounds, as in `Query(ge=1, le=50)`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Limits {
    ge: Option<i64>,
    gt: Option<i64>,
    le: Option<i64>,
    lt: Option<i64>,
}

impl Limits {
    pub fn ge(mut self, bound: i64) -> Self {
        self.ge = Some(bound);
        self
    }
    pub fn gt(mut self, bound: i64) -> Self {
        self.gt = Some(bound);
        self
    }
    pub fn le(mut self, bound: i64) -> Self {
        self.le = Some(bound);
        self
    }
    pub fn lt(mut self, bound: i64) -> Self {
        self.lt = Some(bound);
        self
    }

    /// pydantic checks `gt`, `ge`, `lt`, `le` in that order and reports the first failure.
    fn violation(&self, value: i64) -> Option<(&'static str, String, Value)> {
        if let Some(bound) = self.gt.filter(|bound| value <= *bound) {
            return Some((
                "greater_than",
                format!("Input should be greater than {bound}"),
                json!({ "gt": bound }),
            ));
        }
        if let Some(bound) = self.ge.filter(|bound| value < *bound) {
            return Some((
                "greater_than_equal",
                format!("Input should be greater than or equal to {bound}"),
                json!({ "ge": bound }),
            ));
        }
        if let Some(bound) = self.lt.filter(|bound| value >= *bound) {
            return Some((
                "less_than",
                format!("Input should be less than {bound}"),
                json!({ "lt": bound }),
            ));
        }
        if let Some(bound) = self.le.filter(|bound| value > *bound) {
            return Some((
                "less_than_equal",
                format!("Input should be less than or equal to {bound}"),
                json!({ "le": bound }),
            ));
        }
        None
    }
}

/// String length bounds, as in `Query(min_length=1, max_length=200)`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Length {
    min: Option<usize>,
    max: Option<usize>,
}

impl Length {
    pub fn min(mut self, bound: usize) -> Self {
        self.min = Some(bound);
        self
    }
    pub fn max(mut self, bound: usize) -> Self {
        self.max = Some(bound);
        self
    }
}

fn characters(count: usize) -> &'static str {
    if count == 1 {
        "character"
    } else {
        "characters"
    }
}

/// Collects every issue of one request, then fails it with a single 422.
#[derive(Debug, Default)]
pub struct Validator {
    issues: Vec<ValidationIssue>,
}

impl Validator {
    pub fn query<'a>(&'a mut self, query: &'a QueryParams, name: &'a str) -> Field<'a> {
        Field {
            validator: self,
            source: "query",
            name,
            raw: query.get(name),
        }
    }

    pub fn path<'a>(&'a mut self, path: &'a PathParams, name: &'a str) -> Field<'a> {
        Field {
            validator: self,
            source: "path",
            name,
            raw: path.0.get(name).map(String::as_str),
        }
    }

    pub fn push(&mut self, issue: ValidationIssue) {
        self.issues.push(issue);
    }

    /// `Err(422)` when any parameter was invalid.
    pub fn finish(self) -> Result<(), ApiError> {
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(ApiError::RequestValidation(self.issues))
        }
    }
}

/// One named parameter being read; each reader records its own issues.
pub struct Field<'a> {
    validator: &'a mut Validator,
    source: &'static str,
    name: &'a str,
    raw: Option<&'a str>,
}

impl Field<'_> {
    fn loc(&self) -> Vec<Value> {
        vec![json!(self.source), json!(self.name)]
    }

    fn issue(&mut self, kind: &str, msg: String, ctx: Option<Value>) {
        let issue = ValidationIssue {
            kind: kind.to_owned(),
            loc: self.loc(),
            msg,
            input: json!(self.raw),
            ctx,
        };
        self.validator.push(issue);
    }

    fn missing(&mut self) {
        let issue = ValidationIssue::missing(self.loc(), Value::Null);
        self.validator.push(issue);
    }

    fn parse_int(&mut self, raw: &str, limits: Limits) -> Option<i64> {
        let Some(value) = parse_python_int(raw) else {
            self.issue(
                "int_parsing",
                "Input should be a valid integer, unable to parse string as an integer".to_owned(),
                None,
            );
            return None;
        };
        if let Some((kind, msg, ctx)) = limits.violation(value) {
            self.issue(kind, msg, Some(ctx));
            return None;
        }
        Some(value)
    }

    /// A required integer; 0 stands in for an invalid value (the request fails anyway).
    pub fn int(mut self, limits: Limits) -> i64 {
        match self.raw {
            Some(raw) => self.parse_int(raw, limits).unwrap_or_default(),
            None => {
                self.missing();
                0
            }
        }
    }

    pub fn int_or(mut self, default: i64, limits: Limits) -> i64 {
        match self.raw {
            Some(raw) => self.parse_int(raw, limits).unwrap_or(default),
            None => default,
        }
    }

    pub fn optional_int(mut self, limits: Limits) -> Option<i64> {
        let raw = self.raw?;
        self.parse_int(raw, limits)
    }

    fn check_length(&mut self, raw: &str, length: Length) {
        let count = raw.chars().count();
        if let Some(min) = length.min.filter(|min| count < *min) {
            self.issue(
                "string_too_short",
                format!("String should have at least {min} {}", characters(min)),
                Some(json!({ "min_length": min })),
            );
        } else if let Some(max) = length.max.filter(|max| count > *max) {
            self.issue(
                "string_too_long",
                format!("String should have at most {max} {}", characters(max)),
                Some(json!({ "max_length": max })),
            );
        }
    }

    pub fn string(mut self, length: Length) -> String {
        match self.raw {
            Some(raw) => {
                self.check_length(raw, length);
                raw.to_owned()
            }
            None => {
                self.missing();
                String::new()
            }
        }
    }

    pub fn string_or(mut self, default: &str, length: Length) -> String {
        match self.raw {
            Some(raw) => {
                self.check_length(raw, length);
                raw.to_owned()
            }
            None => default.to_owned(),
        }
    }

    pub fn optional_string(mut self, length: Length) -> Option<String> {
        let raw = self.raw?;
        self.check_length(raw, length);
        Some(raw.to_owned())
    }

    pub fn bool_or(mut self, default: bool) -> bool {
        let Some(raw) = self.raw else { return default };
        match parse_python_bool(raw) {
            Some(value) => value,
            None => {
                self.issue(
                    "bool_parsing",
                    "Input should be a valid boolean, unable to interpret input".to_owned(),
                    None,
                );
                default
            }
        }
    }

    fn parse_uuid(&mut self, raw: &str) -> Option<Uuid> {
        match Uuid::parse_str(raw) {
            Ok(value) => Some(value),
            Err(error) => {
                self.issue(
                    "uuid_parsing",
                    format!("Input should be a valid UUID, {error}"),
                    Some(json!({ "error": error.to_string() })),
                );
                None
            }
        }
    }

    /// A required UUID; the nil UUID stands in for an invalid value.
    pub fn uuid(mut self) -> Uuid {
        match self.raw {
            Some(raw) => self.parse_uuid(raw).unwrap_or_default(),
            None => {
                self.missing();
                Uuid::nil()
            }
        }
    }

    pub fn optional_uuid(mut self) -> Option<Uuid> {
        let raw = self.raw?;
        self.parse_uuid(raw)
    }
}

/// pydantic's lax `int` from a string: surrounding whitespace, a sign,
/// single underscores between digits, and a fraction of only zeros.
pub fn parse_python_int(raw: &str) -> Option<i64> {
    let text = raw.trim_matches(|character: char| character.is_whitespace());
    let (negative, digits) = match text.as_bytes().first()? {
        b'+' => (false, &text[1..]),
        b'-' => (true, &text[1..]),
        _ => (false, text),
    };
    let digits = match digits.split_once('.') {
        Some((whole, fraction))
            if !whole.is_empty()
                && !fraction.is_empty()
                && fraction.bytes().all(|byte| byte == b'0') =>
        {
            whole
        }
        Some(_) => return None,
        None => digits,
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'_')
    {
        return None;
    }
    let magnitude: i64 = digits.replace('_', "").parse().ok()?;
    Some(if negative { -magnitude } else { magnitude })
}

/// pydantic's lax `bool` from a string (case-insensitive, no whitespace).
pub fn parse_python_bool(raw: &str) -> Option<bool> {
    match raw.to_ascii_lowercase().as_str() {
        "1" | "on" | "t" | "true" | "y" | "yes" => Some(true),
        "0" | "off" | "f" | "false" | "n" | "no" => Some(false),
        _ => None,
    }
}

/// The query string's parameters; a repeated scalar takes its last value, as in FastAPI.
#[derive(Debug, Default, Clone)]
pub struct QueryParams(Vec<(String, String)>);

impl QueryParams {
    pub fn parse(query: Option<&str>) -> Self {
        Self(
            form_urlencoded::parse(query.unwrap_or_default().as_bytes())
                .map(|(name, value)| (name.into_owned(), value.into_owned()))
                .collect(),
        )
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .rev()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// Every value of a repeated parameter (`?tag=a&tag=b`), in order.
    pub fn all(&self, name: &str) -> Vec<&str> {
        self.0
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
            .collect()
    }
}

impl<S: Send + Sync> FromRequestParts<S> for QueryParams {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(Self::parse(parts.uri.query()))
    }
}

/// The matched route's path parameters, percent-decoded once.
#[derive(Debug, Default, Clone)]
pub struct PathParams(HashMap<String, String>);

impl<S: Send + Sync> FromRequestParts<S> for PathParams {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let axum::extract::Path(values) =
            axum::extract::Path::<HashMap<String, String>>::from_request_parts(parts, state)
                .await
                .map_err(|error| ApiError::Internal(anyhow::anyhow!("path parameters: {error}")))?;
        Ok(Self(values))
    }
}

/// A JSON request body parsed into `T`, failing with FastAPI's 422 shape.
///
/// serde stops at the first problem, so unlike pydantic only one issue is
/// reported; its `type`, `loc` and `msg` follow pydantic for missing fields,
/// wrong types and unknown fields. Check a ported route's invalid bodies with
/// the parity harness.
pub struct ValidatedJson<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for ValidatedJson<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let is_json = json_content_type(request.headers());
        let body = axum::body::Bytes::from_request(request, state)
            .await
            .map_err(|error| ApiError::Internal(anyhow::anyhow!("request body: {error}")))?;
        parse_json_body(&body, is_json).map(Self)
    }
}

fn json_content_type(headers: &HeaderMap) -> bool {
    // FastAPI parses the body as JSON when the header is absent or names JSON.
    let Some(content_type) = headers.get(header::CONTENT_TYPE) else {
        return true;
    };
    let Ok(content_type) = content_type.to_str() else {
        return false;
    };
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    essence == "application/json"
        || (essence.starts_with("application/") && essence.ends_with("+json"))
}

/// Parse a request body as FastAPI does for a single body model.
pub fn parse_json_body<T: DeserializeOwned>(body: &[u8], is_json: bool) -> Result<T, ApiError> {
    let fail = |issue: ValidationIssue| ApiError::RequestValidation(vec![issue]);
    if body.is_empty() {
        return Err(fail(ValidationIssue::missing(
            vec![json!("body")],
            Value::Null,
        )));
    }
    if !is_json {
        return Err(fail(ValidationIssue::new(
            "model_attributes_type",
            vec![json!("body")],
            "Input should be a valid dictionary or object to extract fields from",
            json!(String::from_utf8_lossy(body)),
        )));
    }
    let value: Value = serde_json::from_slice(body).map_err(|error| {
        let offset = byte_offset(body, error.line(), error.column());
        fail(
            ValidationIssue::new(
                "json_invalid",
                vec![json!("body"), json!(offset)],
                "JSON decode error",
                json!({}),
            )
            .with_ctx(json!({ "error": error.to_string() })),
        )
    })?;
    serde_path_to_error::deserialize(&value)
        .map_err(|error| fail(body_issue(&value, error.path(), error.inner())))
}

fn byte_offset(body: &[u8], line: usize, column: usize) -> usize {
    let line_start: usize = body
        .split(|byte| *byte == b'\n')
        .take(line.saturating_sub(1))
        .map(|line| line.len() + 1)
        .sum();
    line_start + column.saturating_sub(1)
}

fn body_issue(
    value: &Value,
    path: &serde_path_to_error::Path,
    error: &serde_json::Error,
) -> ValidationIssue {
    let mut loc = vec![json!("body")];
    let mut input = value.clone();
    for segment in path.iter() {
        match segment {
            serde_path_to_error::Segment::Seq { index } => {
                loc.push(json!(index));
                input = input.get(index).cloned().unwrap_or(Value::Null);
            }
            serde_path_to_error::Segment::Map { key } => {
                loc.push(json!(key));
                input = input.get(key).cloned().unwrap_or(Value::Null);
            }
            serde_path_to_error::Segment::Enum { variant } => loc.push(json!(variant)),
            serde_path_to_error::Segment::Unknown => {}
        }
    }
    let message = error.to_string();
    if let Some(field) = between(&message, "missing field `", "`") {
        loc.push(json!(field));
        return ValidationIssue::missing(loc, input);
    }
    if message.starts_with("unknown field `") {
        // The path already ends at the unknown field.
        return ValidationIssue::new(
            "extra_forbidden",
            loc,
            "Extra inputs are not permitted",
            input,
        );
    }
    let expected = message
        .split(", expected ")
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let (kind, msg) = if expected.contains("string") || expected.contains("char") {
        ("string_type", "Input should be a valid string")
    } else if expected.contains("bool") {
        ("bool_type", "Input should be a valid boolean")
    } else if expected.starts_with('i') || expected.starts_with('u') || expected.contains("integer")
    {
        ("int_type", "Input should be a valid integer")
    } else if expected.starts_with('f') {
        ("float_type", "Input should be a valid number")
    } else if expected.contains("sequence") {
        ("list_type", "Input should be a valid list")
    } else if expected.contains("map") || expected.contains("struct") {
        (
            "model_attributes_type",
            "Input should be a valid dictionary or object to extract fields from",
        )
    } else {
        ("value_error", "Value error, invalid value")
    };
    ValidationIssue::new(kind, loc, msg, input)
}

fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let rest = &text[text.find(start)? + start.len()..];
    Some(&rest[..rest.find(end)?])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail(error: ApiError) -> Value {
        match error {
            ApiError::RequestValidation(issues) => json!(issues),
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn int_parsing_matches_pydantic() {
        // Expected values come from pydantic's TypeAdapter(int).validate_python.
        for (raw, expected) in [
            ("1", Some(1)),
            (" 1 ", Some(1)),
            ("+5", Some(5)),
            ("-5", Some(-5)),
            ("05", Some(5)),
            ("1_000", Some(1000)),
            ("\t7\n", Some(7)),
            ("-0", Some(0)),
            ("1.0", Some(1)),
            ("1.00", Some(1)),
            ("0.0", Some(0)),
            ("-1.0", Some(-1)),
            ("1__0", None),
            ("_1", None),
            ("1_", None),
            ("1.5", None),
            ("1.10", None),
            ("1.", None),
            ("1.0.0", None),
            ("1e3", None),
            ("0x10", None),
            ("", None),
            ("  ", None),
            ("\u{661}\u{662}", None),
            ("1 2", None),
            ("+-1", None),
        ] {
            assert_eq!(parse_python_int(raw), expected, "{raw:?}");
        }
    }

    #[test]
    fn bool_parsing_matches_pydantic() {
        for raw in ["true", "True", "TRUE", "tRuE", "1", "yes", "on", "t", "y"] {
            assert_eq!(parse_python_bool(raw), Some(true), "{raw}");
        }
        for raw in ["false", "0", "no", "off", "f", "n"] {
            assert_eq!(parse_python_bool(raw), Some(false), "{raw}");
        }
        for raw in [" true", "", "2"] {
            assert_eq!(parse_python_bool(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn every_invalid_parameter_is_reported_like_fastapi() {
        // FastAPI's body for GET /q?page=0&s=toolong&u=xyz&b=maybe with
        // page: int = Query(1, ge=1, le=1000), s: str = Query("", max_length=5),
        // u: UUID | None = None, b: bool = False.
        let query = QueryParams::parse(Some("page=0&s=toolong&u=xyz&b=maybe"));
        let mut check = Validator::default();
        check
            .query(&query, "page")
            .int_or(1, Limits::default().ge(1).le(1000));
        check
            .query(&query, "s")
            .string_or("", Length::default().max(5));
        check.query(&query, "u").optional_uuid();
        check.query(&query, "b").bool_or(false);
        let expected = json!([
            {"type": "greater_than_equal", "loc": ["query", "page"], "msg": "Input should be greater than or equal to 1", "input": "0", "ctx": {"ge": 1}},
            {"type": "string_too_long", "loc": ["query", "s"], "msg": "String should have at most 5 characters", "input": "toolong", "ctx": {"max_length": 5}},
            {"type": "uuid_parsing", "loc": ["query", "u"], "msg": "Input should be a valid UUID, invalid character: found `x` at 0", "input": "xyz", "ctx": {"error": "invalid character: found `x` at 0"}},
            {"type": "bool_parsing", "loc": ["query", "b"], "msg": "Input should be a valid boolean, unable to interpret input", "input": "maybe"}
        ]);
        assert_eq!(detail(check.finish().unwrap_err()), expected);
    }

    #[test]
    fn bounds_lengths_and_missing_values_match_fastapi() {
        let query = QueryParams::parse(Some("page=1001&s=a&g=0&h=10&page=1001"));
        let mut check = Validator::default();
        check
            .query(&query, "page")
            .int_or(1, Limits::default().ge(1).le(1000));
        check
            .query(&query, "s")
            .string_or("", Length::default().min(2).max(5));
        check
            .query(&query, "g")
            .int_or(1, Limits::default().gt(0).lt(10));
        check
            .query(&query, "h")
            .int_or(1, Limits::default().gt(0).lt(10));
        check.query(&query, "x").int(Limits::default());
        let expected = json!([
            {"type": "less_than_equal", "loc": ["query", "page"], "msg": "Input should be less than or equal to 1000", "input": "1001", "ctx": {"le": 1000}},
            {"type": "string_too_short", "loc": ["query", "s"], "msg": "String should have at least 2 characters", "input": "a", "ctx": {"min_length": 2}},
            {"type": "greater_than", "loc": ["query", "g"], "msg": "Input should be greater than 0", "input": "0", "ctx": {"gt": 0}},
            {"type": "less_than", "loc": ["query", "h"], "msg": "Input should be less than 10", "input": "10", "ctx": {"lt": 10}},
            {"type": "missing", "loc": ["query", "x"], "msg": "Field required", "input": null}
        ]);
        assert_eq!(detail(check.finish().unwrap_err()), expected);
    }

    #[test]
    fn repeated_scalars_take_the_last_value_and_lengths_count_characters() {
        let query = QueryParams::parse(Some("page=2&page=3&s=%C3%A9%C3%A9%C3%A9%C3%A9%C3%A9"));
        let mut check = Validator::default();
        assert_eq!(check.query(&query, "page").int_or(1, Limits::default()), 3);
        assert_eq!(
            check
                .query(&query, "s")
                .string_or("", Length::default().max(5)),
            "ééééé"
        );
        assert!(check.finish().is_ok());
    }

    #[test]
    fn uuid_messages_match_pydantic() {
        for (raw, message) in [
            ("123", "invalid length: found 3"),
            (
                "ZZ345678-1234-5678-1234-567812345678",
                "invalid character: found `Z` at 0",
            ),
            (
                "12345678-1234-5678-1234-5678123456781",
                "invalid group length in group 4: expected 12, found 13",
            ),
        ] {
            let query = QueryParams::parse(Some(&format!("u={raw}")));
            let mut check = Validator::default();
            check.query(&query, "u").optional_uuid();
            let issues = detail(check.finish().unwrap_err());
            assert_eq!(
                issues[0]["msg"],
                format!("Input should be a valid UUID, {message}")
            );
        }
        let query = QueryParams::parse(Some("u=%7B12345678-1234-5678-1234-567812345678%7D"));
        let mut check = Validator::default();
        assert!(check.query(&query, "u").optional_uuid().is_some());
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    #[allow(dead_code)]
    struct Body {
        name: String,
        #[serde(default)]
        n: i64,
    }

    fn body_detail(body: &[u8], is_json: bool) -> Value {
        detail(parse_json_body::<Body>(body, is_json).unwrap_err())
    }

    #[test]
    fn body_errors_follow_fastapi() {
        assert_eq!(
            body_detail(b"", true),
            json!([{"type": "missing", "loc": ["body"], "msg": "Field required", "input": null}])
        );
        assert_eq!(
            body_detail(b"{}", true),
            json!([{"type": "missing", "loc": ["body", "name"], "msg": "Field required", "input": {}}])
        );
        assert_eq!(
            body_detail(br#"{"name": 1}"#, true),
            json!([{"type": "string_type", "loc": ["body", "name"], "msg": "Input should be a valid string", "input": 1}])
        );
        assert_eq!(
            body_detail(br#"{"name": "a", "n": "x"}"#, true),
            json!([{"type": "int_type", "loc": ["body", "n"], "msg": "Input should be a valid integer", "input": "x"}])
        );
        assert_eq!(
            body_detail(br#"{"name": "a", "other": 2}"#, true),
            json!([{"type": "extra_forbidden", "loc": ["body", "other"], "msg": "Extra inputs are not permitted", "input": 2}])
        );
        assert_eq!(
            body_detail(b"name=x", false),
            json!([{"type": "model_attributes_type", "loc": ["body"], "msg": "Input should be a valid dictionary or object to extract fields from", "input": "name=x"}])
        );
        let invalid = body_detail(b"{bad", true);
        assert_eq!(invalid[0]["type"], "json_invalid");
        assert_eq!(invalid[0]["loc"], json!(["body", 1]));
        assert_eq!(invalid[0]["msg"], "JSON decode error");
    }
}
