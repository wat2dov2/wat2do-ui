//! Request bodies validated the way pydantic validates them in FastAPI
//! (python lax mode on the decoded JSON): every problem reported, in field
//! order, with pydantic's types, messages, locations and inputs, and the
//! normalized values `model_dump(mode="json")` gives the service.
//!
//! `EventCreate`, `EventUpdate`, `OccurrenceCreate` / `OccurrenceUpdate`,
//! `GoingEventSelectionUpdate`, `InteractionBatch` / `InteractionCreate`,
//! `ReportCreate` and `ReportUpdate`.

use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::validation::{
    PyDateTimeInput, PyInt, ValidationIssue, parse_python_datetime, parse_python_float,
};
use crate::constants::{
    EVENT_CATEGORIES, MAX_EVENT_CATEGORY_LENGTH, MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT, MAX_EVENT_FOOD_ITEM_LENGTH, MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH, MAX_EVENT_PRICE, MAX_EVENT_TITLE_LENGTH, MAX_URL_LENGTH,
};
use crate::text::python_strip;

/// The decoded body, or FastAPI's 422 for a missing or undecodable one.
pub fn decode(headers: &HeaderMap, body: &[u8]) -> Result<Value, ApiError> {
    let is_json = crate::api::validation::json_content_type(headers);
    match crate::api::validation::parse_json_body::<Value>(body, is_json)? {
        Value::Null => Err(ApiError::RequestValidation(vec![ValidationIssue::missing(
            vec![json!("body")],
            Value::Null,
        )])),
        value => Ok(value),
    }
}

/// Validate the body with `model`, adding its 422 issues after the path's
/// (FastAPI reports path and body problems together).
pub fn validate_into<T>(
    check: &mut crate::api::validation::Validator,
    headers: &HeaderMap,
    body: &[u8],
    model: impl FnOnce(&Value) -> Result<T, ApiError>,
) -> Result<Option<T>, ApiError> {
    match decode(headers, body).and_then(|value| model(&value)) {
        Ok(value) => Ok(Some(value)),
        Err(ApiError::RequestValidation(issues)) => {
            for issue in issues {
                check.push(issue);
            }
            Ok(None)
        }
        Err(other) => Err(other),
    }
}

/// Collects pydantic's issues for one body.
#[derive(Debug, Default)]
pub struct Check {
    pub issues: Vec<ValidationIssue>,
}

fn at(loc: &[Value], key: impl Into<Value>) -> Vec<Value> {
    let mut loc = loc.to_vec();
    loc.push(key.into());
    loc
}

fn characters(count: usize) -> &'static str {
    if count == 1 {
        "character"
    } else {
        "characters"
    }
}

fn items(count: usize) -> &'static str {
    if count == 1 { "item" } else { "items" }
}

impl Check {
    fn push(&mut self, kind: &str, loc: Vec<Value>, msg: impl Into<String>, input: &Value) {
        self.issues
            .push(ValidationIssue::new(kind, loc, msg, input.clone()));
    }

    fn push_ctx(
        &mut self,
        kind: &str,
        loc: Vec<Value>,
        msg: impl Into<String>,
        input: &Value,
        ctx: Value,
    ) {
        self.issues
            .push(ValidationIssue::new(kind, loc, msg, input.clone()).with_ctx(ctx));
    }

    /// `ValueError` raised by a validator: `Value error, {message}`.
    pub fn value_error(&mut self, loc: Vec<Value>, message: &str, input: &Value) {
        self.push_ctx(
            "value_error",
            loc,
            format!("Value error, {message}"),
            input,
            json!({"error": {}}),
        );
    }

