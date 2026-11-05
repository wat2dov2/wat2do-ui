//! One-hour reminders for occurrence-aware Going selections
//! (`services/notifications/event_reminder.py`).
//!
//! Each run reminds about occurrences starting `lead_minutes` from now, within
//! the late and early tolerances; a delivery is keyed by occurrence and start,
//! so a moved occurrence is reminded about again and an overlap sends nothing twice.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::delivery_log::Outbox;
use super::email_images::event_hero_image;
use super::rendering::{self, Event};
use super::{
    Addressing, LinkSettings, Outcome, Recipient, Stats, load_recipients, preferences,
    python_isoformat,
};
use crate::constants::NOTIFICATION_TYPE_EVENT_REMINDER;
use crate::controlbox::EVENT_REMINDER;
use crate::email::{EmailMessage, InlineImage, layout};

/// One user's Going selection of one occurrence, due a reminder.
#[derive(Debug, Clone)]
pub struct DueReminder {
    pub user_id: Uuid,
    pub event_date_id: Uuid,
    pub event: Event,
    pub source_image_url: Option<String>,
}

/// Send each selected occurrence once when it reaches the reminder window.
pub async fn dispatch(outbox: &Outbox, now: DateTime<Utc>) -> Result<Stats> {
    let pool = outbox.pool();
    let (window_start, window_end) = reminder_window(now);
    let due = load_due_reminders(pool, window_start, window_end).await?;
    let mut stats = Stats {
        considered: due.len(),
        ..Stats::default()
    };
    if due.is_empty() {
        return Ok(stats);
    }

    let mut user_ids: Vec<Uuid> = Vec::new();
    for reminder in &due {
        if !user_ids.contains(&reminder.user_id) {
            user_ids.push(reminder.user_id);
        }
    }
    let users: HashMap<Uuid, Recipient> = load_recipients(pool, Some(&user_ids))
        .await?
        .into_iter()
        .map(|user| (user.id, user))
        .collect();
    let enabled =
        preferences::enabled_user_ids(pool, &user_ids, NOTIFICATION_TYPE_EVENT_REMINDER).await?;
    let images = event_images(&due).await;
    let link_settings = LinkSettings::from_env()?;

    for reminder in &due {
        let Some(user) = users
            .get(&reminder.user_id)
            .filter(|user| !user.email.is_empty() && enabled.contains(&user.id))
        else {
            stats.skipped += 1;
            continue;
        };
        stats.prepared += 1;
        let image = images.get(&reminder.event.id).cloned().flatten();
        stats.record(send(outbox, user, reminder, image, &link_settings).await?);
    }
    tracing::info!(
        "Event reminder dispatch complete: {}",
        stats.describe("due")
    );
    Ok(stats)
}

fn reminder_window(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let target = now + Duration::minutes(EVENT_REMINDER.lead_minutes);
    (
        target - Duration::minutes(EVENT_REMINDER.late_tolerance_minutes),
        target + Duration::minutes(EVENT_REMINDER.early_tolerance_minutes),
    )
}

type DueRow = (
    Uuid,
    Uuid,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    i32,
    String,
    String,
    Option<String>,
);

async fn load_due_reminders(
    pool: &PgPool,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Result<Vec<DueReminder>> {
    let rows: Vec<DueRow> = sqlx::query_as(
        "SELECT g.user_id, g.event_date_id, d.dtstart_utc, d.dtend_utc, \
         e.id, e.title, e.location, e.source_image_url \
         FROM public.user_going_events g \
         JOIN public.event_dates d ON d.event_id = g.event_id AND d.id = g.event_date_id \
         JOIN public.events e ON e.id = g.event_id \
         WHERE d.dtstart_utc >= $1 AND d.dtstart_utc < $2 AND NOT e.cancelled \
         ORDER BY g.event_date_id, g.user_id",
    )
    .bind(window_start)
    .bind(window_end)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(user_id, event_date_id, start, end, id, title, location, source_image_url)| {
                DueReminder {
                    user_id,
                    event_date_id,
                    event: Event {
                        id: i64::from(id),
                        title,
                        location,
                        dtstart_utc: Some(start),
                        dtend_utc: end,
                    },
                    source_image_url,
                }
            },
        )
        .collect())
}

/// Each due event's poster, downloaded once however many attendees it has.
async fn event_images(due: &[DueReminder]) -> HashMap<i64, Option<Arc<InlineImage>>> {
    let mut images = HashMap::new();
    for reminder in due {
        if let std::collections::hash_map::Entry::Vacant(entry) = images.entry(reminder.event.id) {
            entry.insert(event_hero_image(reminder.source_image_url.as_deref()).await);
        }
    }
    images
}

/// The delivery key: the occurrence and the start it was reminded about.
fn target_id(reminder: &DueReminder) -> String {
    let start = reminder
        .event
        .dtstart_utc
        .map(python_isoformat)
        .unwrap_or_default();
    format!("{}:{start}", reminder.event_date_id)
}

