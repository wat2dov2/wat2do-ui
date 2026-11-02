//! The events routes' request models, read with `api::body::Body` as
//! pydantic validates them: `EventCreate`, `EventUpdate`, `OccurrenceCreate`
//! / `OccurrenceUpdate`, `GoingEventSelectionUpdate`, `InteractionBatch` /
//! `InteractionCreate`, `ReportCreate` and `ReportUpdate`. Each returns the
//! normalized values `model_dump(mode="json")` gives the Python service.

use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::api::body::{Body, Extra, Input, Str};
use crate::api::errors::ApiError;
use crate::api::validation::PyInt;
use crate::constants::{
    EVENT_CATEGORIES, MAX_EVENT_CATEGORY_LENGTH, MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_EVENT_FOOD_COUNT, MAX_EVENT_FOOD_ITEM_LENGTH, MAX_EVENT_HANDLE_LENGTH,
    MAX_EVENT_LOCATION_LENGTH, MAX_EVENT_PRICE, MAX_EVENT_TITLE_LENGTH, MAX_URL_LENGTH,
};
use crate::text::python_strip;

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
    let Some(after) = rest.strip_prefix("//") else {
        return false;
    };
    let netloc = &after[..after.find(['/', '?', '#']).unwrap_or(after.len())];
    matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") && !netloc.is_empty()
}

/// A `str | None` field with a string-to-optional-string validator: the
/// validated value as JSON, or `None` when not sent or after a problem.
fn validated_text(
    body: &mut Body,
    name: &'static str,
    rules: &Str,
    validate: impl FnOnce(&str) -> Result<Option<String>, String>,
) -> Option<Value> {
    let raw = body.raw_copy(name);
    match body.string(name, rules) {
        Input::Missing => None,
        Input::Null => Some(Value::Null),
        Input::Given(text) => match validate(&text) {
            Ok(value) => Some(json!(value)),
            Err(message) => {
                body.field_error(name, raw.unwrap_or(Value::Null), &message);
                None
            }
        },
    }
}

/// `_validate_optional_http_url`.
fn http_url(text: &str) -> Result<Option<String>, String> {
    let stripped = python_strip(text);
    if stripped.is_empty() {
        return Ok(None);
    }
    if !is_safe_http_url(stripped) {
        return Err("URL must use http or https scheme".to_owned());
    }
    Ok(Some(stripped.to_owned()))
}

/// `_validate_optional_handle`.
fn handle(text: &str) -> Result<Option<String>, String> {
    let stripped = python_strip(text);
    if stripped.is_empty() {
        return Ok(None);
    }
    if stripped.contains("://") && !is_safe_http_url(stripped) {
        return Err("handle URL must use http or https scheme".to_owned());
    }
    Ok(Some(stripped.to_owned()))
}

