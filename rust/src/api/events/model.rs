//! The event API models (`schemas/event.py`, `schemas/event_date.py`) and
//! `event_query.hydrate_event`: one events row plus its occurrences become the
//! browse card, the full detail, or the public detail, field for field in the
//! pydantic models' order.

use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::api::errors::ApiError;
use crate::api::json;

/// One `event_dates` row (`OccurrenceResponse`).
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub id: Uuid,
    pub event_id: i64,
    pub dtstart_utc: DateTime<Utc>,
    pub dtend_utc: Option<DateTime<Utc>>,
    pub duration: Option<String>,
    pub tz: Option<String>,
}

/// `OccurrenceSummaryResponse`: browse dates keep only their identity and times.
#[derive(Debug, Serialize)]
pub struct OccurrenceSummary {
    pub id: Uuid,
    #[serde(serialize_with = "json::datetime")]
    pub dtstart_utc: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub dtend_utc: Option<DateTime<Utc>>,
}

/// `OccurrenceResponse`.
#[derive(Debug, Serialize)]
pub struct OccurrenceResponse {
    pub id: Uuid,
    #[serde(serialize_with = "json::datetime")]
    pub dtstart_utc: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub dtend_utc: Option<DateTime<Utc>>,
    pub event_id: i64,
    pub duration: Option<String>,
    pub tz: Option<String>,
}

impl From<&Occurrence> for OccurrenceSummary {
    fn from(occurrence: &Occurrence) -> Self {
        Self {
            id: occurrence.id,
            dtstart_utc: occurrence.dtstart_utc,
            dtend_utc: occurrence.dtend_utc,
        }
    }
}

impl From<&Occurrence> for OccurrenceResponse {
    fn from(occurrence: &Occurrence) -> Self {
        Self {
            id: occurrence.id,
            dtstart_utc: occurrence.dtstart_utc,
            dtend_utc: occurrence.dtend_utc,
            event_id: occurrence.event_id,
            duration: occurrence.duration.clone(),
            tz: occurrence.tz.clone(),
        }
    }
}

/// `ClubCohostResponse`.
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct ClubCohost {
    pub id: i64,
    pub club_name: String,
    pub logo_url: Option<String>,
    pub club_type: Option<String>,
    pub club_page: Option<String>,
    pub ig: Option<String>,
    pub discord: Option<String>,
}

/// An events row with the embeds `hydrate_event` reads: the owning club's
/// display fields, the cohosts, the school and the Instagram publication.
#[derive(Debug, Clone, Default)]
pub struct EventRow {
    pub id: i64,
    pub club_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub map_location: Option<String>,
    pub map_coordinates: Option<Vec<Option<f64>>>,
    pub price: Option<f64>,
    pub food: Option<serde_json::Value>,
    pub registration: bool,
    pub source_image_url: Option<String>,
    pub source_video_url: Option<String>,
    /// The title as the poster sets it, drawn as an SVG.
    pub title_svg: Option<String>,
    pub source_url: Option<String>,
    pub category: Option<String>,
    pub club: Option<String>,
    pub ig_handle: Option<String>,
    pub cancelled: bool,
    pub added_at: DateTime<Utc>,
    pub last_source_changed_at: Option<DateTime<Utc>>,
    pub competition: Option<bool>,
    pub employers_on_campus: Option<bool>,
    pub sports_game: Option<bool>,
    pub campus_season_ids: Option<Vec<Option<String>>>,
    pub ingestion_source: Option<String>,
    pub created_by: Option<Uuid>,
    /// The school's slug (`with_school_slug`).
    pub school: Option<String>,
    pub school_timezone: Option<String>,
    /// Whether the `clubs` embed was present (the event has a club).
    pub has_club: bool,
    pub club_logo_url: Option<String>,
    pub club_type: Option<String>,
    pub club_page: Option<String>,
    pub club_ig: Option<String>,
    pub club_discord: Option<String>,
    pub cohosts: Vec<ClubCohost>,
    pub featured: bool,
}

