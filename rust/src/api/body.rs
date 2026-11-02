//! JSON request bodies validated the way pydantic validates a request model,
//! with FastAPI's 422 shape.
//!
//! `ValidatedJson<T>` stops at serde's first problem; a model with field
//! constraints and validators needs pydantic's full list instead: every
//! field's first problem in field order, then each unknown key of an
//! `extra="forbid"` model. Read the fields in the model's order:
//!
//! ```text
//! let mut body = Body::parse(&bytes, &headers, Extra::Forbid)?;
//! let name = body.required_string("club_name", &Str::new().min(1).max(200));
//! let page = body.string("club_page", &Str::new().max(2048));
//! body.finish()?;
//! ```
//!
//! A field reads as `Input::Missing` (not sent), `Input::Null` or
//! `Input::Given`, which is what `model_dump(exclude_unset=True)` needs.

use axum::http::HeaderMap;
use regex::Regex;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::errors::ApiError;
use super::validation::{ValidationIssue, parse_json_body};
use crate::text::python_strip;

/// One field of the body.
#[derive(Debug, Clone, PartialEq)]
pub enum Input<T> {
    Missing,
    Null,
    Given(T),
}

impl<T> Default for Input<T> {
    fn default() -> Self {
        Self::Missing
    }
}

impl<T> Input<T> {
    /// Sent, as a value or as `null`.
    pub fn is_set(&self) -> bool {
        !matches!(self, Self::Missing)
    }

    /// The value, with `null` and a missing field both `None`.
    pub fn value(self) -> Option<T> {
        match self {
            Self::Given(value) => Some(value),
            _ => None,
        }
    }

    pub fn map<U>(self, convert: impl FnOnce(T) -> U) -> Input<U> {
        match self {
            Self::Missing => Input::Missing,
            Self::Null => Input::Null,
            Self::Given(value) => Input::Given(convert(value)),
        }
    }
}

/// The model's `extra` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Extra {
    Forbid,
    Ignore,
}

/// A string field's constraints, applied in pydantic's order: strip, then
/// the minimum and maximum length, then the pattern or literal choices.
#[derive(Debug, Clone, Default)]
pub struct Str {
    strip: bool,
    lower: bool,
    min: Option<usize>,
    max: Option<usize>,
    pattern: Option<(&'static str, &'static Regex)>,
    choices: Option<&'static [&'static str]>,
}

impl Str {
    pub fn new() -> Self {
        Self::default()
    }
    /// `str_strip_whitespace=True`.
    pub fn strip(mut self) -> Self {
        self.strip = true;
        self
    }
    /// A `BeforeValidator` that strips and lower-cases (`normalize_club_type`).
    pub fn strip_lower(mut self) -> Self {
        self.strip = true;
        self.lower = true;
        self
    }
    pub fn min(mut self, bound: usize) -> Self {
        self.min = Some(bound);
        self
    }
    pub fn max(mut self, bound: usize) -> Self {
        self.max = Some(bound);
        self
    }
    pub fn pattern(mut self, source: &'static str, regex: &'static Regex) -> Self {
        self.pattern = Some((source, regex));
        self
    }
    /// `Literal[...]`.
    pub fn one_of(mut self, choices: &'static [&'static str]) -> Self {
        self.choices = Some(choices);
        self
    }
}

fn characters(count: usize) -> &'static str {
    if count == 1 { "character" } else { "characters" }
}

/// pydantic's "'a', 'b' or 'c'".
pub fn expected_choices(choices: &[&str]) -> String {
    let quoted: Vec<String> = choices.iter().map(|choice| format!("'{choice}'")).collect();
    match quoted.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} or {last}", rest.join(", ")),
        _ => quoted.join(""),
    }
}

/// A request body object being validated.
pub struct Body {
    object: Map<String, Value>,
    extra: Extra,
    known: Vec<&'static str>,
    issues: Vec<ValidationIssue>,
}

impl Body {
    /// Parse the body, failing at once (as FastAPI does) when it is empty,
    /// not JSON or not an object.
    pub fn parse(bytes: &[u8], headers: &HeaderMap, extra: Extra) -> Result<Self, ApiError> {
        let object: Map<String, Value> =
            parse_json_body(bytes, super::validation::json_content_type(headers))?;
        Ok(Self {
            object,
            extra,
            known: Vec::new(),
            issues: Vec::new(),
        })
    }

