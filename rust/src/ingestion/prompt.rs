//! Rendering `backend/services/ingestion/prompt.md` for one source.

use std::sync::LazyLock;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::constants::EVENT_CATEGORIES;
use crate::schools::{School, building_code_prompt, campus_season_prompt};

const PROMPT: &str = include_str!("../../../backend/services/ingestion/prompt.md");

/// `backend/schemas/event_discovery_fields.json`, which the event schema,
/// the extraction prompt and this agent's prompt all read.
#[derive(Deserialize)]
pub struct DiscoveryFields {
    pub heading: Vec<String>,
    /// Each discovery field, in the event schema's order, with its description.
    pub fields: indexmap::IndexMap<String, String>,
}

pub static DISCOVERY: LazyLock<DiscoveryFields> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../backend/schemas/event_discovery_fields.json"
    ))
    .expect("backend/schemas/event_discovery_fields.json")
});

/// `EVENT_DISCOVERY_RULES`: the heading, then one line per field.
pub static DISCOVERY_RULES: LazyLock<String> = LazyLock::new(|| {
    DISCOVERY
        .heading
        .iter()
        .cloned()
        .chain(
            DISCOVERY
                .fields
                .iter()
                .map(|(name, description)| format!("- {name}: {description}")),
        )
        .collect::<Vec<_>>()
        .join("\n")
});

const DIRECTORY_NOTE: &str = "A directory agent already read this page and confirmed it is a real event or position, so its details below are accurate. Your job is to avoid duplicates and fit it with what is already listed.";
const DM_NOTE: &str = "This source is not a post: it is what a club wrote to our Instagram account in direct messages, usually a correction to an event or position already listed (a new date, time, place, price or organizer). Find the listings it clearly refers to and correct only what the message states. Never create a listing from a message, and change nothing if you cannot tell which listing it means.";
const CAROUSEL_NOTE: &str = "The club asked us in our Instagram DMs to feature this post in our carousel. Once the listings match the source, set `carousel_requested_at = now()` on every event this source describes, including an existing event you matched instead of creating a new one.";

/// How a queued source is described to the agent, and the `ingestion_source`
/// the rows it creates carry.
pub fn source_kind(source: &str) -> (&'static str, &'static str, &'static str) {
    match source {
        "directory" => (
            "official school event-directory page",
            "directory",
            DIRECTORY_NOTE,
        ),
        "dm" => ("direct message from a club", "instagram_scraper", DM_NOTE),
        _ => ("Instagram post", "instagram_scraper", ""),
    }
}

/// What the agent writes as a poster until its image is stored.
pub fn poster_reference(token: &str, index: usize) -> String {
    format!("pending:{token}/image-{index}")
}

/// One image saved in the agent's folder.
pub struct ImageLine<'a> {
    pub file: &'a str,
    pub is_video: bool,
}

pub struct Source<'a> {
    pub post: &'a Value,
    pub source: &'a str,
    pub school: &'a School,
    pub carousel_requested: bool,
    pub caption: &'a str,
    pub images: Vec<ImageLine<'a>>,
    pub token: &'a str,
    pub owner: &'a str,
    pub coauthors: &'a [String],
    pub posted_at: Option<DateTime<Utc>>,
    pub now: DateTime<Utc>,
}

pub fn render(source: &Source) -> String {
    let timezone = source.school.tz();
    let now = source.now.with_timezone(&timezone);
    let posted = source
        .posted_at
        .map(|posted| posted.with_timezone(&timezone))
        .unwrap_or(now);
    let (kind, ingestion_source, note) = source_kind(source.source);
    let semester_line = match source.school.current_semester_end(source.now) {
        Some(end) => format!("Current semester ends: {end}"),
        None => "Current semester end: unknown".to_owned(),
    };
    let source_note = [
        note,
        if source.carousel_requested {
            CAROUSEL_NOTE
        } else {
            ""
        },
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");
    let images = source
        .images
        .iter()
        .enumerate()
        .map(|(index, image)| {
            format!(
                "- Image {index}: ./{}, poster reference `{}`{}",
                image.file,
                poster_reference(source.token, index),
                if image.is_video {
                    " (a video slide)"
                } else {
                    ""
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let coauthors = if source.coauthors.is_empty() {
        "none".to_owned()
    } else {
        source
            .coauthors
            .iter()
            .map(|handle| format!("@{handle}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let categories = EVENT_CATEGORIES
        .iter()
        .map(|c| format!("'{c}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let values: Vec<(&str, String)> = vec![
        (
            "source_url",
            source.post["url"].as_str().unwrap_or_default().to_owned(),
        ),
        ("source_kind", kind.to_owned()),
        ("ingestion_source", ingestion_source.to_owned()),
        ("school", source.school.slug.clone()),
        ("school_name", source.school.name.clone()),
        ("school_id", source.school.id.to_string()),
        ("timezone", timezone.name().to_owned()),
        ("today", now.format("%A %Y-%m-%d").to_string()),
        ("posted_at", posted.format("%A %Y-%m-%d %H:%M").to_string()),
        ("semester_line", semester_line),
        ("owner_club", source.owner.to_owned()),
        ("coauthors", coauthors),
        (
            "caption",
            if source.caption.is_empty() {
                "(no text)".into()
            } else {
                source.caption.to_owned()
            },
        ),
        ("source_note", source_note),
        (
            "images",
            if images.is_empty() {
                "(no images)".into()
            } else {
                images
            },
        ),
        ("categories", categories),
        ("discovery_rules", DISCOVERY_RULES.clone()),
        ("campus_seasons", campus_season_prompt(&source.school.slug)),
        ("building_codes", building_code_prompt(&source.school.slug)),
    ];
    // Substituted in this order, like the Python loop over its values dict.
    let mut prompt = PROMPT.to_owned();
    for (key, value) in &values {
        prompt = prompt.replace(&format!("{{{{{key}}}}}"), value);
    }
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_placeholder_is_filled() {
        let school = School {
            id: 1,
            slug: "uwaterloo".into(),
            name: "University of Waterloo".into(),
            timezone: "America/Toronto".into(),
            semester_start: None,
            semester_end: None,
            recipient_id: None,
        };
        let post = serde_json::json!({"url": "https://www.instagram.com/p/ABC/"});
        let rendered = render(&Source {
            post: &post,
            source: "instagram",
            school: &school,
            carousel_requested: true,
            caption: "Jam",
            images: vec![ImageLine {
                file: "image-0.jpg",
                is_video: false,
            }],
            token: "t0k3n",
            owner: "Improv Club (clubs.id = 1, Instagram @improv)",
            coauthors: &[],
            posted_at: None,
            now: Utc::now(),
        });
        assert!(!rendered.contains("{{"), "unfilled placeholder");
        assert!(rendered.contains("poster reference `pending:t0k3n/image-0`"));
        assert!(rendered.contains("carousel_requested_at = now()"));
        assert!(rendered.contains("- competition:"));
    }
}
