//! Scheduled notification emails: the morning email and event reminders
//! (`jobs/send_notifications.py`, `services/notifications`).
//!
//! The pieces the Python API still uses for event change emails and the
//! unsubscribe route (`preferences`, `unsubscribe`, `delivery_log`) live here
//! too, so those routes can move without a second copy.

pub mod delivery_log;
pub mod email_images;
pub mod event_reminder;
pub mod morning_email;
pub mod preferences;
pub mod rendering;
pub mod unsubscribe;

use std::collections::HashMap;

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::schools::{self, School};
use crate::settings::settings;
use crate::time_zones::Tz;

/// Counts for one dispatch, logged and used for the job's exit status.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Stats {
    /// Users who could get the morning email, or Going selections due a reminder.
    pub considered: usize,
    pub prepared: usize,
    pub sent: usize,
    pub failed: usize,
    pub skipped: usize,
}

/// What one delivery attempt came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    Failed,
    /// Already sent or being sent by another run.
    Skipped,
}

impl Stats {
    /// Python's stats dict, e.g. `{'eligible': 2, 'prepared': 1, ...}`.
    pub fn describe(&self, considered_label: &str) -> String {
        format!(
            "{{'{considered_label}': {}, 'prepared': {}, 'sent': {}, 'failed': {}, 'skipped': {}}}",
            self.considered, self.prepared, self.sent, self.failed, self.skipped
        )
    }

    fn record(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Sent => self.sent += 1,
            Outcome::Failed => self.failed += 1,
            Outcome::Skipped => self.skipped += 1,
        }
    }
}

/// A user an email goes to, with their school.
#[derive(Debug, Clone)]
pub struct Recipient {
    pub id: Uuid,
    pub email: String,
    pub school: Option<School>,
}

impl Recipient {
    /// The school's time zone; a user without a school reads times in UTC.
    pub fn tz(&self) -> Tz {
        match &self.school {
            Some(school) => school.tz(),
            None => Tz::UTC,
        }
    }

    fn slug(&self) -> Option<&str> {
        self.school.as_ref().map(|school| school.slug.as_str())
    }
}

/// Users with an email, in id order; all of them, or only `ids`.
pub async fn load_recipients(pool: &PgPool, ids: Option<&[Uuid]>) -> Result<Vec<Recipient>> {
    let rows: Vec<(Uuid, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, email, school_id FROM public.users \
         WHERE email IS NOT NULL AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY id",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    let schools = schools::by_id(pool).await?;
    Ok(attach_schools(rows, &schools))
}

fn attach_schools(
    rows: Vec<(Uuid, String, Option<i32>)>,
    schools: &HashMap<i32, School>,
) -> Vec<Recipient> {
    rows.into_iter()
        .map(|(id, email, school_id)| {
            let school = school_id.and_then(|school_id| schools.get(&school_id).cloned());
            if school.is_none() {
                tracing::warn!("unresolved school=None for user={id}; falling back to UTC");
            }
            Recipient { id, email, school }
        })
        .collect()
}

/// The settings every email's links are built from.
#[derive(Debug, Clone)]
pub struct LinkSettings {
    /// `FRONTEND_URL`, which each school's subdomain is derived from.
    pub frontend_url: String,
    pub unsubscribe_secret: String,
}

impl LinkSettings {
    pub fn from_env() -> Result<Self> {
        let settings = settings()?;
        Ok(Self {
            frontend_url: settings.frontend_url.clone(),
            unsubscribe_secret: settings.email_unsubscribe_secret.clone(),
        })
    }
}

/// The links and headers every scheduled email carries for its recipient.
pub struct Addressing {
    pub frontend_url: String,
    pub preferences_url: String,
    pub unsubscribe_url: String,
}

impl Addressing {
    pub fn new(
        recipient: &Recipient,
        notification_type: &str,
        link_settings: &LinkSettings,
    ) -> Result<Self> {
        let frontend_url = schools::frontend_url(&link_settings.frontend_url, recipient.slug())?;
        let unsubscribe_url = unsubscribe::unsubscribe_url(
            &link_settings.unsubscribe_secret,
            &frontend_url,
            recipient.id,
            notification_type,
        )?;
        Ok(Self {
            preferences_url: format!("{frontend_url}/settings?tab=notifications"),
            frontend_url,
            unsubscribe_url,
        })
    }

    pub fn links(&self) -> rendering::Links<'_> {
        rendering::Links {
            frontend_url: &self.frontend_url,
            preferences_url: &self.preferences_url,
            unsubscribe_url: &self.unsubscribe_url,
        }
    }

    /// One-click unsubscribe (RFC 8058), which Gmail and Yahoo require of bulk senders.
    pub fn headers(&self) -> Vec<(String, String)> {
        vec![
            (
                "List-Unsubscribe".to_owned(),
                format!("<{}>", self.unsubscribe_url),
            ),
            (
                "List-Unsubscribe-Post".to_owned(),
                "List-Unsubscribe=One-Click".to_owned(),
            ),
        ]
    }
}

/// Python's `datetime.isoformat()` for a UTC time, e.g. `2026-05-01T15:00:00+00:00`.
pub fn python_isoformat(value: DateTime<Utc>) -> String {
    let micros = value.timestamp_subsec_micros();
    let fraction = if micros == 0 {
        String::new()
    } else {
        format!(".{micros:06}")
    };
    format!("{}{fraction}+00:00", value.format("%Y-%m-%dT%H:%M:%S"))
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn isoformat_matches_python() {
        let whole = Utc.with_ymd_and_hms(2026, 5, 1, 15, 0, 0).unwrap();
        assert_eq!(python_isoformat(whole), "2026-05-01T15:00:00+00:00");
        let fraction = whole + chrono::Duration::microseconds(1500);
        assert_eq!(
            python_isoformat(fraction),
            "2026-05-01T15:00:00.001500+00:00"
        );
    }

    #[test]
    fn users_without_a_school_read_times_in_utc() {
        let school = School {
            id: 1,
            slug: "uwaterloo".to_owned(),
            name: "University of Waterloo".to_owned(),
            timezone: "America/Toronto".to_owned(),
            semester_start: None,
            semester_end: None,
            recipient_id: None,
        };
        let recipients = attach_schools(
            vec![
                (Uuid::from_u128(1), "a@x.ca".to_owned(), Some(1)),
                (Uuid::from_u128(2), "b@x.ca".to_owned(), None),
                (Uuid::from_u128(3), "c@x.ca".to_owned(), Some(99)),
            ],
            &HashMap::from([(1, school)]),
        );
        let zones: Vec<Tz> = recipients.iter().map(Recipient::tz).collect();
        assert_eq!(zones, [Tz::AMERICA_TORONTO, Tz::UTC, Tz::UTC]);
        assert_eq!(recipients[0].slug(), Some("uwaterloo"));
    }
}
