//! What the image parsing routes read from a poster: the parts of
//! `services/scraper/extractor.py` (the prompt, the model's JSON and its
//! cleaning) and `services/ai_service.py` (the event form and the position)
//! they use.
//!
//! The prompt template is `backend/services/scraper/extraction_prompt.txt`,
//! which the Python extractor renders too. The model's answer is untrusted:
//! an item that fails the extraction models' validation is dropped, and an
//! answer with no usable structure is a failed extraction.

use chrono::{DateTime, Duration, NaiveDate, Timelike, Utc};
use chrono_tz::Tz;
use serde_json::{Map, Value};

use crate::api::body::{Body, Extra, Input, Str};
use crate::api::validation::{DateError, ParsedDatetime, parse_date, parse_datetime};
use crate::constants::{
    EVENT_CATEGORIES, MAX_POSITION_DESCRIPTION_LENGTH, MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT, MAX_POSITION_REQUIREMENT_LENGTH, MAX_POSITION_TITLE_LENGTH,
};
use crate::controlbox::EVENT_DISCOVERY;
use crate::ingestion::prompt::{DISCOVERY, DISCOVERY_RULES};
use crate::schools::{School, campus_season_prompt, normalize_slug};
use crate::text::{normalize_scraped_text, python_strip};

pub const SYSTEM_MESSAGE: &str = "You triage social media posts and extract campus event and hiring information. Always return valid JSON with the exact structure requested.";

const PROMPT_TEMPLATE: &str =
    include_str!("../../../../../backend/services/scraper/extraction_prompt.txt");

pub const POSITION_TYPES: &[&str] = &[
    "executive",
    "committee",
    "volunteer",
    "staff",
    "internship",
    "general",
];

/// The vision model the routes ask (`Completion`): the reply text, or
/// `None` when the call failed.
pub trait Completion {
    fn complete(
        &self,
        system: &str,
        prompt: &str,
        image_urls: &[String],
    ) -> impl Future<Output = Option<String>> + Send;
}

/// `openai_completion` with the configured key and model.
pub struct OpenAi<'a> {
    pub api_key: &'a str,
    pub model: &'a str,
}

impl Completion for OpenAi<'_> {
    async fn complete(&self, system: &str, prompt: &str, image_urls: &[String]) -> Option<String> {
        crate::openai::vision_completion(self.api_key, self.model, system, prompt, image_urls).await
    }
}

/// `PostExtractionError`: the provider failed or its answer was unusable.
#[derive(Debug, PartialEq, Eq)]
pub struct ExtractionFailed;

