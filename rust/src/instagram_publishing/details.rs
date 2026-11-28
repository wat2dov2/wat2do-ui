//! Events whose place or start time is still to be announced never make a
//! carousel (Tony, 2026-11-27: "anything that is tbd should not be featured"),
//! however good they are: a slide that says "Location TBA" sends nobody
//! anywhere. Curation never offers them and the draft audit takes them off.

use std::sync::LazyLock;

use chrono::{DateTime, NaiveTime, Utc};
use regex::Regex;

use crate::time_zones::Tz;

/// A location that names no place yet: "TBD", "Room TBA", "Lieu à venir",
/// "shared after registration", "DM for address".
static LOCATION_PENDING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)
        \b(tbd|tba|tbc|tbdl)\b
        | \bto\ be\ (announced|determined|confirmed|decided|revealed|shared)\b
        | \b(à|a)\ (déterminer|determiner|confirmer|venir|communiquer|annoncer)\b
        | \b(after|upon|on|with|once\ you)\ (registration|registering|rsvp|rsvping|sign[-\ ]?up|signing\ up)\b
        | \b(après|apres|lors\ de)\ (l'|l’)?inscription\b
        | \bdm\ (us\ )?(for|to\ get|me)\b
        | \b(location|venue|address|room|lieu|local|salle)\ (coming\ soon|soon|later|to\ come)\b
        | \bcoming\ soon\b
        | \bsecret\ location\b
        ",
    )
    .expect("a valid pattern")
});

/// Words that say the start time is not known yet, near "time" or "heure":
/// "Time: TBA", "the time is TBD", "l'heure exacte est à confirmer".
static TIME_PENDING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)
        \b(times?|start\ time|heures?|horaires?)\b [^.!?\n]{0,15}?
        \b(tbd|tba|tbc|to\ be\ (announced|determined|confirmed|decided)|(à|a)\ (déterminer|determiner|confirmer|venir|annoncer))\b
        ",
    )
    .expect("a valid pattern")
});

/// A title still carrying a placeholder: "Movie Night (Date TBA)".
static TITLE_PENDING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(tbd|tba|tbc)\b").expect("a valid pattern"));

/// Why an event cannot be promoted yet, or `None` when its place and start
/// time are both known. `start` is the occurrence its slide would print and
/// `zone` the zone it prints in; a start at exactly local midnight is how an
/// event listed with no start time is stored.
pub fn pending_detail(
    title: &str,
    description: Option<&str>,
    location: Option<&str>,
    start: DateTime<Utc>,
    zone: &str,
) -> Option<&'static str> {
    let location = location.map(str::trim).unwrap_or_default();
    let blank = location.is_empty()
        || ["?", "-", "n/a", "na", "none", "unknown"]
            .iter()
            .any(|placeholder| location.eq_ignore_ascii_case(placeholder));
    if blank || LOCATION_PENDING.is_match(location) {
        return Some("location TBD");
    }
    if TITLE_PENDING.is_match(title) {
        return Some("details TBD");
    }
    if description.is_some_and(|description| TIME_PENDING.is_match(description)) {
        return Some("time TBD");
    }
    let midnight = zone.trim().parse::<Tz>().is_ok_and(|zone| {
        start.with_timezone(&zone).time() == NaiveTime::from_hms_opt(0, 0, 0).expect("midnight")
    });
    if midnight {
        return Some("no start time");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZONE: &str = "America/Toronto";

    /// 7 PM in Toronto.
    fn evening() -> DateTime<Utc> {
        "2026-12-02T00:00:00Z".parse().unwrap()
    }

    fn located(location: &str) -> Option<&'static str> {
        pending_detail("Pizza Night", None, Some(location), evening(), ZONE)
    }

    fn described(description: &str) -> Option<&'static str> {
        pending_detail(
            "Pizza Night",
            Some(description),
            Some("SLC 3223"),
            evening(),
            ZONE,
        )
    }

    #[test]
    fn a_known_place_and_time_is_promotable() {
        for location in [
            "SLC 3223",
            "Online (Zoom)",
            "Théâtre Saint-Catherine",
            "Toldo Lancer Centre",
            "Quidi Vidi Lower Deck",
            "3559 Rue University",
            "Venue at Tabaret Hall",
        ] {
            assert_eq!(located(location), None, "{location}");
        }
        assert_eq!(
            described("Time: 7 PM. Doors open at 6:30. Free pizza for everyone!"),
            None
        );
        assert_eq!(
            described("Come any time for snacks, location TBA soon"),
            None
        );
    }

    #[test]
    fn a_placeholder_location_is_pending() {
        for location in [
            "",
            "  ",
            "TBD",
            "TBA",
            "Location TBA",
            "Room TBD",
            "SGW, Room TBD",
            "Online, In-Person Room TBD",
            "To be announced",
            "Bronx, NY (Location To Be Announced)",
            "Local à déterminer",
            "Lieu à venir",
            "En présence et en ligne, local à confirmer",
            "Location upon registration",
            "Location shared after registration",
            "In person, room details shared upon registration",
            "DM for address",
            "DM us for the location",
            "Drop off location coming soon",
            "IBLC 156/157 (TBC)",
        ] {
            assert_eq!(located(location), Some("location TBD"), "{location:?}");
        }
        assert_eq!(
            pending_detail("Pizza Night", None, None, evening(), ZONE),
            Some("location TBD")
        );
    }

    #[test]
    fn a_time_still_to_come_is_pending() {
        for description in [
            "📍1443 Washtenaw Ave\n🗓️ Saturday, November 7\n⏰ Time TBD",
            "The time is TBD so be on the lookout for our email",
            "Location and time are tbd, but get hyped for DECEMBER 2ND!!!",
            "Times and Dates: TBD",
            "Time to be announced",
            "L'heure exacte est à confirmer.",
        ] {
            assert_eq!(described(description), Some("time TBD"), "{description:?}");
        }
        assert_eq!(
            pending_detail("Movie Night (Date TBA)", None, Some("SLC"), evening(), ZONE),
            Some("details TBD")
        );
    }

    #[test]
    fn a_start_at_local_midnight_is_no_start_time() {
        let midnight: DateTime<Utc> = "2026-12-02T05:00:00Z".parse().unwrap();
        assert_eq!(
            pending_detail("Foosball Tournament", None, Some("MP217"), midnight, ZONE),
            Some("no start time")
        );
        // Midnight elsewhere is evening in Toronto, and a zone with stray
        // spaces still reads.
        assert_eq!(
            pending_detail(
                "Foosball Tournament",
                None,
                Some("MP217"),
                evening(),
                " America/Toronto"
            ),
            None
        );
        // British Columbia keeps UTC-7 all year since 2026.
        let vancouver_midnight: DateTime<Utc> = "2026-12-02T07:00:00Z".parse().unwrap();
        assert_eq!(
            pending_detail(
                "Ski Night",
                None,
                Some("SUB"),
                vancouver_midnight,
                " America/Vancouver "
            ),
            Some("no start time")
        );
    }
}
