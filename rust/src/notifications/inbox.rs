//! The notification inbox under the top bar's bell (`public.user_notifications`).
//!
//! Every notification email a user is sent also leaves one notification here,
//! recorded where that email is sent: the morning email and event reminders
//! (through [`super::delivery_log::Outbox::add_to_inbox`]), event change alerts
//! (Python's `services/notifications/inbox.py`), ticket emails, review decisions
//! and club invitations. Login codes are not notifications.
//!
//! A notification keeps only what its words need (an event's title, how many tickets);
//! the site writes them in the reader's language from its kind and details.
//! Writing one also drops the user's notifications older than
//! `controlbox/notification_inbox.json` `retention_days`, and reads never
//! show older ones either.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::constants::{
    INBOX_KIND_EVENT_CANCELLED, NOTIFICATION_TYPE_EVENT_CHANGE, NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
};
use crate::controlbox::NOTIFICATION_INBOX;
use crate::db::read_with_retry;

/// The email a notification repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    MorningEmail,
    EventReminder,
    EventChange,
    EventCancelled,
    Tickets,
    TicketRefunded,
    RefundRequested,
    RefundDeclined,
    ReviewDecision,
    ClubInvitation,
}

impl NotificationKind {
    const ALL: [Self; 10] = [
        Self::MorningEmail,
        Self::EventReminder,
        Self::EventChange,
        Self::EventCancelled,
        Self::Tickets,
        Self::TicketRefunded,
        Self::RefundRequested,
        Self::RefundDeclined,
        Self::ReviewDecision,
        Self::ClubInvitation,
    ];

    /// The stored kind (`user_notifications_kind_check`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MorningEmail => NOTIFICATION_TYPE_MORNING_EMAIL,
            Self::EventReminder => NOTIFICATION_TYPE_EVENT_REMINDER,
            Self::EventChange => NOTIFICATION_TYPE_EVENT_CHANGE,
            Self::EventCancelled => INBOX_KIND_EVENT_CANCELLED,
            Self::Tickets => "tickets",
            Self::TicketRefunded => "ticket_refunded",
            Self::RefundRequested => "refund_requested",
            Self::RefundDeclined => "refund_declined",
            Self::ReviewDecision => "review_decision",
            Self::ClubInvitation => "club_invitation",
        }
    }

    fn parse(stored: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == stored)
    }
}

/// What a notification's words need; each kind fills only its own.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NotificationDetails {
    /// The event's title, or the club's name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// How many tickets the email held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tickets: Option<i64>,
    /// What a review decided on: `club`, `claim`, `event` or `position`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed: Option<String>,
    /// Whether that review approved it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved: Option<bool>,
}

/// One notification to record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub kind: NotificationKind,
    pub event_id: Option<i64>,
    pub details: NotificationDetails,
    /// The exact page it is about, on the right school's site: the event, the
    /// ticket or order, the club panel's ticket desk, the published listing, or
    /// the morning email's new events (`rendering::new_events_url`).
    pub link: Option<String>,
}

impl Notice {
    /// A notification about one event, named by its title.
    pub fn about_event(kind: NotificationKind, event_id: i64, title: &str, link: String) -> Self {
        Self {
            kind,
            event_id: Some(event_id),
            details: NotificationDetails {
                name: Some(title.to_owned()),
                ..NotificationDetails::default()
            },
            link: Some(link),
        }
    }
}

/// `events.id` is a Postgres integer; an id beyond it names no event.
fn event_column(event_id: Option<i64>) -> Option<i32> {
    event_id.and_then(|id| i32::try_from(id).ok())
}

/// Add `notice` to the user's inbox.
pub async fn record(db: &PgPool, user_id: Uuid, notice: &Notice) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT public.record_user_notification($1, $2, $3, $4, $5, $6)")
        .bind(user_id)
        .bind(notice.kind.as_str())
        .bind(event_column(notice.event_id))
        .bind(Json(&notice.details))
        .bind(notice.link.as_deref())
        .bind(NOTIFICATION_INBOX.retention_days)
        .execute(db)
        .await?;
    Ok(())
}