/// A hydrated event: every field any of the three response models carries.
#[derive(Debug, Clone)]
pub struct Event {
    pub competition: Option<bool>,
    pub employers_on_campus: Option<bool>,
    pub sports_game: Option<bool>,
    pub campus_season_ids: Option<Vec<String>>,
    pub id: i64,
    pub club_id: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub map_location: Option<String>,
    pub map_coordinates: Option<[f64; 2]>,
    pub occurrences: Vec<Occurrence>,
    pub price: Option<f64>,
    pub food: Option<Vec<String>>,
    pub registration: bool,
    pub source_image_url: Option<String>,
    pub source_video_url: Option<String>,
    /// The title as the poster sets it, drawn as an SVG.
    pub title_svg: Option<String>,
    pub source_url: Option<String>,
    pub category: Option<String>,
    pub club: Option<String>,
    pub club_logo_url: Option<String>,
    pub cohosts: Vec<ClubCohost>,
    pub featured: bool,
    pub is_directory_event: bool,
    pub club_type: Option<String>,
    pub club_page: Option<String>,
    pub club_ig: Option<String>,
    pub club_discord: Option<String>,
    pub ig_handle: Option<String>,
    pub school: Option<String>,
    pub cancelled: bool,
    pub added_at: DateTime<Utc>,
    pub last_source_changed_at: Option<DateTime<Utc>>,
    pub created_by: Option<Uuid>,
}

fn invalid(event_id: i64, field: &str) -> ApiError {
    // FastAPI's ResponseValidationError: the generic 500.
    ApiError::Internal(anyhow::anyhow!(
        "event {event_id} fails response validation: {field}"
    ))
}

/// `ClubTypeValue`: stripped, lower-cased, a lowercase slug of at most 100 characters.
pub fn club_type_value(value: Option<String>, event_id: i64) -> Result<Option<String>, ApiError> {
    let Some(value) = value else { return Ok(None) };
    let normalized = crate::text::python_strip(&value).to_lowercase();
    let valid = !normalized.is_empty()
        && normalized.chars().count() <= crate::constants::MAX_CLUB_TYPE_LENGTH
        && normalized.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        });
    if valid {
        Ok(Some(normalized))
    } else {
        Err(invalid(event_id, "club_type"))
    }
}

/// `EventDiscoveryFields._unique_campus_seasons`: sorted and unique.
fn campus_seasons(
    value: Option<Vec<Option<String>>>,
    event_id: i64,
) -> Result<Option<Vec<String>>, ApiError> {
    let Some(values) = value else { return Ok(None) };
    let mut seasons = values
        .into_iter()
        .collect::<Option<Vec<String>>>()
        .ok_or_else(|| invalid(event_id, "campus_season_ids"))?;
    seasons.sort();
    seasons.dedup();
    Ok(Some(seasons))
}

/// `MapCoordinates`: `[longitude, latitude]` within the globe.
fn coordinates(
    value: Option<Vec<Option<f64>>>,
    event_id: i64,
) -> Result<Option<[f64; 2]>, ApiError> {
    let Some(values) = value else { return Ok(None) };
    match values.as_slice() {
        [Some(longitude), Some(latitude)]
            if (-180.0..=180.0).contains(longitude) && (-90.0..=90.0).contains(latitude) =>
        {
            Ok(Some([*longitude, *latitude]))
        }
        _ => Err(invalid(event_id, "map_coordinates")),
    }
}

fn food(value: Option<serde_json::Value>, event_id: i64) -> Result<Option<Vec<String>>, ApiError> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Array(items)) => items
            .into_iter()
            .map(|item| match item {
                serde_json::Value::String(text) => Ok(text),
                _ => Err(invalid(event_id, "food")),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(invalid(event_id, "food")),
    }
}

