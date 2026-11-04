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
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Input<T> {
    #[default]
    Missing,
    Null,
    Given(T),
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
    if count == 1 {
        "character"
    } else {
        "characters"
    }
}

/// pydantic's "'a', 'b' or 'c'".
pub fn expected_choices(choices: &[&str]) -> String {
    let quoted: Vec<String> = choices.iter().map(|choice| format!("'{choice}'")).collect();
    match quoted.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} or {last}", rest.join(", ")),
        _ => quoted.join(""),
    }
}

/// A request body object being validated: the request model, or (with a
/// longer `prefix`) a model nested inside it, such as one item of a list.
pub struct Body {
    object: Map<String, Value>,
    extra: Extra,
    known: Vec<&'static str>,
    issues: Vec<ValidationIssue>,
    /// Where this object sits: `["body"]`, or `["body", "items", 0]`.
    prefix: Vec<Value>,
    extras_checked: bool,
}

impl Body {
    /// Parse the body, failing at once (as FastAPI does) when it is empty,
    /// not JSON or not an object.
    pub fn parse(bytes: &[u8], headers: &HeaderMap, extra: Extra) -> Result<Self, ApiError> {
        let value: Value = parse_json_body(bytes, super::validation::json_content_type(headers))?;
        Self::from_json(value, extra)
    }

    /// A decoded body: `null` is a missing body, as in FastAPI, and anything
    /// but an object is refused at once.
    pub fn from_json(value: Value, extra: Extra) -> Result<Self, ApiError> {
        if value.is_null() {
            return Err(ApiError::RequestValidation(vec![ValidationIssue::missing(
                vec![json!("body")],
                Value::Null,
            )]));
        }
        Self::nested(value, vec![json!("body")], extra)
            .map_err(|issue| ApiError::RequestValidation(vec![*issue]))
    }

    /// A nested model at `prefix`, or pydantic's `model_attributes_type`
    /// when `value` is not an object.
    pub fn nested(
        value: Value,
        prefix: Vec<Value>,
        extra: Extra,
    ) -> Result<Self, Box<ValidationIssue>> {
        match value {
            Value::Object(object) => Ok(Self {
                object,
                extra,
                known: Vec::new(),
                issues: Vec::new(),
                prefix,
                extras_checked: false,
            }),
            other => Err(Box::new(ValidationIssue::new(
                "model_attributes_type",
                prefix,
                "Input should be a valid dictionary or object to extract fields from",
                other,
            ))),
        }
    }

    #[cfg(test)]
    pub fn from_value(value: Value, extra: Extra) -> Self {
        Self {
            object: value.as_object().cloned().unwrap_or_default(),
            extra,
            known: Vec::new(),
            issues: Vec::new(),
            prefix: vec![json!("body")],
            extras_checked: false,
        }
    }

    /// One member of a union body (`A | B`): pydantic validates the object
    /// against each member and names the member in every issue's `loc`.
    pub fn member(object: Map<String, Value>, extra: Extra, label: &'static str) -> Self {
        Self {
            object,
            extra,
            known: Vec::new(),
            issues: Vec::new(),
            prefix: vec![json!("body"), json!(label)],
            extras_checked: false,
        }
    }

    /// A field's location, as pydantic reports it.
    pub fn loc(&self, name: &str) -> Vec<Value> {
        let mut loc = self.prefix.clone();
        loc.push(json!(name));
        loc
    }

    /// This object's own location (where a model validator reports).
    pub fn model_loc(&self) -> Vec<Value> {
        self.prefix.clone()
    }

    /// The object as sent (a model validator's `input`).
    pub fn input(&self) -> Value {
        Value::Object(self.object.clone())
    }

    /// A `model_validator`'s `ValueError(message)`, reported at the model.
    pub fn model_error(&mut self, message: &str) {
        let (loc, input) = (self.model_loc(), self.input());
        self.value_error(loc, input, message);
    }

    /// An issue below a field (`loc` continues with `path`), such as one
    /// member of a field's own union.
    pub fn nested_issue(&mut self, path: &[&str], kind: &str, msg: &str, input: &Value) {
        let mut loc = self.model_loc();
        loc.extend(path.iter().map(|part| json!(part)));
        self.issue(kind, loc, msg.into(), input.clone(), None);
    }

