//! Coordinates for event map locations, found once with OpenStreetMap's
//! Nominatim (`services/map_location_service.py`).
//!
//! Every place an event names waits in `map_locations` until a worker looks
//! it up. Every API server runs one worker, and `claim_map_location` lets only
//! one claim be outstanding across all of them, so the whole app keeps to
//! Nominatim's one request a second. Stored coordinates reach every event at
//! that place through the database; schools whose feeds gain pins are
//! refreshed together at most once per `feed_refresh_seconds`.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use regex::Regex;
use serde_json::Value;
use sqlx::PgPool;
use tokio::sync::watch;
use unicode_normalization::UnicodeNormalization;

use crate::controlbox::{EVENT_DISCOVERY, MapGeocoding};

fn control() -> &'static MapGeocoding {
    &EVENT_DISCOVERY.map_geocoding
}

/// `[longitude, latitude]`.
pub type Coordinates = (f64, f64);

static STREET_NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\A\d+[a-z]?(?:-\d+)?\s+\S").expect("valid regex"));
/// A campus's mailing address is shared by every building on it, so it never
/// places a named building.
static CAMPUS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)universit|college|campus|polytechni").expect("valid regex"));
/// Provinces, states, postal codes and countries never narrow a search to one city.
static REGION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\A(?:[A-Z]{2,3}(?:\s+[A-Z0-9][A-Z0-9 -]*)?|Canada|USA|United States)\z")
        .expect("valid regex")
});
static PARENTHESES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\([^)]*\)").expect("valid regex"));
static SPACED_PARENTHESES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*\([^)]*\)").expect("valid regex"));

/// Results that share a building's name but are not the building itself.
const NOT_A_VENUE_AMENITIES: [&str; 14] = [
    "atm",
    "bench",
    "bicycle_parking",
    "charging_station",
    "drinking_water",
    "fountain",
    "parking",
    "parking_entrance",
    "post_box",
    "taxi",
    "telephone",
    "toilets",
    "vending_machine",
    "waste_basket",
];
const NOT_A_VENUE_CATEGORIES: [&str; 4] = ["highway", "public_transport", "railway", "entrance"];
const STREET_WORDS: [(&str, &str); 28] = [
    ("st", "street"),
    ("ave", "avenue"),
    ("av", "avenue"),
    ("rd", "road"),
    ("blvd", "boulevard"),
    ("boul", "boulevard"),
    ("dr", "drive"),
    ("ln", "lane"),
    ("cres", "crescent"),
    ("ct", "court"),
    ("pl", "place"),
    ("ter", "terrace"),
    ("hwy", "highway"),
    ("pkwy", "parkway"),
    ("cir", "circle"),
    ("sq", "square"),
    ("n", "north"),
    ("s", "south"),
    ("e", "east"),
    ("w", "west"),
    ("nord", "north"),
    ("sud", "south"),
    ("est", "east"),
    ("ouest", "west"),
    ("o", "west"),
    ("rue", "street"),
    ("chemin", "road"),
    ("ch", "road"),
];
const STOP_WORDS: [&str; 11] = [
    "the", "of", "at", "in", "and", "de", "du", "des", "la", "le", "les",
];
/// "Québec City" is "Québec" in OpenStreetMap addresses.
const PLACE_WORDS: [&str; 3] = ["city", "ville", "town"];
/// Address parts that name a place itself. A county such as "Region of
/// Waterloo" also covers its neighbouring cities, so it never confirms one.
const LOCALITY_KEYS: [&str; 10] = [
    "city",
    "town",
    "village",
    "municipality",
    "hamlet",
    "suburb",
    "city_district",
    "borough",
    "quarter",
    "neighbourhood",
];