    #[cfg(test)]
    pub fn from_value(value: Value, extra: Extra) -> Self {
        Self {
            object: value.as_object().cloned().unwrap_or_default(),
            extra,
            known: Vec::new(),
            issues: Vec::new(),
        }
    }

    fn loc(name: &str) -> Vec<Value> {
        vec![json!("body"), json!(name)]
    }

    fn take(&mut self, name: &'static str) -> Input<Value> {
        self.known.push(name);
        match self.object.get(name) {
            None => Input::Missing,
            Some(Value::Null) => Input::Null,
            Some(value) => Input::Given(value.clone()),
        }
    }

    fn issue(&mut self, kind: &str, loc: Vec<Value>, msg: String, input: Value, ctx: Option<Value>) {
        let mut issue = ValidationIssue::new(kind, loc, msg, input);
        issue.ctx = ctx;
        self.issues.push(issue);
    }

    /// A required field that was not sent.
    pub fn missing(&mut self, name: &str) {
        let issue = ValidationIssue::missing(Self::loc(name), Value::Object(self.object.clone()));
        self.issues.push(issue);
    }

    /// A field validator's `ValueError(message)`.
    pub fn value_error(&mut self, loc: Vec<Value>, input: Value, message: &str) {
        self.issue(
            "value_error",
            loc,
            format!("Value error, {message}"),
            input,
            Some(json!({"error": {}})),
        );
    }

    /// `value_error` at a top-level field.
    pub fn field_error(&mut self, name: &str, input: Value, message: &str) {
        self.value_error(Self::loc(name), input, message);
    }

    /// Check one string against `rules`, reporting at `loc`.
    fn check_string(&mut self, loc: Vec<Value>, value: &Value, rules: &Str) -> Option<String> {
        let Value::String(raw) = value else {
            if let Some(choices) = rules.choices {
                self.literal_error(loc, value.clone(), choices);
            } else {
                self.issue(
                    "string_type",
                    loc,
                    "Input should be a valid string".into(),
                    value.clone(),
                    None,
                );
            }
            return None;
        };
        let mut text = if rules.strip {
            python_strip(raw).to_owned()
        } else {
            raw.clone()
        };
        if rules.lower {
            text = text.to_lowercase();
        }
        // A before-validator's output is what pydantic reports as the input.
        let shown = if rules.lower {
            json!(text)
        } else {
            value.clone()
        };
        let count = text.chars().count();
        if let Some(min) = rules.min.filter(|min| count < *min) {
            self.issue(
                "string_too_short",
                loc,
                format!("String should have at least {min} {}", characters(min)),
                shown,
                Some(json!({"min_length": min})),
            );
            return None;
        }
        if let Some(max) = rules.max.filter(|max| count > *max) {
            self.issue(
                "string_too_long",
                loc,
                format!("String should have at most {max} {}", characters(max)),
                shown,
                Some(json!({"max_length": max})),
            );
            return None;
        }
        if let Some((source, regex)) = rules.pattern
            && !regex.is_match(&text)
        {
            self.issue(
                "string_pattern_mismatch",
                loc,
                format!("String should match pattern '{source}'"),
                shown,
                Some(json!({"pattern": source})),
            );
            return None;
        }
        if let Some(choices) = rules.choices
            && !choices.contains(&text.as_str())
        {
            self.literal_error(loc, shown, choices);
            return None;
        }
        Some(text)
    }

    fn literal_error(&mut self, loc: Vec<Value>, input: Value, choices: &[&str]) {
        let expected = expected_choices(choices);
        self.issue(
            "literal_error",
            loc,
            format!("Input should be {expected}"),
            input,
            Some(json!({"expected": expected})),
        );
    }

    /// An optional string field.
    pub fn string(&mut self, name: &'static str, rules: &Str) -> Input<String> {
        match self.take(name) {
            Input::Given(value) => match self.check_string(Self::loc(name), &value, rules) {
                Some(text) => Input::Given(text),
                None => Input::Missing,
            },
            Input::Null => Input::Null,
            Input::Missing => Input::Missing,
        }
    }

    /// A required, non-null string field.
    pub fn required_string(&mut self, name: &'static str, rules: &Str) -> Option<String> {
        match self.take(name) {
            Input::Given(value) => self.check_string(Self::loc(name), &value, rules),
            Input::Null => {
                self.check_string(Self::loc(name), &Value::Null, rules);
                None
            }
            Input::Missing => {
                self.missing(name);
                None
            }
        }
    }