/// `str.format` for the template's placeholders and `{{` / `}}` escapes.
fn render(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len() * 2);
    let mut rest = template;
    while let Some(at) = rest.find(['{', '}']) {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        if tail.starts_with("{{") || tail.starts_with("}}") {
            out.push_str(&tail[..1]);
            rest = &tail[2..];
        } else if tail.starts_with('{') {
            let end = tail.find('}').expect("closed placeholder");
            let name = &tail[1..end];
            let value = values
                .iter()
                .find(|(key, _)| *key == name)
                .unwrap_or_else(|| panic!("no value for {{{name}}}"));
            out.push_str(value.1);
            rest = &tail[end + 1..];
        } else {
            out.push('}');
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}

/// `EVENT_DISCOVERY_JSON_FIELDS`: each discovery field's JSON type.
fn discovery_json_fields() -> String {
    DISCOVERY
        .fields
        .keys()
        .map(|name| {
            let kind = if name == "campus_season_ids" {
                "string[]"
            } else {
                "boolean"
            };
            format!("\"{name}\": {kind} or null,")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `_build_prompt`'s inputs.
pub struct PromptInputs<'a> {
    pub caption: Option<&'a str>,
    pub image_count: usize,
    pub school: &'a str,
    pub local_tz_key: &'a str,
    pub current_date: &'a str,
    pub current_day: &'a str,
    pub post_date: &'a str,
    pub post_day: &'a str,
    pub post_time: &'a str,
    pub semester_line: &'a str,
}

/// `_build_prompt`.
pub fn build_prompt(inputs: &PromptInputs) -> String {
    let has_caption = inputs
        .caption
        .is_some_and(|caption| !python_strip(caption).is_empty());
    let (description_field, description_rule) = if has_caption {
        (
            "",
            "Do not output description. The application attaches the original caption to every extracted item.",
        )
    } else {
        (
            "\n      \"description\": string,",
            "No caption is available. Extract description from the relevant image text; do not invent details.",
        )
    };
    let categories = EVENT_CATEGORIES
        .iter()
        .map(|category| format!("- {category}"))
        .collect::<Vec<_>>()
        .join("\n");
    let image_count = inputs.image_count.to_string();
    let json_fields = discovery_json_fields();
    let campus_seasons = campus_season_prompt(&normalize_slug(inputs.school));
    render(
        PROMPT_TEMPLATE,
        &[
            ("school", inputs.school),
            ("current_day", inputs.current_day),
            ("current_date", inputs.current_date),
            ("post_day", inputs.post_day),
            ("post_date", inputs.post_date),
            ("post_time", inputs.post_time),
            ("semester_line", inputs.semester_line),
            ("caption", inputs.caption.unwrap_or_default()),
            ("image_count", &image_count),
            ("description_rule", description_rule),
            ("description_field", description_field),
            ("discovery_json_fields", &json_fields),
            ("local_tz_key", inputs.local_tz_key),
            ("categories_str", &categories),
            ("discovery_rules", &DISCOVERY_RULES),
            ("campus_seasons", &campus_seasons),
        ],
    )
}

/// The school's zone as `ZoneInfo` reads it, with the key it was read by;
/// an unknown zone is UTC.
fn zone(name: &str) -> (Tz, String) {
    match name.parse::<Tz>() {
        Ok(tz) => (tz, name.to_owned()),
        Err(_) => (Tz::UTC, "UTC".to_owned()),
    }
}

/// `extract_post_content` for an uploaded poster: no caption, posted now.
pub async fn extract_post_content(
    school: &School,
    image_urls: &[String],
    now: DateTime<Utc>,
    complete: &impl Completion,
) -> Result<PostContent, ExtractionFailed> {
    let (tz, key) = zone(&school.timezone);
    let local = now.with_timezone(&tz);
    let slug = normalize_slug(&school.slug);
    let semester_line = school
        .current_semester_end(now)
        .map(|end| format!("Current semester end date: {end}\n"))
        .unwrap_or_default();
    let date = local.format("%Y-%m-%d").to_string();
    let day = local.format("%A").to_string();
    let prompt = build_prompt(&PromptInputs {
        caption: None,
        image_count: image_urls.iter().filter(|url| !url.is_empty()).count(),
        school: &slug,
        local_tz_key: &key,
        current_date: &date,
        current_day: &day,
        post_date: &date,
        post_day: &day,
        post_time: &local.format("%H:%M").to_string(),
        semester_line: &semester_line,
    });
    let urls: Vec<String> = image_urls
        .iter()
        .filter(|url| !url.is_empty())
        .cloned()
        .collect();
    let Some(raw) = complete.complete(SYSTEM_MESSAGE, &prompt, &urls).await else {
        return Err(ExtractionFailed);
    };
    match parse_model_json(python_strip(&raw)) {
        Some(Value::Object(mut answer)) => {
            for key in ["events", "positions"] {
                if let Some(Value::Array(items)) = answer.get_mut(key) {
                    for item in items.iter_mut().filter_map(Value::as_object_mut) {
                        item.insert("school".into(), Value::String(slug.clone()));
                    }
                }
            }
            clean_extracted_content(&answer).map_err(|()| {
                tracing::warn!("Extraction returned an unusable response");
                ExtractionFailed
            })
        }
        _ => {
            tracing::warn!("Extraction returned an unusable response");
            Err(ExtractionFailed)
        }
    }
}

/// `_parse_model_json`: the model's JSON, without code fences or a trailing
/// note; `None` when nothing parses.
pub fn parse_model_json(raw: &str) -> Option<Value> {
    let mut text = raw;
    if let Some(rest) = text.strip_prefix("```json") {
        text = rest;
    } else if let Some(rest) = text.strip_prefix("```") {
        text = rest;
    }
    if let Some(rest) = text.strip_suffix("```") {
        text = rest;
    }
    let text = python_strip(text);
    if text.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str(text) {
        return Some(value);
    }
    for (opener, closer) in [('[', ']'), ('{', '}')] {
        if let (Some(start), Some(end)) = (text.find(opener), text.rfind(closer))
            && end > start
            && let Ok(value) = serde_json::from_str(&text[start..=end])
        {
            return Some(value);
        }
    }
    let head: String = raw.chars().take(200).collect();
    tracing::warn!(
        "Extractor returned non-JSON text (len={}): {head}",
        raw.chars().count()
    );
    None
}

/// `ExtractedPostContent`: the cleaned events and positions.
#[derive(Debug, Default, PartialEq)]
pub struct PostContent {
    pub events: Vec<ExtractedEvent>,
    pub positions: Vec<ExtractedPosition>,
}

/// `_clean_extracted_content`.
fn clean_extracted_content(answer: &Map<String, Value>) -> Result<PostContent, ()> {
    let content_type = answer.get("content_type").and_then(Value::as_str);
    let Some(content_type) =
        content_type.filter(|kind| ["event", "hiring", "event_and_hiring", "other"].contains(kind))
    else {
        return Err(());
    };
    let wants_events = matches!(content_type, "event" | "event_and_hiring");
    let wants_positions = matches!(content_type, "hiring" | "event_and_hiring");
    let raw_list = |key: &str| -> Result<Vec<Value>, ()> {
        match answer.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(Value::Array(items)) => Ok(items.clone()),
            Some(_) => Err(()),
        }
    };
    let mut content = PostContent::default();
    let raw_events = if wants_events {
        raw_list("events")?
    } else {
        Vec::new()
    };
    for event in &raw_events {
        if let Value::Object(event) = event
            && let Some(cleaned) = clean_event(event)
        {
            content.events.push(cleaned);
        }
    }
    let raw_positions = if wants_positions {
        raw_list("positions")?
    } else {
        Vec::new()
    };
    for position in &raw_positions {
        if let Value::Object(position) = position
            && let Some(cleaned) = clean_position(position)
        {
            content.positions.push(cleaned);
        }
    }
    if content.events.is_empty()
        && content.positions.is_empty()
        && (!raw_events.is_empty() || !raw_positions.is_empty())
    {
        return Err(());
    }
    Ok(content)
}

/// `normalize_campus_season_ids(value, school)` as extraction calls it:
/// unknown IDs are dropped, and an answer of only unknown IDs is unknown.
fn extracted_campus_seasons(value: Option<&Value>, school: Option<&Value>) -> Value {
    let Some(Value::Array(items)) = value else {
        return Value::Null;
    };
    let slug = normalize_slug(school.and_then(Value::as_str).unwrap_or_default());
    let allowed: Vec<&str> = EVENT_DISCOVERY
        .campus_seasons
        .schools
        .get(&slug)
        .map(|school| {
            school
                .seasons
                .iter()
                .map(|season| season.id.as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut valid: Vec<String> = items
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| allowed.contains(id))
        .map(str::to_owned)
        .collect();
    valid.sort();
    valid.dedup();
    if valid.is_empty() && !items.is_empty() {
        Value::Null
    } else {
        Value::from(valid)
    }
}

/// A datetime as pydantic's lax `datetime` reads a JSON value.
fn lax_datetime(value: &Value) -> Option<ParsedDatetime> {
    match value {
        Value::String(text) => parse_datetime(text).ok(),
        Value::Number(number) => parse_datetime(&number.to_string()).ok(),
        _ => None,
    }
}

/// `OptionalStr`'s `empty_str_to_none`: a blank string reads as `None`.
fn blank(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(text)) if python_strip(text).is_empty())
}

/// A `str` field with a default: missing is the default, `null` invalid.
fn text_or_default(body: &mut Body, name: &'static str, rules: &Str) -> String {
    match body.string(name, rules) {
        Input::Given(text) => text,
        Input::Missing => String::new(),
        Input::Null => {
            body.type_error(name, "string_type", "Input should be a valid string");
            String::new()
        }
    }
}

/// An `OptionalStr` field: blank or `null` is `None`.
fn optional_text(body: &mut Body, name: &'static str, rules: &Str) -> Option<String> {
    if blank(body.raw_copy(name).as_ref()) {
        body.raw(name);
        return None;
    }
    body.string(name, rules).value()
}

/// One extracted occurrence (`ExtractedOccurrence`).
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedOccurrence {
    pub dtstart_utc: ParsedDatetime,
    pub dtend_utc: Option<ParsedDatetime>,
    pub duration: Option<String>,
    pub tz: Option<String>,
}

fn occurrence(item: &Value) -> Option<ExtractedOccurrence> {
    let mut body = Body::nested(item.clone(), Vec::new(), Extra::Ignore).ok()?;
    let start = body.raw_copy("dtstart_utc").as_ref().and_then(lax_datetime);
    let end = match body.raw_copy("dtend_utc") {
        None | Some(Value::Null) => Some(None),
        value if blank(value.as_ref()) => Some(None),
        Some(value) => lax_datetime(&value).map(Some),
    };
    let duration = optional_text(&mut body, "duration", &Str::new());
    let tz = optional_text(&mut body, "tz", &Str::new());
    if body.has_issues() {
        return None;
    }
    Some(ExtractedOccurrence {
        dtstart_utc: start?,
        dtend_utc: end?,
        duration: duration.map(|text| normalize_scraped_text(&text)),
        tz: tz.map(|text| normalize_scraped_text(&text)),
    })
}

/// A cleaned event (`ExtractedEvent` after `_clean_event`), with the fields
/// the event form uses.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedEvent {
    pub title: String,
    pub description: String,
    pub location: String,
    pub price: Option<f64>,
    pub food: Vec<String>,
    pub registration: bool,
    pub occurrences: Vec<ExtractedOccurrence>,
    pub category: Option<String>,
}

/// `_clean_event`: validate one event as `ExtractedEvent`, normalizing its
/// text; `None` drops it.
fn clean_event(event: &Map<String, Value>) -> Option<ExtractedEvent> {
    let mut event = event.clone();
    let seasons = extracted_campus_seasons(event.get("campus_season_ids"), event.get("school"));
    event.insert("campus_season_ids".into(), seasons);
    let mut body = Body::nested(Value::Object(event), Vec::new(), Extra::Ignore).ok()?;
    for name in ["competition", "employers_on_campus", "sports_game"] {
        body.strict_bool(name);
    }
    let title = text_or_default(&mut body, "title", &Str::new());
    let description = text_or_default(&mut body, "description", &Str::new());
    let location = text_or_default(&mut body, "location", &Str::new());
    text_or_default(&mut body, "club", &Str::new());
    let price = match body.raw_copy("price") {
        None | Some(Value::Null) => None,
        Some(value) => match &value {
            Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
            Value::Number(number) => number.as_f64(),
            Value::String(text) => Some(crate::api::validation::parse_python_float(text)?),
            _ => return None,
        },
    };
    let food = match body.raw_copy("food") {
        None => Vec::new(),
        Some(Value::Array(items)) => {
            let mut food = Vec::with_capacity(items.len());
            for item in items {
                food.push(item.as_str()?.to_owned());
            }
            food
        }
        Some(_) => return None,
    };
    let registration = match body.bool("registration") {
        Input::Given(flag) => flag,
        Input::Missing => false,
        Input::Null => return None,
    };
    if matches!(body.int("image_index"), Input::Null) {
        return None;
    }
    let occurrences = match body.raw_copy("occurrences") {
        None => Vec::new(),
        Some(Value::Array(items)) => {
            let mut occurrences = Vec::with_capacity(items.len());
            for item in &items {
                occurrences.push(occurrence(item)?);
            }
            occurrences
        }
        Some(_) => return None,
    };
    text_or_default(&mut body, "school", &Str::new());
    let category = body.string("category", &Str::new()).value();
    if body.has_issues() {
        return None;
    }
    // `sort_occurrences`: by start, which fails (dropping the event) when
    // aware and naive times are mixed.
    let aware = occurrences
        .iter()
        .filter(|occurrence| matches!(occurrence.dtstart_utc, ParsedDatetime::Aware(_)))
        .count();
    if aware != 0 && aware != occurrences.len() {
        return None;
    }
    let mut occurrences = occurrences;
    occurrences.sort_by_key(|occurrence| occurrence.dtstart_utc.to_utc());
    Some(ExtractedEvent {
        title: normalize_scraped_text(&title),
        description: normalize_scraped_text(&description),
        location: normalize_scraped_text(&location),
        price,
        food: food
            .iter()
            .map(|item| normalize_scraped_text(item))
            .collect(),
        registration,
        occurrences,
        category: category.map(|text| normalize_scraped_text(&text)),
    })
}

/// A cleaned hiring position (`ExtractedPosition` after `_clean_position`),
/// in `PositionFields`' order.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedPosition {
    pub title: String,
    pub description: String,
    pub position_type: String,
    pub requirements: Vec<String>,
    pub commitment: Option<String>,
    pub compensation: Option<String>,
    pub is_paid: Option<bool>,
    pub location: Option<String>,
    pub contact_email: Option<String>,
    pub deadline_date: Option<NaiveDate>,
    /// As pydantic writes it (the offset kept).
    pub deadline_at: Option<String>,
}