    /// The 422 for every issue, or `Ok`.
    pub fn finish(self) -> Result<(), ApiError> {
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(ApiError::RequestValidation(self.issues))
        }
    }

    fn errors_since(&self, mark: usize) -> bool {
        self.issues.len() > mark
    }

    /// A model's object, or `model_attributes_type`.
    pub fn object<'v>(
        &mut self,
        value: &'v Value,
        loc: &[Value],
    ) -> Option<&'v Map<String, Value>> {
        match value {
            Value::Object(map) => Some(map),
            _ => {
                self.push(
                    "model_attributes_type",
                    loc.to_vec(),
                    "Input should be a valid dictionary or object to extract fields from",
                    value,
                );
                None
            }
        }
    }

    /// `extra="forbid"`: every key not in `fields`, in input order.
    fn forbid_extra(&mut self, map: &Map<String, Value>, loc: &[Value], fields: &[&str]) {
        for (key, value) in map {
            if !fields.contains(&key.as_str()) {
                self.push(
                    "extra_forbidden",
                    at(loc, key.as_str()),
                    "Extra inputs are not permitted",
                    value,
                );
            }
        }
    }

    fn missing(&mut self, map: &Map<String, Value>, loc: &[Value], name: &str) {
        self.push(
            "missing",
            at(loc, name),
            "Field required",
            &Value::Object(map.clone()),
        );
    }

    /// `str` with length bounds.
    fn string(&mut self, value: &Value, loc: Vec<Value>, min: usize, max: usize) -> Option<String> {
        let Value::String(text) = value else {
            self.push("string_type", loc, "Input should be a valid string", value);
            return None;
        };
        let count = text.chars().count();
        if count < min {
            self.push_ctx(
                "string_too_short",
                loc,
                format!("String should have at least {min} {}", characters(min)),
                value,
                json!({"min_length": min}),
            );
            return None;
        }
        if count > max {
            self.push_ctx(
                "string_too_long",
                loc,
                format!("String should have at most {max} {}", characters(max)),
                value,
                json!({"max_length": max}),
            );
            return None;
        }
        Some(text.clone())
    }

    /// `str | None` with length bounds.
    fn optional_string(
        &mut self,
        value: &Value,
        loc: Vec<Value>,
        min: usize,
        max: usize,
    ) -> Option<Option<String>> {
        if value.is_null() {
            return Some(None);
        }
        self.string(value, loc, min, max).map(Some)
    }

    /// Lax `bool`.
    fn boolean(&mut self, value: &Value, loc: Vec<Value>) -> Option<bool> {
        let parsed = match value {
            Value::Bool(flag) => Some(*flag),
            Value::String(text) => match crate::api::validation::parse_python_bool(text) {
                Some(flag) => Some(flag),
                None => {
                    self.push(
                        "bool_parsing",
                        loc,
                        "Input should be a valid boolean, unable to interpret input",
                        value,
                    );
                    return None;
                }
            },
            Value::Number(number) => match (number.as_i64(), number.as_f64()) {
                (Some(0), _) => Some(false),
                (Some(1), _) => Some(true),
                (Some(_), _) => {
                    self.push(
                        "bool_parsing",
                        loc,
                        "Input should be a valid boolean, unable to interpret input",
                        value,
                    );
                    return None;
                }
                (None, Some(float)) => (float == 0.0)
                    .then_some(false)
                    .or((float == 1.0).then_some(true)),
                (None, None) => None,
            },
            _ => None,
        };
        if parsed.is_none() {
            self.push("bool_type", loc, "Input should be a valid boolean", value);
        }
        parsed
    }

    /// Strict `bool | None` (`Field(strict=True)`).
    fn strict_optional_bool(&mut self, value: &Value, loc: Vec<Value>) -> Option<Option<bool>> {
        match value {
            Value::Null => Some(None),
            Value::Bool(flag) => Some(Some(*flag)),
            _ => {
                self.push("bool_type", loc, "Input should be a valid boolean", value);
                None
            }
        }
    }

    /// Lax `int` with `ge`; bools count as 0 and 1, floats must be whole.
    fn integer(&mut self, value: &Value, loc: Vec<Value>, ge: Option<i64>) -> Option<PyInt> {
        let parsed = match value {
            Value::Bool(flag) => Some(PyInt::Small(i64::from(*flag))),
            Value::Number(number) => match number.as_i64() {
                Some(integer) => Some(PyInt::Small(integer)),
                None => {
                    let float = number.as_f64().unwrap_or(f64::NAN);
                    if float.fract() != 0.0 || !float.is_finite() {
                        self.push(
                            "int_from_float",
                            loc,
                            "Input should be a valid integer, got a number with a fractional part",
                            value,
                        );
                        return None;
                    }
                    if float.abs() < 9.2e18 {
                        Some(PyInt::Small(float as i64))
                    } else {
                        Some(PyInt::Huge)
                    }
                }
            },
            Value::String(text) => match crate::api::validation::parse_unbounded_int(text) {
                Some(parsed) => Some(parsed),
                None => {
                    self.push(
                        "int_parsing",
                        loc,
                        "Input should be a valid integer, unable to parse string as an integer",
                        value,
                    );
                    return None;
                }
            },
            _ => {
                self.push("int_type", loc, "Input should be a valid integer", value);
                return None;
            }
        };
        if let (Some(PyInt::Small(integer)), Some(bound)) = (parsed, ge)
            && integer < bound
        {
            self.push_ctx(
                "greater_than_equal",
                loc,
                format!("Input should be greater than or equal to {bound}"),
                value,
                json!({"ge": bound}),
            );
            return None;
        }
        parsed
    }

    /// Lax `float`, finite, within `[0, le]` (`PriceField`).
    fn price(&mut self, value: &Value, loc: Vec<Value>, le: f64) -> Option<f64> {
        let parsed = match value {
            Value::Bool(flag) => f64::from(u8::from(*flag)),
            Value::Number(number) => number.as_f64().unwrap_or(f64::INFINITY),
            Value::String(text) => match parse_python_float(text) {
                Some(float) => float,
                None => {
                    self.push(
                        "float_parsing",
                        loc,
                        "Input should be a valid number, unable to parse string as a number",
                        value,
                    );
                    return None;
                }
            },
            _ => {
                self.push("float_type", loc, "Input should be a valid number", value);
                return None;
            }
        };
        if !parsed.is_finite() {
            self.push(
                "finite_number",
                loc,
                "Input should be a finite number",
                value,
            );
            return None;
        }
        if parsed < 0.0 {
            self.push_ctx(
                "greater_than_equal",
                loc,
                "Input should be greater than or equal to 0",
                value,
                json!({"ge": 0.0}),
            );
            return None;
        }
        if parsed > le {
            self.push_ctx(
                "less_than_equal",
                loc,
                format!("Input should be less than or equal to {}", le as i64),
                value,
                json!({"le": le}),
            );
            return None;
        }
        Some(parsed)
    }

    /// A JSON array (`list[...]`); its length is checked after its items
    /// (`list_length`), as pydantic does.
    fn list<'v>(&mut self, value: &'v Value, loc: &[Value]) -> Option<&'v Vec<Value>> {
        let Value::Array(values) = value else {
            self.push(
                "list_type",
                loc.to_vec(),
                "Input should be a valid list",
                value,
            );
            return None;
        };
        Some(values)
    }

    fn list_length(
        &mut self,
        value: &Value,
        loc: &[Value],
        length: usize,
        min: usize,
        max: usize,
    ) -> bool {
        if length < min {
            self.push_ctx(
                "too_short",
                loc.to_vec(),
                format!(
                    "List should have at least {min} {} after validation, not {length}",
                    items(min)
                ),
                value,
                json!({"field_type": "List", "min_length": min, "actual_length": length}),
            );
            return false;
        }
        if length > max {
            self.push_ctx(
                "too_long",
                loc.to_vec(),
                format!(
                    "List should have at most {max} {} after validation, not {length}",
                    items(max)
                ),
                value,
                json!({"field_type": "List", "max_length": max, "actual_length": length}),
            );
            return false;
        }
        true
    }

    /// `UUID`.
    fn uuid(&mut self, value: &Value, loc: Vec<Value>) -> Option<Uuid> {
        let Value::String(text) = value else {
            self.push(
                "uuid_type",
                loc,
                "UUID input should be a string, bytes or UUID object",
                value,
            );
            return None;
        };
        match Uuid::parse_str(text) {
            Ok(parsed) => Some(parsed),
            Err(error) => {
                self.push_ctx(
                    "uuid_parsing",
                    loc,
                    format!("Input should be a valid UUID, {error}"),
                    value,
                    json!({"error": error.to_string()}),
                );
                None
            }
        }
    }

    /// `AwareDatetime`, normalized to UTC.
    fn aware_datetime(&mut self, value: &Value, loc: Vec<Value>) -> Option<DateTime<Utc>> {
        let parsed = match value {
            Value::String(text) => match parse_python_datetime(text) {
                Ok(parsed) => parsed,
                Err(error) => {
                    self.push_ctx(
                        "datetime_from_date_parsing",
                        loc,
                        format!("Input should be a valid datetime or date, {error}"),
                        value,
                        json!({"error": error}),
                    );
                    return None;
                }
            },
            Value::Number(number) => {
                let text = number.to_string();
                match parse_python_datetime(&text) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        self.push_ctx(
                            "datetime_parsing",
                            loc,
                            format!("Input should be a valid datetime, {error}"),
                            value,
                            json!({"error": error}),
                        );
                        return None;
                    }
                }
            }
            _ => {
                self.push(
                    "datetime_type",
                    loc,
                    "Input should be a valid datetime",
                    value,
                );
                return None;
            }
        };
        match parsed {
            PyDateTimeInput::Aware(at) => Some(at.with_timezone(&Utc)),
            PyDateTimeInput::Naive(_) => {
                self.push(
                    "timezone_aware",
                    loc,
                    "Input should have timezone info",
                    value,
                );
                None
            }
        }
    }
}