/// Add `notice` to the inbox of the user signed up with `email`, if there is one.
pub async fn record_for_email(
    db: &PgPool,
    email: &str,
    notice: &Notice,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT public.record_user_notification_for_email($1, $2, $3, $4, $5, $6)")
        .bind(email)
        .bind(notice.kind.as_str())
        .bind(event_column(notice.event_id))
        .bind(Json(&notice.details))
        .bind(notice.link.as_deref())
        .bind(NOTIFICATION_INBOX.retention_days)
        .execute(db)
        .await?;
    Ok(())
}

/// [`record_for_email`] for each address, logging (never raising) a failure,
/// so an inbox can never stop the email it repeats.
pub async fn record_for_emails(db: &PgPool, emails: &[String], notice: &Notice) {
    for email in emails {
        if let Err(error) = record_for_email(db, email, notice).await {
            tracing::warn!(
                "Could not add a {} notification to an inbox: {error}",
                notice.kind.as_str()
            );
        }
    }
}

/// One notification in a user's inbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub id: Uuid,
    pub kind: NotificationKind,
    pub details: NotificationDetails,
    /// Where it leads, as stored when it was recorded.
    pub link: Option<String>,
    pub created_at: DateTime<Utc>,
    pub read: bool,
}

/// A user's newest notifications, and how many of those are still unread:
/// the count only ever names notifications the list shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inbox {
    pub unread_count: i64,
    pub notifications: Vec<Notification>,
}

type InboxRow = (
    Uuid,
    String,
    Json<NotificationDetails>,
    Option<String>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
);

/// The user's inbox: at most `page_size` notifications, newest first, kept
/// within `retention_days`.
pub async fn inbox(db: &PgPool, user_id: Uuid) -> Result<Inbox, sqlx::Error> {
    let rows: Vec<InboxRow> = read_with_retry(|| {
        sqlx::query_as(
            "SELECT id, kind, details, link, created_at, read_at \
             FROM public.user_notifications \
             WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2) \
             ORDER BY created_at DESC, id \
             LIMIT $3",
        )
        .bind(user_id)
        .bind(NOTIFICATION_INBOX.retention_days)
        .bind(NOTIFICATION_INBOX.page_size)
        .fetch_all(db)
    })
    .await?;
    let notifications = rows
        .into_iter()
        .filter_map(|(id, kind, details, link, created_at, read_at)| {
            Some(Notification {
                id,
                kind: NotificationKind::parse(&kind)?,
                details: details.0,
                link,
                created_at,
                read: read_at.is_some(),
            })
        })
        .collect::<Vec<_>>();
    let unread_count = notifications
        .iter()
        .filter(|notification| !notification.read)
        .count();
    Ok(Inbox {
        unread_count: i64::try_from(unread_count).unwrap_or(i64::MAX),
        notifications,
    })
}

/// Mark read the user's notifications among `ids`, the ones their list showed,
/// so one that arrived after the list was read stays unread.
pub async fn mark_read(db: &PgPool, user_id: Uuid, ids: &[Uuid]) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE public.user_notifications SET read_at = now() \
         WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL",
    )
    .bind(user_id)
    .bind(ids)
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_reads_back_as_itself() {
        for kind in NotificationKind::ALL {
            assert_eq!(NotificationKind::parse(kind.as_str()), Some(kind));
            assert_eq!(
                serde_json::to_value(kind).unwrap(),
                serde_json::Value::String(kind.as_str().to_owned()),
                "the API names each kind as it is stored"
            );
        }
        assert_eq!(NotificationKind::parse("login_code"), None);
    }

    #[test]
    fn details_keep_only_what_a_kind_filled() {
        let notice = Notice::about_event(
            NotificationKind::EventReminder,
            42,
            "Tea Tasting",
            "https://uwaterloo.wat2do.io/events/42".to_owned(),
        );
        assert_eq!(
            serde_json::to_value(&notice.details).unwrap(),
            serde_json::json!({"name": "Tea Tasting"})
        );
        assert_eq!(event_column(Some(42)), Some(42));
        assert_eq!(event_column(Some(i64::MAX)), None);
    }
}

