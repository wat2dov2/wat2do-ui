//! The filtered feed's in-memory steps (`event_query._dedup_candidates_keeping_earliest`,
//! `_filter_candidates`, `_sort_candidates`): Postgres hands over the first
//! occurrence rows in feed order, and these steps decide membership and order
//! exactly as Python did.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike, Utc, Weekday};

use crate::text::{casefold, python_strip, python_word};
use crate::time_zones::Tz;

/// The event fields the in-memory filters and sorts read.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
pub struct CandidateEvent {
    pub id: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub club: Option<String>,
    pub ig_handle: Option<String>,
    pub food: Option<serde_json::Value>,
    pub price: Option<f64>,
    /// Microseconds since the epoch.
    pub added_at: Option<i64>,
    /// The event's school's IANA zone.
    pub timezone: Option<String>,
}

/// One scanned occurrence row: the event and its start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScannedRow {
    pub event_id: i64,
    pub dtstart_utc: DateTime<Utc>,
}

/// `_EventCandidate`: an event, its earliest scanned start and the weekdays it falls on.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub event: CandidateEvent,
    pub earliest_dtstart: Option<DateTime<Utc>>,
    pub weekdays: HashSet<&'static str>,
}

/// `strftime("%A")` in the school's zone; an unknown zone stays in UTC.
pub fn weekday(value: DateTime<Utc>, timezone: Option<&str>) -> &'static str {
    let day = match timezone
        .filter(|zone| !zone.is_empty())
        .and_then(|zone| zone.parse::<Tz>().ok())
    {
        Some(zone) => value.with_timezone(&zone).weekday(),
        None => value.weekday(),
    };
    match day {
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
        Weekday::Sun => "Sunday",
    }
}

/// `_dedup_candidates_keeping_earliest`: one candidate per event in first-seen
/// order, stopping at `cap` events (later rows then add no weekdays).
pub fn dedup(
    rows: &[ScannedRow],
    events: &HashMap<i64, CandidateEvent>,
    cap: usize,
) -> Vec<Candidate> {
    let mut index: HashMap<i64, usize> = HashMap::new();
    let mut ordered: Vec<Candidate> = Vec::new();
    for row in rows {
        let Some(event) = events.get(&row.event_id) else {
            continue;
        };
        let day = weekday(row.dtstart_utc, event.timezone.as_deref());
        if let Some(&position) = index.get(&row.event_id) {
            ordered[position].weekdays.insert(day);
            continue;
        }
        index.insert(row.event_id, ordered.len());
        ordered.push(Candidate {
            event: event.clone(),
            earliest_dtstart: Some(row.dtstart_utc),
            weekdays: HashSet::from([day]),
        });
        if ordered.len() >= cap {
            break;
        }
    }
    ordered
}

/// The in-memory filters (`_filter_candidates`).
#[derive(Debug, Default)]
pub struct Filters<'a> {
    /// Already sanitized (`sanitize_postgrest_value`); empty means none.
    pub search: &'a str,
    pub locations: &'a [String],
    pub foods: &'a [String],
    pub days: &'a [String],
    pub has_food: bool,
}

fn food_items(food: &Option<serde_json::Value>) -> Vec<String> {
    match food {
        Some(serde_json::Value::String(text)) => vec![text.clone()],
        Some(serde_json::Value::Array(items)) => items.iter().map(python_str).collect(),
        _ => Vec::new(),
    }
}

/// Python's `str(value)` for a JSON value inside `food`.
fn python_str(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Null => "None".to_owned(),
        serde_json::Value::Bool(flag) => if *flag { "True" } else { "False" }.to_owned(),
        other => other.to_string(),
    }
}

fn truthy_food(food: &Option<serde_json::Value>) -> bool {
    match food {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Array(items)) => !items.is_empty(),
        Some(serde_json::Value::String(text)) => !text.is_empty(),
        Some(serde_json::Value::Object(map)) => !map.is_empty(),
        Some(serde_json::Value::Bool(flag)) => *flag,
        Some(serde_json::Value::Number(number)) => number.as_f64() != Some(0.0),
    }
}

