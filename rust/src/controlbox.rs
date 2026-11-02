//! Typed views of the `backend/controlbox/*.json` files the Rust services use.
//!
//! The JSON is embedded at compile time, so a binary runs with the settings of
//! the checkout it was built from; `core.controlbox` in Python validates the
//! complete files, and these structs read only the fields Rust needs.

use std::collections::HashMap;
use std::sync::LazyLock;

use indexmap::IndexMap;
use serde::Deserialize;
use serde::de::DeserializeOwned;

fn parse<T: DeserializeOwned>(name: &str, json: &str) -> T {
    serde_json::from_str(json)
        .unwrap_or_else(|error| panic!("backend/controlbox/{name}.json: {error}"))
}

/// `controlbox/ingestion.json`, every field.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ingestion {
    pub model: String,
    pub parallel_agents: usize,
    pub fetch_lanes: usize,
    pub fetch_impersonate: String,
    pub fetch_block_pause_seconds: u64,
    pub retry_backoff_seconds: u64,
    pub realtime_reconnect_seconds: f64,
    pub realtime_probe_seconds: f64,
    pub directory_agents: usize,
    pub directory_items_per_run: usize,
    pub directory_horizon_days: u32,
    pub directory_listing_max_bytes: usize,
    pub directory_model_timeout_seconds: u64,
    pub directory_scrape_interval_seconds: u64,
    pub claim_lease_seconds: i32,
    pub max_attempts: i32,
    pub model_timeout_seconds: u64,
    pub max_images_per_item: usize,
    pub fetch_timeout_seconds: f64,
    pub club_logo_read_delay_seconds: f64,
    pub club_logo_retry_days: u64,
    pub launch_agent_timeout_seconds: f64,
}

/// The event image and video limits in `controlbox/uploads.json`.
#[derive(Debug, Deserialize)]
pub struct Uploads {
    pub event_image_allowed_mime_types: Vec<String>,
    pub event_image_max_size_bytes: usize,
    pub event_image_rendition_width_pixels: u32,
    pub event_image_rendition_quality: u8,
    pub event_video_max_size_bytes: usize,
    pub event_video_download_timeout_seconds: u64,
}

/// The directory image floor in `controlbox/scraping.json`.
#[derive(Debug, Deserialize)]
pub struct Scraping {
    pub directory_minimum_image_dimension_pixels: u32,
}

/// The campus seasons and building codes in `controlbox/event_discovery.json`.
#[derive(Debug, Deserialize)]
pub struct EventDiscovery {
    pub campus_seasons: CampusSeasons,
    pub map_geocoding: MapGeocoding,
}

#[derive(Debug, Deserialize)]
pub struct CampusSeasons {
    pub definitions: HashMap<String, SeasonDefinition>,
    pub schools: HashMap<String, SchoolSeasons>,
}

#[derive(Debug, Deserialize)]
pub struct SeasonDefinition {
    pub labels: HashMap<String, String>,
    pub instructions: String,
}

#[derive(Debug, Deserialize)]
pub struct SchoolSeasons {
    pub instructions: String,
    pub seasons: Vec<SchoolSeason>,
}

#[derive(Debug, Deserialize)]
pub struct SchoolSeason {
    pub id: String,
    pub instructions: String,
}

#[derive(Debug, Deserialize)]
pub struct MapGeocoding {
    /// Per school, building code to building name, in the file's order.
    pub building_codes: HashMap<String, IndexMap<String, String>>,
}

pub static INGESTION: LazyLock<Ingestion> = LazyLock::new(|| {
    parse(
        "ingestion",
        include_str!("../../backend/controlbox/ingestion.json"),
    )
});
pub static UPLOADS: LazyLock<Uploads> = LazyLock::new(|| {
    parse(
        "uploads",
        include_str!("../../backend/controlbox/uploads.json"),
    )
});
pub static SCRAPING: LazyLock<Scraping> = LazyLock::new(|| {
    parse(
        "scraping",
        include_str!("../../backend/controlbox/scraping.json"),
    )
});
pub static EVENT_DISCOVERY: LazyLock<EventDiscovery> = LazyLock::new(|| {
    parse(
        "event_discovery",
        include_str!("../../backend/controlbox/event_discovery.json"),
    )
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_control_file_parses() {
        assert!(INGESTION.parallel_agents > 0);
        assert!(UPLOADS.event_image_max_size_bytes > 0);
        assert!(SCRAPING.directory_minimum_image_dimension_pixels > 0);
        assert!(!EVENT_DISCOVERY.campus_seasons.schools.is_empty());
    }
}