// ── Shared field validators (`schemas/event.py`) ─────────────────────────

/// `_is_safe_http_url`: `urlparse` gives an http(s) scheme and a netloc.
fn is_safe_http_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    let scheme_ok = scheme
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !scheme_ok {
        return false;
    }
    let scheme = scheme.to_ascii_lowercase();
    let Some(after) = rest.strip_prefix("//") else {
        return false;
    };
    let netloc = &after[..after.find(['/', '?', '#']).unwrap_or(after.len())];
    matches!(scheme.as_str(), "http" | "https") && !netloc.is_empty()
}

/// `_validate_optional_http_url`.
fn http_url(
    check: &mut Check,
    value: Option<String>,
    loc: Vec<Value>,
    input: &Value,
) -> Option<Option<String>> {
    let Some(text) = value else { return Some(None) };
    let stripped = python_strip(&text);
    if stripped.is_empty() {
        return Some(None);
    }
    if !is_safe_http_url(stripped) {
        check.value_error(loc, "URL must use http or https scheme", input);
        return None;
    }
    Some(Some(stripped.to_owned()))
}

/// `_validate_optional_handle`.
fn handle(
    check: &mut Check,
    value: Option<String>,
    loc: Vec<Value>,
    input: &Value,
) -> Option<Option<String>> {
    let Some(text) = value else { return Some(None) };
    let stripped = python_strip(&text);
    if stripped.is_empty() {
        return Some(None);
    }
    if stripped.contains("://") && !is_safe_http_url(stripped) {
        check.value_error(loc, "handle URL must use http or https scheme", input);
        return None;
    }
    Some(Some(stripped.to_owned()))
}

/// `_validate_category`.
fn category(
    check: &mut Check,
    value: Option<String>,
    loc: Vec<Value>,
    input: &Value,
) -> Option<Option<String>> {
    let Some(text) = value.filter(|text| !text.is_empty()) else {
        return Some(None);
    };
    let stripped = python_strip(&text);
    if EVENT_CATEGORIES.contains(&stripped) {
        return Some(Some(stripped.to_owned()));
    }
    tracing::warn!("Unrecognized category {text:?}, dropping it");
    check.value_error(
        loc,
        &format!("category must be one of: {}", EVENT_CATEGORIES.join(", ")),
        input,
    );
    None
}