/// `hydrate_event`: flatten the club embed onto the event, mark directory and
/// featured events, and attach the occurrences. `directory_logo` is the
/// publishing club's logo for a directory event whose host club has none
/// (`directory.default_club_logo`), looked up by the caller.
pub fn hydrate(
    row: EventRow,
    occurrences: Vec<Occurrence>,
    directory_logo: Option<String>,
) -> Result<Event, ApiError> {
    let id = row.id;
    let is_directory_event = row.ingestion_source.as_deref() == Some("directory");
    let mut club_logo_url = row.club_logo_url;
    if needs_directory_logo(is_directory_event, row.club_id, club_logo_url.as_deref()) {
        club_logo_url = directory_logo;
    }
    let cohosts = row
        .cohosts
        .into_iter()
        .map(|cohost| {
            Ok(ClubCohost {
                club_type: club_type_value(cohost.club_type.clone(), id)?,
                ..cohost
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Event {
        competition: row.competition,
        employers_on_campus: row.employers_on_campus,
        sports_game: row.sports_game,
        campus_season_ids: campus_seasons(row.campus_season_ids, id)?,
        id,
        club_id: row.club_id,
        title: row.title,
        description: row.description,
        location: row.location,
        map_location: row.map_location,
        map_coordinates: coordinates(row.map_coordinates, id)?,
        occurrences,
        price: row.price,
        food: food(row.food, id)?,
        registration: row.registration,
        source_image_url: row.source_image_url,
        source_video_url: row.source_video_url,
        title_svg: row.title_svg,
        source_url: row.source_url,
        category: row.category,
        club: row.club,
        club_logo_url,
        cohosts,
        featured: row.featured,
        is_directory_event,
        club_type: club_type_value(row.club_type, id)?,
        club_page: row.club_page,
        club_ig: row.club_ig,
        club_discord: row.club_discord,
        ig_handle: row.ig_handle,
        school: row.school,
        cancelled: row.cancelled,
        added_at: row.added_at,
        last_source_changed_at: row.last_source_changed_at,
        created_by: row.created_by,
    })
}

/// A university-run directory event (no club) never borrows the union's logo;
/// a club-hosted one without a logo of its own does.
pub fn needs_directory_logo(
    is_directory_event: bool,
    club_id: Option<i64>,
    club_logo_url: Option<&str>,
) -> bool {
    is_directory_event && club_id.is_some() && club_logo_url.is_none_or(str::is_empty)
}

/// `EventSummaryResponse`: the browse card.
#[derive(Debug, Serialize)]
pub struct EventSummaryResponse<'a> {
    pub competition: Option<bool>,
    pub employers_on_campus: Option<bool>,
    pub sports_game: Option<bool>,
    pub campus_season_ids: &'a Option<Vec<String>>,
    pub id: i64,
    pub club_id: Option<i64>,
    pub title: &'a str,
    pub description: &'a Option<String>,
    pub location: &'a Option<String>,
    pub map_location: &'a Option<String>,
    #[serde(serialize_with = "json::option_float_array")]
    pub map_coordinates: Option<[f64; 2]>,
    pub occurrences: Vec<OccurrenceSummary>,
    #[serde(serialize_with = "json::option_float")]
    pub price: Option<f64>,
    pub food: &'a Option<Vec<String>>,
    pub registration: bool,
    pub source_image_url: &'a Option<String>,
    pub source_video_url: &'a Option<String>,
    pub title_svg: &'a Option<String>,
    pub source_url: &'a Option<String>,
    pub category: &'a Option<String>,
    pub club: &'a Option<String>,
    pub club_logo_url: &'a Option<String>,
    pub cohosts: &'a [ClubCohost],
    pub featured: bool,
    pub is_directory_event: bool,
    pub club_type: &'a Option<String>,
    pub club_page: &'a Option<String>,
    pub club_ig: &'a Option<String>,
    pub club_discord: &'a Option<String>,
    pub ig_handle: &'a Option<String>,
    pub school: &'a Option<String>,
    pub cancelled: bool,
    #[serde(serialize_with = "json::datetime")]
    pub added_at: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub last_source_changed_at: Option<DateTime<Utc>>,
}

/// `EventResponse` (with `created_by`) and `EventPublicResponse` (without).
#[derive(Debug, Serialize)]
pub struct EventResponse<'a> {
    pub competition: Option<bool>,
    pub employers_on_campus: Option<bool>,
    pub sports_game: Option<bool>,
    pub campus_season_ids: &'a Option<Vec<String>>,
    pub id: i64,
    pub club_id: Option<i64>,
    pub title: &'a str,
    pub description: &'a Option<String>,
    pub location: &'a Option<String>,
    pub map_location: &'a Option<String>,
    #[serde(serialize_with = "json::option_float_array")]
    pub map_coordinates: Option<[f64; 2]>,
    pub occurrences: Vec<OccurrenceResponse>,
    #[serde(serialize_with = "json::option_float")]
    pub price: Option<f64>,
    pub food: &'a Option<Vec<String>>,
    pub registration: bool,
    pub source_image_url: &'a Option<String>,
    pub source_video_url: &'a Option<String>,
    pub title_svg: &'a Option<String>,
    pub club_logo_url: &'a Option<String>,
    pub cohosts: &'a [ClubCohost],
    pub featured: bool,
    pub is_directory_event: bool,
    pub club_type: &'a Option<String>,
    pub school: &'a Option<String>,
    pub source_url: &'a Option<String>,
    pub category: &'a Option<String>,
    pub club: &'a Option<String>,
    pub ig_handle: &'a Option<String>,
    pub cancelled: bool,
    #[serde(serialize_with = "json::datetime")]
    pub added_at: DateTime<Utc>,
    #[serde(serialize_with = "json::option_datetime")]
    pub last_source_changed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Hidden::is_hidden")]
    pub created_by: Hidden<Option<String>>,
}

/// A field that one response model has and its public twin omits.
#[derive(Debug)]
pub enum Hidden<T> {
    Shown(T),
    Omitted,
}

impl<T> Hidden<T> {
    fn is_hidden(&self) -> bool {
        matches!(self, Self::Omitted)
    }
}

impl<T: Serialize> Serialize for Hidden<T> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Shown(value) => value.serialize(serializer),
            Self::Omitted => serializer.serialize_none(),
        }
    }
}