/// `_words`: ASCII-folded, lower-cased words.
fn words(value: &str) -> BTreeSet<String> {
    let plain: String = value
        .nfkd()
        .filter(char::is_ascii)
        .collect::<String>()
        .to_lowercase();
    plain
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

fn without(mut set: BTreeSet<String>, removed: &[&str]) -> BTreeSet<String> {
    set.retain(|word| !removed.contains(&word.as_str()));
    set
}

/// `_place_key`: "Mathematics & Computer (MC)" names the same building as
/// "Mathematics and Computer Building".
fn place_key(name: &str) -> BTreeSet<String> {
    let mut key = without(words(&PARENTHESES.replace_all(name, "")), &STOP_WORDS);
    key.remove("building");
    key.into_iter()
        .map(|word| {
            if word == "center" {
                "centre".to_owned()
            } else {
                word
            }
        })
        .collect()
}

fn street(value: &str) -> BTreeSet<String> {
    words(value)
        .into_iter()
        .map(|word| {
            STREET_WORDS
                .iter()
                .find(|(short, _)| *short == word)
                .map_or(word, |(_, long)| (*long).to_owned())
        })
        .collect()
}

/// Python's `str.strip()`.
fn strip(value: &str) -> &str {
    crate::text::python_strip(value)
}

fn text<'a>(candidate: &'a Value, key: &str) -> Option<&'a str> {
    candidate.get(key).and_then(Value::as_str)
}