// ── Occurrences ─────────────────────────────────────────────────────────

/// `OccurrenceCreate` / `OccurrenceUpdate` after validation.
#[derive(Debug, Clone, PartialEq)]
pub struct OccurrenceInput {
    pub id: Option<Uuid>,
    pub dtstart_utc: DateTime<Utc>,
    pub dtend_utc: Option<DateTime<Utc>>,
    pub duration: Option<String>,
    pub tz: Option<String>,
}

impl OccurrenceInput {
    /// `model_dump(mode="json")`: the create shape, plus `id` for updates.
    pub fn dump(&self, with_id: bool) -> Value {
        let mut map = Map::new();
        map.insert(
            "dtstart_utc".into(),
            json!(crate::api::pyjson::format_datetime(&self.dtstart_utc)),
        );
        map.insert(
            "dtend_utc".into(),
            json!(
                self.dtend_utc
                    .as_ref()
                    .map(crate::api::pyjson::format_datetime)
            ),
        );
        map.insert("duration".into(), json!(self.duration));
        map.insert("tz".into(), json!(self.tz));
        if with_id {
            map.insert("id".into(), json!(self.id.map(|id| id.to_string())));
        }
        Value::Object(map)
    }
}

const MAX_DURATION_LENGTH: usize = 64;
const MAX_TZ_LENGTH: usize = 64;

fn occurrence(
    check: &mut Check,
    value: &Value,
    loc: Vec<Value>,
    with_id: bool,
) -> Option<OccurrenceInput> {
    let map = check.object(value, &loc)?;
    let mark = check.issues.len();
    let start = match map.get("dtstart_utc") {
        Some(raw) => check.aware_datetime(raw, at(&loc, "dtstart_utc")),
        None => {
            check.missing(map, &loc, "dtstart_utc");
            None
        }
    };
    let end = match map.get("dtend_utc") {
        Some(Value::Null) | None => Some(None),
        Some(raw) => check.aware_datetime(raw, at(&loc, "dtend_utc")).map(Some),
    };
    let duration = match map.get("duration") {
        Some(raw) => check.optional_string(raw, at(&loc, "duration"), 0, MAX_DURATION_LENGTH),
        None => Some(None),
    };
    let tz = match map.get("tz") {
        Some(raw) => check.optional_string(raw, at(&loc, "tz"), 0, MAX_TZ_LENGTH),
        None => Some(None),
    };
    let id = if with_id {
        match map.get("id") {
            Some(Value::Null) | None => Some(None),
            Some(raw) => check.uuid(raw, at(&loc, "id")).map(Some),
        }
    } else {
        Some(None)
    };
    let fields: &[&str] = if with_id {
        &["dtstart_utc", "dtend_utc", "duration", "tz", "id"]
    } else {
        &["dtstart_utc", "dtend_utc", "duration", "tz"]
    };
    check.forbid_extra(map, &loc, fields);
    if check.errors_since(mark) {
        return None;
    }
    let (start, end) = (start?, end?);
    if end.is_some_and(|end| end <= start) {
        check.value_error(loc, "dtend_utc must be after dtstart_utc", value);
        return None;
    }
    Some(OccurrenceInput {
        id: id?,
        dtstart_utc: start,
        dtend_utc: end,
        duration: duration?,
        tz: tz?,
    })
}

// ── EventCreate / EventUpdate ─────────────────────────────────────────────

const DISCOVERY_FIELDS: [&str; 4] = [
    "competition",
    "employers_on_campus",
    "sports_game",
    "campus_season_ids",
];
const EVENT_FIELDS: [&str; 14] = [
    "title",
    "description",
    "location",
    "map_location",
    "occurrences",
    "price",
    "food",
    "registration",
    "source_image_url",
    "source_url",
    "category",
    "club_id",
    "ig_handle",
    "cancelled",
];

/// A validated event body: the fields that were sent, normalized, in the
/// model's field order (`model_dump(mode="json", exclude_unset=True)` for an
/// update; every field with its default for a create), plus the occurrences.
#[derive(Debug, Clone, Default)]
pub struct EventInput {
    /// The event columns to write, without `occurrences`.
    pub fields: Map<String, Value>,
    /// `None` when an update leaves the occurrences as they are.
    pub occurrences: Option<Vec<OccurrenceInput>>,
    /// The owning club, when the body names one.
    pub club_id: Option<PyInt>,
    /// Whether `campus_season_ids` was sent.
    pub sets_campus_seasons: bool,
}