    /// pydantic's lax boolean from JSON.
    pub fn bool(&mut self, name: &'static str) -> Input<bool> {
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let parsed = match &value {
            Value::Bool(flag) => Some(*flag),
            Value::Number(number) => match number.as_f64() {
                Some(n) if n == 0.0 => Some(false),
                Some(n) if n == 1.0 => Some(true),
                _ => None,
            },
            Value::String(text) => super::validation::parse_python_bool(text),
            _ => {
                self.issue(
                    "bool_type",
                    Self::loc(name),
                    "Input should be a valid boolean".into(),
                    value,
                    None,
                );
                return Input::Missing;
            }
        };
        match parsed {
            Some(flag) => Input::Given(flag),
            None => {
                self.issue(
                    "bool_parsing",
                    Self::loc(name),
                    "Input should be a valid boolean, unable to interpret input".into(),
                    value,
                    None,
                );
                Input::Missing
            }
        }
    }

    /// A required UUID field.
    pub fn required_uuid(&mut self, name: &'static str) -> Option<Uuid> {
        match self.take(name) {
            Input::Given(Value::String(text)) => match Uuid::parse_str(&text) {
                Ok(id) => Some(id),
                Err(error) => {
                    self.issue(
                        "uuid_parsing",
                        Self::loc(name),
                        format!("Input should be a valid UUID, {error}"),
                        json!(text),
                        Some(json!({"error": error.to_string()})),
                    );
                    None
                }
            },
            Input::Missing => {
                self.missing(name);
                None
            }
            Input::Given(other) => {
                self.uuid_type(name, other);
                None
            }
            Input::Null => {
                self.uuid_type(name, Value::Null);
                None
            }
        }
    }

    fn uuid_type(&mut self, name: &str, input: Value) {
        self.issue(
            "uuid_type",
            Self::loc(name),
            "UUID input should be a string, bytes or UUID object".into(),
            input,
            None,
        );
    }

    /// An optional list of strings, each checked against `item`, at most
    /// `max_items` long.
    pub fn string_list(
        &mut self,
        name: &'static str,
        item: &Str,
        max_items: usize,
    ) -> Input<Vec<String>> {
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let Value::Array(items) = &value else {
            self.issue(
                "list_type",
                Self::loc(name),
                "Input should be a valid list".into(),
                value.clone(),
                None,
            );
            return Input::Missing;
        };
        if items.len() > max_items {
            self.issue(
                "too_long",
                Self::loc(name),
                format!(
                    "List should have at most {max_items} items after validation, not {}",
                    items.len()
                ),
                value.clone(),
                Some(json!({"field_type": "List", "max_length": max_items, "actual_length": items.len()})),
            );
            return Input::Missing;
        }
        let before = self.issues.len();
        let mut texts = Vec::with_capacity(items.len());
        for (index, entry) in items.iter().enumerate() {
            let mut loc = Self::loc(name);
            loc.push(json!(index));
            if let Some(text) = self.check_string(loc, entry, item) {
                texts.push(text);
            }
        }
        if self.issues.len() > before {
            return Input::Missing;
        }
        Input::Given(texts)
    }

    /// A required JSON object field (`dict[str, Any]`); with `strip_keys`, keys
    /// are stripped like the model's other strings.
    pub fn required_object(&mut self, name: &'static str, strip_keys: bool) -> Option<Map<String, Value>> {
        match self.take(name) {
            Input::Given(Value::Object(entries)) => Some(if strip_keys {
                entries
                    .into_iter()
                    .map(|(key, value)| (python_strip(&key).to_owned(), value))
                    .collect()
            } else {
                entries
            }),
            Input::Missing => {
                self.missing(name);
                None
            }
            Input::Given(other) => {
                self.dict_type(name, other);
                None
            }
            Input::Null => {
                self.dict_type(name, Value::Null);
                None
            }
        }
    }

    fn dict_type(&mut self, name: &str, input: Value) {
        self.issue(
            "dict_type",
            Self::loc(name),
            "Input should be a valid dictionary".into(),
            input,
            None,
        );
    }

    /// pydantic's `EmailStr`: the normalized address.
    pub fn email(&mut self, name: &'static str) -> Input<String> {
        match self.take(name) {
            Input::Given(Value::String(text)) => match super::email_address::normalize(&text) {
                Ok(address) => Input::Given(address),
                Err(reason) => {
                    self.issue(
                        "value_error",
                        Self::loc(name),
                        format!("value is not a valid email address: {reason}"),
                        json!(text),
                        Some(json!({"reason": reason})),
                    );
                    Input::Missing
                }
            },
            Input::Given(other) => {
                self.check_string(Self::loc(name), &other, &Str::new());
                Input::Missing
            }
            Input::Null => Input::Null,
            Input::Missing => Input::Missing,
        }
    }

