//! `build_caption` (`services/instagram_publishing/captions.py`): the factual
//! caption a carousel posts with, built from its events' live data.
//!
//! Python's daily drafts build the same caption when they save a draft; the
//! two must stay byte for byte alike (`backend/tests/.../test_captions.py`
//! and the tests below share their cases).

use chrono::{DateTime, Utc};
use chrono_tz::Tz;

use crate::api::errors::ApiError;
use crate::api::events::model::Event;
use crate::text::{python_space, python_strip};

const INSTAGRAM_CAPTION_LIMIT: usize = 2200;
pub const CAPTION_TOO_LONG: &str = "Caption intro and generated event details exceed Instagram's 2200-character limit. Shorten the intro or reduce the number of slides.";

/// The school facts a caption needs.
pub struct CaptionSchool<'a> {
    /// The canonical slug (`canonical_school_key`).
    pub slug: &'a str,
    pub timezone: Tz,
    pub french: bool,
}

/// What one slide's caption entry prints: the event's first occurrence.
pub struct CaptionEvent<'a> {
    pub title: &'a str,
    pub club: Option<&'a str>,
    pub ig_handle: Option<&'a str>,
    pub location: Option<&'a str>,
    pub start: DateTime<Utc>,
}

impl<'a> CaptionEvent<'a> {
    /// A hydrated event's entry; `None` for an event without a date.
    pub fn of(event: &'a Event) -> Option<Self> {
        Some(Self {
            title: &event.title,
            club: event.club.as_deref(),
            ig_handle: event.ig_handle.as_deref(),
            location: event.location.as_deref(),
            start: event.occurrences.first()?.dtstart_utc,
        })
    }
}

fn char_len(value: &str) -> usize {
    value.chars().count()
}

/// `_truncate`: collapse whitespace, then cut to `length` characters with an ellipsis.
fn truncate(value: &str, length: usize) -> String {
    let cleaned = value
        .split(python_space)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if char_len(&cleaned) <= length {
        return cleaned;
    }
    let kept: String = cleaned
        .chars()
        .take(length.saturating_sub(1).max(1))
        .collect();
    format!("{}…", kept.trim_end_matches(python_space))
}