fn address_text<'a>(candidate: &'a Value, key: &str) -> &'a str {
    candidate
        .get("address")
        .and_then(|address| address.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

/// A candidate's `[lon, lat]` (Nominatim sends them as strings).
fn position(candidate: &Value) -> Result<Coordinates> {
    let read = |key: &str| -> Result<f64> {
        match candidate.get(key) {
            Some(Value::String(text)) => crate::api::validation::parse_python_float(text)
                .with_context(|| format!("candidate {key} {text:?} is not a number")),
            Some(Value::Number(number)) => number.as_f64().context("candidate coordinate"),
            _ => anyhow::bail!("candidate has no {key}"),
        }
    };
    Ok((read("lon")?, read("lat")?))
}

fn in_city(candidate: &Value, city: Option<&str>) -> bool {
    let Some(city) = city else { return true };
    let places = words(
        &LOCALITY_KEYS
            .iter()
            .map(|key| address_text(candidate, key))
            .collect::<Vec<_>>()
            .join(" "),
    );
    without(words(city), &PLACE_WORDS).is_subset(&places)
}

fn in_region(candidate: &Value, region: Option<&str>) -> bool {
    region.is_none_or(|region| {
        address_text(candidate, "ISO3166-2-lvl4").ends_with(&format!("-{region}"))
    })
}

fn is_address(candidate: &Value, address: &str) -> bool {
    let (number, rest) = address.split_once(' ').unwrap_or((address, ""));
    address_text(candidate, "house_number").to_lowercase() == number.to_lowercase()
        && street(address_text(candidate, "road")) == street(rest)
}

fn is_venue(
    candidate: &Value,
    venue: &str,
    city: Option<&str>,
    center: Coordinates,
) -> Result<bool> {
    let category = text(candidate, "category");
    let kind = text(candidate, "type");
    if category.is_some_and(|category| NOT_A_VENUE_CATEGORIES.contains(&category))
        || (category == Some("amenity")
            && kind.is_some_and(|kind| NOT_A_VENUE_AMENITIES.contains(&kind)))
    {
        return Ok(false);
    }
    let expected = without(words(venue), &STOP_WORDS);
    if expected.is_empty()
        || !expected.is_subset(&words(text(candidate, "name").unwrap_or_default()))
    {
        return Ok(false);
    }
    match city {
        // A bare building name belongs to this campus, never a namesake elsewhere.
        None => {
            let radius = control().search_radius_degrees;
            let (longitude, latitude) = position(candidate)?;
            Ok((longitude - center.0).abs() <= radius && (latitude - center.1).abs() <= radius)
        }
        Some(city) => Ok(in_city(candidate, Some(city))),
    }
}

/// How a query's results are accepted.
#[derive(Debug, Clone, PartialEq)]
enum Accept {
    Venue(String),
    Address(String),
}

/// `_queries`: the searches to try, most specific first, each with its test.
#[derive(Debug)]
struct Queries {
    region: Option<String>,
    city: Option<String>,
    list: Vec<(String, Accept)>,
}

fn queries(map_location: &str) -> Queries {
    let parts: Vec<&str> = map_location
        .split(',')
        .map(strip)
        .filter(|part| !part.is_empty())
        .collect();
    let street_at = parts.iter().position(|part| STREET_NUMBER.is_match(part));
    let on_campus = parts.iter().any(|part| CAMPUS.is_match(part));
    let rest = parts.get(1..).unwrap_or_default();
    let locality: Vec<&str> = rest
        .iter()
        .filter(|part| !STREET_NUMBER.is_match(part) && !CAMPUS.is_match(part))
        .copied()
        .collect();
    let city = locality
        .iter()
        .rev()
        .find(|part| !REGION.is_match(part))
        .copied();
    // "ON" or "CA 94720" names the province or state every result must be in.
    let region = rest.iter().rev().find_map(|part| {
        let first_two: String = part.chars().take(2).collect();
        (REGION.is_match(part)
            && !first_two.is_empty()
            && first_two.chars().all(char::is_alphabetic))
        .then_some(first_two)
    });
    // Nominatim searches inside a named campus or college, where most buildings are mapped.
    let campus = rest
        .iter()
        .find(|part| CAMPUS.is_match(part) && !STREET_NUMBER.is_match(part))
        .copied();
    // The named places before the street and city, most specific first.
    let city_at = city
        .filter(|city| rest.contains(city))
        .and_then(|city| parts.iter().position(|part| *part == city))
        .unwrap_or(parts.len());
    let end = street_at.unwrap_or(parts.len()).min(city_at);
    let names: Vec<&str> = parts
        .iter()
        .take(1)
        .chain(
            parts
                .get(1..end)
                .unwrap_or_default()
                .iter()
                .filter(|part| !CAMPUS.is_match(part)),
        )
        .copied()
        .collect();
    let venue_of = |name: &str| SPACED_PARENTHESES.replace_all(name, "").into_owned();
    let mut list: Vec<(String, Accept)> = Vec::new();
    if street_at != Some(0) {
        if let Some(first) = names.first() {
            list.push((map_location.to_owned(), Accept::Venue(venue_of(first))));
        }
        for name in &names {
            let venue = venue_of(name);
            if let Some(campus) = campus {
                list.push((format!("{venue}, {campus}"), Accept::Venue(venue.clone())));
            }
            let tail = &locality[locality.len().saturating_sub(2)..];
            let query = std::iter::once(venue.as_str())
                .chain(tail.iter().copied())
                .collect::<Vec<_>>()
                .join(", ");
            list.push((query, Accept::Venue(venue.clone())));
        }
    }
    if let Some(at) = street_at
        && (at == 0 || !on_campus)
    {
        list.push((
            parts[at..].join(", "),
            Accept::Address(parts[at].to_owned()),
        ));
    }
    // Like `{query: (query, accept)}`: first position, last test.
    let mut unique: Vec<(String, Accept)> = Vec::new();
    for (query, accept) in list {
        match unique.iter_mut().find(|(seen, _)| *seen == query) {
            Some(existing) => existing.1 = accept,
            None => unique.push((query, accept)),
        }
    }
    Queries {
        region,
        city: city.map(str::to_owned),
        list: unique,
    }
}

fn accepts(
    queries: &Queries,
    accept: &Accept,
    candidate: &Value,
    center: Coordinates,
) -> Result<bool> {
    if !in_region(candidate, queries.region.as_deref()) {
        return Ok(false);
    }
    match accept {
        Accept::Venue(venue) => is_venue(candidate, venue, queries.city.as_deref(), center),
        Accept::Address(address) => {
            Ok(is_address(candidate, address) && in_city(candidate, queries.city.as_deref()))
        }
    }
}

/// `locate`: a known campus building named in `map_location`, else the first
/// acceptable Nominatim result, most specific query first.
pub async fn locate<F, Fut>(
    map_location: &str,
    center: Coordinates,
    mut search: F,
    known_places: Option<&indexmap::IndexMap<String, Coordinates>>,
) -> Result<Option<Coordinates>>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Vec<Value>>>,
{
    let mut known: HashMap<BTreeSet<String>, Coordinates> = HashMap::new();
    for (name, coordinates) in known_places.into_iter().flatten() {
        known.insert(place_key(name), *coordinates);
    }
    for part in map_location.split(',') {
        if let Some(coordinates) = known.get(&place_key(part)) {
            return Ok(Some(*coordinates));
        }
    }
    let queries = queries(map_location);
    for (query, accept) in &queries.list {
        for candidate in search(query.clone()).await? {
            if accepts(&queries, accept, &candidate, center)? {
                return position(&candidate).map(Some);
            }
        }
    }
    Ok(None)
}

/// Python's `str(float)` for the viewbox.
fn python_float(value: f64) -> String {
    let text = format!("{value}");
    if text.contains(['.', 'e', 'i', 'N']) {
        text
    } else {
        format!("{text}.0")
    }
}

/// `_search`: one Nominatim query near the campus, then the pause its usage
/// policy needs, whether the request worked or not.
async fn search(client: &wreq::Client, query: &str, center: Coordinates) -> Result<Vec<Value>> {
    let control = control();
    let started = Instant::now();
    let (longitude, latitude) = center;
    let radius = control.search_radius_degrees;
    let viewbox = format!(
        "{},{},{},{}",
        python_float(longitude - radius),
        python_float(latitude + radius),
        python_float(longitude + radius),
        python_float(latitude - radius)
    );
    let mut url = url::Url::parse(&control.search_url)?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("format", "jsonv2")
        .append_pair("addressdetails", "1")
        .append_pair("limit", &control.candidate_count.to_string())
        // A preference, not a limit: off-campus venues name their own city.
        .append_pair("viewbox", &viewbox);
    let result = async {
        let response = client.get(url.as_str()).send().await?.error_for_status()?;
        let results: Vec<Value> = serde_json::from_slice(&response.bytes().await?)?;
        anyhow::Ok(results)
    }
    .await;
    let interval = Duration::from_secs_f64(control.request_interval_seconds);
    tokio::time::sleep(interval.saturating_sub(started.elapsed())).await;
    result
}

#[derive(Debug, sqlx::FromRow)]
struct Claimed {
    school_id: i32,
    map_location: String,
}

/// `look_up_next`: claim, look up and store the next waiting place. Returns
/// its school and whether it was found, or `None` when none is waiting or
/// another worker is mid-lookup.
pub async fn look_up_next<F, Fut>(db: &PgPool, search: F) -> Result<Option<(String, bool)>>
where
    F: FnMut(String, Coordinates) -> Fut,
    Fut: Future<Output = Result<Vec<Value>>>,
{
    let control = control();
    let retry_before = chrono::Utc::now() - chrono::Duration::days(control.not_found_retry_days);
    let claimed: Option<Claimed> = sqlx::query_as(
        "SELECT school_id, map_location FROM public.claim_map_location($1, $2) LIMIT 1",
    )
    .bind(control.claim_lease_seconds)
    .bind(retry_before)
    .fetch_optional(db)
    .await?;
    let Some(place) = claimed else {
        return Ok(None);
    };
    let slug: Option<String> = sqlx::query_scalar("SELECT slug FROM public.schools WHERE id = $1")
        .bind(place.school_id)
        .fetch_optional(db)
        .await?;
    let slug = slug.unwrap_or_default();
    let coordinates = match EVENT_DISCOVERY.views.map_campus_centers.get(&slug) {
        Some(&center) => {
            let mut search = search;
            locate(
                &place.map_location,
                center,
                |query| search(query, center),
                control.known_places.get(&slug),
            )
            .await?
        }
        None => None,
    };
    sqlx::query(
        "UPDATE public.map_locations SET coordinates = $3, looked_up_at = now(), claimed_until = NULL \
         WHERE school_id = $1 AND map_location = $2",
    )
    .bind(place.school_id)
    .bind(&place.map_location)
    .bind(coordinates.map(|(longitude, latitude)| vec![longitude, latitude]))
    .execute(db)
    .await?;
    Ok(Some((slug, coordinates.is_some())))
}

/// `_FeedRefresh`: schools whose feeds gain pins, refreshed together at most
/// once per `feed_refresh_seconds`.
struct FeedRefresh {
    schools: BTreeSet<String>,
    flushed_at: Instant,
}

impl FeedRefresh {
    fn take_when_due(&mut self) -> Option<Vec<String>> {
        if self.flushed_at.elapsed().as_secs_f64() >= control().feed_refresh_seconds {
            self.take()
        } else {
            None
        }
    }

    fn take(&mut self) -> Option<Vec<String>> {
        self.flushed_at = Instant::now();
        (!self.schools.is_empty()).then(|| std::mem::take(&mut self.schools).into_iter().collect())
    }
}

/// The worker loop, with its lookup and feed refresh supplied.
async fn drive<L, LookUp, R, Refresh>(
    mut look_up: L,
    mut revalidate: R,
    mut stopping: watch::Receiver<bool>,
) where
    L: FnMut() -> LookUp,
    LookUp: Future<Output = Result<Option<(String, bool)>>>,
    R: FnMut(Vec<String>) -> Refresh,
    Refresh: Future<Output = ()>,
{
    let mut refresh = FeedRefresh {
        schools: BTreeSet::new(),
        flushed_at: Instant::now(),
    };
    while !*stopping.borrow() {
        let looked_up = match look_up().await {
            Ok(looked_up) => looked_up,
            Err(error) => {
                // The claim lapses after its lease, so the place is tried again later.
                tracing::error!("Map location lookup failed: {error:#}");
                None
            }
        };
        match looked_up {
            None => {
                if let Some(schools) = refresh.take() {
                    revalidate(schools).await;
                }
                let idle = Duration::from_secs_f64(control().idle_poll_seconds);
                let _ = tokio::time::timeout(idle, stopping.wait_for(|stop| *stop)).await;
            }
            Some((school, found)) => {
                if found {
                    refresh.schools.insert(school);
                }
                if let Some(schools) = refresh.take_when_due() {
                    revalidate(schools).await;
                }
            }
        }
    }
    if let Some(schools) = refresh.take() {
        revalidate(schools).await;
    }
}

/// `run`: look up waiting places until `stopping` turns true, refreshing the
/// feeds of schools with new pins, and flush once more on the way out.
pub async fn run(db: PgPool, stopping: watch::Receiver<bool>) {
    let control = control();
    let client = match wreq::Client::builder()
        .user_agent(&control.user_agent)
        .connect_timeout(Duration::from_secs_f64(control.request_timeout_seconds))
        // httpx's `timeout=10` bounds each phase, not the whole request.
        .read_timeout(Duration::from_secs_f64(control.request_timeout_seconds))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::error!("Map location lookups cannot start: {error}");
            return;
        }
    };
    drive(
        || {
            look_up_next(&db, |query, center| {
                let client = client.clone();
                async move { search(&client, &query, center).await }
            })
        },
        |schools| async move { crate::revalidation::revalidate_schools(&schools, &["events"]).await },
        stopping,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    const WATERLOO: Coordinates = (-80.5449, 43.4723);

    fn place(
        name: Option<&str>,
        lon: f64,
        lat: f64,
        category: &str,
        kind: &str,
        region: &str,
        address: &[(&str, &str)],
    ) -> Value {
        let mut fields = serde_json::Map::new();
        for (key, value) in address {
            fields.insert((*key).to_owned(), json!(value));
        }
        fields.insert("ISO3166-2-lvl4".into(), json!(region));
        json!({
            "name": name,
            "lon": lon.to_string(),
            "lat": lat.to_string(),
            "category": category,
            "type": kind,
            "address": fields,
        })
    }

    fn building(name: &str, lon: f64, lat: f64, city: &str) -> Value {
        place(
            Some(name),
            lon,
            lat,
            "building",
            "university",
            "CA-ON",
            &[("city", city)],
        )
    }

    fn house(lon: f64, lat: f64, region: &str, address: &[(&str, &str)]) -> Value {
        place(None, lon, lat, "place", "house", region, address)
    }

    /// A Nominatim stand-in answering from `results`, recording the queries asked.
    fn run_locate(
        location: &str,
        center: Coordinates,
        results: Vec<(&str, Vec<Value>)>,
        known: Option<&indexmap::IndexMap<String, Coordinates>>,
    ) -> (Option<Coordinates>, Vec<String>) {
        let asked = RefCell::new(Vec::new());
        let found = futures_util::FutureExt::now_or_never(locate(
            location,
            center,
            |query: String| {
                asked.borrow_mut().push(query.clone());
                let answer = results
                    .iter()
                    .find(|(asked, _)| *asked == query)
                    .map(|(_, found)| found.clone())
                    .unwrap_or_default();
                async move { Ok(answer) }
            },
            known,
        ))
        .unwrap()
        .unwrap();
        (found, asked.into_inner())
    }

    #[test]
    fn skips_same_named_stops_and_keeps_the_building() {
        let location = "Davis Centre, University of Waterloo, Waterloo, ON";
        let (found, asked) = run_locate(
            location,
            WATERLOO,
            vec![(
                location,
                vec![
                    place(
                        Some("Davis Centre"),
                        -80.5426,
                        43.4730,
                        "amenity",
                        "taxi",
                        "CA-ON",
                        &[("city", "Waterloo")],
                    ),
                    place(
                        Some("Davis Centre"),
                        -80.5418,
                        43.4728,
                        "highway",
                        "bus_stop",
                        "CA-ON",
                        &[("city", "Waterloo")],
                    ),
                    building(
                        "William G. Davis Computer Research Centre",
                        -80.5422,
                        43.4727,
                        "Waterloo",
                    ),
                ],
            )],
            None,
        );
        assert_eq!(found, Some((-80.5422, 43.4727)));
        assert_eq!(asked, [location]);
    }

    #[test]
    fn tries_the_building_and_city_when_the_full_location_finds_nothing() {
        let location = "Mathematics & Computer (MC), University of Waterloo, 200 University Ave W, Waterloo, ON";
        let (found, asked) = run_locate(
            location,
            WATERLOO,
            vec![(
                "Mathematics & Computer, Waterloo, ON",
                vec![building(
                    "Mathematics & Computer Building",
                    -80.5439,
                    43.4720,
                    "Waterloo",
                )],
            )],
            None,
        );
        assert_eq!(found, Some((-80.5439, 43.4720)));
        assert_eq!(
            asked,
            [
                location,
                "Mathematics & Computer, University of Waterloo",
                "Mathematics & Computer, Waterloo, ON"
            ]
        );
    }

    #[test]
    fn falls_back_from_a_room_to_the_building_that_holds_it() {
        let location = "Mates Office, Student Life Centre, University of Waterloo, 200 University Ave W, Waterloo, ON";
        let (found, asked) = run_locate(
            location,
            WATERLOO,
            vec![(
                "Student Life Centre, University of Waterloo",
                vec![building(
                    "Student Life Centre",
                    -80.5451,
                    43.4718,
                    "Waterloo",
                )],
            )],
            None,
        );
        assert_eq!(found, Some((-80.5451, 43.4718)));
        assert_eq!(
            asked.last().unwrap(),
            "Student Life Centre, University of Waterloo"
        );
    }

    #[test]
    fn uses_a_college_only_as_the_area_to_search() {
        let location = "Howard W. Rundle Building, Fanshawe College, 137 Dundas St, London, ON";
        let main_campus = building("Fanshawe College", -81.2, 43.01, "London");
        let (found, asked) = run_locate(
            location,
            (-81.2737, 43.0096),
            vec![
                ("Fanshawe College, London, ON", vec![main_campus.clone()]),
                ("Fanshawe College", vec![main_campus]),
            ],
            None,
        );
        assert_eq!(found, None);
        assert!(asked.contains(&"Howard W. Rundle Building, Fanshawe College".to_owned()));
        assert!(
            !asked
                .iter()
                .any(|query| query.starts_with("Fanshawe College"))
        );
    }

    #[test]
    fn never_pins_a_campus_building_at_the_campus_mailing_address() {
        let location =
            "Arts Lecture Hall, University of Waterloo, 200 University Ave W, Waterloo, ON";
        let campus_address = house(
            -80.5450,
            43.4690,
            "CA-ON",
            &[
                ("house_number", "200"),
                ("road", "University Avenue West"),
                ("city", "Waterloo"),
            ],
        );
        let (found, asked) = run_locate(
            location,
            WATERLOO,
            vec![("200 University Ave W, Waterloo, ON", vec![campus_address])],
            None,
        );
        assert_eq!(found, None);
        assert!(!asked.contains(&"200 University Ave W, Waterloo, ON".to_owned()));
    }

    #[test]
    fn places_an_off_campus_venue_at_its_street_address() {
        let location = "Columbia Icefield, 220 Columbia Street West, Waterloo, ON";
        let address = house(
            -80.5521,
            43.4776,
            "CA-ON",
            &[
                ("house_number", "220"),
                ("road", "Columbia Street West"),
                ("city", "Waterloo"),
            ],
        );
        let wrong = house(
            -80.5500,
            43.4770,
            "CA-ON",
            &[
                ("house_number", "22"),
                ("road", "Columbia Street West"),
                ("city", "Waterloo"),
            ],
        );
        let (found, asked) = run_locate(
            location,
            WATERLOO,
            vec![(
                "220 Columbia Street West, Waterloo, ON",
                vec![wrong, address],
            )],
            None,
        );
        assert_eq!(found, Some((-80.5521, 43.4776)));
        assert_eq!(
            asked.last().unwrap(),
            "220 Columbia Street West, Waterloo, ON"
        );
    }

    #[test]
    fn matches_abbreviated_street_types_and_directions() {
        let location = "123 Slater St, Ottawa, ON";
        let address = place(
            None,
            -75.6980,
            45.4210,
            "building",
            "office",
            "CA-ON",
            &[
                ("house_number", "123"),
                ("road", "Slater Street"),
                ("city", "Ottawa"),
            ],
        );
        let (found, _) = run_locate(location, WATERLOO, vec![(location, vec![address])], None);
        assert_eq!(found, Some((-75.6980, 45.4210)));
    }

    #[test]
    fn rejects_a_same_named_venue_in_another_city() {
        let location = "On the Rox, University of Waterloo, Waterloo, ON";
        let elsewhere = place(
            Some("On The Rox"),
            -93.28,
            44.97,
            "amenity",
            "bar",
            "CA-ON",
            &[("city", "Minneapolis")],
        );
        let (found, _) = run_locate(
            location,
            WATERLOO,
            vec![
                (location, vec![elsewhere.clone()]),
                ("On the Rox, Waterloo, ON", vec![elsewhere]),
            ],
            None,
        );
        assert_eq!(found, None);
    }

    #[test]
    fn keeps_a_bare_building_name_on_campus() {
        let namesake = building("Hagey Hall", -79.38, 43.65, "Toronto");
        let hall = building(
            "J.G. Hagey Hall of the Humanities",
            -80.5420,
            43.4686,
            "Waterloo",
        );
        let (found, _) = run_locate(
            "Hagey Hall",
            WATERLOO,
            vec![("Hagey Hall", vec![namesake, hall])],
            None,
        );
        assert_eq!(found, Some((-80.5420, 43.4686)));
    }

    #[test]
    fn matches_a_city_named_with_its_place_word() {
        let location = "Pavillon Alphonse-Desjardins, Université Laval, Québec City";
        let pavillon = place(
            Some("Pavillon Alphonse-Desjardins"),
            -71.2747,
            46.7817,
            "building",
            "university",
            "CA-QC",
            &[("city", "Québec")],
        );
        let (found, _) = run_locate(
            location,
            (-71.2747, 46.7817),
            vec![(location, vec![pavillon])],
            None,
        );
        assert_eq!(found, Some((-71.2747, 46.7817)));
    }

    #[test]
    fn rejects_a_namesake_in_a_neighbouring_city_of_the_same_region() {
        let location = "The Lounge, University of Waterloo, Waterloo, ON";
        let salon = place(
            Some("The Grooming Lounge"),
            -80.31,
            43.36,
            "shop",
            "hairdresser",
            "CA-ON",
            &[("city", "Cambridge"), ("county", "Region of Waterloo")],
        );
        let (found, _) = run_locate(
            location,
            WATERLOO,
            vec![
                (location, vec![salon.clone()]),
                ("The Lounge, Waterloo, ON", vec![salon]),
            ],
            None,
        );
        assert_eq!(found, None);
    }

    #[test]
    fn rejects_a_same_named_city_in_another_country() {
        let location = "Sheridan, Western University, London, ON";
        let england = place(
            Some("Sheridan Place"),
            -0.33,
            51.57,
            "building",
            "yes",
            "GB-ENG",
            &[("city", "London")],
        );
        let (found, _) = run_locate(
            location,
            (-81.2737, 43.0096),
            vec![
                (location, vec![england.clone()]),
                ("Sheridan, London, ON", vec![england]),
            ],
            None,
        );
        assert_eq!(found, None);
    }

    #[test]
    fn rejects_the_same_street_address_in_another_city() {
        let location = "Alumni Ventures, 183 Madison Avenue, New York, NY";
        let elsewhere = house(
            -73.65,
            40.60,
            "US-NY",
            &[
                ("house_number", "183"),
                ("road", "Madison Avenue"),
                ("village", "Island Park"),
            ],
        );
        let manhattan = house(
            -73.98,
            40.75,
            "US-NY",
            &[
                ("house_number", "183"),
                ("road", "Madison Avenue"),
                ("city", "New York"),
                ("borough", "Manhattan"),
            ],
        );
        let (found, _) = run_locate(
            location,
            (-73.9965, 40.7295),
            vec![(
                "183 Madison Avenue, New York, NY",
                vec![elsewhere, manhattan],
            )],
            None,
        );
        assert_eq!(found, Some((-73.98, 40.75)));
    }

    #[test]
    fn uses_a_known_building_before_searching() {
        let known: indexmap::IndexMap<String, Coordinates> = [
            ("Davis Centre".to_owned(), (-80.54204, 43.4725)),
            (
                "University Community Centre".to_owned(),
                (-81.27617, 43.00866),
            ),
        ]
        .into_iter()
        .collect();
        let (found, asked) = run_locate(
            "Davis Center (DC), University of Waterloo, 200 University Ave W, Waterloo, ON",
            WATERLOO,
            vec![],
            Some(&known),
        );
        assert_eq!(found, Some((-80.54204, 43.4725)));
        assert!(asked.is_empty());
        // A bar inside a known building is placed at that building.
        let (found, _) = run_locate(
            "Mustang Lounge, University Community Centre, Western University, London, ON",
            WATERLOO,
            vec![],
            Some(&known),
        );
        assert_eq!(found, Some((-81.27617, 43.00866)));
    }

    #[test]
    fn duplicate_queries_keep_their_first_position_and_last_test() {
        let built = queries("Hall, Waterloo");
        let texts: Vec<&str> = built.list.iter().map(|(query, _)| query.as_str()).collect();
        assert_eq!(texts, ["Hall, Waterloo"]);
        assert!(queries("").list.is_empty());
        assert!(queries(" , ").list.is_empty());
    }

    #[test]
    fn a_location_with_no_names_is_not_searched() {
        // test_a_location_with_no_names_is_not_searched (main's de989a431).
        for location in ["", " , ", ",,"] {
            let (found, asked) = run_locate(location, WATERLOO, vec![], None);
            assert_eq!(found, None, "{location:?}");
            assert!(asked.is_empty(), "{location:?}");
        }
    }

    #[tokio::test]
    async fn run_refreshes_feeds_of_schools_that_gained_pins_and_survives_failures() {
        // test_run_refreshes_feeds_of_schools_that_gained_pins_and_survives_failures
        let (stop, stopping) = watch::channel(false);
        let mut results = vec![
            Ok(Some(("uwaterloo".to_owned(), true))),
            Ok(Some(("uwaterloo".to_owned(), false))),
            Ok(Some(("ubc".to_owned(), true))),
            Err(anyhow::anyhow!("database unavailable")),
        ]
        .into_iter();
        let refreshed = std::sync::Mutex::new(Vec::new());
        drive(
            || {
                let next = results.next().expect("no lookups after stopping");
                if next.is_err() {
                    stop.send(true).unwrap();
                }
                async move { next }
            },
            |schools| {
                refreshed.lock().unwrap().push(schools);
                async {}
            },
            stopping,
        )
        .await;
        assert_eq!(
            refreshed.into_inner().unwrap(),
            vec![vec!["ubc".to_owned(), "uwaterloo".to_owned()]]
        );
    }

    /// `QUERIES_PARITY_FILE`: Python's `_queries` for every production
    /// `map_location` (one that names nothing plans no search on either side).
    #[test]
    #[ignore = "needs a file exported from production"]
    fn production_locations_plan_the_same_searches() {
        let expected: std::collections::BTreeMap<String, Value> = serde_json::from_str(
            &std::fs::read_to_string(std::env::var("QUERIES_PARITY_FILE").unwrap()).unwrap(),
        )
        .unwrap();
        let mut compared = 0;
        for (location, python) in &expected {
            let built = queries(location);
            let ours: Vec<&str> = built.list.iter().map(|(query, _)| query.as_str()).collect();
            match python {
                Value::Array(_) => assert_eq!(json!(ours), *python, "{location:?}"),
                _ => assert!(ours.is_empty(), "{location:?}"),
            }
            compared += 1;
        }
        assert!(compared > 1000);
    }

    #[test]
    fn viewbox_numbers_print_like_python() {
        // Python: -80.5449 - 0.3, 43.4723 + 0.3, 44.0
        assert_eq!(python_float(-80.5449 - 0.3), "-80.8449");
        assert_eq!(python_float(43.4723 + 0.3), "43.772299999999994");
        assert_eq!(python_float(44.0), "44.0");
    }

    #[test]
    fn words_fold_accents_and_split_on_punctuation() {
        assert_eq!(
            words("Québec-City (MC) Hall"),
            ["city", "hall", "mc", "quebec"]
                .into_iter()
                .map(str::to_owned)
                .collect()
        );
        assert_eq!(
            place_key("Mathematics & Computer (MC)"),
            place_key("Mathematics and Computer Building")
        );
    }
}