/// The inbox against a real Postgres loaded with our schema; it runs only when
/// `WAT2DO_TEST_DATABASE_URL` is set (CI's "Rust database tests" job).
#[cfg(test)]
mod database_tests {
    use super::*;
    use crate::api::test_database::database;

    async fn reader(db: &PgPool) -> (Uuid, String) {
        let id = Uuid::new_v4();
        let email = format!("inbox-{}@example.com", id.simple());
        sqlx::query(
            "INSERT INTO public.users (id, email, auth_id, full_name) VALUES ($1, $2, $3, 'Reader')",
        )
        .bind(id)
        .bind(&email)
        .bind(id.to_string())
        .execute(db)
        .await
        .unwrap();
        (id, email)
    }

    fn morning() -> Notice {
        Notice {
            kind: NotificationKind::MorningEmail,
            event_id: None,
            details: NotificationDetails::default(),
            link: Some("https://uwaterloo.wat2do.io/events".to_owned()),
        }
    }

    fn invitation(club: &str) -> Notice {
        Notice {
            kind: NotificationKind::ClubInvitation,
            event_id: None,
            details: NotificationDetails {
                name: Some(club.to_owned()),
                ..NotificationDetails::default()
            },
            link: Some("https://uwaterloo.wat2do.io/invite/token".to_owned()),
        }
    }

    #[tokio::test]
    async fn notifications_arrive_newest_first_and_are_read_together() {
        let Some(db) = database() else { return };
        let (id, email) = reader(&db).await;
        record(&db, id, &morning()).await.unwrap();
        // Sent to an address in any case, the notification finds its user.
        record_for_email(&db, &email.to_uppercase(), &invitation("Chess Club"))
            .await
            .unwrap();
        // An address nobody signed up with keeps nothing.
        record_for_email(&db, "nobody-at-all@example.com", &invitation("Go Club"))
            .await
            .unwrap();

        let unread = inbox(&db, id).await.unwrap();
        assert_eq!(unread.unread_count, 2);
        let kinds: Vec<NotificationKind> = unread
            .notifications
            .iter()
            .map(|notification| notification.kind)
            .collect();
        assert_eq!(
            kinds,
            [
                NotificationKind::ClubInvitation,
                NotificationKind::MorningEmail
            ]
        );
        assert_eq!(
            unread.notifications[0].details.name.as_deref(),
            Some("Chess Club")
        );
        assert!(
            unread
                .notifications
                .iter()
                .all(|notification| !notification.read)
        );

        // Only what the list showed is read: one that arrived since stays unread.
        let shown: Vec<Uuid> = unread
            .notifications
            .iter()
            .map(|notification| notification.id)
            .collect();
        record(&db, id, &morning()).await.unwrap();
        mark_read(&db, id, &shown).await.unwrap();
        let read = inbox(&db, id).await.unwrap();
        assert_eq!(read.unread_count, 1);
        assert_eq!(read.notifications.len(), 3);
        assert!(
            !read.notifications[0].read,
            "the newest arrived after the list"
        );
        assert!(
            read.notifications[1..]
                .iter()
                .all(|notification| notification.read)
        );
        // Nobody marks another user's notifications read.
        let (stranger, _) = reader(&db).await;
        mark_read(&db, stranger, &[read.notifications[0].id])
            .await
            .unwrap();
        assert_eq!(inbox(&db, id).await.unwrap().unread_count, 1);
    }

    #[tokio::test]
    async fn a_new_notification_drops_the_ones_past_retention() {
        let Some(db) = database() else { return };
        let (id, _) = reader(&db).await;
        record(&db, id, &morning()).await.unwrap();
        sqlx::query(
            "UPDATE public.user_notifications SET created_at = now() - make_interval(days => $2 + 1) \
             WHERE user_id = $1",
        )
        .bind(id)
        .bind(NOTIFICATION_INBOX.retention_days)
        .execute(&db)
        .await
        .unwrap();
        // Past retention, it is no longer shown, and the next write removes it.
        assert!(inbox(&db, id).await.unwrap().notifications.is_empty());
        record(&db, id, &morning()).await.unwrap();
        let kept: i64 =
            sqlx::query_scalar("SELECT count(*) FROM public.user_notifications WHERE user_id = $1")
                .bind(id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(kept, 1);
    }
}