    /// pydantic's `HttpUrl` (at most 2083 characters, http or https), as the
    /// normalized URL text pydantic would store.
    pub fn required_http_url(&mut self, name: &'static str, strip: bool) -> Option<String> {
        const MAX_URL_LENGTH: usize = 2083;
        let raw = match self.take(name) {
            Input::Given(Value::String(text)) => text,
            Input::Missing => {
                self.missing(name);
                return None;
            }
            Input::Given(other) => {
                self.issue(
                    "url_type",
                    Self::loc(name),
                    "URL input should be a string or URL".into(),
                    other,
                    None,
                );
                return None;
            }
            Input::Null => {
                self.issue(
                    "url_type",
                    Self::loc(name),
                    "URL input should be a string or URL".into(),
                    Value::Null,
                    None,
                );
                return None;
            }
        };
        let text = if strip { python_strip(&raw) } else { raw.as_str() };
        if text.chars().count() > MAX_URL_LENGTH {
            self.issue(
                "url_too_long",
                Self::loc(name),
                format!("URL should have at most {MAX_URL_LENGTH} characters"),
                json!(raw),
                Some(json!({"max_length": MAX_URL_LENGTH})),
            );
            return None;
        }
        match url::Url::parse(text) {
            Err(error) => {
                self.issue(
                    "url_parsing",
                    Self::loc(name),
                    format!("Input should be a valid URL, {error}"),
                    json!(raw),
                    Some(json!({"error": error.to_string()})),
                );
                None
            }
            Ok(url) if !matches!(url.scheme(), "http" | "https") => {
                self.issue(
                    "url_scheme",
                    Self::loc(name),
                    "URL scheme should be 'http' or 'https'".into(),
                    json!(raw),
                    Some(json!({"expected_schemes": "'http' or 'https'"})),
                );
                None
            }
            Ok(url) => Some(url.to_string()),
        }
    }

    /// Fail with every problem found, after reporting unknown keys of a
    /// `extra="forbid"` model.
    pub fn finish(mut self) -> Result<(), ApiError> {
        if self.extra == Extra::Forbid {
            let unknown: Vec<(String, Value)> = self
                .object
                .iter()
                .filter(|(key, _)| !self.known.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            for (key, value) in unknown {
                self.issue(
                    "extra_forbidden",
                    Self::loc(&key),
                    "Extra inputs are not permitted".into(),
                    value,
                    None,
                );
            }
        }
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(ApiError::RequestValidation(self.issues))
        }
    }
}