/// The reminder email for one user and occurrence.
pub fn compose(
    user: &Recipient,
    reminder: &DueReminder,
    image: Option<Arc<InlineImage>>,
    link_settings: &LinkSettings,
) -> Result<EmailMessage> {
    let addressing = Addressing::new(user, NOTIFICATION_TYPE_EVENT_REMINDER, link_settings)?;
    let links = addressing.links();
    let tz = user.tz();
    let event = &reminder.event;
    let subject = rendering::event_reminder_subject(event);
    let image_src = match &image {
        Some(image) => Some(format!("cid:{}", image.content_id)),
        None => reminder.source_image_url.clone(),
    };
    Ok(EmailMessage {
        to: vec![user.email.clone()],
        body_html: rendering::render_event_reminder_html(
            &subject,
            event,
            image_src.as_deref(),
            tz,
            &links,
        ),
        body_text: rendering::render_event_reminder_text(&subject, event, tz, &links),
        subject,
        idempotency_key: Some(format!(
            "{NOTIFICATION_TYPE_EVENT_REMINDER}:{}:{}",
            user.id,
            target_id(reminder)
        )),
        headers: addressing.headers(),
        inline_images: std::iter::once(layout::LOGO.clone()).chain(image).collect(),
        sender: None,
        reply_to: None,
    })
}

/// Composed before claiming, so a rendering failure cannot strand a pending delivery.
async fn send(
    outbox: &Outbox,
    user: &Recipient,
    reminder: &DueReminder,
    image: Option<Arc<InlineImage>>,
    link_settings: &LinkSettings,
) -> Result<Outcome> {
    let message = compose(user, reminder, image, link_settings)?;
    let Some(row_id) = outbox
        .claim(
            user.id,
            NOTIFICATION_TYPE_EVENT_REMINDER,
            &target_id(reminder),
        )
        .await?
    else {
        return Ok(Outcome::Skipped);
    };
    let sent = outbox
        .deliver(
            row_id,
            &message,
            EVENT_REMINDER.provider_attempts,
            &format!(
                "notification=event_reminder user={} occurrence={}",
                user.id, reminder.event_date_id
            ),
        )
        .await?;
    Ok(if sent { Outcome::Sent } else { Outcome::Failed })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn the_window_centers_on_one_hour() {
        let now = Utc.with_ymd_and_hms(2026, 5, 1, 13, 0, 0).unwrap();
        assert_eq!(
            reminder_window(now),
            (now + Duration::minutes(45), now + Duration::minutes(65))
        );
    }

    #[test]
    fn the_reminder_email_links_the_school_site_and_embeds_the_poster() {
        let user = Recipient {
            id: Uuid::from_u128(1),
            email: "alice@uwaterloo.ca".to_owned(),
            school: Some(crate::schools::School {
                id: 1,
                slug: "uwaterloo".to_owned(),
                name: "University of Waterloo".to_owned(),
                timezone: "America/Toronto".to_owned(),
                semester_start: None,
                semester_end: None,
                recipient_id: None,
            }),
        };
        let reminder = DueReminder {
            user_id: user.id,
            event_date_id: Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
            event: Event {
                id: 42,
                title: "<Tea>".to_owned(),
                location: "SLC".to_owned(),
                dtstart_utc: Some(Utc.with_ymd_and_hms(2026, 5, 1, 15, 0, 0).unwrap()),
                dtend_utc: None,
            },
            source_image_url: Some("https://media.wat2do.io/poster.jpg".to_owned()),
        };
        let poster = Arc::new(InlineImage {
            content_id: "event-image".to_owned(),
            filename: "event-image.jpg".to_owned(),
            content_type: "image/jpeg".to_owned(),
            content: b"x".to_vec(),
        });
        let links = LinkSettings {
            frontend_url: "https://wat2do.io".to_owned(),
            unsubscribe_secret: "s".to_owned(),
        };
        let message = compose(&user, &reminder, Some(poster), &links).unwrap();
        assert_eq!(message.subject, "Starts in about 1 hour: <Tea>");
        assert_eq!(message.sender, None);
        assert!(message.body_html.contains("&lt;Tea&gt;"));
        assert!(
            message
                .body_html
                .contains("https://uwaterloo.wat2do.io/events/42")
        );
        assert!(message.body_html.contains(r#"<img src="cid:event-image""#));
        assert!(message.body_text.contains("- When: Fri, May 1, 11 AM"));
        assert!(message.body_text.contains("- Where: SLC"));
        assert_eq!(
            message.idempotency_key.as_deref(),
            Some(
                "event_reminder:00000000-0000-0000-0000-000000000001:\
                 22222222-2222-2222-2222-222222222222:2026-05-01T15:00:00+00:00"
            )
        );
        assert!(message.headers.contains(&(
            "List-Unsubscribe-Post".to_owned(),
            "List-Unsubscribe=One-Click".to_owned()
        )));
        let ids: Vec<&str> = message
            .inline_images
            .iter()
            .map(|image| image.content_id.as_str())
            .collect();
        assert_eq!(ids, ["wat2do-logo", "event-image"]);

        // Without an embedded poster the original is linked.
        let linked = compose(&user, &reminder, None, &links).unwrap();
        assert!(
            linked
                .body_html
                .contains(r#"<img src="https://media.wat2do.io/poster.jpg""#)
        );
        assert_eq!(linked.inline_images.len(), 1);
    }

    #[test]
    fn deliveries_are_keyed_by_occurrence_and_start() {
        let reminder = DueReminder {
            user_id: Uuid::nil(),
            event_date_id: Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
            event: Event {
                id: 42,
                dtstart_utc: Some(Utc.with_ymd_and_hms(2026, 5, 1, 15, 0, 0).unwrap()),
                ..Event::default()
            },
            source_image_url: None,
        };
        assert_eq!(
            target_id(&reminder),
            "22222222-2222-2222-2222-222222222222:2026-05-01T15:00:00+00:00"
        );
    }
}
