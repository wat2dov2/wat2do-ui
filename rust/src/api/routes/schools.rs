//! `GET /schools` and `GET /schools/{slug}`: the public school directory
//! (`routers/schools.py`, `services/school_service.py`).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use chrono::NaiveDate;
use indexmap::IndexMap;
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;
use utoipa::ToSchema;

use crate::api::AppState;
use crate::api::errors::ApiError;
use crate::api::validation::{Length, Limits, PathParams, QueryParams, Validator};
use crate::constants::MAX_SEARCH_QUERY_LENGTH;
use crate::controlbox::EVENT_DISCOVERY;
use crate::db::read_with_retry;
use crate::schools::normalize_slug;

/// `school_service.DEFAULT_SEARCH_LIMIT`.
const DEFAULT_SEARCH_LIMIT: i64 = 10;
const SCHOOL_NOT_FOUND: &str = "School not found";

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct CampusSeasonWindow {
    #[schema(value_type = String, format = Date)]
    #[serde(serialize_with = "date")]
    pub start_date: NaiveDate,
    #[schema(value_type = String, format = Date)]
    #[serde(serialize_with = "date")]
    pub end_date: NaiveDate,
}

fn date<S: serde::Serializer>(value: &NaiveDate, serializer: S) -> Result<S::Ok, S::Error> {
    crate::api::json::option_date(&Some(*value), serializer)
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SchoolEventSeason {
    pub id: String,
    pub classification_id: String,
    #[schema(value_type = std::collections::HashMap<String, String>)]
    pub labels: IndexMap<String, String>,
    pub display_windows: Vec<CampusSeasonWindow>,
}

/// `_event_seasons`: a school's discovery filters from its configured
/// seasons, without the classification instructions. A named display window
/// (`filter_id`) becomes its own filter that keeps the season's tagging.
pub fn event_seasons(slug: &str) -> Vec<SchoolEventSeason> {
    let configuration = &EVENT_DISCOVERY.campus_seasons;
    let Some(school) = configuration.schools.get(&normalize_slug(slug)) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for season in &school.seasons {
        let filter_of = |window: &crate::controlbox::DisplayWindow| {
            window
                .filter_id
                .clone()
                .unwrap_or_else(|| season.id.clone())
        };
        let mut filter_ids: Vec<String> = Vec::new();
        for window in &season.display_windows {
            let filter_id = filter_of(window);
            if !filter_ids.contains(&filter_id) {
                filter_ids.push(filter_id);
            }
        }
        if filter_ids.is_empty() {
            filter_ids.push(season.id.clone());
        }
        for filter_id in filter_ids {
            result.push(SchoolEventSeason {
                labels: configuration.definitions[&filter_id].labels.clone(),
                display_windows: season
                    .display_windows
                    .iter()
                    .filter(|window| filter_of(window) == filter_id)
                    .map(|window| CampusSeasonWindow {
                        start_date: window.start_date,
                        end_date: window.end_date,
                    })
                    .collect(),
                classification_id: season.id.clone(),
                id: filter_id,
            });
        }
    }
    result
}

/// A school as the directory lists it, with its sign-in email domains.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SchoolSummary {
    pub slug: String,
    pub name: String,
    pub city: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
    pub timezone: String,
    #[schema(inline)]
    pub language: Language,
    #[schema(required = false)]
    pub faculties: Vec<String>,
    #[schema(required = false)]
    pub location_examples: Vec<String>,
    #[schema(required = false)]
    pub event_seasons: Vec<SchoolEventSeason>,
    #[schema(required = false)]
    pub email_domains: Vec<String>,
}

/// One school's public profile.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct School {
    pub slug: String,
    pub name: String,
    pub city: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
    pub timezone: String,
    #[schema(inline)]
    pub language: Language,
    #[schema(required = false)]
    pub faculties: Vec<String>,
    #[schema(required = false)]
    pub location_examples: Vec<String>,
    #[schema(required = false)]
    pub event_seasons: Vec<SchoolEventSeason>,
    pub recipient_id: Option<String>,
    #[schema(value_type = Option<String>, format = Date)]
    #[serde(serialize_with = "crate::api::json::option_date")]
    pub semester_start: Option<NaiveDate>,
    #[schema(value_type = Option<String>, format = Date)]
    #[serde(serialize_with = "crate::api::json::option_date")]
    pub semester_end: Option<NaiveDate>,
    pub social_preview_image_url: Option<String>,
}

