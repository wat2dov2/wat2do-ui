//! Registered schools and the per-school context agents are given
//! (`services/school_service.py` and `services/school_context.py`).

use std::collections::HashMap;

use anyhow::{Result, bail};
use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;
use sqlx::PgPool;
use url::Url;

use crate::controlbox::EVENT_DISCOVERY;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct School {
    pub id: i32,
    pub slug: String,
    pub name: String,
    pub timezone: String,
    pub semester_start: Option<NaiveDate>,
    pub semester_end: Option<NaiveDate>,
    /// The Instagram account ID whose notifications belong to this school.
    pub recipient_id: Option<String>,
}

/// The `schools` columns a `School` reads.
pub const COLUMNS: &str = "id, slug, name, timezone, semester_start, semester_end, recipient_id";

/// `school_service.get_school`: a school by slug.
pub async fn by_slug(pool: &PgPool, slug: &str) -> Result<Option<School>> {
    let slug = slug.trim().to_lowercase();
    Ok(sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM public.schools WHERE slug = $1"
    ))
    .bind(slug)
    .fetch_optional(pool)
    .await?)
}

/// Every registered school by id; there are few, so callers load them once.
pub async fn by_id(pool: &PgPool) -> Result<HashMap<i32, School>> {
    let schools: Vec<School> = sqlx::query_as(&format!("SELECT {COLUMNS} FROM public.schools"))
        .fetch_all(pool)
        .await?;
    Ok(schools
        .into_iter()
        .map(|school| (school.id, school))
        .collect())
}

/// `normalize_school_slug` (and `canonical_school_key`): stripped and lower-cased.
pub fn normalize_slug(value: &str) -> String {
    crate::text::python_strip(value).to_lowercase()
}

/// `get_school_by_name`'s PostgREST `ilike` value: the stripped name, with
/// `*` read as `%` as PostgREST reads it; `None` when blank.
pub fn name_pattern(value: &str) -> Option<String> {
    let name = crate::text::python_strip(value);
    (!name.is_empty()).then(|| name.replace('*', "%"))
}

/// SQL for `get_school_id(value)`, given placeholders bound to
/// `normalize_slug(value)` and `name_pattern(value)` (NULL when blank): the
/// school with that slug, else the first whose name matches.
pub fn school_id_sql(slug: &str, name: &str) -> String {
    format!(
        "COALESCE((SELECT id FROM public.schools WHERE slug = {slug} LIMIT 1), \
         (SELECT id FROM public.schools WHERE name ILIKE {name} LIMIT 1))"
    )
}

/// `school_frontend_url`: the configured frontend origin scoped to one school,
/// such as `https://uwaterloo.wat2do.io` for `https://wat2do.io`.
pub fn frontend_url(configured: &str, slug: Option<&str>) -> Result<String> {
    let base_url = match configured.trim_end_matches('/') {
        "" => "http://localhost:3000",
        trimmed => trimmed,
    };
    let parsed = Url::parse(base_url).ok();
    let Some(hostname) = parsed
        .as_ref()
        .and_then(Url::host_str)
        .filter(|host| !host.is_empty())
        .map(|host| host.trim_matches(['[', ']']).to_lowercase())
    else {
        bail!("FRONTEND_URL must be an absolute URL");
    };
    if matches!(hostname.as_str(), "wat2do.ca" | "www.wat2do.ca")
        || hostname.ends_with(".wat2do.ca")
    {
        bail!("FRONTEND_URL must use wat2do.io, not wat2do.ca");
    }
    let slug = slug.unwrap_or("").trim().to_lowercase();
    if slug.is_empty() || matches!(hostname.as_str(), "127.0.0.1" | "::1") {
        return Ok(base_url.to_owned());
    }
    let scoped_hostname = if hostname == "localhost" || hostname.ends_with(".localhost") {
        format!("{slug}.wat2do.localhost")
    } else if hostname == "wat2do.io" || hostname.ends_with(".wat2do.io") {
        format!("{slug}.wat2do.io")
    } else {
        format!(
            "{slug}.{}",
            hostname.strip_prefix("www.").unwrap_or(&hostname)
        )
    };
    let parsed = parsed.expect("parsed above");
    // The port the URL spells out, even the scheme's default, as Python reads it.
    let port = crate::urls::urlsplit(base_url, "")
        .ok()
        .and_then(|split| split.port().ok().flatten())
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Ok(format!(
        "{}://{scoped_hostname}{port}{}",
        parsed.scheme(),
        parsed.path().trim_end_matches('/')
    ))
}

/// `schemas.school.validate_recipient_id`: one canonical numeric notification recipient ID.
pub fn validate_recipient_id(value: &str) -> Result<String, String> {
    if !(1..=32).contains(&value.len())
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.starts_with('0')
    {
        return Err("recipient_id must be a canonical numeric identifier".to_owned());
    }
    Ok(value.to_owned())
}

