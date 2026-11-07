//! The daily Instagram carousels' background jobs (`wat2do-instagram`): Claude
//! drafts each school's carousel (`curation`), the morning publish and the
//! admin's Publish button post them (`publishing`), and a daily run refreshes
//! the accounts' tokens and reads their stats (`tokens`, `stats`).
//!
//! The admin editor's routes (`api::routes::instagram_publishing`) own reading,
//! editing and claiming a batch; these jobs read and claim batches through the
//! same functions, and build captions with the same `captions` module.
//! Liking, reposting and adding music to a published carousel stay with the
//! Python emulator worker (`services/instagram_publishing/music.py`).

pub mod curation;
pub mod drafts;
pub mod meta;
pub mod publishing;
pub mod rendering;
pub mod schedule;
pub mod selection;
pub mod stats;
pub mod tokens;

#[cfg(test)]
mod database_tests;
#[cfg(test)]
pub(crate) mod fake_http;

use std::fmt::Write as _;
use std::path::PathBuf;

use chrono::{DateTime, Timelike, Utc};

use crate::api::errors::ApiError;

/// A refusal the caller can act on (Python's `ValidationError` and
/// `ValueError`): a curation agent is shown it and may answer again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused(pub String);

impl std::fmt::Display for Refused {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Refused {}

/// An API layer error as these jobs report it: a validation problem is a
/// [`Refused`]; anything else keeps its message (`str(exc)` in Python).
pub fn job_error(error: ApiError) -> anyhow::Error {
    match error {
        ApiError::Validation { detail, .. } => Refused(detail).into(),
        ApiError::NotFound(detail) | ApiError::Conflict(detail) => anyhow::anyhow!(detail),
        ApiError::Database(error) => error.into(),
        ApiError::Internal(error) => error,
        other => anyhow::anyhow!("{other:?}"),
    }
}

/// Python's `str(exc)` for an error, cut to the 2000 characters a batch's
/// `error_message` keeps.
pub fn error_message(error: &anyhow::Error) -> String {
    let message = format!("{error:#}");
    let message = if message.is_empty() {
        "Error".to_owned()
    } else {
        message
    };
    message.chars().take(2000).collect()
}

fn fraction(value: &DateTime<Utc>) -> u32 {
    value.nanosecond() / 1000 % 1_000_000
}

/// `datetime.isoformat()` of a UTC time: `2026-09-28T14:00:00+00:00`, with
/// all six microsecond digits when there are any.
pub fn isoformat(value: &DateTime<Utc>) -> String {
    let mut text = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    let micros = fraction(value);
    if micros != 0 {
        let _ = write!(text, ".{micros:06}");
    }
    text.push_str("+00:00");
    text
}

/// A `timestamptz` as PostgREST returned it to Python (Postgres' JSON text in
/// UTC): like [`isoformat`], with trailing zeros of the fraction dropped.
pub fn postgres_json_datetime(value: &DateTime<Utc>) -> String {
    let mut text = value.format("%Y-%m-%dT%H:%M:%S").to_string();
    let micros = fraction(value);
    if micros != 0 {
        let digits = format!("{micros:06}");
        let _ = write!(text, ".{}", digits.trim_end_matches('0'));
    }
    text.push_str("+00:00");
    text
}

/// Python's `tempfile.gettempdir()` under launchd: the user's `TMPDIR`.
pub fn temp_directory() -> PathBuf {
    std::env::temp_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn datetimes_print_as_python_and_postgrest_did() {
        let at = Utc.with_ymd_and_hms(2026, 9, 28, 14, 0, 0).unwrap();
        assert_eq!(isoformat(&at), "2026-09-28T14:00:00+00:00");
        assert_eq!(postgres_json_datetime(&at), "2026-09-28T14:00:00+00:00");
        let at = at + chrono::Duration::microseconds(120_000);
        assert_eq!(isoformat(&at), "2026-09-28T14:00:00.120000+00:00");
        assert_eq!(postgres_json_datetime(&at), "2026-09-28T14:00:00.12+00:00");
    }

    #[test]
    fn validation_problems_are_refusals_with_their_message() {
        let error = job_error(ApiError::validation(
            "Draft window cannot end in the future",
        ));
        assert_eq!(
            error.downcast_ref::<Refused>(),
            Some(&Refused("Draft window cannot end in the future".into()))
        );
        assert_eq!(
            error_message(&error),
            "Draft window cannot end in the future"
        );
        assert_eq!(
            error_message(&anyhow::anyhow!("x".repeat(2100))).len(),
            2000
        );
    }
}
