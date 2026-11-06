//! Club tickets: free QR tickets and paid ones, one admission model
//! (`event_ticketing`, `ticket_orders`, `tickets`).
//!
//! A club turns tickets on for one of its events. With a price of zero,
//! anyone signed in takes a free ticket to a date in one tap; turning free
//! tickets on also hands one to everyone already going. With a price, the
//! buyer pays through Stripe Checkout on the club's own Connect Standard
//! account, so money never passes through wat2do. Every ticket's QR code
//! holds the link to its page: the holder shows it at the door, and the club
//! scans it with the door scanner or any phone camera to admit them. Taking
//! or buying a ticket marks the holder going.

pub mod admission;
pub mod codes;
#[cfg(test)]
mod database_tests;
pub mod door;
pub mod emails;
pub mod holders;
pub mod model;
pub mod payouts;
pub mod refunds;
pub mod requests;
pub mod store;
pub mod stripe;
pub mod ticketing;

#[cfg(test)]
pub(crate) mod tests {
    use chrono::{Duration, TimeZone, Utc};
    use uuid::Uuid;

    use crate::api::events::model::{Event, Occurrence};

    /// A club's event with three-hour dates starting at the given UTC hours.
    pub fn event_with_dates(id: i64, starts: &[(i32, u32, u32, u32)]) -> Event {
        let occurrences = starts
            .iter()
            .enumerate()
            .map(|(index, (year, month, day, hour))| {
                let start = Utc
                    .with_ymd_and_hms(*year, *month, *day, *hour, 0, 0)
                    .unwrap();
                Occurrence {
                    id: Uuid::from_u128(index as u128 + 1),
                    event_id: id,
                    dtstart_utc: start,
                    dtend_utc: Some(start + Duration::hours(3)),
                    duration: None,
                    tz: None,
                }
            })
            .collect();
        Event {
            competition: None,
            employers_on_campus: None,
            sports_game: None,
            campus_season_ids: None,
            id,
            club_id: Some(7),
            title: "Board Games Night".into(),
            description: None,
            location: Some("SLC Great Hall".into()),
            map_location: None,
            map_coordinates: None,
            occurrences,
            price: Some(0.0),
            food: None,
            registration: true,
            source_image_url: None,
            source_video_url: None,
            source_url: None,
            category: None,
            club: Some("Board Game Club".into()),
            club_logo_url: None,
            cohosts: Vec::new(),
            featured: false,
            is_directory_event: false,
            club_type: None,
            club_page: None,
            club_ig: None,
            club_discord: None,
            ig_handle: None,
            school: Some("uwaterloo".into()),
            cancelled: false,
            added_at: Utc.with_ymd_and_hms(2026, 11, 1, 0, 0, 0).unwrap(),
            last_source_changed_at: None,
            created_by: None,
        }
    }
}