/// `school_service.get_school_by_recipient_id`: the school an Instagram account notifies.
pub async fn by_recipient_id(pool: &PgPool, recipient_id: &str) -> Result<Option<School>> {
    let Ok(recipient_id) = validate_recipient_id(recipient_id.trim()) else {
        return Ok(None);
    };
    Ok(sqlx::query_as(&format!(
        "SELECT {COLUMNS} FROM public.schools WHERE recipient_id = $1 LIMIT 1"
    ))
    .bind(recipient_id)
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
         Networking opportunities (employers, career panels, hackathons, conferences) \
         belong in employers_on_campus, not a campus-season ID."
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

#[cfg(test)]
mod tests {
    use super::{frontend_url, name_pattern, normalize_slug};

    #[test]
    fn slugs_and_name_patterns_follow_python() {
        assert_eq!(normalize_slug("  UWaterloo\n"), "uwaterloo");
        assert_eq!(
            name_pattern("  University of *  ").as_deref(),
            Some("University of %")
        );
        assert_eq!(name_pattern("   "), None);
    }

    /// Every case as `services.school_context.school_frontend_url` returns it.
    #[test]
    fn frontend_urls_match_python() {
        let cases: [(&str, Option<&str>, Option<&str>); 45] = [
            (
                "https://wat2do.io",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io"),
            ),
            ("https://wat2do.io", None, Some("https://wat2do.io")),
            (
                "https://wat2do.io",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://wat2do.io/",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io"),
            ),
            ("https://wat2do.io/", None, Some("https://wat2do.io")),
            (
                "https://wat2do.io/",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://www.wat2do.io",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io"),
            ),
            ("https://www.wat2do.io", None, Some("https://www.wat2do.io")),
            (
                "https://www.wat2do.io",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://uwaterloo.wat2do.io",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://uwaterloo.wat2do.io",
                None,
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://uwaterloo.wat2do.io",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "http://localhost:3000",
                Some("uwaterloo"),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            ("http://localhost:3000", None, Some("http://localhost:3000")),
            (
                "http://localhost:3000",
                Some(" UWaterloo "),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            (
                "http://wat2do.localhost:3000",
                Some("uwaterloo"),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            (
                "http://wat2do.localhost:3000",
                None,
                Some("http://wat2do.localhost:3000"),
            ),
            (
                "http://wat2do.localhost:3000",
                Some(" UWaterloo "),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            (
                "http://127.0.0.1:3000",
                Some("uwaterloo"),
                Some("http://127.0.0.1:3000"),
            ),
            ("http://127.0.0.1:3000", None, Some("http://127.0.0.1:3000")),
            (
                "http://127.0.0.1:3000",
                Some(" UWaterloo "),
                Some("http://127.0.0.1:3000"),
            ),
            (
                "http://[::1]:3000",
                Some("uwaterloo"),
                Some("http://[::1]:3000"),
            ),
            ("http://[::1]:3000", None, Some("http://[::1]:3000")),
            (
                "http://[::1]:3000",
                Some(" UWaterloo "),
                Some("http://[::1]:3000"),
            ),
            (
                "https://example.com:8443/app/",
                Some("uwaterloo"),
                Some("https://uwaterloo.example.com:8443/app"),
            ),
            (
                "https://example.com:8443/app/",
                None,
                Some("https://example.com:8443/app"),
            ),
            (
                "https://example.com:8443/app/",
                Some(" UWaterloo "),
                Some("https://uwaterloo.example.com:8443/app"),
            ),
            (
                "https://www.example.com",
                Some("uwaterloo"),
                Some("https://uwaterloo.example.com"),
            ),
            (
                "https://www.example.com",
                None,
                Some("https://www.example.com"),
            ),
            (
                "https://www.example.com",
                Some(" UWaterloo "),
                Some("https://uwaterloo.example.com"),
            ),
            (
                "",
                Some("uwaterloo"),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            ("", None, Some("http://localhost:3000")),
            (
                "",
                Some(" UWaterloo "),
                Some("http://uwaterloo.wat2do.localhost:3000"),
            ),
            (
                "https://WAT2DO.IO",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io"),
            ),
            ("https://WAT2DO.IO", None, Some("https://WAT2DO.IO")),
            (
                "https://WAT2DO.IO",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io"),
            ),
            (
                "https://wat2do.io:443",
                Some("uwaterloo"),
                Some("https://uwaterloo.wat2do.io:443"),
            ),
            ("https://wat2do.io:443", None, Some("https://wat2do.io:443")),
            (
                "https://wat2do.io:443",
                Some(" UWaterloo "),
                Some("https://uwaterloo.wat2do.io:443"),
            ),
            ("https://uwaterloo.wat2do.ca", Some("uwaterloo"), None),
            ("https://uwaterloo.wat2do.ca", None, None),
            ("https://uwaterloo.wat2do.ca", Some(" UWaterloo "), None),
            ("localhost:3000", Some("uwaterloo"), None),
            ("localhost:3000", None, None),
            ("localhost:3000", Some(" UWaterloo "), None),
        ];
        for (configured, slug, expected) in cases {
            assert_eq!(
                frontend_url(configured, slug).ok().as_deref(),
                expected,
                "{configured:?} {slug:?}"
            );
        }
        let legacy = frontend_url("https://uwaterloo.wat2do.ca", None).unwrap_err();
        assert!(legacy.to_string().contains("must use wat2do.io"));
    }
}