    /// A `Literal[...]` field with a default: missing reads as `default`,
    /// and `null` is refused like any other value.
    pub fn literal_or(
        &mut self,
        name: &'static str,
        default: &'static str,
        choices: &'static [&'static str],
    ) -> Option<String> {
        match self.take(name) {
            Input::Missing => Some(default.to_owned()),
            Input::Null => {
                let loc = self.loc(name);
                self.literal_error(loc, Value::Null, choices);
                None
            }
            Input::Given(value) => {
                let loc = self.loc(name);
                self.check_string(loc, &value, &Str::new().one_of(choices))
            }
        }
    }

    /// `int` with a default when missing (not `Optional`: `null` is
    /// refused), checked against `limits`.
    pub fn int_or(
        &mut self,
        name: &'static str,
        default: i64,
        limits: super::validation::Limits,
    ) -> Option<i64> {
        let before = self.issues.len();
        let input = self.object.get(name).cloned().unwrap_or(Value::Null);
        match self.int(name) {
            Input::Given(integer) => {
                if let Some((kind, msg, ctx)) = limits.violation(integer) {
                    let loc = self.loc(name);
                    self.issue(kind, loc, msg, input, Some(ctx));
                    return None;
                }
                Some(integer)
            }
            Input::Null => {
                let loc = self.loc(name);
                self.issue(
                    "int_type",
                    loc,
                    "Input should be a valid integer".into(),
                    Value::Null,
                    None,
                );
                None
            }
            Input::Missing => (self.issues.len() == before).then_some(default),
        }
    }

    /// pydantic's lax `float` from JSON (a number, a bool or a numeric
    /// string), with a default when missing; `null` is refused.
    pub fn float_or(
        &mut self,
        name: &'static str,
        default: f64,
        limits: super::validation::FloatLimits,
    ) -> Option<f64> {
        let value = match self.take(name) {
            Input::Missing => return Some(default),
            Input::Null => Value::Null,
            Input::Given(value) => value,
        };
        let loc = self.loc(name);
        let parsed = match &value {
            Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
            Value::Number(number) => number.as_f64(),
            Value::String(text) => match super::validation::parse_python_float(text) {
                Some(float) => Some(float),
                None => {
                    self.issue(
                        "float_parsing",
                        loc,
                        "Input should be a valid number, unable to parse string as a number".into(),
                        value.clone(),
                        None,
                    );
                    return None;
                }
            },
            _ => None,
        };
        let Some(float) = parsed else {
            self.issue(
                "float_type",
                loc,
                "Input should be a valid number".into(),
                value,
                None,
            );
            return None;
        };
        if let Some((kind, msg, ctx)) = limits.violation(float) {
            self.issue(kind, loc, msg, value, Some(ctx));
            return None;
        }
        Some(float)
    }

    fn take(&mut self, name: &'static str) -> Input<Value> {
        self.known.push(name);
        match self.object.get(name) {
            None => Input::Missing,
            Some(Value::Null) => Input::Null,
            Some(value) => Input::Given(value.clone()),
        }
    }

    fn issue(
        &mut self,
        kind: &str,
        loc: Vec<Value>,
        msg: String,
        input: Value,
        ctx: Option<Value>,
    ) {
        let mut issue = ValidationIssue::new(kind, loc, msg, input);
        issue.ctx = ctx;
        self.issues.push(issue);
    }

    /// A required field that was not sent.
    pub fn missing(&mut self, name: &str) {
        let issue = ValidationIssue::missing(self.loc(name), self.input());
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
        self.value_error(self.loc(name), input, message);
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
            Input::Given(value) => match self.check_string(self.loc(name), &value, rules) {
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
            Input::Given(value) => self.check_string(self.loc(name), &value, rules),
            Input::Null => {
                self.check_string(self.loc(name), &Value::Null, rules);
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
            // 0 and 1 are booleans; another whole number is unreadable
            // (`bool_parsing`); a fraction, or a number too large for an
            // integer, is the wrong type (`bool_type`).
            Value::Number(number) if !whole_i64(number) => {
                self.issue(
                    "bool_type",
                    self.loc(name),
                    "Input should be a valid boolean".into(),
                    value,
                    None,
                );
                return Input::Missing;
            }
            Value::Number(number) => match number.as_f64() {
                Some(0.0) => Some(false),
                Some(1.0) => Some(true),
                _ => None,
            },
            Value::String(text) => super::validation::parse_python_bool(text),
            _ => {
                self.issue(
                    "bool_type",
                    self.loc(name),
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
                    self.loc(name),
                    "Input should be a valid boolean, unable to interpret input".into(),
                    value,
                    None,
                );
                Input::Missing
            }
        }
    }

    /// pydantic's lax `int` from JSON: whole numbers (also as floats or
    /// numeric strings) and booleans. A fraction is `int_from_float`, a
    /// number beyond 64 bits `int_parsing_size` (pydantic accepts larger
    /// integers given as digits; no column here holds one).
    pub fn int(&mut self, name: &'static str) -> Input<i64> {
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let loc = self.loc(name);
        let (kind, msg) = match &value {
            Value::Bool(flag) => return Input::Given(i64::from(*flag)),
            Value::Number(number) => {
                if let Some(int) = number.as_i64() {
                    return Input::Given(int);
                }
                let float = number.as_f64().unwrap_or(f64::INFINITY);
                if number.is_f64() && float.fract() != 0.0 {
                    (
                        "int_from_float",
                        "Input should be a valid integer, got a number with a fractional part",
                    )
                } else if number.is_f64() && float.abs() < 9_223_372_036_854_775_808.0 {
                    return Input::Given(float as i64);
                } else {
                    (
                        "int_parsing_size",
                        "Unable to parse input string as an integer, exceeded maximum size",
                    )
                }
            }
            Value::String(text) => match super::validation::parse_python_int(text) {
                Some(int) => return Input::Given(int),
                None if text
                    .trim()
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'-' || byte == b'+')
                    && text.trim().bytes().any(|byte| byte.is_ascii_digit()) =>
                {
                    (
                        "int_parsing_size",
                        "Unable to parse input string as an integer, exceeded maximum size",
                    )
                }
                None => (
                    "int_parsing",
                    "Input should be a valid integer, unable to parse string as an integer",
                ),
            },
            _ => ("int_type", "Input should be a valid integer"),
        };
        self.issue(kind, loc, msg.into(), value, None);
        Input::Missing
    }

    /// A `bool` field with a default (not `Optional`): missing reads as
    /// `default`, and `null` is refused as pydantic refuses it.
    pub fn bool_or(&mut self, name: &'static str, default: bool) -> bool {
        match self.bool(name) {
            Input::Given(flag) => flag,
            Input::Null => {
                self.issue(
                    "bool_type",
                    self.loc(name),
                    "Input should be a valid boolean".into(),
                    Value::Null,
                    None,
                );
                default
            }
            Input::Missing => default,
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
                        self.loc(name),
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
            self.loc(name),
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
                self.loc(name),
                "Input should be a valid list".into(),
                value.clone(),
                None,
            );
            return Input::Missing;
        };
        if items.len() > max_items {
            self.issue(
                "too_long",
                self.loc(name),
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
            let mut loc = self.loc(name);
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

    /// Whether the field was sent (as a value or `null`).
    pub fn has_field(&self, name: &str) -> bool {
        self.object.contains_key(name)
    }

    /// A field's value as sent, without reading it.
    pub fn raw_copy(&self, name: &str) -> Option<Value> {
        self.object.get(name).cloned()
    }

    /// A type error at a field (`null` for a required, non-optional field).
    pub fn type_error(&mut self, name: &str, kind: &str, message: &str) {
        let input = self.raw_copy(name).unwrap_or(Value::Null);
        self.issue(kind, self.loc(name), message.into(), input, None);
    }

    /// Another field's raw value, marking it known (for a custom validator).
    pub fn raw(&mut self, name: &'static str) -> Input<Value> {
        self.take(name)
    }

    /// A strict `bool | None` (`Field(strict=True)`): only JSON booleans.
    pub fn strict_bool(&mut self, name: &'static str) -> Input<bool> {
        match self.take(name) {
            Input::Given(Value::Bool(flag)) => Input::Given(flag),
            Input::Given(other) => {
                self.issue(
                    "bool_type",
                    self.loc(name),
                    "Input should be a valid boolean".into(),
                    other,
                    None,
                );
                Input::Missing
            }
            other => other.map(|_| false),
        }
    }

    /// A lax `float` within `[ge, le]`, refusing NaN and infinities
    /// (`allow_inf_nan=False`).
    pub fn finite_float(&mut self, name: &'static str, ge: f64, le: f64) -> Input<f64> {
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let loc = self.loc(name);
        let parsed = match &value {
            Value::Bool(flag) => f64::from(u8::from(*flag)),
            Value::Number(number) => number.as_f64().unwrap_or(f64::INFINITY),
            Value::String(text) => match super::validation::parse_python_float(text) {
                Some(float) => float,
                None => {
                    self.issue(
                        "float_parsing",
                        loc,
                        "Input should be a valid number, unable to parse string as a number".into(),
                        value,
                        None,
                    );
                    return Input::Missing;
                }
            },
            _ => {
                self.issue(
                    "float_type",
                    loc,
                    "Input should be a valid number".into(),
                    value,
                    None,
                );
                return Input::Missing;
            }
        };
        if !parsed.is_finite() {
            self.issue(
                "finite_number",
                loc,
                "Input should be a finite number".into(),
                value,
                None,
            );
            return Input::Missing;
        }
        if parsed < ge {
            self.issue(
                "greater_than_equal",
                loc,
                format!(
                    "Input should be greater than or equal to {}",
                    super::validation::bound_text(ge)
                ),
                value,
                Some(json!({"ge": ge})),
            );
            return Input::Missing;
        }
        if parsed > le {
            self.issue(
                "less_than_equal",
                loc,
                format!(
                    "Input should be less than or equal to {}",
                    super::validation::bound_text(le)
                ),
                value,
                Some(json!({"le": le})),
            );
            return Input::Missing;
        }
        Input::Given(parsed)
    }

    /// A lax `int` of any size with an optional `ge`: pydantic accepts
    /// integers beyond 64 bits (`PyInt::Huge`), which Postgres then refuses.
    pub fn unbounded_int(
        &mut self,
        name: &'static str,
        ge: Option<i64>,
    ) -> Input<super::validation::PyInt> {
        use super::validation::PyInt;
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let loc = self.loc(name);
        let parsed = match &value {
            Value::Bool(flag) => PyInt::Small(i64::from(*flag)),
            Value::Number(number) => match number.as_i64() {
                Some(integer) => PyInt::Small(integer),
                None => {
                    let float = number.as_f64().unwrap_or(f64::NAN);
                    if float.fract() != 0.0 || !float.is_finite() {
                        self.issue(
                            "int_from_float",
                            loc,
                            "Input should be a valid integer, got a number with a fractional part"
                                .into(),
                            value,
                            None,
                        );
                        return Input::Missing;
                    }
                    if float.abs() < 9.2e18 {
                        PyInt::Small(float as i64)
                    } else {
                        PyInt::Huge
                    }
                }
            },
            Value::String(text) => match super::validation::parse_unbounded_int(text) {
                Some(parsed) => parsed,
                None => {
                    self.issue(
                        "int_parsing",
                        loc,
                        "Input should be a valid integer, unable to parse string as an integer"
                            .into(),
                        value,
                        None,
                    );
                    return Input::Missing;
                }
            },
            _ => {
                self.issue(
                    "int_type",
                    loc,
                    "Input should be a valid integer".into(),
                    value,
                    None,
                );
                return Input::Missing;
            }
        };
        if let (PyInt::Small(integer), Some(bound)) = (parsed, ge)
            && integer < bound
        {
            self.issue(
                "greater_than_equal",
                loc,
                format!("Input should be greater than or equal to {bound}"),
                value,
                Some(json!({"ge": bound})),
            );
            return Input::Missing;
        }
        Input::Given(parsed)
    }

    /// An `AwareDatetime` (`| None`), normalized to UTC; a JSON number is a
    /// Unix timestamp.
    pub fn aware_datetime(&mut self, name: &'static str) -> Input<chrono::DateTime<chrono::Utc>> {
        use super::validation::ParsedDatetime;
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let loc = self.loc(name);
        let (text, kind, prefix) = match &value {
            Value::String(text) => (
                text.clone(),
                "datetime_from_date_parsing",
                "Input should be a valid datetime or date",
            ),
            Value::Number(number) => (
                number.to_string(),
                "datetime_parsing",
                "Input should be a valid datetime",
            ),
            _ => {
                self.issue(
                    "datetime_type",
                    loc,
                    "Input should be a valid datetime".into(),
                    value,
                    None,
                );
                return Input::Missing;
            }
        };
        match super::validation::parse_datetime(&text) {
            Ok(ParsedDatetime::Aware(at)) => Input::Given(at.with_timezone(&chrono::Utc)),
            Ok(ParsedDatetime::Naive(_)) => {
                self.issue(
                    "timezone_aware",
                    loc,
                    "Input should have timezone info".into(),
                    value,
                    None,
                );
                Input::Missing
            }
            Err(error) => {
                self.issue(
                    kind,
                    loc,
                    format!("{prefix}, {error}"),
                    value,
                    Some(json!({"error": error})),
                );
                Input::Missing
            }
        }
    }

    /// A `UUID | None`.
    pub fn uuid(&mut self, name: &'static str) -> Input<Uuid> {
        match self.take(name) {
            Input::Given(Value::String(text)) => match Uuid::parse_str(&text) {
                Ok(id) => Input::Given(id),
                Err(error) => {
                    self.issue(
                        "uuid_parsing",
                        self.loc(name),
                        format!("Input should be a valid UUID, {error}"),
                        json!(text),
                        Some(json!({"error": error.to_string()})),
                    );
                    Input::Missing
                }
            },
            Input::Given(other) => {
                self.uuid_type(name, other);
                Input::Missing
            }
            other => other.map(|_| Uuid::nil()),
        }
    }

    /// A `dict | None` field.
    pub fn object(&mut self, name: &'static str) -> Input<Map<String, Value>> {
        match self.take(name) {
            Input::Given(Value::Object(entries)) => Input::Given(entries),
            Input::Given(other) => {
                self.dict_type(name, other);
                Input::Missing
            }
            other => other.map(|_| Map::new()),
        }
    }

    /// A list (`list[...]`) of `min..=max` items, each read by `item` at
    /// `[name, index]`. As in pydantic, too many items is reported alone;
    /// too few is reported once the items are valid.
    pub fn list<T>(
        &mut self,
        name: &'static str,
        min: usize,
        max: usize,
        mut item: impl FnMut(&mut Self, Vec<Value>, Value) -> Option<T>,
    ) -> Input<Vec<T>> {
        let value = match self.take(name) {
            Input::Given(value) => value,
            Input::Null => return Input::Null,
            Input::Missing => return Input::Missing,
        };
        let loc = self.loc(name);
        let Value::Array(items) = &value else {
            self.issue(
                "list_type",
                loc,
                "Input should be a valid list".into(),
                value,
                None,
            );
            return Input::Missing;
        };
        let plural = |count: usize| if count == 1 { "item" } else { "items" };
        if items.len() > max {
            self.issue(
                "too_long",
                loc,
                format!(
                    "List should have at most {max} {} after validation, not {}",
                    plural(max),
                    items.len()
                ),
                value.clone(),
                Some(
                    json!({"field_type": "List", "max_length": max, "actual_length": items.len()}),
                ),
            );
            return Input::Missing;
        }
        let before = self.issues.len();
        let mut parsed = Vec::with_capacity(items.len());
        for (index, entry) in items.iter().enumerate() {
            let mut at = loc.clone();
            at.push(json!(index));
            if let Some(value) = item(self, at, entry.clone()) {
                parsed.push(value);
            }
        }
        if self.issues.len() > before {
            return Input::Missing;
        }
        if items.len() < min {
            self.issue(
                "too_short",
                loc,
                format!(
                    "List should have at least {min} {} after validation, not {}",
                    plural(min),
                    items.len()
                ),
                value.clone(),
                Some(
                    json!({"field_type": "List", "min_length": min, "actual_length": items.len()}),
                ),
            );
            return Input::Missing;
        }
        Input::Given(parsed)
    }

    /// A required `list[UUID]` of `min..=max` items, each bad item reported
    /// at its index.
    pub fn required_uuid_list(
        &mut self,
        name: &'static str,
        min: usize,
        max: usize,
    ) -> Option<Vec<Uuid>> {
        if !self.has_field(name) {
            self.missing(name);
            return None;
        }
        match self.list(name, min, max, |body, loc, value| {
            body.uuid_item(loc, value)
        }) {
            Input::Given(ids) => Some(ids),
            Input::Null => {
                let loc = self.loc(name);
                self.issue(
                    "list_type",
                    loc,
                    "Input should be a valid list".into(),
                    Value::Null,
                    None,
                );
                None
            }
            Input::Missing => None,
        }
    }

    /// One nested model in a list: `read` gets its own `Body` at `loc`,
    /// whose problems join this one's.
    pub fn nested_item<T>(
        &mut self,
        loc: Vec<Value>,
        value: Value,
        extra: Extra,
        read: impl FnOnce(&mut Self) -> Option<T>,
    ) -> Option<T> {
        match Self::nested(value, loc, extra) {
            Err(issue) => {
                self.issues.push(*issue);
                None
            }
            Ok(mut child) => {
                let result = read(&mut child);
                self.issues.extend(child.into_issues());
                result
            }
        }
    }

    /// One string list item checked against `rules`.
    pub fn string_item(&mut self, loc: Vec<Value>, value: &Value, rules: &Str) -> Option<String> {
        self.check_string(loc, value, rules)
    }

    /// One UUID list item.
    pub fn uuid_item(&mut self, loc: Vec<Value>, value: Value) -> Option<Uuid> {
        let Value::String(text) = &value else {
            self.issue(
                "uuid_type",
                loc,
                "UUID input should be a string, bytes or UUID object".into(),
                value,
                None,
            );
            return None;
        };
        match Uuid::parse_str(text) {
            Ok(id) => Some(id),
            Err(error) => {
                self.issue(
                    "uuid_parsing",
                    loc,
                    format!("Input should be a valid UUID, {error}"),
                    value.clone(),
                    Some(json!({"error": error.to_string()})),
                );
                None
            }
        }
    }

    /// A required JSON object field (`dict[str, Any]`); with `strip_keys`, keys
    /// are stripped like the model's other strings.
    pub fn required_object(
        &mut self,
        name: &'static str,
        strip_keys: bool,
    ) -> Option<Map<String, Value>> {
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
            self.loc(name),
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
                        self.loc(name),
                        format!("value is not a valid email address: {reason}"),
                        json!(text),
                        Some(json!({"reason": reason})),
                    );
                    Input::Missing
                }
            },
            Input::Given(other) => {
                self.check_string(self.loc(name), &other, &Str::new());
                Input::Missing
            }
            Input::Null => Input::Null,
            Input::Missing => Input::Missing,
        }
    }

    /// A required, non-null `EmailStr`.
    pub fn required_email(&mut self, name: &'static str) -> Option<String> {
        if !self.has_field(name) {
            self.known.push(name);
            self.missing(name);
            return None;
        }
        match self.email(name) {
            Input::Given(address) => Some(address),
            Input::Null => {
                self.check_string(self.loc(name), &Value::Null, &Str::new());
                None
            }
            Input::Missing => None,
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
                    self.loc(name),
                    "URL input should be a string or URL".into(),
                    other,
                    None,
                );
                return None;
            }
            Input::Null => {
                self.issue(
                    "url_type",
                    self.loc(name),
                    "URL input should be a string or URL".into(),
                    Value::Null,
                    None,
                );
                return None;
            }
        };
        let text = if strip {
            python_strip(&raw)
        } else {
            raw.as_str()
        };
        if text.chars().count() > MAX_URL_LENGTH {
            self.issue(
                "url_too_long",
                self.loc(name),
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
                    self.loc(name),
                    format!("Input should be a valid URL, {error}"),
                    json!(raw),
                    Some(json!({"error": error.to_string()})),
                );
                None
            }
            Ok(url) if !matches!(url.scheme(), "http" | "https") => {
                self.issue(
                    "url_scheme",
                    self.loc(name),
                    "URL scheme should be 'http' or 'https'".into(),
                    json!(raw),
                    Some(json!({"expected_schemes": "'http' or 'https'"})),
                );
                None
            }
            Ok(url) => Some(url.to_string()),
        }
    }

    /// Report the unknown keys of an `extra="forbid"` model (once). pydantic
    /// reports them after the fields, before any model validator runs.
    pub fn check_extras(&mut self) {
        if self.extras_checked || self.extra != Extra::Forbid {
            return;
        }
        self.extras_checked = true;
        let unknown: Vec<(String, Value)> = self
            .object
            .iter()
            .filter(|(key, _)| !self.known.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        for (key, value) in unknown {
            self.issue(
                "extra_forbidden",
                self.loc(&key),
                "Extra inputs are not permitted".into(),
                value,
                None,
            );
        }
    }

    /// Whether any problem has been found so far.
    pub fn has_issues(&self) -> bool {
        !self.issues.is_empty()
    }

    /// Every problem found, unknown keys included.
    pub fn into_issues(mut self) -> Vec<ValidationIssue> {
        self.check_extras();
        self.issues
    }

    /// Fail with every problem found, after reporting unknown keys of a
    /// `extra="forbid"` model.
    pub fn finish(self) -> Result<(), ApiError> {
        let issues = self.into_issues();
        if issues.is_empty() {
            Ok(())
        } else {
            Err(ApiError::RequestValidation(issues))
        }
    }
}