/// `_clean_position`: validate one position as `ExtractedPosition`; `None` drops it.
fn clean_position(position: &Map<String, Value>) -> Option<ExtractedPosition> {
    let mut body = Body::nested(Value::Object(position.clone()), Vec::new(), Extra::Ignore).ok()?;
    let title = body.required_string("title", &Str::new().min(1).max(MAX_POSITION_TITLE_LENGTH));
    let description = body.required_string(
        "description",
        &Str::new()
            .min(1)
            .max(MAX_POSITION_DESCRIPTION_LENGTH as usize),
    );
    text_or_default(&mut body, "club", &Str::new());
    let position_type = body.required_string("position_type", &Str::new().one_of(POSITION_TYPES));
    let requirements = match body.raw_copy("requirements") {
        None => Vec::new(),
        Some(_) => body
            .string_list(
                "requirements",
                &Str::new().min(1).max(MAX_POSITION_REQUIREMENT_LENGTH),
                MAX_POSITION_REQUIREMENT_COUNT,
            )
            .value()?,
    };
    let detail = Str::new().max(MAX_POSITION_DETAIL_LENGTH);
    let commitment = optional_text(&mut body, "commitment", &detail);
    let compensation = optional_text(&mut body, "compensation", &detail);
    let is_paid = body.bool("is_paid").value();
    let location = optional_text(&mut body, "location", &detail);
    let contact_email = optional_text(&mut body, "contact_email", &Str::new().max(320));
    let deadline_date = match body.raw_copy("deadline_date") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(parse_date(&text).ok()?),
        Some(Value::Number(number)) => match parse_date(&number.to_string()) {
            Ok(date) => Some(date),
            Err(DateError::Inexact | DateError::Invalid(_)) => return None,
        },
        Some(_) => return None,
    };
    let deadline_at = match body.raw_copy("deadline_at") {
        None | Some(Value::Null) => None,
        value if blank(value.as_ref()) => None,
        Some(value) => Some(lax_datetime(&value)?),
    };
    match body.int("image_index") {
        Input::Given(index) if index >= 0 => {}
        Input::Missing => {}
        _ => return None,
    }
    if body.has_issues() {
        return None;
    }
    // `deadline_time_requires_date`.
    let deadline_at = match deadline_at {
        None => None,
        Some(_) if deadline_date.is_none() => return None,
        Some(ParsedDatetime::Naive(_)) => return None,
        Some(ParsedDatetime::Aware(at)) => Some(crate::api::json::format_offset_datetime(&at)),
    };
    let normalized = |text: Option<String>| text.map(|text| normalize_scraped_text(&text));
    Some(ExtractedPosition {
        title: normalize_scraped_text(&title?),
        description: normalize_scraped_text(&description?),
        position_type: normalize_scraped_text(&position_type?),
        requirements: requirements
            .iter()
            .map(|item| normalize_scraped_text(item))
            .collect(),
        commitment: normalized(commitment),
        compensation: normalized(compensation),
        is_paid,
        location: normalized(location),
        contact_email: normalized(contact_email),
        deadline_date,
        deadline_at,
    })
}