/// Validate an `EventCreate` (`update == false`) or `EventUpdate` body.
pub fn event(value: &Value, update: bool) -> Result<EventInput, ApiError> {
    let mut check = Check::default();
    let loc = vec![json!("body")];
    let Some(map) = check.object(value, &loc) else {
        return check.finish().map(|()| EventInput::default());
    };
    let mut fields = Map::new();
    let mut input = EventInput::default();
    let mut ok = true;
    for name in DISCOVERY_FIELDS.iter().chain(EVENT_FIELDS.iter()) {
        let raw = map.get(*name);
        let field_loc = at(&loc, *name);
        let Some(raw) = raw else {
            let required =
                !update && matches!(*name, "title" | "location" | "occurrences" | "club_id");
            if required {
                check.missing(map, &loc, name);
                ok = false;
            } else if !update {
                // A create dumps every field with its default.
                let default = match *name {
                    "registration" | "cancelled" => json!(false),
                    _ => Value::Null,
                };
                fields.insert((*name).to_owned(), default);
            }
            continue;
        };
        let result: Option<Value> = match *name {
            "competition" | "employers_on_campus" | "sports_game" => {
                check.strict_optional_bool(raw, field_loc).map(|v| json!(v))
            }
            "campus_season_ids" => {
                input.sets_campus_seasons = true;
                if raw.is_null() {
                    Some(Value::Null)
                } else {
                    check.list(raw, &field_loc).and_then(|values| {
                        let mark = check.issues.len();
                        let seasons: Vec<Option<String>> = values
                            .iter()
                            .enumerate()
                            .map(|(index, item)| {
                                check.string(item, at(&field_loc, index), 0, usize::MAX)
                            })
                            .collect();
                        if check.errors_since(mark) {
                            return None;
                        }
                        let mut seasons: Vec<String> = seasons.into_iter().flatten().collect();
                        seasons.sort();
                        seasons.dedup();
                        Some(json!(seasons))
                    })
                }
            }
            "title" => {
                if update {
                    check
                        .optional_string(raw, field_loc, 0, MAX_EVENT_TITLE_LENGTH)
                        .map(|v| json!(v))
                } else {
                    check
                        .string(raw, field_loc, 1, MAX_EVENT_TITLE_LENGTH)
                        .map(|v| json!(v))
                }
            }
            "description" => check
                .optional_string(raw, field_loc, 0, MAX_EVENT_DESCRIPTION_LENGTH as usize)
                .map(|v| json!(v)),
            "location" => {
                if update {
                    check
                        .optional_string(raw, field_loc, 0, MAX_EVENT_LOCATION_LENGTH)
                        .map(|v| json!(v))
                } else {
                    check
                        .string(raw, field_loc, 1, MAX_EVENT_LOCATION_LENGTH)
                        .map(|v| json!(v))
                }
            }
            "map_location" => check
                .optional_string(raw, field_loc, 1, MAX_EVENT_LOCATION_LENGTH)
                .map(|v| json!(v)),
            "occurrences" => {
                if update && raw.is_null() {
                    Some(Value::Null)
                } else {
                    match check.list(raw, &field_loc) {
                        None => None,
                        Some(values) => {
                            let mark = check.issues.len();
                            let parsed: Vec<Option<OccurrenceInput>> = values
                                .iter()
                                .enumerate()
                                .map(|(index, item)| {
                                    occurrence(&mut check, item, at(&field_loc, index), update)
                                })
                                .collect();
                            if check.errors_since(mark)
                                || !check.list_length(raw, &field_loc, values.len(), 1, usize::MAX)
                            {
                                None
                            } else {
                                let parsed: Vec<OccurrenceInput> =
                                    parsed.into_iter().flatten().collect();
                                input.occurrences = Some(parsed);
                                Some(Value::Null)
                            }
                        }
                    }
                }
            }
            "price" => {
                if raw.is_null() {
                    Some(Value::Null)
                } else {
                    check
                        .price(raw, field_loc, MAX_EVENT_PRICE)
                        .map(|v| json!(v))
                }
            }
            "food" => {
                if raw.is_null() {
                    Some(Value::Null)
                } else {
                    check.list(raw, &field_loc).and_then(|values| {
                        let mark = check.issues.len();
                        let foods: Vec<Option<String>> = values
                            .iter()
                            .enumerate()
                            .map(|(index, item)| {
                                check.string(
                                    item,
                                    at(&field_loc, index),
                                    1,
                                    MAX_EVENT_FOOD_ITEM_LENGTH,
                                )
                            })
                            .collect();
                        if check.errors_since(mark)
                            || !check.list_length(
                                raw,
                                &field_loc,
                                values.len(),
                                0,
                                MAX_EVENT_FOOD_COUNT,
                            )
                        {
                            return None;
                        }
                        Some(json!(foods.into_iter().flatten().collect::<Vec<_>>()))
                    })
                }
            }
            "registration" | "cancelled" => {
                if update && raw.is_null() {
                    Some(Value::Null)
                } else {
                    check.boolean(raw, field_loc).map(|v| json!(v))
                }
            }
            "source_image_url" | "source_url" => check
                .optional_string(raw, field_loc.clone(), 0, MAX_URL_LENGTH)
                .and_then(|text| http_url(&mut check, text, field_loc, raw))
                .map(|v| json!(v)),
            "category" => check
                .optional_string(raw, field_loc.clone(), 0, MAX_EVENT_CATEGORY_LENGTH)
                .and_then(|text| category(&mut check, text, field_loc, raw))
                .map(|v| json!(v)),
            "club_id" => {
                if update && raw.is_null() {
                    Some(Value::Null)
                } else {
                    check.integer(raw, field_loc, Some(1)).map(|parsed| {
                        input.club_id = Some(parsed);
                        match parsed {
                            PyInt::Small(id) => json!(id),
                            PyInt::Huge => json!(raw),
                        }
                    })
                }
            }
            "ig_handle" => check
                .optional_string(raw, field_loc.clone(), 0, MAX_EVENT_HANDLE_LENGTH)
                .and_then(|text| handle(&mut check, text, field_loc, raw))
                .map(|v| json!(v)),
            _ => unreachable!("every event field is handled"),
        };
        match result {
            None => ok = false,
            Some(normalized) if *name != "occurrences" => {
                fields.insert((*name).to_owned(), normalized);
            }
            Some(_) => {}
        }
    }
    let known: Vec<&str> = DISCOVERY_FIELDS
        .iter()
        .chain(EVENT_FIELDS.iter())
        .copied()
        .collect();
    check.forbid_extra(map, &loc, &known);
    if !ok || !check.issues.is_empty() {
        return check.finish().map(|()| EventInput::default());
    }
    // `EventUpdate._map_location_follows_location`.
    if update && map.contains_key("location") && !map.contains_key("map_location") {
        check.value_error(loc, "map_location is required when location changes", value);
        return check.finish().map(|()| EventInput::default());
    }
    input.fields = fields;
    Ok(input)
}