/// `re.sub(r"[\W_]", "", text)`: letters and digits only.
fn compact(text: &str) -> String {
    text.chars()
        .filter(|character| *character != '_' && python_word(*character))
        .collect()
}

fn matches_search(event: &CandidateEvent, search: &str) -> bool {
    if search.is_empty() {
        return true;
    }
    let compact_search = compact(search);
    let fields = [
        &event.title,
        &event.description,
        &event.location,
        &event.club,
        &event.ig_handle,
    ];
    fields
        .iter()
        .map(|value| (*value).clone().unwrap_or_default())
        .chain(food_items(&event.food))
        .any(|value| {
            let folded = casefold(&value);
            folded.contains(search)
                || (!compact_search.is_empty() && compact(&folded).contains(&compact_search))
        })
}

/// `_filter_candidates`.
pub fn filter(candidates: Vec<Candidate>, filters: &Filters<'_>) -> Vec<Candidate> {
    let search = casefold(filters.search);
    let locations: Vec<String> = filters
        .locations
        .iter()
        .map(|location| casefold(python_strip(location)))
        .filter(|location| !location.is_empty())
        .collect();
    let foods: HashSet<String> = filters
        .foods
        .iter()
        .map(|food| casefold(python_strip(food)))
        .filter(|food| !food.is_empty())
        .collect();
    let days: HashSet<String> = filters
        .days
        .iter()
        .filter(|day| !python_strip(day).is_empty())
        .map(|day| casefold(day))
        .collect();
    candidates
        .into_iter()
        .filter(|candidate| {
            let event = &candidate.event;
            matches_search(event, &search)
                && (locations.is_empty() || {
                    let value = casefold(event.location.as_deref().unwrap_or_default());
                    locations
                        .iter()
                        .all(|location| value.contains(location.as_str()))
                })
                && (foods.is_empty() || {
                    let items: Vec<String> = match &event.food {
                        Some(serde_json::Value::String(text)) => vec![casefold(text)],
                        Some(serde_json::Value::Array(items)) => items
                            .iter()
                            .map(|item| casefold(&python_str(item)))
                            .collect(),
                        _ => Vec::new(),
                    };
                    foods
                        .iter()
                        .all(|query| items.iter().any(|item| item.contains(query.as_str())))
                })
                && (days.is_empty() || {
                    let weekdays: HashSet<String> =
                        candidate.weekdays.iter().map(|day| casefold(day)).collect();
                    days.is_subset(&weekdays)
                })
                && (!filters.has_food || truthy_food(&event.food))
        })
        .collect()
}

/// A sort key: the primary value, then the event id.
#[derive(Debug, PartialEq, PartialOrd)]
enum Primary {
    Text(String),
    Number(f64),
    Instant(i64),
}