/// One occurrence of the event form, in the poster's local time.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[schema(as = EventFormOccurrenceResponse)]
pub struct FormOccurrence {
    pub dtstart_local: String,
    pub dtend_local: String,
}

/// `parse_event_image`'s result, before the stored poster's URL is added.
#[derive(Debug, Clone, PartialEq)]
pub struct EventForm {
    pub title: String,
    pub description: String,
    pub occurrences: Vec<FormOccurrence>,
    pub location: String,
    pub category: String,
    pub price: f64,
    pub food: Vec<String>,
    pub registration: bool,
}

const LOCAL_FORMAT: &str = "%Y-%m-%dT%H:%M";

/// `_default_local_datetime`: the next whole hour of the server's clock
/// (UTC in the container).
fn default_local_datetime(now: DateTime<Utc>) -> String {
    let hour = now
        .with_minute(0)
        .and_then(|time| time.with_second(0))
        .and_then(|time| time.with_nanosecond(0))
        .unwrap_or(now);
    (hour + Duration::hours(1)).format(LOCAL_FORMAT).to_string()
}

/// `datetime.fromisoformat(text).astimezone(zone)` for a pydantic datetime:
/// a naive one is read in the server's zone (UTC in the container).
fn local_text(value: &ParsedDatetime, zone: Tz) -> String {
    value
        .to_utc()
        .with_timezone(&zone)
        .format(LOCAL_FORMAT)
        .to_string()
}