/// `build_caption`.
pub fn build_caption(
    events: &[CaptionEvent<'_>],
    school: &CaptionSchool<'_>,
    intro: &str,
) -> Result<String, ApiError> {
    let french = school.french;
    let mut lines: Vec<String> = Vec::new();
    for (index, event) in events.iter().enumerate() {
        let start = event.start.with_timezone(&school.timezone);
        let handle = python_strip(event.ig_handle.unwrap_or_default()).trim_start_matches('@');
        let club = if handle.is_empty() {
            event.club.unwrap_or_default().to_owned()
        } else {
            format!("@{handle}")
        };
        let title = Some(event.title).filter(|title| !title.is_empty());
        let title = truncate(
            title.unwrap_or(if french {
                "Événement sans titre"
            } else {
                "Untitled event"
            }),
            90,
        );
        let location = event.location.filter(|location| !location.is_empty());
        let location = truncate(
            location.unwrap_or(if french {
                "Lieu sur Wat2Do"
            } else {
                "See Wat2Do for location"
            }),
            90,
        );
        let (date, time) = if french {
            (
                start.format("%d/%m/%Y").to_string(),
                start.format("%H h %M").to_string(),
            )
        } else {
            let hour = start.format("%I").to_string();
            (
                format!("{} {}", start.format("%a, %b"), start.format("%-d")),
                format!("{}:{}", hour.trim_start_matches('0'), start.format("%M %p")),
            )
        };
        let heading = format!("{}. {title}", index + 1);
        lines.push(if club.is_empty() {
            heading
        } else {
            format!("{heading} - {club}")
        });
        lines.push(format!("   🗓 {date} · {time}"));
        lines.push(format!("   📍 {location}"));
        lines.push(String::new());
    }
    let body = lines.join("\n");
    let body = body.trim_end_matches(python_space);
    let hostname = format!("{}.wat2do.io", school.slug);
    let footer = [
        if french {
            "À quel événement allez-vous participer ?".to_owned()
        } else {
            "Which one are you going to?".to_owned()
        },
        String::new(),
        if french {
            format!("Dates, horaires, lieux, inscriptions et mises à jour sur {hostname}.")
        } else {
            format!(
                "For final, up-to-date dates, times, locations, registration details, and event changes, visit {hostname}."
            )
        },
        String::new(),
        format!("#{} #CampusEvents #Wat2Do", school.slug.replace('-', "")),
    ]
    .join("\n");
    let separator = "\n\n";
    let intro = python_strip(intro);
    let prefix = if intro.is_empty() {
        String::new()
    } else {
        format!("{intro}{separator}")
    };
    let caption = format!("{prefix}{body}{separator}{footer}");
    if char_len(&caption) <= INSTAGRAM_CAPTION_LIMIT {
        return Ok(caption);
    }
    let body_limit = INSTAGRAM_CAPTION_LIMIT as i64
        - char_len(&prefix) as i64
        - char_len(separator) as i64
        - char_len(&footer) as i64
        - 1;
    if body_limit <= 0 {
        return Err(ApiError::validation(CAPTION_TOO_LONG));
    }
    let truncated: String = body.chars().take(body_limit as usize).collect();
    Ok(format!(
        "{prefix}{}…{separator}{footer}",
        truncated.trim_end_matches(python_space)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn school(slug: &str, french: bool) -> CaptionSchool<'_> {
        CaptionSchool {
            slug,
            timezone: "America/Toronto".parse().unwrap(),
            french,
        }
    }

    fn event<'a>(
        title: &'a str,
        club: Option<&'a str>,
        handle: Option<&'a str>,
    ) -> CaptionEvent<'a> {
        CaptionEvent {
            title,
            club,
            ig_handle: handle,
            location: Some("Student Life Centre"),
            start: Utc.with_ymd_and_hms(2026, 7, 24, 23, 30, 0).unwrap(),
        }
    }

    #[test]
    fn captions_use_the_handle_local_time_location_and_school_link() {
        // test_build_caption_uses_canonical_handle_time_location_and_cta
        let caption = build_caption(
            &[event(
                "Midnight Breakfast",
                Some("Student Society"),
                Some("verifiedclub"),
            )],
            &school("utm", false),
            "",
        )
        .unwrap();
        assert_eq!(
            caption,
            "1. Midnight Breakfast - @verifiedclub\n   🗓 Fri, Jul 24 · 7:30 PM\n   📍 Student Life Centre\n\n\
             Which one are you going to?\n\nFor final, up-to-date dates, times, locations, registration details, \
             and event changes, visit utm.wat2do.io.\n\n#utm #CampusEvents #Wat2Do"
        );
    }

    #[test]
    fn french_schools_get_french_dates_and_copy() {
        let caption = build_caption(
            &[CaptionEvent {
                title: "",
                club: Some("Club Plein Air"),
                ig_handle: Some(" @ "),
                location: None,
                start: Utc.with_ymd_and_hms(2026, 7, 4, 13, 5, 0).unwrap(),
            }],
            &school("uqam-montreal", true),
            "  Bonjour  ",
        )
        .unwrap();
        assert!(caption.starts_with(
            "Bonjour\n\n1. Événement sans titre - Club Plein Air\n   🗓 04/07/2026 · 09 h 05\n   📍 Lieu sur Wat2Do\n\n"
        ));
        assert!(caption.ends_with(
            "mises à jour sur uqam-montreal.wat2do.io.\n\n#uqammontreal #CampusEvents #Wat2Do"
        ));
    }

    #[test]
    fn long_captions_keep_the_school_link_within_the_limit() {
        // test_build_caption_preserves_school_url_within_instagram_limit
        let title = "Long event title ".repeat(20);
        let club = "Club ".repeat(20);
        let location = "Very long location ".repeat(20);
        let events: Vec<CaptionEvent<'_>> = (0..9)
            .map(|_| CaptionEvent {
                location: Some(&location),
                ..event(&title, Some(&club), None)
            })
            .collect();
        let caption = build_caption(&events, &school("uwaterloo", false), "").unwrap();
        assert!(char_len(&caption) <= 2200);
        assert!(caption.contains("…\n\nWhich one are you going to?"));
        assert!(caption.contains("uwaterloo.wat2do.io"));
        // Each title is cut to 90 characters; the club name is printed as stored.
        assert!(caption.starts_with(&format!("1. {}… - {club}\n", &title[..89])));
        let too_long = build_caption(&events, &school("uwaterloo", false), &"x".repeat(2200));
        assert!(matches!(too_long, Err(ApiError::Validation { .. })));
    }

    #[test]
    fn truncation_collapses_whitespace_first() {
        assert_eq!(truncate("  a \n b  ", 90), "a b");
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(truncate("ab  cdef", 4), "ab…");
    }
}