/// `_sort_candidates`: Python's stable sort (reversed for `desc`) by
/// `(value, id)`; a missing date sorts last ascending and first descending.
pub fn sort(candidates: &mut [Candidate], sort_by: &str, descending: bool) {
    let missing = if descending { i64::MIN } else { i64::MAX };
    let key = |candidate: &Candidate| -> (Primary, i64) {
        let event = &candidate.event;
        let primary = match sort_by {
            "title" => Primary::Text(casefold(event.title.as_deref().unwrap_or_default())),
            "location" => Primary::Text(casefold(event.location.as_deref().unwrap_or_default())),
            "price" => Primary::Number(event.price.unwrap_or(0.0)),
            "added_at" => Primary::Instant(event.added_at.unwrap_or(missing)),
            _ => Primary::Instant(
                candidate
                    .earliest_dtstart
                    .map_or(missing, |start| start.timestamp_micros()),
            ),
        };
        (primary, event.id)
    };
    candidates.sort_by(|left, right| {
        let (left, right) = (key(left), key(right));
        let order = left
            .partial_cmp(&right)
            .unwrap_or(std::cmp::Ordering::Equal);
        if descending { order.reverse() } else { order }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    fn event(id: i64) -> CandidateEvent {
        CandidateEvent {
            id,
            ..CandidateEvent::default()
        }
    }

    fn candidate(event: CandidateEvent, weekdays: &[&'static str]) -> Candidate {
        Candidate {
            event,
            earliest_dtstart: None,
            weekdays: weekdays.iter().copied().collect(),
        }
    }

    #[test]
    fn weekday_uses_the_school_zone() {
        // test_weekday_filter_uses_school_timezone_not_occurrence_hint
        let start = Utc.with_ymd_and_hms(2026, 9, 15, 5, 30, 0).unwrap();
        assert_eq!(weekday(start, Some("America/Edmonton")), "Monday");
        assert_eq!(weekday(start, Some("Not/AZone")), "Tuesday");
        assert_eq!(weekday(start, None), "Tuesday");
    }

    #[test]
    fn dedup_keeps_first_seen_order_and_collects_weekdays_until_the_cap() {
        let at = |day| Utc.with_ymd_and_hms(2026, 9, day, 18, 0, 0).unwrap();
        let events: HashMap<i64, CandidateEvent> =
            [(1, event(1)), (2, event(2)), (3, event(3))].into();
        let rows = [
            ScannedRow {
                event_id: 2,
                dtstart_utc: at(14),
            },
            ScannedRow {
                event_id: 1,
                dtstart_utc: at(15),
            },
            ScannedRow {
                event_id: 2,
                dtstart_utc: at(16),
            },
            ScannedRow {
                event_id: 3,
                dtstart_utc: at(17),
            },
            ScannedRow {
                event_id: 1,
                dtstart_utc: at(18),
            },
        ];
        let all = dedup(&rows, &events, 10);
        assert_eq!(
            all.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [2, 1, 3]
        );
        assert_eq!(all[0].earliest_dtstart, Some(at(14)));
        assert_eq!(all[0].weekdays, HashSet::from(["Monday", "Wednesday"]));
        assert_eq!(all[1].weekdays, HashSet::from(["Tuesday", "Friday"]));
        let capped = dedup(&rows, &events, 2);
        assert_eq!(capped.len(), 2);
        // The loop stops at the cap, so event 2 never sees its Wednesday.
        assert_eq!(capped[0].weekdays, HashSet::from(["Monday"]));
    }

    #[test]
    fn food_filter_is_independent_of_price() {
        let with = |food: serde_json::Value, price| CandidateEvent {
            food: Some(food),
            price: Some(price),
            ..event(1)
        };
        let run = |event, has_food| {
            filter(
                vec![candidate(event, &[])],
                &Filters {
                    has_food,
                    ..Filters::default()
                },
            )
            .len()
                == 1
        };
        assert!(run(with(json!(["Pizza"]), 20.0), true));
        assert!(run(with(json!(["Pizza"]), 0.0), true));
        assert!(!run(with(json!([]), 0.0), true));
        assert!(run(with(json!([]), 20.0), false));
    }

    #[test]
    fn non_category_selections_must_all_match() {
        let row = CandidateEvent {
            food: Some(json!(["Pizza", "Cookies"])),
            location: Some("SLC Great Hall".into()),
            ..event(1)
        };
        let keeps = |filters: Filters<'_>, weekdays: &[&'static str]| {
            filter(vec![candidate(row.clone(), weekdays)], &filters).len() == 1
        };
        let strings = |values: &[&str]| values.iter().map(|v| v.to_string()).collect::<Vec<_>>();
        let (piz, soup, slc, library) = (
            strings(&["piz", "cookies"]),
            strings(&["pizza", "soup"]),
            strings(&["slc", "hall"]),
            strings(&["slc", "library"]),
        );
        assert!(keeps(
            Filters {
                foods: &piz,
                ..Filters::default()
            },
            &[]
        ));
        assert!(!keeps(
            Filters {
                foods: &soup,
                ..Filters::default()
            },
            &[]
        ));
        assert!(keeps(
            Filters {
                locations: &slc,
                ..Filters::default()
            },
            &[]
        ));
        assert!(!keeps(
            Filters {
                locations: &library,
                ..Filters::default()
            },
            &[]
        ));
        let (monday_tuesday, monday_friday) = (
            strings(&["monday", "tuesday"]),
            strings(&["monday", "friday"]),
        );
        assert!(keeps(
            Filters {
                days: &monday_tuesday,
                ..Filters::default()
            },
            &["Monday", "Tuesday"]
        ));
        assert!(!keeps(
            Filters {
                days: &monday_friday,
                ..Filters::default()
            },
            &["Monday", "Tuesday"]
        ));
        // Whitespace-only selections select nothing.
        let blank = strings(&["  "]);
        assert!(keeps(
            Filters {
                foods: &blank,
                days: &blank,
                locations: &blank,
                ..Filters::default()
            },
            &[]
        ));
    }

    #[test]
    fn filter_groups_intersect() {
        // test_filter_groups_intersect
        let social = |food: &str| CandidateEvent {
            title: Some("Social".into()),
            food: Some(json!([food])),
            location: Some("SLC".into()),
            ..event(1)
        };
        let matching = candidate(social("Pizza"), &["Monday", "Tuesday"]);
        let wrong_food = candidate(social("Soup"), &["Monday", "Tuesday"]);
        let wrong_day = candidate(social("Pizza"), &["Monday"]);
        let locations = vec!["slc".to_owned()];
        let foods = vec![" PIZ ".to_owned()];
        let days = vec!["Monday".to_owned(), "Tuesday".to_owned()];
        let result = filter(
            vec![matching.clone(), wrong_food, wrong_day],
            &Filters {
                search: "",
                locations: &locations,
                foods: &foods,
                days: &days,
                has_food: true,
            },
        );
        assert_eq!(result, vec![matching]);
    }

    #[test]
    fn search_matches_copy_food_and_compact_names() {
        // test_event_search_matches_description_and_food and
        // test_event_search_matches_compact_club_names_and_handles
        let row = CandidateEvent {
            title: Some("Games Night".into()),
            description: Some("Advanced watercolor techniques".into()),
            club: Some("UW Blueprint".into()),
            ig_handle: Some("@uw_blue.print".into()),
            food: Some(json!(["Bubble Tea"])),
            ..event(1)
        };
        let finds = |search: &str| {
            filter(
                vec![candidate(row.clone(), &[])],
                &Filters {
                    search,
                    ..Filters::default()
                },
            )
            .len()
                == 1
        };
        assert!(finds("watercolor"));
        assert!(finds("bubble tea"));
        assert!(finds("uwblueprint"));
        assert!(finds("UWBLUE print"));
        assert!(finds("STRASSE") == finds("strasse"));
        assert!(!finds("karaoke"));
        let german = CandidateEvent {
            title: Some("Straße Fest".into()),
            ..event(2)
        };
        assert_eq!(
            filter(
                vec![candidate(german, &[])],
                &Filters {
                    search: "STRASSE",
                    ..Filters::default()
                }
            )
            .len(),
            1,
            "casefold maps ß to ss"
        );
    }

    #[test]
    fn date_sort_keeps_missing_dates_last_ascending_and_first_descending() {
        // test_candidate_date_sort_keeps_missing_dates_last
        let at = |day| Some(Utc.with_ymd_and_hms(2026, 9, day, 18, 0, 0).unwrap());
        let make = |id, start| Candidate {
            event: event(id),
            earliest_dtstart: start,
            weekdays: HashSet::new(),
        };
        let mut candidates = vec![make(1, None), make(2, at(2)), make(3, at(1))];
        sort(&mut candidates, "date", false);
        assert_eq!(
            candidates.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [3, 2, 1]
        );
        sort(&mut candidates, "date", true);
        assert_eq!(
            candidates.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [2, 3, 1]
        );
    }

    #[test]
    fn text_and_price_sorts_break_ties_by_id() {
        let named = |id, title: &str, price| Candidate {
            event: CandidateEvent {
                title: Some(title.into()),
                price,
                ..event(id)
            },
            earliest_dtstart: None,
            weekdays: HashSet::new(),
        };
        let mut candidates = vec![
            named(3, "beta", Some(5.0)),
            named(1, "Alpha", None),
            named(2, "alpha", Some(0.0)),
        ];
        sort(&mut candidates, "title", false);
        assert_eq!(
            candidates.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [1, 2, 3]
        );
        sort(&mut candidates, "title", true);
        assert_eq!(
            candidates.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [3, 2, 1]
        );
        sort(&mut candidates, "price", false);
        assert_eq!(
            candidates.iter().map(|c| c.event.id).collect::<Vec<_>>(),
            [1, 2, 3]
        );
    }
}