/// FastAPI reports path and body problems in one 422, path first.
pub fn merge_issues(check: super::validation::Validator, body: Result<(), ApiError>) -> Result<(), ApiError> {
    match (check.finish(), body) {
        (Ok(()), body) => body,
        (Err(ApiError::RequestValidation(mut path)), Err(ApiError::RequestValidation(body))) => {
            path.extend(body);
            Err(ApiError::RequestValidation(path))
        }
        (Err(path), _) => Err(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::LazyLock;

    static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[a-z0-9]+(?:-[a-z0-9]+)*$").unwrap());

    fn issues(body: Body) -> Value {
        match body.finish() {
            Err(ApiError::RequestValidation(issues)) => json!(issues),
            other => panic!("expected a 422, got {other:?}"),
        }
    }

    #[test]
    fn field_problems_come_in_field_order_then_unknown_keys() {
        // FastAPI's body for POST /clubs/ with these fields (see the PR's probe).
        let mut body = Body::from_value(
            json!({"club_name": "  ", "club_type": "Bad Type!", "submitted_by_email": "not-an-email", "extra": 1}),
            Extra::Forbid,
        );
        body.email("submitted_by_email");
        let name = body.required_string("club_name", &Str::new().min(1).max(200));
        if let Some(name) = name
            && python_strip(&name).is_empty()
        {
            body.field_error("club_name", json!(name), "value cannot be blank");
        }
        body.string(
            "club_type",
            &Str::new().strip_lower().min(1).max(100).pattern("^[a-z0-9]+(?:-[a-z0-9]+)*$", &SLUG),
        );
        assert_eq!(
            issues(body),
            json!([
                {"type": "value_error", "loc": ["body", "submitted_by_email"], "msg": "value is not a valid email address: An email address must have an @-sign.", "input": "not-an-email", "ctx": {"reason": "An email address must have an @-sign."}},
                {"type": "value_error", "loc": ["body", "club_name"], "msg": "Value error, value cannot be blank", "input": "  ", "ctx": {"error": {}}},
                {"type": "string_pattern_mismatch", "loc": ["body", "club_type"], "msg": "String should match pattern '^[a-z0-9]+(?:-[a-z0-9]+)*$'", "input": "bad type!", "ctx": {"pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}},
                {"type": "extra_forbidden", "loc": ["body", "extra"], "msg": "Extra inputs are not permitted", "input": 1}
            ])
        );
    }

    #[test]
    fn types_lists_and_literals_match_pydantic() {
        let mut body = Body::from_value(
            json!({"categories": ["", "a".repeat(101), 5], "flag": 2, "role": "boss", "items": "x", "missing_not": null}),
            Extra::Ignore,
        );
        body.string_list("categories", &Str::new().min(1).max(100), 20);
        body.bool("flag");
        body.required_string("role", &Str::new().one_of(&["user", "admin"]));
        body.string_list("items", &Str::new(), 3);
        body.required_string("absent", &Str::new());
        assert_eq!(
            issues(body),
            json!([
                {"type": "string_too_short", "loc": ["body", "categories", 0], "msg": "String should have at least 1 character", "input": "", "ctx": {"min_length": 1}},
                {"type": "string_too_long", "loc": ["body", "categories", 1], "msg": "String should have at most 100 characters", "input": "a".repeat(101), "ctx": {"max_length": 100}},
                {"type": "string_type", "loc": ["body", "categories", 2], "msg": "Input should be a valid string", "input": 5},
                {"type": "bool_parsing", "loc": ["body", "flag"], "msg": "Input should be a valid boolean, unable to interpret input", "input": 2},
                {"type": "literal_error", "loc": ["body", "role"], "msg": "Input should be 'user' or 'admin'", "input": "boss", "ctx": {"expected": "'user' or 'admin'"}},
                {"type": "list_type", "loc": ["body", "items"], "msg": "Input should be a valid list", "input": "x"},
                {"type": "missing", "loc": ["body", "absent"], "msg": "Field required", "input": {"categories": ["", "a".repeat(101), 5], "flag": 2, "role": "boss", "items": "x", "missing_not": null}}
            ])
        );
    }

    #[test]
    fn too_many_items_and_tri_state_fields() {
        let mut body = Body::from_value(json!({"tags": ["a", "a", "a"], "name": null}), Extra::Forbid);
        assert_eq!(body.string("name", &Str::new()), Input::Null);
        assert_eq!(body.string("other", &Str::new()), Input::Missing);
        body.string_list("tags", &Str::new(), 2);
        assert_eq!(
            issues(body)[0],
            json!({"type": "too_long", "loc": ["body", "tags"], "msg": "List should have at most 2 items after validation, not 3", "input": ["a", "a", "a"], "ctx": {"field_type": "List", "max_length": 2, "actual_length": 3}})
        );
    }

    #[test]
    fn urls_are_normalized_like_pydantic() {
        let mut body = Body::from_value(
            json!({"a": "https://WAT2DO.io", "b": "https://uwaterloo.wat2do.io/events?q=a b#x", "c": "ftp://x", "d": "not a url"}),
            Extra::Ignore,
        );
        assert_eq!(body.required_http_url("a", true).as_deref(), Some("https://wat2do.io/"));
        assert_eq!(
            body.required_http_url("b", true).as_deref(),
            Some("https://uwaterloo.wat2do.io/events?q=a%20b#x")
        );
        body.required_http_url("c", true);
        body.required_http_url("d", true);
        assert_eq!(
            issues(body),
            json!([
                {"type": "url_scheme", "loc": ["body", "c"], "msg": "URL scheme should be 'http' or 'https'", "input": "ftp://x", "ctx": {"expected_schemes": "'http' or 'https'"}},
                {"type": "url_parsing", "loc": ["body", "d"], "msg": "Input should be a valid URL, relative URL without a base", "input": "not a url", "ctx": {"error": "relative URL without a base"}}
            ])
        );
    }

    #[test]
    fn expected_choices_reads_like_pydantic() {
        assert_eq!(expected_choices(&["asc", "desc"]), "'asc' or 'desc'");
        assert_eq!(
            expected_choices(&["events", "clubs", "positions"]),
            "'events', 'clubs' or 'positions'"
        );
        assert_eq!(expected_choices(&["only"]), "'only'");
    }
}