/// `parse_event_image` from the first extracted event, and
/// `validate_event_response`: the event form's values, or `None` when the
/// event has no title.
pub fn event_form(
    event: &ExtractedEvent,
    school_zone: &str,
    now: DateTime<Utc>,
) -> Option<EventForm> {
    if python_strip(&event.title).is_empty() {
        return None;
    }
    let mut occurrences = Vec::new();
    for occurrence in &event.occurrences {
        let tz = occurrence
            .tz
            .as_deref()
            .filter(|tz| !tz.is_empty())
            .unwrap_or(school_zone);
        let (zone, _) = zone(tz);
        occurrences.push(FormOccurrence {
            dtstart_local: local_text(&occurrence.dtstart_utc, zone),
            dtend_local: occurrence
                .dtend_utc
                .as_ref()
                .map(|end| local_text(end, zone))
                .unwrap_or_default(),
        });
    }
    if occurrences.is_empty() {
        occurrences.push(FormOccurrence {
            dtstart_local: default_local_datetime(now),
            dtend_local: String::new(),
        });
    }
    let category = event
        .category
        .as_deref()
        .map(python_strip)
        .filter(|category| !category.is_empty())
        .and_then(|category| {
            if EVENT_CATEGORIES.contains(&category) {
                Some(category.to_owned())
            } else {
                tracing::warn!("Unrecognized category {category:?}, dropping it");
                None
            }
        })
        .unwrap_or_default();
    let mut food: Vec<String> = Vec::new();
    for item in &event.food {
        let item = python_strip(item);
        if !item.is_empty() && !food.iter().any(|kept| kept == item) {
            food.push(item.to_owned());
        }
    }
    Some(EventForm {
        title: event.title.clone(),
        description: event.description.clone(),
        occurrences,
        location: python_strip(&event.location).to_owned(),
        category,
        price: event.price.map_or(0.0, |price| price.max(0.0)),
        food,
        registration: event.registration,
    })
}