/// Whether a JSON number is a whole number that fits in 64 bits.
fn whole_i64(number: &serde_json::Number) -> bool {
    if number.is_i64() {
        return true;
    }
    if number.is_u64() {
        return false;
    }
    number
        .as_f64()
        .is_some_and(|float| float.fract() == 0.0 && float.abs() < 9_223_372_036_854_775_808.0)
}

/// A request whose body is read and JSON-checked before its extractors run,
/// as FastAPI decodes a body before it resolves dependencies (malformed JSON
/// is a 422 even without a token). Extract from `parts` afterwards.
pub async fn json_first(
    request: axum::extract::Request,
) -> Result<(axum::http::request::Parts, axum::body::Bytes), ApiError> {
    let (parts, body) = request.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX)
        .await
        .map_err(|error| ApiError::Internal(anyhow::anyhow!("request body: {error}")))?;
    check_json_syntax(&bytes, &parts.headers)?;
    Ok((parts, bytes))
}

/// FastAPI decodes a JSON body before it runs a route's dependencies, so
/// malformed JSON is a 422 before (for example) a rate limit is counted;
/// the body's other problems are reported after them.
pub fn check_json_syntax(bytes: &[u8], headers: &HeaderMap) -> Result<(), ApiError> {
    let is_json = super::validation::json_content_type(headers);
    if bytes.is_empty()
        || !is_json
        || serde_json::from_slice::<serde::de::IgnoredAny>(bytes).is_ok()
    {
        return Ok(());
    }
    parse_json_body::<Value>(bytes, true).map(|_| ())
}

