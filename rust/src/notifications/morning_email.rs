//! The morning email (`services/notifications/morning_email.py`).
//!
//! Every recipient at a school gets the same digest: each upcoming event and
//! active position added there in the last 24 hours, newest first, one card per
//! source post. GitHub skips many hourly scheduled runs, so anyone whose 9 AM
//! has passed today without an email gets it on the next run, until the last
//! send hour; the local date is the delivery key, so nobody gets two.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Duration, NaiveDate, Timelike, Utc};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use super::delivery_log::Outbox;
use super::email_images::email_image;
use super::rendering::{self, CardMedia, Event, EventCard, PositionCard};
use super::{Addressing, LinkSettings, Outcome, Recipient, Stats, load_recipients, preferences};
use crate::constants::{NOTIFICATION_STATUS_SENT, NOTIFICATION_TYPE_MORNING_EMAIL};
use crate::controlbox::{EMAIL_DELIVERY, MORNING_EMAIL};
use crate::email::{EmailMessage, InlineImage, layout};

/// One school's new events and positions, shared by every recipient there.
#[derive(Debug, Default)]
pub struct SchoolDigest {
    pub events: Vec<EventCard>,
    pub positions: Vec<PositionCard>,
    pub images: Vec<Arc<InlineImage>>,
}

impl SchoolDigest {
    fn is_empty(&self) -> bool {
        self.events.is_empty() && self.positions.is_empty()
    }
}

/// Compose each school's digest once, then send to each recipient independently.
pub async fn dispatch(outbox: &Outbox, now: DateTime<Utc>) -> Result<Stats> {
    let pool = outbox.pool();
    let mut users: Vec<Recipient> = load_recipients(pool, None)
        .await?
        .into_iter()
        .filter(|user| is_send_hour(user, now))
        .collect();
    if !users.is_empty() {
        let ids: Vec<Uuid> = users.iter().map(|user| user.id).collect();
        let enabled =
            preferences::enabled_user_ids(pool, &ids, NOTIFICATION_TYPE_MORNING_EMAIL).await?;
        users.retain(|user| enabled.contains(&user.id));
    }
    let users = without_todays_email(pool, users, now).await?;
    let mut stats = Stats {
        considered: users.len(),
        ..Stats::default()
    };
    if users.is_empty() {
        return Ok(stats);
    }

    let link_settings = LinkSettings::from_env()?;
    // Sorted by slug, like Python, so logs and downloads come in the same order.
    let schools: BTreeMap<&str, i32> = users
        .iter()
        .filter_map(|user| user.school.as_ref())
        .map(|school| (school.slug.as_str(), school.id))
        .collect();
    let mut digests = HashMap::new();
    for school_id in schools.values() {
        digests.insert(*school_id, load_school_digest(pool, *school_id, now).await?);
    }

    for user in &users {
        let Some(digest) = user
            .school
            .as_ref()
            .and_then(|school| digests.get(&school.id))
            .filter(|digest| !digest.is_empty())
        else {
            continue;
        };
        stats.prepared += 1;
        stats.record(send(outbox, user, digest, now, &link_settings).await?);
    }
    tracing::info!(
        "Morning email dispatch complete: {}",
        stats.describe("eligible")
    );
    Ok(stats)
}

/// From the send hour through the last send hour of the user's local day.
fn is_send_hour(user: &Recipient, now: DateTime<Utc>) -> bool {
    let hour = now.with_timezone(&user.tz()).hour();
    (MORNING_EMAIL.local_send_hour..=MORNING_EMAIL.last_local_send_hour).contains(&hour)
}

/// The delivery key: the user's local date.
fn local_date(user: &Recipient, now: DateTime<Utc>) -> String {
    now.with_timezone(&user.tz()).date_naive().to_string()
}

/// Drop users already sent today's email, before any digest is composed.
async fn without_todays_email(
    pool: &PgPool,
    users: Vec<Recipient>,
    now: DateTime<Utc>,
) -> Result<Vec<Recipient>> {
    if users.is_empty() {
        return Ok(users);
    }
    let ids: Vec<Uuid> = users.iter().map(|user| user.id).collect();
    let dates: Vec<String> = users
        .iter()
        .map(|user| local_date(user, now))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let sent: HashSet<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, target_id FROM public.notifications_log \
         WHERE notification_type = $1 AND status = $2 \
         AND user_id = ANY($3) AND target_id = ANY($4)",
    )
    .bind(NOTIFICATION_TYPE_MORNING_EMAIL)
    .bind(NOTIFICATION_STATUS_SENT)
    .bind(&ids)
    .bind(&dates)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    Ok(users
        .into_iter()
        .filter(|user| !sent.contains(&(user.id, local_date(user, now))))
        .collect())
}