impl Event {
    pub fn summary(&self) -> EventSummaryResponse<'_> {
        EventSummaryResponse {
            competition: self.competition,
            employers_on_campus: self.employers_on_campus,
            sports_game: self.sports_game,
            campus_season_ids: &self.campus_season_ids,
            id: self.id,
            club_id: self.club_id,
            title: &self.title,
            description: &self.description,
            location: &self.location,
            map_location: &self.map_location,
            map_coordinates: self.map_coordinates,
            occurrences: self.occurrences.iter().map(Into::into).collect(),
            price: self.price,
            food: &self.food,
            registration: self.registration,
            source_image_url: &self.source_image_url,
            source_video_url: &self.source_video_url,
            title_svg: &self.title_svg,
            source_url: &self.source_url,
            category: &self.category,
            club: &self.club,
            club_logo_url: &self.club_logo_url,
            cohosts: &self.cohosts,
            featured: self.featured,
            is_directory_event: self.is_directory_event,
            club_type: &self.club_type,
            club_page: &self.club_page,
            club_ig: &self.club_ig,
            club_discord: &self.club_discord,
            ig_handle: &self.ig_handle,
            school: &self.school,
            cancelled: self.cancelled,
            added_at: self.added_at,
            last_source_changed_at: self.last_source_changed_at,
        }
    }

    fn detail(&self, created_by: Hidden<Option<String>>) -> EventResponse<'_> {
        EventResponse {
            competition: self.competition,
            employers_on_campus: self.employers_on_campus,
            sports_game: self.sports_game,
            campus_season_ids: &self.campus_season_ids,
            id: self.id,
            club_id: self.club_id,
            title: &self.title,
            description: &self.description,
            location: &self.location,
            map_location: &self.map_location,
            map_coordinates: self.map_coordinates,
            occurrences: self.occurrences.iter().map(Into::into).collect(),
            price: self.price,
            food: &self.food,
            registration: self.registration,
            source_image_url: &self.source_image_url,
            source_video_url: &self.source_video_url,
            title_svg: &self.title_svg,
            club_logo_url: &self.club_logo_url,
            cohosts: &self.cohosts,
            featured: self.featured,
            is_directory_event: self.is_directory_event,
            club_type: &self.club_type,
            school: &self.school,
            source_url: &self.source_url,
            category: &self.category,
            club: &self.club,
            ig_handle: &self.ig_handle,
            cancelled: self.cancelled,
            added_at: self.added_at,
            last_source_changed_at: self.last_source_changed_at,
            created_by,
        }
    }

    /// `EventResponse`, for writes and ownership checks.
    pub fn full(&self) -> EventResponse<'_> {
        self.detail(Hidden::Shown(self.created_by.map(|id| id.to_string())))
    }

    /// `EventPublicResponse`: no creator id for anonymous readers.
    pub fn public(&self) -> EventResponse<'_> {
        self.detail(Hidden::Omitted)
    }

    /// `has_ended`: every occurrence is over (the latest end, or start, is in
    /// the past); an event without occurrences counts as ended.
    pub fn has_ended(&self, now: DateTime<Utc>) -> bool {
        self.occurrences
            .iter()
            .map(|occurrence| occurrence.dtend_utc.unwrap_or(occurrence.dtstart_utc))
            .max()
            .is_none_or(|latest| latest < now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 18, 0, 0).unwrap()
    }

    fn row() -> EventRow {
        EventRow {
            id: 42,
            title: "Fast Feed Night".into(),
            location: Some("SLC".into()),
            club: Some("UW Blueprint".into()),
            added_at: Utc.with_ymd_and_hms(2026, 5, 30, 0, 0, 0).unwrap(),
            ..EventRow::default()
        }
    }

    fn occurrence(day: u32) -> Occurrence {
        Occurrence {
            id: Uuid::from_u128(day as u128),
            event_id: 42,
            dtstart_utc: at(day),
            dtend_utc: None,
            duration: Some("PT2H".into()),
            tz: Some("America/Toronto".into()),
        }
    }

    #[test]
    fn club_fields_flatten_onto_the_card() {
        // test_hydrate_event_reuses_validated_occurrences_without_json_dump
        let event = hydrate(
            EventRow {
                has_club: true,
                club_logo_url: Some("https://example.com/uw-blueprint.jpg".into()),
                club_type: Some(" WUSA ".into()),
                ..row()
            },
            vec![occurrence(1)],
            None,
        )
        .unwrap();
        assert_eq!(
            event.club_logo_url.as_deref(),
            Some("https://example.com/uw-blueprint.jpg")
        );
        assert_eq!(event.club_type.as_deref(), Some("wusa"));
        assert_eq!(event.occurrences[0].dtstart_utc, at(1));
    }

    #[test]
    fn browse_occurrences_keep_identity_and_times_only() {
        // test_browse_occurrences_reduce_payload_without_losing_selection_or_full_detail_fields
        let event = hydrate(row(), (1..=6).map(occurrence).collect(), None).unwrap();
        let summary = serde_json::to_value(event.summary()).unwrap();
        let detail = serde_json::to_value(event.full()).unwrap();
        for (compact, full) in summary["occurrences"]
            .as_array()
            .unwrap()
            .iter()
            .zip(detail["occurrences"].as_array().unwrap())
        {
            assert_eq!(compact.as_object().unwrap().len(), 3);
            for key in ["id", "dtstart_utc", "dtend_utc"] {
                assert_eq!(compact[key], full[key]);
            }
            assert_eq!(full["event_id"], 42);
            assert_eq!(full["duration"], "PT2H");
            assert_eq!(full["tz"], "America/Toronto");
        }
    }

    #[test]
    fn public_detail_hides_the_creator() {
        let creator = Uuid::from_u128(7);
        let event = hydrate(
            EventRow {
                created_by: Some(creator),
                ..row()
            },
            vec![],
            None,
        )
        .unwrap();
        let full = serde_json::to_value(event.full()).unwrap();
        assert_eq!(full["created_by"], creator.to_string());
        let public = serde_json::to_value(event.public()).unwrap();
        assert!(public.get("created_by").is_none());
        let summary = serde_json::to_value(event.summary()).unwrap();
        assert!(summary.get("created_by").is_none());
    }

    #[test]
    fn directory_events_borrow_the_union_logo_only_when_hosted_by_a_club() {
        // test_directory_event_identity_preserves_original_media and
        // test_directory_missing_host_picture_uses_union_without_renaming_host
        let directory = EventRow {
            ingestion_source: Some("directory".into()),
            club_id: Some(7),
            has_club: true,
            ..row()
        };
        let event = hydrate(directory.clone(), vec![], Some("union.jpg".into())).unwrap();
        assert!(event.is_directory_event);
        assert_eq!(event.club_logo_url.as_deref(), Some("union.jpg"));
        assert!(!needs_directory_logo(true, None, None));
        assert!(needs_directory_logo(true, Some(7), Some("")));
        assert!(!needs_directory_logo(true, Some(7), Some("own.jpg")));
        assert!(!needs_directory_logo(false, Some(7), None));
        let scraped = EventRow {
            ingestion_source: Some("instagram_scraper".into()),
            club_logo_url: Some("club.jpg".into()),
            ..directory
        };
        let event = hydrate(scraped, vec![], None).unwrap();
        assert!(!event.is_directory_event);
        assert_eq!(event.club_logo_url.as_deref(), Some("club.jpg"));
    }

    #[test]
    fn response_validation_failures_are_500s() {
        let bad_type = EventRow {
            club_type: Some("Not A Slug".into()),
            ..row()
        };
        assert!(matches!(
            hydrate(bad_type, vec![], None),
            Err(ApiError::Internal(_))
        ));
        let bad_pin = EventRow {
            map_coordinates: Some(vec![Some(200.0), Some(1.0)]),
            ..row()
        };
        assert!(hydrate(bad_pin, vec![], None).is_err());
        let bad_food = EventRow {
            food: Some(serde_json::json!(["pizza", 1])),
            ..row()
        };
        assert!(hydrate(bad_food, vec![], None).is_err());
        let seasons = EventRow {
            campus_season_ids: Some(vec![Some("b".into()), Some("a".into()), Some("b".into())]),
            ..row()
        };
        let event = hydrate(seasons, vec![], None).unwrap();
        assert_eq!(event.campus_season_ids, Some(vec!["a".into(), "b".into()]));
    }

    #[test]
    fn has_ended_uses_the_latest_end() {
        // event_service.has_ended
        let now = at(10);
        let mut event = hydrate(row(), vec![], None).unwrap();
        assert!(event.has_ended(now));
        event.occurrences = vec![occurrence(1), occurrence(20)];
        assert!(!event.has_ended(now));
        event.occurrences = vec![Occurrence {
            dtend_utc: Some(at(11)),
            ..occurrence(9)
        }];
        assert!(!event.has_ended(now));
        event.occurrences = vec![occurrence(9)];
        assert!(event.has_ended(now));
    }
}