/// FastAPI reports path and body problems in one 422, path first.
pub fn merge_issues<T>(
    check: super::validation::Validator,
    body: Result<T, ApiError>,
) -> Result<T, ApiError> {
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

    static SLUG: LazyLock<Regex> =
        LazyLock::new(|| Regex::new("^[a-z0-9]+(?:-[a-z0-9]+)*$").unwrap());

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
            &Str::new()
                .strip_lower()
                .min(1)
                .max(100)
                .pattern("^[a-z0-9]+(?:-[a-z0-9]+)*$", &SLUG),
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
        let mut body = Body::from_value(
            json!({"tags": ["a", "a", "a"], "name": null}),
            Extra::Forbid,
        );
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
        assert_eq!(
            body.required_http_url("a", true).as_deref(),
            Some("https://wat2do.io/")
        );
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
    fn only_malformed_json_fails_the_syntax_check() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::CONTENT_TYPE,
            "application/json".parse().unwrap(),
        );
        assert!(check_json_syntax(b"{\"a\": 1}", &headers).is_ok());
        assert!(check_json_syntax(b"[1]", &headers).is_ok());
        assert!(check_json_syntax(b"", &headers).is_ok());
        match check_json_syntax(b"{bad", &headers) {
            Err(ApiError::RequestValidation(issues)) => assert_eq!(issues[0].kind, "json_invalid"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn booleans_and_integers_match_pydantic() {
        // pydantic 2.14 TypeAdapter(bool).validate_json / a model's `n: int`.
        let kinds = |value: Value, read: fn(&mut Body)| {
            let mut body = Body::from_value(json!({"v": value}), Extra::Ignore);
            read(&mut body);
            match body.finish() {
                Ok(()) => "ok".to_owned(),
                Err(ApiError::RequestValidation(issues)) => issues[0].kind.clone(),
                Err(other) => panic!("{other:?}"),
            }
        };
        let bool_read: fn(&mut Body) = |body| {
            body.bool("v");
        };
        for (value, expected) in [
            (json!(2), "bool_parsing"),
            (json!(-1), "bool_parsing"),
            (json!(2.0), "bool_parsing"),
            (json!("2"), "bool_parsing"),
            (json!("1.0"), "bool_parsing"),
            (json!(2.5), "bool_type"),
            (json!(1e20), "bool_type"),
            (json!([]), "bool_type"),
            (json!(1.0), "ok"),
            (json!(0), "ok"),
            (json!("t"), "ok"),
        ] {
            assert_eq!(kinds(value.clone(), bool_read), expected, "{value}");
        }
        let int_read: fn(&mut Body) = |body| {
            body.int("v");
        };
        for (value, expected) in [
            (json!(1e20), "int_parsing_size"),
            (json!(1e19), "int_parsing_size"),
            (json!(-9.3e18), "int_parsing_size"),
            (json!(9223372036854775807.0), "int_parsing_size"),
            (json!(1.5), "int_from_float"),
            (json!("1.5"), "int_parsing"),
            (json!("abc"), "int_parsing"),
            (json!([]), "int_type"),
            (json!(9.2e18), "ok"),
            (json!(-9.2e18), "ok"),
            (json!(2.0), "ok"),
            (json!(" 12 "), "ok"),
            (json!("1.0"), "ok"),
            (json!(true), "ok"),
        ] {
            assert_eq!(kinds(value.clone(), int_read), expected, "{value}");
        }
        let mut body = Body::from_value(json!({"v": 9.2e18, "w": true, "x": null}), Extra::Ignore);
        assert_eq!(body.int("v"), Input::Given(9_200_000_000_000_000_000));
        assert_eq!(body.int("w"), Input::Given(1));
        assert_eq!(body.int("x"), Input::Null);
    }

    #[test]
    fn defaulted_booleans_refuse_null() {
        let mut body = Body::from_value(json!({"a": null, "c": "yes"}), Extra::Ignore);
        assert!(!body.bool_or("a", false));
        assert!(!body.bool_or("b", false));
        assert!(body.bool_or("c", false));
        assert_eq!(
            issues(body),
            json!([{"type": "bool_type", "loc": ["body", "a"], "msg": "Input should be a valid boolean", "input": null}])
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

    #[test]
    fn a_required_uuid_list_reports_like_pydantic() {
        // pydantic 2 for `payout_ids: list[UUID] = Field(min_length=1, max_length=3)`.
        let read = |value: Value| {
            let mut body = Body::from_value(value, Extra::Forbid);
            let ids = body.required_uuid_list("payout_ids", 1, 3);
            (ids, body.into_issues())
        };
        let (ids, found) = read(json!({}));
        assert_eq!(ids, None);
        assert_eq!(
            json!(found),
            json!([{"type": "missing", "loc": ["body", "payout_ids"], "msg": "Field required", "input": {}}])
        );
        let (_, found) = read(json!({"payout_ids": null}));
        assert_eq!(
            json!(found),
            json!([{"type": "list_type", "loc": ["body", "payout_ids"], "msg": "Input should be a valid list", "input": null}])
        );
        let (_, found) = read(json!({"payout_ids": []}));
        assert_eq!(
            json!(found),
            json!([{"type": "too_short", "loc": ["body", "payout_ids"],
                "msg": "List should have at least 1 item after validation, not 0", "input": [],
                "ctx": {"field_type": "List", "min_length": 1, "actual_length": 0}}])
        );
        let id = "00000000-0000-0000-0000-000000000001";
        let (_, found) = read(json!({"payout_ids": [id, id, id, id]}));
        assert_eq!(
            json!(found),
            json!([{"type": "too_long", "loc": ["body", "payout_ids"],
                "msg": "List should have at most 3 items after validation, not 4", "input": [id, id, id, id],
                "ctx": {"field_type": "List", "max_length": 3, "actual_length": 4}}])
        );
        let (_, found) = read(json!({"payout_ids": ["x", 5]}));
        let found = json!(found);
        assert_eq!(found[0]["type"], "uuid_parsing");
        assert_eq!(found[0]["loc"], json!(["body", "payout_ids", 0]));
        assert_eq!(
            found[1],
            json!({"type": "uuid_type", "loc": ["body", "payout_ids", 1],
                "msg": "UUID input should be a string, bytes or UUID object", "input": 5})
        );
        let (ids, found) = read(json!({"payout_ids": [id]}));
        assert_eq!(ids, Some(vec![Uuid::parse_str(id).unwrap()]));
        assert!(found.is_empty());
    }

    #[test]
    fn a_union_member_names_itself_after_body() {
        let object = json!({"copies": "x", "nope": 1})
            .as_object()
            .unwrap()
            .clone();
        let mut body = Body::member(object, Extra::Forbid, "PromoterPosterBatchCreate");
        body.int_or("copies", 1, crate::api::validation::Limits::default().ge(1));
        body.model_error("check failed");
        let found = json!(body.into_issues());
        assert_eq!(
            found[0]["loc"],
            json!(["body", "PromoterPosterBatchCreate", "copies"])
        );
        assert_eq!(
            found[1]["loc"],
            json!(["body", "PromoterPosterBatchCreate"])
        );
        assert_eq!(found[1]["msg"], "Value error, check failed");
        assert_eq!(
            found[2]["loc"],
            json!(["body", "PromoterPosterBatchCreate", "nope"])
        );
    }

    #[test]
    fn a_defaulted_float_takes_pydantic_bounds() {
        let limits = crate::api::validation::FloatLimits::default()
            .ge(-90.0)
            .le(90.0);
        let mut body = Body::from_value(json!({"latitude": "nan"}), Extra::Ignore);
        assert_eq!(body.float_or("latitude", 0.0, limits), None);
        assert_eq!(body.float_or("longitude", 0.0, limits), Some(0.0));
        assert_eq!(
            issues(body),
            json!([{"type": "less_than_equal", "loc": ["body", "latitude"],
                "msg": "Input should be less than or equal to 90", "input": "nan", "ctx": {"le": 90.0}}])
        );
    }
}