// ── Smaller bodies ──────────────────────────────────────────────────────

/// `GoingEventSelectionUpdate`: at least one occurrence id.
pub fn going_selection(value: &Value) -> Result<Vec<Uuid>, ApiError> {
    let mut check = Check::default();
    let loc = vec![json!("body")];
    let Some(map) = check.object(value, &loc) else {
        return Err(ApiError::RequestValidation(check.issues));
    };
    let mut ids = Vec::new();
    match map.get("occurrence_ids") {
        None => check.missing(map, &loc, "occurrence_ids"),
        Some(raw) => {
            let field = at(&loc, "occurrence_ids");
            if let Some(values) = check.list(raw, &field) {
                let mark = check.issues.len();
                for (index, item) in values.iter().enumerate() {
                    if let Some(id) = check.uuid(item, at(&field, index)) {
                        ids.push(id);
                    }
                }
                if !check.errors_since(mark) {
                    check.list_length(raw, &field, values.len(), 1, usize::MAX);
                }
            }
        }
    }
    check.forbid_extra(map, &loc, &["occurrence_ids"]);
    check.finish().map(|()| ids)
}

/// `InteractionCreate`.
#[derive(Debug, Clone, PartialEq)]
pub struct InteractionInput {
    pub event_id: Option<i64>,
    pub position_id: Option<i64>,
    pub interaction_type: String,
    pub metadata: Option<Value>,
}

/// `InteractionBatch`.
#[derive(Debug, Clone, PartialEq)]
pub struct InteractionBatchInput {
    pub session_id: String,
    pub user_id: Option<Uuid>,
    pub interactions: Vec<InteractionInput>,
}

/// `core.constants.INTERACTION_TYPES`.
pub const INTERACTION_TYPES: [&str; 5] = ["click", "detail_view", "going", "ungoing", "share"];
const MAX_SESSION_ID_LENGTH: usize = 128;

/// Python's `len(json.dumps(value, separators=(",", ":")))` (ASCII escapes).
pub fn python_json_length(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(flag) => {
            if *flag {
                4
            } else {
                5
            }
        }
        Value::Number(number) => match number.as_f64() {
            Some(float) if !number.is_i64() && !number.is_u64() => python_float_repr(float).len(),
            _ => number.to_string().len(),
        },
        Value::String(text) => python_string_length(text),
        Value::Array(values) => {
            2 + values.iter().map(python_json_length).sum::<usize>()
                + values.len().saturating_sub(1)
        }
        Value::Object(map) => {
            2 + map
                .iter()
                .map(|(key, value)| python_string_length(key) + 1 + python_json_length(value))
                .sum::<usize>()
                + map.len().saturating_sub(1)
        }
    }
}

fn python_string_length(text: &str) -> usize {
    2 + text
        .chars()
        .map(|c| match c {
            '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                if (c as u32) > 0xffff {
                    12
                } else {
                    6
                }
            }
            _ => 1,
        })
        .sum::<usize>()
}

/// Python's `repr(float)`.
fn python_float_repr(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific.split_once('e').expect("exponent");
    let exponent: i32 = exponent.parse().expect("exponent");
    if (-4..16).contains(&exponent) {
        crate::api::pyjson::format_float(value)
    } else {
        let sign = if exponent < 0 { "-" } else { "+" };
        format!("{mantissa}e{sign}{:02}", exponent.abs())
    }
}