/// `_validate_category`.
fn category(text: &str) -> Result<Option<String>, String> {
    if text.is_empty() {
        return Ok(None);
    }
    let stripped = python_strip(text);
    if EVENT_CATEGORIES.contains(&stripped) {
        return Ok(Some(stripped.to_owned()));
    }
    tracing::warn!("Unrecognized category {text:?}, dropping it");
    Err(format!(
        "category must be one of: {}",
        EVENT_CATEGORIES.join(", ")
    ))
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
            json!(crate::api::json::format_datetime(&self.dtstart_utc)),
        );
        map.insert(
            "dtend_utc".into(),
            json!(
                self.dtend_utc
                    .as_ref()
                    .map(crate::api::json::format_datetime)
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

fn occurrence(body: &mut Body, with_id: bool) -> Option<OccurrenceInput> {
    let start = match body.aware_datetime("dtstart_utc") {
        Input::Given(start) => Some(start),
        Input::Missing if !body.has_field("dtstart_utc") => {
            body.missing("dtstart_utc");
            None
        }
        Input::Null => {
            body.type_error(
                "dtstart_utc",
                "datetime_type",
                "Input should be a valid datetime",
            );
            None
        }
        Input::Missing => None,
    };
    let end = body.aware_datetime("dtend_utc");
    let duration = body.string("duration", &Str::new().max(MAX_DURATION_LENGTH));
    let tz = body.string("tz", &Str::new().max(MAX_TZ_LENGTH));
    let id = if with_id {
        body.uuid("id")
    } else {
        Input::Missing
    };
    body.check_extras();
    if body.has_issues() {
        return None;
    }
    let start = start?;
    let end = end.value();
    // `_dtend_after_dtstart`.
    if end.is_some_and(|end| end <= start) {
        let (loc, input) = (body.model_loc(), body.input());
        body.value_error(loc, input, "dtend_utc must be after dtstart_utc");
        return None;
    }
    Some(OccurrenceInput {
        id: id.value(),
        dtstart_utc: start,
        dtend_utc: end,
        duration: duration.value(),
        tz: tz.value(),
    })
}

// ── EventCreate / EventUpdate ─────────────────────────────────────────────

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
}

/// One field's outcome as JSON, `None` when not sent or after a problem.
trait FieldValue {
    fn field(self) -> Option<Value>;
}

impl<T: serde::Serialize> FieldValue for Input<T> {
    fn field(self) -> Option<Value> {
        match self {
            Input::Missing => None,
            Input::Null => Some(Value::Null),
            Input::Given(value) => Some(json!(value)),
        }
    }
}

/// Validate an `EventCreate` (`update == false`) or `EventUpdate` body.
pub fn event(mut body: Body, update: bool) -> Result<EventInput, ApiError> {
    let mut fields = Map::new();
    let mut input = EventInput::default();
    // A sent field keeps its normalized value (none after a problem); an
    // unsent one is left out of an update and takes its default in a create.
    let put = |body: &Body,
               fields: &mut Map<String, Value>,
               name: &str,
               value: Option<Value>,
               default: Value| {
        match value {
            Some(value) => {
                fields.insert(name.to_owned(), value);
            }
            None if !update && !body.has_field(name) => {
                fields.insert(name.to_owned(), default);
            }
            None => {}
        }
    };
    // EventDiscoveryFields.
    for name in ["competition", "employers_on_campus", "sports_game"] {
        let value = body.strict_bool(name).field();
        put(&body, &mut fields, name, value, Value::Null);
    }
    let seasons = body
        .list("campus_season_ids", 0, usize::MAX, |body, loc, value| {
            body.string_item(loc, &value, &Str::new())
        })
        .map(|mut seasons| {
            // `_unique_campus_seasons`: sorted and unique.
            seasons.sort();
            seasons.dedup();
            seasons
        })
        .field();
    put(
        &body,
        &mut fields,
        "campus_season_ids",
        seasons,
        Value::Null,
    );
    // EventCreate / EventUpdate.
    let title = if update {
        body.string("title", &Str::new().max(MAX_EVENT_TITLE_LENGTH))
            .field()
    } else {
        body.required_string("title", &Str::new().min(1).max(MAX_EVENT_TITLE_LENGTH))
            .map(|title| json!(title))
    };
    put(&body, &mut fields, "title", title, Value::Null);
    let description = body
        .string(
            "description",
            &Str::new().max(MAX_EVENT_DESCRIPTION_LENGTH as usize),
        )
        .field();
    put(&body, &mut fields, "description", description, Value::Null);
    let location = if update {
        body.string("location", &Str::new().max(MAX_EVENT_LOCATION_LENGTH))
            .field()
    } else {
        body.required_string(
            "location",
            &Str::new().min(1).max(MAX_EVENT_LOCATION_LENGTH),
        )
        .map(|location| json!(location))
    };
    put(&body, &mut fields, "location", location, Value::Null);
    let map_location = body
        .string(
            "map_location",
            &Str::new().min(1).max(MAX_EVENT_LOCATION_LENGTH),
        )
        .field();
    put(
        &body,
        &mut fields,
        "map_location",
        map_location,
        Value::Null,
    );
    let occurrences = body.list("occurrences", 1, usize::MAX, |body, loc, value| {
        body.nested_item(loc, value, Extra::Forbid, |item| occurrence(item, update))
    });
    match occurrences {
        Input::Given(occurrences) => input.occurrences = Some(occurrences),
        Input::Null if !update => {
            body.type_error("occurrences", "list_type", "Input should be a valid list")
        }
        Input::Missing if !update && !body.has_field("occurrences") => body.missing("occurrences"),
        _ => {}
    }
    let price = body.finite_float("price", 0.0, MAX_EVENT_PRICE).field();
    put(&body, &mut fields, "price", price, Value::Null);
    let food = body
        .list("food", 0, MAX_EVENT_FOOD_COUNT, |body, loc, value| {
            body.string_item(
                loc,
                &value,
                &Str::new().min(1).max(MAX_EVENT_FOOD_ITEM_LENGTH),
            )
        })
        .field();
    put(&body, &mut fields, "food", food, Value::Null);
    let registration = match body.bool("registration") {
        Input::Null if !update => {
            body.type_error(
                "registration",
                "bool_type",
                "Input should be a valid boolean",
            );
            None
        }
        other => other.field(),
    };
    put(
        &body,
        &mut fields,
        "registration",
        registration,
        json!(false),
    );
    for name in ["source_image_url", "source_url"] {
        let value = validated_text(&mut body, name, &Str::new().max(MAX_URL_LENGTH), http_url);
        put(&body, &mut fields, name, value, Value::Null);
    }
    let category = validated_text(
        &mut body,
        "category",
        &Str::new().max(MAX_EVENT_CATEGORY_LENGTH),
        category,
    );
    put(&body, &mut fields, "category", category, Value::Null);
    let club_id = match body.unbounded_int("club_id", Some(1)) {
        Input::Given(club_id) => {
            input.club_id = Some(club_id);
            Some(match club_id {
                PyInt::Small(id) => json!(id),
                PyInt::Huge => body.raw_copy("club_id").unwrap_or(Value::Null),
            })
        }
        Input::Null if !update => {
            body.type_error("club_id", "int_type", "Input should be a valid integer");
            None
        }
        Input::Missing if !update && !body.has_field("club_id") => {
            body.missing("club_id");
            None
        }
        other => other.map(|_| Value::Null).field(),
    };
    put(&body, &mut fields, "club_id", club_id, Value::Null);
    let ig_handle = validated_text(
        &mut body,
        "ig_handle",
        &Str::new().max(MAX_EVENT_HANDLE_LENGTH),
        handle,
    );
    put(&body, &mut fields, "ig_handle", ig_handle, Value::Null);
    let cancelled = match body.bool("cancelled") {
        Input::Null if !update => {
            body.type_error("cancelled", "bool_type", "Input should be a valid boolean");
            None
        }
        other => other.field(),
    };
    put(&body, &mut fields, "cancelled", cancelled, json!(false));
    body.check_extras();
    if body.has_issues() {
        return body.finish().map(|()| EventInput::default());
    }
    // `EventUpdate._map_location_follows_location`.
    if update && body.has_field("location") && !body.has_field("map_location") {
        let (loc, value) = (body.model_loc(), body.input());
        body.value_error(loc, value, "map_location is required when location changes");
        return body.finish().map(|()| EventInput::default());
    }
    input.fields = fields;
    Ok(input)
}

// ── Smaller bodies ──────────────────────────────────────────────────────

/// `GoingEventSelectionUpdate`: at least one occurrence id.
pub fn going_selection(mut body: Body) -> Result<Vec<Uuid>, ApiError> {
    let ids = match body.list("occurrence_ids", 1, usize::MAX, |body, loc, value| {
        body.uuid_item(loc, value)
    }) {
        Input::Given(ids) => ids,
        Input::Null => {
            body.type_error(
                "occurrence_ids",
                "list_type",
                "Input should be a valid list",
            );
            Vec::new()
        }
        Input::Missing => {
            if !body.has_field("occurrence_ids") {
                body.missing("occurrence_ids");
            }
            Vec::new()
        }
    };
    body.finish().map(|()| ids)
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

fn interaction(body: &mut Body, max_metadata: usize) -> Option<InteractionInput> {
    let target = |body: &mut Body, name: &'static str| match body.unbounded_int(name, Some(1)) {
        Input::Given(PyInt::Small(id)) => Some(id),
        // Too large for the column: Postgres refuses it on insert.
        Input::Given(PyInt::Huge) => Some(i64::MAX),
        _ => None,
    };
    let event_id = target(body, "event_id");
    let position_id = target(body, "position_id");
    let kind = match body.string("interaction_type", &Str::new()) {
        Input::Given(kind) if INTERACTION_TYPES.contains(&kind.as_str()) => Some(kind),
        Input::Given(kind) => {
            body.field_error(
                "interaction_type",
                json!(kind),
                &format!(
                    "interaction_type must be one of: {}",
                    INTERACTION_TYPES.join(", ")
                ),
            );
            None
        }
        Input::Null => {
            body.type_error(
                "interaction_type",
                "string_type",
                "Input should be a valid string",
            );
            None
        }
        Input::Missing => {
            if !body.has_field("interaction_type") {
                body.missing("interaction_type");
            }
            None
        }
    };
    let metadata = match body.object("metadata") {
        Input::Given(map) => {
            let value = Value::Object(map);
            let size = crate::api::json::python_dumps_compact(&value).len();
            if size > max_metadata {
                body.field_error(
                    "metadata",
                    value,
                    &format!("metadata exceeds maximum size ({size} bytes, limit {max_metadata})"),
                );
                None
            } else {
                Some(value)
            }
        }
        _ => None,
    };
    body.check_extras();
    if body.has_issues() {
        return None;
    }
    let kind = kind?;
    // `InteractionCreate.validate_target`.
    let message = if event_id.is_none() == position_id.is_none() {
        Some("Select exactly one event_id or position_id")
    } else if position_id.is_some() && kind != "click" {
        Some("Positions support click interactions only")
    } else {
        None
    };
    if let Some(message) = message {
        let (loc, input) = (body.model_loc(), body.input());
        body.value_error(loc, input, message);
        return None;
    }
    Some(InteractionInput {
        event_id,
        position_id,
        interaction_type: kind,
        metadata,
    })
}

/// `InteractionBatch`, with `maximum_batch_size` and `maximum_metadata_bytes`.
pub fn interaction_batch(
    mut body: Body,
    max_batch: usize,
    max_metadata: usize,
) -> Result<InteractionBatchInput, ApiError> {
    let session_id =
        body.required_string("session_id", &Str::new().min(1).max(MAX_SESSION_ID_LENGTH));
    let user_id = body.uuid("user_id").value();
    let interactions = match body.list("interactions", 0, max_batch, |body, loc, value| {
        body.nested_item(loc, value, Extra::Forbid, |item| {
            interaction(item, max_metadata)
        })
    }) {
        Input::Given(items) => items,
        Input::Null => {
            body.type_error("interactions", "list_type", "Input should be a valid list");
            Vec::new()
        }
        Input::Missing => {
            if !body.has_field("interactions") {
                body.missing("interactions");
            }
            Vec::new()
        }
    };
    body.finish()?;
    Ok(InteractionBatchInput {
        session_id: session_id.unwrap_or_default(),
        user_id,
        interactions,
    })
}

/// `ReportCreate`: the event id (possibly beyond Postgres' range) and the reason.
pub fn report_create(mut body: Body, max_reason: usize) -> Result<(PyInt, String), ApiError> {
    let event_id = match body.unbounded_int("event_id", None) {
        Input::Given(id) => Some(id),
        Input::Null => {
            body.type_error("event_id", "int_type", "Input should be a valid integer");
            None
        }
        Input::Missing => {
            if !body.has_field("event_id") {
                body.missing("event_id");
            }
            None
        }
    };
    let reason = body
        .required_string("reason", &Str::new().min(1).max(max_reason))
        .and_then(|reason| {
            let lowered = reason.to_lowercase();
            if ["<", ">", "javascript:", "data:"]
                .iter()
                .any(|bad| lowered.contains(bad))
            {
                body.field_error(
                    "reason",
                    json!(reason),
                    "free-text field may not contain HTML tags or dangerous URL schemes",
                );
                None
            } else {
                Some(reason)
            }
        });
    body.finish()?;
    Ok((
        event_id.unwrap_or(PyInt::Small(0)),
        reason.unwrap_or_default(),
    ))
}

/// `ReportUpdate`: the new status.
pub fn report_update(mut body: Body) -> Result<String, ApiError> {
    const STATUSES: [&str; 3] = ["pending", "resolved", "dismissed"];
    let status = body.required_string("status", &Str::new().one_of(&STATUSES));
    body.finish()?;
    Ok(status.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

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
        let mut headers = HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        let mut checked = 0;
        for case in corpus {
            let path = case["path"].as_str().unwrap();
            let raw: Vec<u8> = match (&case.get("json"), &case.get("body")) {
                (Some(json), _) => serde_json::to_vec(json).unwrap(),
                (None, Some(Value::String(body))) => body.clone().into_bytes(),
                _ => unreachable!(),
            };
            let status = case["status"].as_u64().unwrap();
            let expected: Value = serde_json::from_str(case["response"].as_str().unwrap()).unwrap();
            let outcome: Result<Value, ApiError> = Body::parse(&raw, &headers, Extra::Forbid)
                .and_then(|body| match path {
                    "/create" | "/update" => event(body, path == "/update").map(|input| {
                        let with_id = path == "/update";
                        json!({
                            "fields": input.fields,
                            "occ": input.occurrences.map(|o| o.iter().map(|o| o.dump(with_id)).collect::<Vec<_>>()),
                        })
                    }),
                    "/going" => going_selection(body)
                        .map(|ids| json!({"dump": {"occurrence_ids": ids}})),
                    "/interactions" => interaction_batch(body, 50, 2048).map(|batch| {
                        json!({"dump": {"session_id": batch.session_id, "user_id": batch.user_id, "interactions": batch.interactions.iter().map(|i| json!({"event_id": i.event_id, "position_id": i.position_id, "interaction_type": i.interaction_type, "metadata": i.metadata})).collect::<Vec<_>>()}})
                    }),
                    "/report" => {
                        let raw_id = serde_json::from_slice::<Value>(&raw).unwrap()["event_id"].clone();
                        report_create(body, 2000).map(|(id, reason)| {
                            json!({"dump": {"event_id": int_json(id, &raw_id), "reason": reason}})
                        })
                    }
                    "/report_update" => {
                        report_update(body).map(|status| json!({"dump": {"status": status}}))
                    }
                    _ => unreachable!(),
                });
            match outcome {
                Ok(ours) => {
                    assert_eq!(status, 200, "{case} passed in Rust: {ours}");
                    if path == "/create" || path == "/update" {
                        let mut python = expected["dump"].as_object().unwrap().clone();
                        python.shift_remove("occurrences");
                        assert_eq!(ours["fields"], Value::Object(python), "{case}");
                        assert_eq!(ours["occ"], expected["occ"], "{case}");
                    } else {
                        assert_eq!(ours["dump"], expected["dump"], "{case}");
                    }
                }
                Err(ApiError::RequestValidation(issues)) => {
                    assert_eq!(status, 422, "{case} failed in Rust: {issues:?}");
                    // FastAPI quotes Python's JSON decoder; Rust quotes serde's.
                    if issues[0].kind == "json_invalid" {
                        assert_eq!(expected["detail"][0]["type"], "json_invalid");
                    } else {
                        assert_eq!(json!(issues), expected["detail"], "{case}");
                    }
                }
                Err(other) => panic!("{other:?}"),
            }
            checked += 1;
        }
        assert!(checked > 200);
    }

    #[test]
    fn metadata_size_counts_python_json() {
        let size = |value: Value| crate::api::json::python_dumps_compact(&value).len();
        assert_eq!(size(json!({"a": 1, "b": [1, 2]})), 17);
        assert_eq!(size(json!({"t": "é😀"})), 26);
        assert_eq!(
            size(json!({"f": 1e-5, "g": 0.5})),
            r#"{"f":1e-05,"g":0.5}"#.len()
        );
    }
}