/// `Literal["en", "fr"]`; any other stored value fails like pydantic's validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    En,
    Fr,
}

impl TryFrom<&str> for Language {
    type Error = ApiError;

    fn try_from(value: &str) -> Result<Self, ApiError> {
        match value {
            "en" => Ok(Self::En),
            "fr" => Ok(Self::Fr),
            other => Err(ApiError::Internal(anyhow::anyhow!(
                "school language {other:?} is not 'en' or 'fr'"
            ))),
        }
    }
}

/// `validate_recipient_id`: a stored id must be canonical, or the response fails.
fn checked_recipient_id(value: Option<String>) -> Result<Option<String>, ApiError> {
    match value {
        Some(id)
            if id.is_empty()
                || id.len() > 32
                || !id.bytes().all(|byte| byte.is_ascii_digit())
                || id.starts_with('0') =>
        {
            Err(ApiError::Internal(anyhow::anyhow!(
                "recipient_id must be a canonical numeric identifier"
            )))
        }
        other => Ok(other),
    }
}

#[derive(sqlx::FromRow)]
struct SchoolRow {
    slug: String,
    name: String,
    city: Option<String>,
    primary_color: String,
    secondary_color: String,
    timezone: String,
    language: String,
    faculties: Vec<String>,
    location_examples: Vec<String>,
    recipient_id: Option<String>,
    semester_start: Option<NaiveDate>,
    semester_end: Option<NaiveDate>,
    social_preview_image_url: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SummaryRow {
    slug: String,
    name: String,
    city: Option<String>,
    primary_color: String,
    secondary_color: String,
    timezone: String,
    language: String,
    faculties: Vec<String>,
    location_examples: Vec<String>,
    /// (domain, is_primary) pairs.
    domains: sqlx::types::Json<Vec<(String, bool)>>,
}

/// Python's `" ".join(unicodedata.normalize("NFKC", text).casefold().split())`.
fn normalize(text: &str) -> String {
    let folded = caseless::default_case_fold_str(&text.nfkc().collect::<String>());
    folded
        .split(crate::text::python_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `_compact`: only ASCII letters and digits of the normalized text.
fn compact(text: &str) -> String {
    normalize(text)
        .chars()
        .filter(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        .collect()
}

/// `_score_term`: 0 exact, 1 prefix, 2 substring, with the term's compact length.
fn score_term(term: &str, query: &str, query_compact: &str) -> Option<(u8, usize)> {
    let term_compact: String = term
        .chars()
        .filter(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        .collect();
    if term_compact.is_empty() {
        return None;
    }
    let length = term_compact.chars().count();
    if term == query || term_compact == query_compact {
        return Some((0, length));
    }
    if term.starts_with(query) || term_compact.starts_with(query_compact) {
        return Some((1, length));
    }
    if term.contains(query) || term_compact.contains(query_compact) {
        return Some((2, length));
    }
    None
}

/// `_ordered_email_domains`: primary domains (sorted) first, then the rest sorted.
fn ordered_email_domains(rows: &[(String, bool)]) -> Vec<String> {
    let mut primary = Vec::new();
    let mut secondary = std::collections::BTreeSet::new();
    for (domain, is_primary) in rows {
        let domain = crate::text::python_strip(domain).to_lowercase();
        if domain.is_empty() {
            continue;
        }
        if *is_primary {
            primary.push(domain);
        } else {
            secondary.insert(domain);
        }
    }
    primary.sort();
    let rest: Vec<String> = secondary
        .into_iter()
        .filter(|domain| !primary.contains(domain))
        .collect();
    primary.extend(rest);
    primary
}

/// `search_schools` over the directory rows (in name order): rank by match
/// quality, then by the shortest matching term, then by name; keep `limit`.
fn rank(rows: Vec<SummaryRow>, query: &str, limit: usize) -> Result<Vec<SchoolSummary>, ApiError> {
    let normalized_query = normalize(query);
    let query_compact = compact(&normalized_query);
    let mut ranked: Vec<((u8, usize, String), SchoolSummary)> = Vec::new();
    for row in rows {
        let name_key = caseless::default_case_fold_str(&row.name);
        let mut terms = vec![normalize(&row.slug), normalize(&row.name)];
        terms.extend(
            row.domains
                .iter()
                .filter(|(domain, _)| !domain.is_empty())
                .map(|(domain, _)| normalize(domain)),
        );
        let best = if normalized_query.is_empty() {
            Some((0, 0, name_key))
        } else {
            terms
                .iter()
                .filter_map(|term| score_term(term, &normalized_query, &query_compact))
                .map(|(rank, length)| (rank, length, name_key.clone()))
                .min()
        };
        let Some(key) = best else { continue };
        let school = SchoolSummary {
            email_domains: ordered_email_domains(&row.domains),
            event_seasons: event_seasons(&row.slug),
            language: Language::try_from(row.language.as_str())?,
            slug: row.slug,
            name: row.name,
            city: row.city,
            primary_color: row.primary_color,
            secondary_color: row.secondary_color,
            timezone: row.timezone,
            faculties: row.faculties,
            location_examples: row.location_examples,
        };
        ranked.push((key, school));
    }
    // A stable sort, as Python's, keeps the directory's name order among ties.
    ranked.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(ranked
        .into_iter()
        .take(limit)
        .map(|(_, school)| school)
        .collect())
}

#[utoipa::path(
    get,
    path = "/schools",
    tag = "schools",
    operation_id = "search_schools_endpoint_schools_get",
    summary = "Search Schools Endpoint",
    params(
        ("q" = Option<String>, Query, max_length = 200),
        ("limit" = Option<i64>, Query, minimum = 1, maximum = 50),
    ),
    responses(
        (status = 200, description = "Successful Response", body = Vec<SchoolSummary>),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn search_schools(
    State(state): State<AppState>,
    query: QueryParams,
) -> Result<Json<Vec<SchoolSummary>>, ApiError> {
    let mut check = Validator::default();
    let q = check
        .query(&query, "q")
        .string_or("", Length::default().max(MAX_SEARCH_QUERY_LENGTH));
    let limit = check
        .query(&query, "limit")
        .int_or(DEFAULT_SEARCH_LIMIT, Limits::default().ge(1).le(50));
    check.finish()?;
    let rows = read_with_retry(|| {
        sqlx::query_as::<_, SummaryRow>(
            "SELECT s.slug, s.name, s.city, s.primary_color, s.secondary_color, s.timezone, \
             s.language, s.faculties, s.location_examples, \
             COALESCE((SELECT json_agg(json_build_array(d.domain, d.is_primary)) \
                       FROM public.school_email_domains d WHERE d.school_id = s.id), '[]') AS domains \
             FROM public.schools s ORDER BY s.name",
        )
        .fetch_all(&state.db)
    })
    .await?;
    Ok(Json(rank(rows, &q, limit as usize)?))
}

#[utoipa::path(
    get,
    path = "/schools/{slug}",
    tag = "schools",
    operation_id = "get_school_endpoint_schools__slug__get",
    summary = "Get School Endpoint",
    params(("slug" = String, Path)),
    responses(
        (status = 200, description = "Successful Response", body = School),
        (status = 422, description = "Validation Error", body = crate::api::routes::HttpValidationError),
    )
)]
pub async fn get_school(
    State(state): State<AppState>,
    path: PathParams,
) -> Result<Json<School>, ApiError> {
    let mut check = Validator::default();
    let slug = normalize_slug(&check.path(&path, "slug").string(Length::default()));
    check.finish()?;
    if slug.is_empty() {
        return Err(ApiError::http(StatusCode::NOT_FOUND, SCHOOL_NOT_FOUND));
    }
    let row = read_with_retry(|| {
        sqlx::query_as::<_, SchoolRow>(
            "SELECT slug, name, city, primary_color, secondary_color, timezone, language, \
             faculties, location_examples, recipient_id, semester_start, semester_end, \
             social_preview_image_url FROM public.schools WHERE slug = $1 LIMIT 1",
        )
        .bind(&slug)
        .fetch_optional(&state.db)
    })
    .await?
    .ok_or_else(|| ApiError::http(StatusCode::NOT_FOUND, SCHOOL_NOT_FOUND))?;
    Ok(Json(School {
        event_seasons: event_seasons(&row.slug),
        language: Language::try_from(row.language.as_str())?,
        recipient_id: checked_recipient_id(row.recipient_id)?,
        slug: row.slug,
        name: row.name,
        city: row.city,
        primary_color: row.primary_color,
        secondary_color: row.secondary_color,
        timezone: row.timezone,
        faculties: row.faculties,
        location_examples: row.location_examples,
        semester_start: row.semester_start,
        semester_end: row.semester_end,
        social_preview_image_url: row.social_preview_image_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(slug: &str, name: &str, domains: &[&str]) -> SummaryRow {
        SummaryRow {
            slug: slug.into(),
            name: name.into(),
            city: None,
            primary_color: "#FFD54F".into(),
            secondary_color: "#111111".into(),
            timezone: "America/Toronto".into(),
            language: "en".into(),
            faculties: vec![],
            location_examples: vec![],
            domains: sqlx::types::Json(domains.iter().map(|d| ((*d).to_owned(), false)).collect()),
        }
    }

    fn directory() -> Vec<SummaryRow> {
        // In name order, as the query returns them.
        vec![
            row("mit", "Massachusetts Institute of Technology", &["mit.edu"]),
            row("uwaterloo", "University of Waterloo", &["uwaterloo.ca"]),
        ]
    }

    fn slugs(rows: Vec<SummaryRow>, query: &str, limit: usize) -> Vec<String> {
        rank(rows, query, limit)
            .unwrap()
            .into_iter()
            .map(|school| school.slug)
            .collect()
    }

    #[test]
    fn search_matches_normalized_and_compact_terms() {
        // backend/tests/services/test_school_service.py::test_search_schools_normalized_and_compact_terms
        for (query, expected) in [
            ("UWATERLOO", vec!["uwaterloo"]),
            ("u waterloo", vec!["uwaterloo"]),
            ("u-waterloo", vec!["uwaterloo"]),
            ("waterloo.ca", vec!["uwaterloo"]),
            ("  University   of Waterloo ", vec!["uwaterloo"]),
            ("\u{FF2D}\u{FF29}\u{FF34}", vec!["mit"]),
            ("mit edu", vec!["mit"]),
            ("massachusetts", vec!["mit"]),
            ("MassachusettsInstituteofTechnology", vec!["mit"]),
            ("technology", vec!["mit"]),
            ("unknown university", vec![]),
            ("", vec!["mit", "uwaterloo"]),
        ] {
            assert_eq!(slugs(directory(), query, 10), expected, "{query}");
        }
    }

    #[test]
    fn search_ranks_exact_then_prefix_then_substring() {
        for limit in 1..=3 {
            let rows = vec![
                row("abc", "ABC University", &[]),
                row("xabc", "XABC University", &[]),
                row("ab", "AB University", &[]),
            ];
            let expected: Vec<&str> = ["ab", "abc", "xabc"][..limit].to_vec();
            assert_eq!(slugs(rows, "a b", limit), expected);
        }
    }

    #[test]
    fn primary_domain_leads() {
        // test_search_schools_leads_with_the_primary_domain
        let domains = vec![
            ("edu.uwaterloo.ca".to_owned(), false),
            (" UWaterloo.ca ".to_owned(), true),
            ("uwaterloo.ca".to_owned(), false),
            ("".to_owned(), false),
        ];
        assert_eq!(
            ordered_email_domains(&domains),
            vec!["uwaterloo.ca", "edu.uwaterloo.ca"]
        );
    }

    #[test]
    fn holiday_windows_become_their_own_filters() {
        // test_holiday_windows_project_specific_filters_without_reclassifying_events
        let seasons = event_seasons("uwaterloo");
        let holidays: Vec<&SchoolEventSeason> = seasons
            .iter()
            .filter(|season| season.classification_id == "holidays")
            .collect();
        let ids: std::collections::BTreeSet<&str> =
            holidays.iter().map(|season| season.id.as_str()).collect();
        assert_eq!(
            ids,
            ["halloween", "thanksgiving", "winter_holidays"]
                .into_iter()
                .collect()
        );
        assert!(seasons.iter().all(|season| season.id != "holidays"));
        let thanksgiving = holidays.iter().find(|s| s.id == "thanksgiving").unwrap();
        assert_eq!(thanksgiving.labels["en"], "Thanksgiving");
        assert_eq!(
            thanksgiving.display_windows[0].start_date.to_string(),
            "2026-10-05"
        );
        assert!(
            holidays
                .iter()
                .all(|season| season.display_windows.len() == 1)
        );
        assert_eq!(event_seasons(" UWATERLOO ").len(), seasons.len());
        assert!(event_seasons("nowhere").is_empty());
    }

    #[test]
    fn stored_values_outside_the_schema_fail_the_response() {
        assert!(Language::try_from("de").is_err());
        assert!(checked_recipient_id(Some("0123".into())).is_err());
        assert!(checked_recipient_id(Some("17841400000000000".into())).is_ok());
        assert!(checked_recipient_id(None).is_ok());
    }
}