fn interaction(
    check: &mut Check,
    value: &Value,
    loc: Vec<Value>,
    max_metadata: usize,
) -> Option<InteractionInput> {
    let map = check.object(value, &loc)?;
    let mark = check.issues.len();
    let target = |check: &mut Check, name: &str| match map.get(name) {
        Some(Value::Null) | None => Some(None),
        Some(raw) => check
            .integer(raw, at(&loc, name), Some(1))
            .map(|parsed| match parsed {
                PyInt::Small(id) => Some(id),
                PyInt::Huge => Some(i64::MAX),
            }),
    };
    let event_id = target(check, "event_id");
    let position_id = target(check, "position_id");
    let interaction_type = match map.get("interaction_type") {
        None => {
            check.missing(map, &loc, "interaction_type");
            None
        }
        Some(raw) => check
            .string(raw, at(&loc, "interaction_type"), 0, usize::MAX)
            .and_then(|kind| {
                if INTERACTION_TYPES.contains(&kind.as_str()) {
                    Some(kind)
                } else {
                    check.value_error(
                        at(&loc, "interaction_type"),
                        &format!(
                            "interaction_type must be one of: {}",
                            INTERACTION_TYPES.join(", ")
                        ),
                        raw,
                    );
                    None
                }
            }),
    };
    let metadata = match map.get("metadata") {
        Some(Value::Null) | None => Some(None),
        Some(raw @ Value::Object(_)) => {
            let size = python_json_length(raw);
            if size > max_metadata {
                check.value_error(
                    at(&loc, "metadata"),
                    &format!("metadata exceeds maximum size ({size} bytes, limit {max_metadata})"),
                    raw,
                );
                None
            } else {
                Some(Some(raw.clone()))
            }
        }
        Some(raw) => {
            check.push(
                "dict_type",
                at(&loc, "metadata"),
                "Input should be a valid dictionary",
                raw,
            );
            None
        }
    };
    check.forbid_extra(
        map,
        &loc,
        &["event_id", "position_id", "interaction_type", "metadata"],
    );
    if check.errors_since(mark) {
        return None;
    }
    let (event_id, position_id, interaction_type) = (event_id?, position_id?, interaction_type?);
    if event_id.is_none() == position_id.is_none() {
        check.value_error(loc, "Select exactly one event_id or position_id", value);
        return None;
    }
    if position_id.is_some() && interaction_type != "click" {
        check.value_error(loc, "Positions support click interactions only", value);
        return None;
    }
    Some(InteractionInput {
        event_id,
        position_id,
        interaction_type,
        metadata: metadata?,
    })
}

/// `InteractionBatch`, with `maximum_batch_size` and `maximum_metadata_bytes`.
pub fn interaction_batch(
    value: &Value,
    max_batch: usize,
    max_metadata: usize,
) -> Result<InteractionBatchInput, ApiError> {
    let mut check = Check::default();
    let loc = vec![json!("body")];
    let Some(map) = check.object(value, &loc) else {
        return Err(ApiError::RequestValidation(check.issues));
    };
    let session_id = match map.get("session_id") {
        None => {
            check.missing(map, &loc, "session_id");
            None
        }
        Some(raw) => check.string(raw, at(&loc, "session_id"), 1, MAX_SESSION_ID_LENGTH),
    };
    let user_id = match map.get("user_id") {
        Some(Value::Null) | None => Some(None),
        Some(raw) => check.uuid(raw, at(&loc, "user_id")).map(Some),
    };
    let interactions = match map.get("interactions") {
        None => {
            check.missing(map, &loc, "interactions");
            None
        }
        Some(raw) => {
            let field = at(&loc, "interactions");
            check.list(raw, &field).and_then(|values| {
                let mark = check.issues.len();
                let parsed: Vec<Option<InteractionInput>> = values
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        interaction(&mut check, item, at(&field, index), max_metadata)
                    })
                    .collect();
                if check.errors_since(mark)
                    || !check.list_length(raw, &field, values.len(), 0, max_batch)
                {
                    return None;
                }
                Some(parsed.into_iter().flatten().collect::<Vec<_>>())
            })
        }
    };
    check.forbid_extra(map, &loc, &["session_id", "user_id", "interactions"]);
    check.finish()?;
    Ok(InteractionBatchInput {
        session_id: session_id.unwrap_or_default(),
        user_id: user_id.flatten(),
        interactions: interactions.unwrap_or_default(),
    })
}

/// `ReportCreate`: the event id (possibly beyond Postgres' range) and the reason.
pub fn report_create(value: &Value, max_reason: usize) -> Result<(PyInt, String), ApiError> {
    let mut check = Check::default();
    let loc = vec![json!("body")];
    let Some(map) = check.object(value, &loc) else {
        return Err(ApiError::RequestValidation(check.issues));
    };
    let event_id = match map.get("event_id") {
        None => {
            check.missing(map, &loc, "event_id");
            None
        }
        Some(raw) => check.integer(raw, at(&loc, "event_id"), None),
    };
    let reason = match map.get("reason") {
        None => {
            check.missing(map, &loc, "reason");
            None
        }
        Some(raw) => check
            .string(raw, at(&loc, "reason"), 1, max_reason)
            .and_then(|reason| {
                let lowered = reason.to_lowercase();
                if ["<", ">", "javascript:", "data:"]
                    .iter()
                    .any(|bad| lowered.contains(bad))
                {
                    check.value_error(
                        at(&loc, "reason"),
                        "free-text field may not contain HTML tags or dangerous URL schemes",
                        raw,
                    );
                    None
                } else {
                    Some(reason)
                }
            }),
    };
    check.forbid_extra(map, &loc, &["event_id", "reason"]);
    check.finish()?;
    Ok((
        event_id.unwrap_or(PyInt::Small(0)),
        reason.unwrap_or_default(),
    ))
}

