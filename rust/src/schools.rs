//! Registered schools and the per-school context agents are given
//! (`services/school_service.py` and `services/school_context.py`).

use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;
use sqlx::PgPool;

use crate::controlbox::EVENT_DISCOVERY;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct School {
    pub id: i32,
    pub slug: String,
    pub name: String,
    pub timezone: String,
    pub semester_start: Option<NaiveDate>,
    pub semester_end: Option<NaiveDate>,
}

const COLUMNS: &str = "id, slug, name, timezone, semester_start, semester_end";

pub async fn by_slug(pool: &PgPool, slug: &str) -> Result<Option<School>> {
    let slug = slug.trim().to_lowercase();
    Ok(sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM public.schools WHERE slug = $1"
    ))
    .persistent(false)
    .bind(slug)
    .fetch_optional(pool)
    .await?)
}

impl School {
    /// The school's IANA zone; an unknown name falls back to UTC like Python's lookup.
    pub fn tz(&self) -> Tz {
        self.timezone.parse().unwrap_or(Tz::UTC)
    }

    /// `current_semester_end`: the semester's end as `YYYYMMDDT235959Z` while `now` is in it.
    pub fn current_semester_end(&self, now: DateTime<Utc>) -> Option<String> {
        let (start, end) = (self.semester_start?, self.semester_end?);
        let today = now.with_timezone(&self.tz()).date_naive();
        (start <= today && today <= end).then(|| format!("{}T235959Z", end.format("%Y%m%d")))
    }
}

/// `campus_season_prompt`: one school's season classification guidance.
pub fn campus_season_prompt(slug: &str) -> String {
    let configuration = &EVENT_DISCOVERY.campus_seasons;
    let Some(configured) = configuration
        .schools
        .get(slug)
        .filter(|school| !school.seasons.is_empty())
    else {
        return "CAMPUS SEASONS: This school has no configured season IDs. Return campus_season_ids: [].".to_owned();
    };
    let mut lines = vec![
        format!("CAMPUS SEASONS FOR {slug}:"),
        configured.instructions.clone(),
        "Set campus_season_ids to all matching IDs below, or [] when none match. \
         Use explicit event content and school context, never a date alone. \
         Display windows control filter visibility only; they are not classification rules. \
         Classify announced future events even when a display window is not currently open. \
         Do not copy season classifications from another school. \
         Employer recruiting belongs in employers_on_campus, not a campus-season ID."
            .to_owned(),
    ];
    for season in &configured.seasons {
        let definition = &configuration.definitions[&season.id];
        let line = format!(
            "- {} ({}): {} {}",
            season.id, definition.labels["en"], definition.instructions, season.instructions
        );
        lines.push(line.trim_end().to_owned());
    }
    lines.join("\n")
}

/// `building_code_prompt`: the school's building codes, so a code is never guessed.
pub fn building_code_prompt(slug: &str) -> String {
    let Some(codes) = EVENT_DISCOVERY
        .map_geocoding
        .building_codes
        .get(slug)
        .filter(|codes| !codes.is_empty())
    else {
        return "No building codes are listed for this school.".to_owned();
    };
    let listed: Vec<String> = codes
        .iter()
        .map(|(code, name)| format!("{code} = {name}"))
        .collect();
    format!(
        "Building codes at {slug}: {}. When a listed code appears, its map_location building is exactly this name; never expand it any other way.",
        listed.join("; ")
    )
}