/// A new event or position as loaded, before its images are embedded.
struct NewItem<T> {
    item: T,
    id: i64,
    source_url: Option<String>,
    source_image_url: Option<String>,
    club_name: Option<String>,
    club_logo_url: Option<String>,
}

async fn load_school_digest(
    pool: &PgPool,
    school_id: i32,
    now: DateTime<Utc>,
) -> Result<SchoolDigest> {
    let window_start = now - Duration::hours(MORNING_EMAIL.new_event_window_hours);
    let events = load_new_events(pool, school_id, window_start, now).await?;
    let positions = load_new_positions(pool, school_id, window_start, now).await?;
    Ok(embed_card_images(events, positions).await)
}

type EventRow = (
    i32,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
);

/// Uncancelled events added in the window that still have an occurrence ahead,
/// newest first, each carrying its earliest upcoming occurrence.
async fn load_new_events(
    pool: &PgPool,
    school_id: i32,
    window_start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Vec<NewItem<Event>>> {
    let rows: Vec<EventRow> = sqlx::query_as(
        "SELECT e.id, e.title, e.location, e.source_url, e.source_image_url, e.club, c.logo_url \
         FROM public.events e LEFT JOIN public.clubs c ON c.id = e.club_id \
         WHERE e.school_id = $1 AND NOT e.cancelled AND e.added_at > $2 AND e.added_at <= $3 \
         ORDER BY e.added_at DESC, e.id",
    )
    .bind(school_id)
    .bind(window_start)
    .bind(now)
    .fetch_all(pool)
    .await?;
    let ids: Vec<i32> = rows.iter().map(|row| row.0).collect();
    let earliest: HashMap<i32, (DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT DISTINCT ON (event_id) event_id, dtstart_utc, dtend_utc FROM public.event_dates \
         WHERE event_id = ANY($1) AND dtstart_utc >= $2 ORDER BY event_id, dtstart_utc",
    )
    .bind(&ids)
    .bind(now)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(
        |(event_id, start, end): (i32, DateTime<Utc>, Option<DateTime<Utc>>)| {
            (event_id, (start, end))
        },
    )
    .collect();
    let events = rows
        .into_iter()
        .filter_map(
            |(id, title, location, source_url, source_image_url, club, logo)| {
                let (start, end) = *earliest.get(&id)?;
                Some(NewItem {
                    item: Event {
                        id: i64::from(id),
                        title,
                        location,
                        dtstart_utc: Some(start),
                        dtend_utc: end,
                    },
                    id: i64::from(id),
                    source_url,
                    source_image_url,
                    club_name: Some(club),
                    club_logo_url: logo,
                })
            },
        )
        .collect();
    Ok(one_card_per_post(events))
}

type PositionRow = (
    i64,
    String,
    String,
    Option<String>,
    Option<DateTime<Utc>>,
    Option<NaiveDate>,
    Option<String>,
    Option<String>,
);

/// Active positions added in the window, newest first.
async fn load_new_positions(
    pool: &PgPool,
    school_id: i32,
    window_start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Vec<NewItem<PositionCard>>> {
    let rows: Vec<PositionRow> = sqlx::query_as(
        "SELECT p.id, p.title, p.source_url, p.source_image_url, p.deadline_at, p.deadline_date, \
         c.club_name, c.logo_url \
         FROM public.positions p LEFT JOIN public.clubs c ON c.id = p.club_id \
         WHERE p.school_id = $1 AND p.is_active AND p.added_at > $2 AND p.added_at <= $3 \
         ORDER BY p.added_at DESC, p.id",
    )
    .bind(school_id)
    .bind(window_start)
    .bind(now)
    .fetch_all(pool)
    .await?;
    let positions = rows
        .into_iter()
        .map(
            |(id, title, source_url, source_image_url, deadline_at, deadline_date, club, logo)| {
                NewItem {
                    item: PositionCard {
                        id,
                        title,
                        deadline_at,
                        deadline_date,
                        media: CardMedia::default(),
                    },
                    id,
                    source_url: Some(source_url),
                    source_image_url,
                    club_name: club,
                    club_logo_url: logo,
                }
            },
        )
        .collect();
    Ok(one_card_per_post(positions))
}

/// Keep only the first item (lowest id) from each source post, in the original
/// order: a carousel post can yield several events or positions.
fn one_card_per_post<T>(items: Vec<NewItem<T>>) -> Vec<NewItem<T>> {
    let mut first_by_post: HashMap<String, i64> = HashMap::new();
    for item in &items {
        if let Some(source) = item.source_url.as_deref().filter(|url| !url.is_empty()) {
            let first = first_by_post.entry(source.to_owned()).or_insert(item.id);
            *first = (*first).min(item.id);
        }
    }
    items
        .into_iter()
        .filter(|item| match item.source_url.as_deref() {
            Some(source) if !source.is_empty() => first_by_post[source] == item.id,
            _ => true,
        })
        .collect()
}

fn club_content_id(logo_url: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(logo_url.as_bytes()));
    format!("club-{}", &digest[..16])
}

/// One image to download and embed.
#[derive(Debug, PartialEq)]
struct ImageJob {
    url: Option<String>,
    content_id: String,
    width: u32,
}

/// Each card's poster, then each distinct club logo once, in that order.
fn image_jobs(
    events: &[NewItem<Event>],
    positions: &[NewItem<PositionCard>],
) -> (Vec<ImageJob>, Vec<String>) {
    let logo_urls: Vec<String> = events
        .iter()
        .map(|event| &event.club_logo_url)
        .chain(positions.iter().map(|position| &position.club_logo_url))
        .flatten()
        .filter(|url| !url.is_empty())
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let poster = |url: &Option<String>, content_id: String| ImageJob {
        url: url.clone(),
        content_id,
        width: MORNING_EMAIL.card_image_px,
    };
    let jobs = events
        .iter()
        .map(|event| poster(&event.source_image_url, format!("event-{}", event.id)))
        .chain(positions.iter().map(|position| {
            poster(
                &position.source_image_url,
                format!("position-{}", position.id),
            )
        }))
        .chain(logo_urls.iter().map(|url| ImageJob {
            url: Some(url.clone()),
            content_id: club_content_id(url),
            width: MORNING_EMAIL.club_logo_px,
        }))
        .collect();
    (jobs, logo_urls)
}

/// Embed every poster and club logo, linking the original wherever that fails.
/// A logo shared by several cards is embedded once.
async fn embed_card_images(
    events: Vec<NewItem<Event>>,
    positions: Vec<NewItem<PositionCard>>,
) -> SchoolDigest {
    let (jobs, logo_urls) = image_jobs(&events, &positions);
    let images = futures_util::stream::iter(jobs)
        .map(|job| async move {
            email_image(job.url.as_deref(), &job.content_id, job.width, true).await
        })
        .buffered(MORNING_EMAIL.image_download_concurrency)
        .collect()
        .await;
    assemble(&events, &positions, &logo_urls, images)
}

/// Point each card at its embedded images (`cid:`) or, where one could not be
/// embedded, at the original URL. `images` answers [`image_jobs`] in order.
fn assemble(
    events: &[NewItem<Event>],
    positions: &[NewItem<PositionCard>],
    logo_urls: &[String],
    images: Vec<Option<Arc<InlineImage>>>,
) -> SchoolDigest {
    let card_count = events.len() + positions.len();
    let logos: HashMap<&str, Option<&Arc<InlineImage>>> = logo_urls
        .iter()
        .map(String::as_str)
        .zip(images[card_count..].iter().map(Option::as_ref))
        .collect();
    let source = |image: Option<&Arc<InlineImage>>, url: &Option<String>| {
        image.map_or_else(
            || url.clone(),
            |image| Some(format!("cid:{}", image.content_id)),
        )
    };
    // (poster, poster URL, club name, logo URL) to what the card shows.
    let media = |poster: &Option<Arc<InlineImage>>,
                 image_url: &Option<String>,
                 club_name: &Option<String>,
                 logo_url: &Option<String>| {
        let logo = logo_url
            .as_deref()
            .and_then(|url| logos.get(url).copied().flatten());
        CardMedia {
            image_src: source(poster.as_ref(), image_url),
            club_name: club_name.clone(),
            club_logo_src: source(logo, logo_url),
        }
    };
    let (event_posters, position_posters) = images[..card_count].split_at(events.len());
    SchoolDigest {
        events: events
            .iter()
            .zip(event_posters)
            .map(|(event, poster)| EventCard {
                event: event.item.clone(),
                media: media(
                    poster,
                    &event.source_image_url,
                    &event.club_name,
                    &event.club_logo_url,
                ),
            })
            .collect(),
        positions: positions
            .iter()
            .zip(position_posters)
            .map(|(position, poster)| PositionCard {
                media: media(
                    poster,
                    &position.source_image_url,
                    &position.club_name,
                    &position.club_logo_url,
                ),
                ..position.item.clone()
            })
            .collect(),
        images: images.iter().flatten().cloned().collect(),
    }
}

/// The email for one recipient of a school's digest.
pub fn compose(
    user: &Recipient,
    digest: &SchoolDigest,
    now: DateTime<Utc>,
    link_settings: &LinkSettings,
) -> Result<EmailMessage> {
    let addressing = Addressing::new(user, NOTIFICATION_TYPE_MORNING_EMAIL, link_settings)?;
    let links = addressing.links();
    let tz = user.tz();
    let subject = rendering::morning_email_subject(digest.events.len(), digest.positions.len());
    Ok(EmailMessage {
        to: vec![user.email.clone()],
        body_html: rendering::render_morning_email_html(
            &subject,
            &digest.events,
            &digest.positions,
            tz,
            &links,
        ),
        body_text: rendering::render_morning_email_text(
            &subject,
            &digest.events,
            &digest.positions,
            tz,
            &links,
        ),
        subject,
        // The digest comes from the team inbox, not the newsletter address.
        sender: Some(EMAIL_DELIVERY.team_sender.clone()),
        idempotency_key: Some(format!(
            "{NOTIFICATION_TYPE_MORNING_EMAIL}:{}:{}",
            user.id,
            local_date(user, now)
        )),
        headers: addressing.headers(),
        inline_images: std::iter::once(layout::LOGO.clone())
            .chain(digest.images.iter().cloned())
            .collect(),
        reply_to: None,
    })
}

/// Composed before claiming, so a rendering failure cannot strand a pending delivery.
async fn send(
    outbox: &Outbox,
    user: &Recipient,
    digest: &SchoolDigest,
    now: DateTime<Utc>,
    link_settings: &LinkSettings,
) -> Result<Outcome> {
    let message = compose(user, digest, now, link_settings)?;
    let Some(row_id) = outbox
        .claim(
            user.id,
            NOTIFICATION_TYPE_MORNING_EMAIL,
            &local_date(user, now),
        )
        .await?
    else {
        return Ok(Outcome::Skipped);
    };
    let sent = outbox
        .deliver(
            row_id,
            &message,
            MORNING_EMAIL.provider_attempts,
            &format!("notification=morning_email user={}", user.id),
        )
        .await?;
    Ok(if sent { Outcome::Sent } else { Outcome::Failed })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::schools::School;

    fn user(id: u128, timezone: Option<&str>) -> Recipient {
        Recipient {
            id: Uuid::from_u128(id),
            email: "alice@uwaterloo.ca".to_owned(),
            school: timezone.map(|timezone| School {
                id: 1,
                slug: "uwaterloo".to_owned(),
                name: "University of Waterloo".to_owned(),
                timezone: timezone.to_owned(),
                semester_start: None,
                semester_end: None,
            }),
        }
    }

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn eligibility_tracks_eastern_daylight_saving_and_delayed_starts() {
        let toronto = user(1, Some("America/Toronto"));
        assert!(is_send_hour(&toronto, at(2026, 1, 15, 14, 0)));
        assert!(is_send_hour(&toronto, at(2026, 7, 15, 13, 59)));
        assert!(!is_send_hour(&toronto, at(2026, 7, 15, 12, 59)));
        // Daylight saving ended on 2026-11-01: 13:30 UTC was 9:30 the day
        // before and 8:30 that morning.
        assert!(is_send_hour(&toronto, at(2026, 10, 31, 13, 30)));
        assert!(!is_send_hour(&toronto, at(2026, 11, 1, 13, 30)));
        assert!(is_send_hour(&toronto, at(2026, 11, 1, 14, 17)));
    }

    #[test]
    fn eligibility_catches_up_after_skipped_scheduled_runs() {
        let toronto = user(1, Some("America/Toronto"));
        // 10:59 AM and 8:30 PM Eastern: the 9 AM run never came.
        assert!(is_send_hour(&toronto, at(2026, 10, 26, 14, 59)));
        assert!(is_send_hour(&toronto, at(2026, 10, 27, 0, 30)));
        assert_eq!(local_date(&toronto, at(2026, 10, 27, 0, 30)), "2026-10-26");
        // 9:05 PM Eastern is past the last send hour.
        assert!(!is_send_hour(&toronto, at(2026, 10, 27, 1, 5)));
    }

    #[test]
    fn each_school_reads_its_own_clock() {
        let now = at(2026, 11, 2, 12, 45);
        // 9:15 AM in St. John's (UTC-3:30) and 8:45 AM in Halifax (UTC-4).
        assert!(is_send_hour(&user(1, Some("America/St_Johns")), now));
        assert!(!is_send_hour(&user(1, Some("America/Halifax")), now));
        // Regina keeps standard time all year.
        assert!(is_send_hour(
            &user(1, Some("America/Regina")),
            at(2026, 7, 1, 15, 0)
        ));
        // No school: UTC.
        let nowhere = user(1, None);
        assert!(is_send_hour(&nowhere, at(2026, 11, 2, 9, 0)));
        assert!(!is_send_hour(&nowhere, at(2026, 11, 2, 21, 0)));
    }

    fn item(id: i64, source_url: Option<&str>) -> NewItem<()> {
        NewItem {
            item: (),
            id,
            source_url: source_url.map(str::to_owned),
            source_image_url: None,
            club_name: None,
            club_logo_url: None,
        }
    }

    #[test]
    fn the_digest_keeps_one_card_per_post() {
        let post = "https://www.instagram.com/p/ABC/";
        let items = vec![
            item(9, Some(post)),
            item(4, Some("https://www.instagram.com/p/XYZ/")),
            item(3, Some(post)),
            item(5, None),
            item(6, Some("")),
        ];
        let kept: Vec<i64> = one_card_per_post(items)
            .iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(kept, [4, 3, 5, 6]);
    }

    #[test]
    fn club_logo_content_ids_hash_the_url() {
        // "club-" + hashlib.sha256(url.encode()).hexdigest()[:16]
        assert_eq!(
            club_content_id("https://wat2do.io/media/club.png"),
            "club-5e5ab40f36ff1c93"
        );
    }

    fn links(secret: &str) -> LinkSettings {
        LinkSettings {
            frontend_url: "https://wat2do.io".to_owned(),
            unsubscribe_secret: secret.to_owned(),
        }
    }

    fn digest() -> SchoolDigest {
        let poster = Arc::new(InlineImage {
            content_id: "event-42".to_owned(),
            filename: "event-42.jpg".to_owned(),
            content_type: "image/jpeg".to_owned(),
            content: b"x".to_vec(),
        });
        SchoolDigest {
            events: vec![EventCard {
                event: Event {
                    id: 42,
                    title: "Tea Tasting".to_owned(),
                    location: "SLC".to_owned(),
                    dtstart_utc: Some(at(2026, 5, 1, 15, 0)),
                    dtend_utc: None,
                },
                media: CardMedia {
                    image_src: Some("cid:event-42".to_owned()),
                    ..CardMedia::default()
                },
            }],
            positions: vec![PositionCard {
                id: 7,
                title: "VP Events".to_owned(),
                ..PositionCard::default()
            }],
            images: vec![poster],
        }
    }

    #[test]
    fn the_email_comes_from_the_team_inbox_with_unsubscribe_headers_and_cards() {
        let user = user(1, Some("America/Toronto"));
        let message = compose(&user, &digest(), at(2026, 5, 1, 13, 0), &links("s")).unwrap();
        assert_eq!(message.sender.as_deref(), Some("wat2do <team@wat2do.io>"));
        assert_eq!(message.to, ["alice@uwaterloo.ca"]);
        assert_eq!(message.subject, "1 new event and 1 new position");
        assert_eq!(
            message.idempotency_key.as_deref(),
            Some("morning_email:00000000-0000-0000-0000-000000000001:2026-05-01")
        );
        let headers: HashMap<_, _> = message.headers.iter().cloned().collect();
        assert!(headers["List-Unsubscribe"].starts_with(
            "<https://uwaterloo.wat2do.io/api/notification-preferences/unsubscribe?token="
        ));
        assert_eq!(
            headers["List-Unsubscribe-Post"],
            "List-Unsubscribe=One-Click"
        );
        assert!(
            message
                .body_html
                .contains("https://uwaterloo.wat2do.io/events/42")
        );
        assert!(message.body_text.contains("New positions"));
        assert!(
            message
                .body_text
                .contains("https://uwaterloo.wat2do.io/settings?tab=notifications")
        );
        let ids: Vec<&str> = message
            .inline_images
            .iter()
            .map(|image| image.content_id.as_str())
            .collect();
        assert_eq!(ids, ["wat2do-logo", "event-42"]);
    }

    #[test]
    fn a_missing_unsubscribe_secret_fails_before_anything_is_claimed() {
        let error =
            compose(&user(1, None), &digest(), at(2026, 5, 1, 13, 0), &links("")).unwrap_err();
        assert!(error.to_string().contains("EMAIL_UNSUBSCRIBE_SECRET"));
    }

    fn new_item<T: Default>(id: i64, image: Option<&str>, logo: Option<&str>) -> NewItem<T> {
        NewItem {
            item: T::default(),
            id,
            source_url: None,
            source_image_url: image.map(str::to_owned),
            club_name: None,
            club_logo_url: logo.map(str::to_owned),
        }
    }

    fn embedded(content_id: &str) -> Option<Arc<InlineImage>> {
        Some(Arc::new(InlineImage {
            content_id: content_id.to_owned(),
            filename: format!("{content_id}.jpg"),
            content_type: "image/jpeg".to_owned(),
            content: b"x".to_vec(),
        }))
    }

    #[test]
    fn card_images_embed_posters_and_each_club_logo_once() {
        let logo = "https://wat2do.io/media/club.png";
        let events: Vec<NewItem<Event>> = vec![
            new_item(1, Some("https://wat2do.io/media/ok.jpg"), Some(logo)),
            new_item(2, Some("https://wat2do.io/media/broken.jpg"), Some(logo)),
        ];
        let positions: Vec<NewItem<PositionCard>> = vec![new_item(7, None, None)];

        let (jobs, logo_urls) = image_jobs(&events, &positions);
        let requested: Vec<(Option<&str>, &str, u32)> = jobs
            .iter()
            .map(|job| (job.url.as_deref(), job.content_id.as_str(), job.width))
            .collect();
        assert_eq!(
            requested,
            [
                (Some("https://wat2do.io/media/ok.jpg"), "event-1", 480),
                (Some("https://wat2do.io/media/broken.jpg"), "event-2", 480),
                (None, "position-7", 480),
                (Some(logo), "club-5e5ab40f36ff1c93", 64),
            ]
        );

        // The broken poster and the missing one could not be embedded.
        let images = vec![
            embedded("event-1"),
            None,
            None,
            embedded("club-5e5ab40f36ff1c93"),
        ];
        let digest = assemble(&events, &positions, &logo_urls, images);

        let ids: Vec<&str> = digest
            .images
            .iter()
            .map(|image| image.content_id.as_str())
            .collect();
        assert_eq!(ids, ["event-1", "club-5e5ab40f36ff1c93"]);
        let sources: Vec<Option<&str>> = digest
            .events
            .iter()
            .map(|card| &card.media)
            .chain(digest.positions.iter().map(|card| &card.media))
            .map(|media| media.image_src.as_deref())
            .collect();
        assert_eq!(
            sources,
            [
                Some("cid:event-1"),
                Some("https://wat2do.io/media/broken.jpg"),
                None
            ]
        );
        assert_eq!(
            digest.events[0].media.club_logo_src.as_deref(),
            Some("cid:club-5e5ab40f36ff1c93")
        );
        assert_eq!(
            digest.events[1].media.club_logo_src,
            digest.events[0].media.club_logo_src
        );
        assert_eq!(digest.positions[0].media.club_logo_src, None);

        // A logo that could not be embedded is linked.
        let digest = assemble(
            &events,
            &positions,
            &logo_urls,
            vec![None, None, None, None],
        );
        assert_eq!(digest.events[0].media.club_logo_src.as_deref(), Some(logo));
        assert!(digest.images.is_empty());
    }

    #[tokio::test]
    async fn cards_without_images_link_nothing_and_keep_their_club() {
        let event = NewItem {
            item: Event {
                id: 1,
                ..Event::default()
            },
            id: 1,
            source_url: None,
            source_image_url: None,
            club_name: Some("Esports".to_owned()),
            club_logo_url: None,
        };
        let digest = embed_card_images(vec![event], Vec::new()).await;
        assert!(digest.images.is_empty());
        let media = &digest.events[0].media;
        assert_eq!(
            (media.image_src.as_deref(), media.club_logo_src.as_deref()),
            (None, None)
        );
        assert_eq!(media.club_name.as_deref(), Some("Esports"));
    }
}