/// `ReportUpdate`: the new status.
pub fn report_update(value: &Value) -> Result<&'static str, ApiError> {
    const STATUSES: [&str; 3] = ["pending", "resolved", "dismissed"];
    let mut check = Check::default();
    let loc = vec![json!("body")];
    let Some(map) = check.object(value, &loc) else {
        return Err(ApiError::RequestValidation(check.issues));
    };
    let status = match map.get("status") {
        None => {
            check.missing(map, &loc, "status");
            None
        }
        Some(raw) => {
            let found = STATUSES
                .iter()
                .find(|status| raw.as_str() == Some(**status))
                .copied();
            if found.is_none() {
                let expected = "'pending', 'resolved' or 'dismissed'";
                check.push_ctx(
                    "literal_error",
                    at(&loc, "status"),
                    format!("Input should be {expected}"),
                    raw,
                    json!({"expected": expected}),
                );
            }
            found
        }
    };
    check.forbid_extra(map, &loc, &["status"]);
    check.finish()?;
    Ok(status.unwrap_or("pending"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn int_json(value: PyInt, raw: &Value) -> Value {
        match value {
            PyInt::Small(id) => json!(id),
            PyInt::Huge => raw.clone(),
        }
    }

    /// Every body in `testdata/bodies.json` (FastAPI's answers for the real
    /// models) gets the same status, the same 422 issues, and the same
    /// normalized dump.
    #[test]
    fn bodies_validate_like_fastapi() {
        let corpus: Vec<Value> =
            serde_json::from_str(include_str!("testdata/bodies.json")).unwrap();
        let mut checked = 0;
        for case in corpus {
            let path = case["path"].as_str().unwrap();
            let raw: Vec<u8> = match (&case.get("json"), &case.get("body")) {
                (Some(json), _) => serde_json::to_vec(json).unwrap(),
                (None, Some(Value::String(body))) => body.clone().into_bytes(),
                _ => unreachable!(),
            };
            let headers = {
                let mut headers = HeaderMap::new();
                headers.insert("content-type", "application/json".parse().unwrap());
                headers
            };
            let status = case["status"].as_u64().unwrap();
            let expected: Value = serde_json::from_str(case["response"].as_str().unwrap()).unwrap();
            let value = match decode(&headers, &raw) {
                Ok(value) => value,
                Err(ApiError::RequestValidation(issues)) => {
                    let issue = &issues[0];
                    assert_eq!(status, 422, "{case}");
                    let ours = json!(issues);
                    // FastAPI quotes Python's JSON decoder; Rust quotes serde's.
                    if issue.kind != "json_invalid" {
                        assert_eq!(ours, expected["detail"], "{case}");
                    }
                    checked += 1;
                    continue;
                }
                Err(other) => panic!("{other:?}"),
            };
            let outcome: Result<Value, ApiError> = match path {
                "/create" | "/update" => event(&value, path == "/update").map(|input| {
                    let mut dump = input.fields.clone();
                    let with_id = path == "/update";
                    if let Some(occurrences) = &input.occurrences {
                        dump.insert(
                            "occurrences".into(),
                            json!(occurrences.iter().map(|o| o.dump(with_id)).collect::<Vec<_>>()),
                        );
                    }
                    json!({"fields": dump, "occ": input.occurrences.map(|o| o.iter().map(|o| o.dump(with_id)).collect::<Vec<_>>())})
                }),
                "/going" => going_selection(&value).map(|ids| json!({"dump": {"occurrence_ids": ids}})),
                "/interactions" => interaction_batch(&value, 50, 2048).map(|batch| {
                    json!({"dump": {"session_id": batch.session_id, "user_id": batch.user_id, "interactions": batch.interactions.iter().map(|i| json!({"event_id": i.event_id, "position_id": i.position_id, "interaction_type": i.interaction_type, "metadata": i.metadata})).collect::<Vec<_>>()}})
                }),
                "/report" => report_create(&value, 2000).map(|(id, reason)| {
                    json!({"dump": {"event_id": int_json(id, &value["event_id"]), "reason": reason}})
                }),
                "/report_update" => report_update(&value).map(|status| json!({"dump": {"status": status}})),
                _ => unreachable!(),
            };
            match outcome {
                Ok(ours) => {
                    assert_eq!(status, 200, "{case} passed in Rust: {ours}");
                    if path == "/create" || path == "/update" {
                        let mut python = expected["dump"].as_object().unwrap().clone();
                        python.shift_remove("occurrences");
                        let ours_fields = ours["fields"].as_object().unwrap();
                        let mut ours_fields = ours_fields.clone();
                        ours_fields.shift_remove("occurrences");
                        assert_eq!(Value::Object(ours_fields), Value::Object(python), "{case}");
                        assert_eq!(ours["occ"], expected["occ"], "{case}");
                    } else {
                        assert_eq!(ours["dump"], expected["dump"], "{case}");
                    }
                }
                Err(ApiError::RequestValidation(issues)) => {
                    assert_eq!(status, 422, "{case} failed in Rust: {issues:?}");
                    assert_eq!(json!(issues), expected["detail"], "{case}");
                }
                Err(other) => panic!("{other:?}"),
            }
            checked += 1;
        }
        assert!(checked > 200);
    }

    #[test]
    fn metadata_size_counts_python_json() {
        assert_eq!(python_json_length(&json!({"a": 1, "b": [1, 2]})), 17);
        assert_eq!(python_json_length(&json!({"t": "é😀"})), 26);
        assert_eq!(
            python_json_length(&json!({"f": 1e-5, "g": 0.5})),
            r#"{"f":1e-05,"g":0.5}"#.len()
        );
    }
}
