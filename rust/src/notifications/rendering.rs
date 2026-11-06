//! HTML and plain-text bodies of the scheduled emails
//! (`services/notifications/rendering.py`). Pure functions: the same inputs
//! give the same bytes Python rendered.

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

use crate::email::layout::{
    self, BORDER, FONT, FOREGROUND, MUTED_FOREGROUND, SURFACE_ELEVATED, escape,
};

/// One event as an email shows it.
#[derive(Debug, Clone, Default)]
pub struct Event {
    pub id: i64,
    pub title: String,
    pub location: String,
    pub dtstart_utc: Option<DateTime<Utc>>,
    pub dtend_utc: Option<DateTime<Utc>>,
}

/// What a digest card shows besides its item: the poster and the posting club.
/// `image_src` and `club_logo_src` are embedded `cid:` images or the original URLs.
#[derive(Debug, Clone, Default)]
pub struct CardMedia {
    pub image_src: Option<String>,
    pub club_name: Option<String>,
    pub club_logo_src: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct EventCard {
    pub event: Event,
    pub media: CardMedia,
}

#[derive(Debug, Clone, Default)]
pub struct PositionCard {
    pub id: i64,
    pub title: String,
    pub deadline_at: Option<DateTime<Utc>>,
    pub deadline_date: Option<NaiveDate>,
    pub media: CardMedia,
}

/// Where the email's links go.
pub struct Links<'a> {
    pub frontend_url: &'a str,
    pub preferences_url: &'a str,
    pub unsubscribe_url: &'a str,
}

const FOOTER: &str = "wat2do helps students discover campus events.";
// Half the shell's 640px content width, less a little so two cards always fit a row.
const GRID_CARD_MAX_WIDTH_PX: u32 = 318;
const GRID_GUTTER_PX: u32 = 16;
const REMINDER_INTRO: &str = "You're going to this event. It starts in about an hour.";

fn or<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.is_empty() { fallback } else { value }
}

pub fn morning_email_subject(event_count: usize, position_count: usize) -> String {
    [(event_count, "event"), (position_count, "position")]
        .into_iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, noun)| {
            let plural = if count == 1 { "" } else { "s" };
            format!("{count} new {noun}{plural}")
        })
        .collect::<Vec<_>>()
        .join(" and ")
}

pub fn render_morning_email_text(
    subject: &str,
    events: &[EventCard],
    positions: &[PositionCard],
    tz: Tz,
    links: &Links,
) -> String {
    let mut lines = vec![subject.to_owned(), String::new()];
    if !events.is_empty() {
        lines.extend(["New events".to_owned(), String::new()]);
        lines.extend(events.iter().map(|card| {
            let event = &card.event;
            let (date, time) = format_event_date_time(event.dtstart_utc, tz);
            format!(
                "- {} | {date} {time} | {} | {}",
                or(&event.title, "Untitled event"),
                or(&event.location, "Location TBA"),
                event_url(event.id, links.frontend_url)
            )
        }));
        lines.push(String::new());
    }
    if !positions.is_empty() {
        lines.extend(["New positions".to_owned(), String::new()]);
        lines.extend(positions.iter().map(|position| {
            let deadline = format_position_deadline(position, tz).map_or_else(
                || "No deadline listed".to_owned(),
                |day| format!("Apply by {day}"),
            );
            format!(
                "- {} | {deadline} | {}/positions",
                or(&position.title, "Untitled position"),
                links.frontend_url
            )
        }));
        lines.push(String::new());
    }
    lines.extend([
        format!("Manage email preferences: {}", links.preferences_url),
        format!(
            "Unsubscribe from the morning email: {}",
            links.unsubscribe_url
        ),
        String::new(),
        FOOTER.to_owned(),
    ]);
    lines.join("\n")
}

/// Cards in two columns, like the app's event grid.
pub fn render_morning_email_html(
    subject: &str,
    events: &[EventCard],
    positions: &[PositionCard],
    tz: Tz,
    links: &Links,
) -> String {
    let mut content = String::new();
    if !events.is_empty() {
        let cards: Vec<String> = events
            .iter()
            .map(|card| {
                let event = &card.event;
                let (date, time) = format_event_date_time(event.dtstart_utc, tz);
                grid_card(
                    &event_url(event.id, links.frontend_url),
                    &card.media,
                    or(&event.title, "Untitled event"),
                    &[
                        format!("{date} \u{b7} {time}"),
                        or(&event.location, "Location TBA").to_owned(),
                    ],
                )
            })
            .collect();
        content += &grid_section("New events", &cards);
    }
    if !positions.is_empty() {
        let cards: Vec<String> = positions
            .iter()
            .map(|position| {
                let details: Vec<String> = format_position_deadline(position, tz)
                    .map(|day| format!("Apply by {day}"))
                    .into_iter()
                    .collect();
                grid_card(
                    &format!("{}/positions", links.frontend_url),
                    &position.media,
                    or(&position.title, "Untitled position"),
                    &details,
                )
            })
            .collect();
        content += &grid_section("New positions", &cards);
    }
    layout::shell(subject, &content, &footer_links(links))
}

pub fn event_reminder_subject(event: &Event) -> String {
    format!("Starts in about 1 hour: {}", or(&event.title, "Your event"))
}

pub fn render_event_reminder_text(subject: &str, event: &Event, tz: Tz, links: &Links) -> String {
    let (day, times) = local_occurrence(event, tz);
    [
        subject.to_owned(),
        String::new(),
        REMINDER_INTRO.to_owned(),
        String::new(),
        format!("- When: {day}, {times}"),
        format!("- Where: {}", or(&event.location, "Location TBA")),
        String::new(),
        format!(
            "View the event: {}",
            event_url(event.id, links.frontend_url)
        ),
        String::new(),
        format!("Manage email preferences: {}", links.preferences_url),
        format!(
            "Unsubscribe from event reminders: {}",
            links.unsubscribe_url
        ),
        String::new(),
        FOOTER.to_owned(),
    ]
    .join("\n")
}

pub fn render_event_reminder_html(
    subject: &str,
    event: &Event,
    image_src: Option<&str>,
    tz: Tz,
    links: &Links,
) -> String {
    let (day, times) = local_occurrence(event, tz);
    let content = event_spotlight(
        REMINDER_INTRO,
        event,
        image_src,
        links.frontend_url,
        &[
            ("When", format!("{day}, {times}")),
            ("Where", or(&event.location, "Location TBA").to_owned()),
        ],
    );
    layout::shell(subject, &content, &footer_links(links))
}

fn footer_links<'a>(links: &Links<'a>) -> [(&'a str, &'a str); 2] {
    [
        ("Manage email preferences", links.preferences_url),
        ("Unsubscribe", links.unsubscribe_url),
    ]
}

fn event_url(id: i64, frontend_url: &str) -> String {
    format!("{frontend_url}/events/{id}")
}

/// Two cards per row that wrap to one column on screens too narrow for two.
///
/// Each card is an inline block capped at half the shell's width, so phones stack
/// them without media queries, which many email apps ignore. Every card keeps its
/// gutter on the right, so stacked cards stay aligned with the heading.
fn grid_section(title: &str, cards: &[String]) -> String {
    let blocks: String = cards
        .iter()
        .map(|card| {
            format!(
                concat!(
                    r#"<div style="display:inline-block;box-sizing:border-box;width:100%;"#,
                    "max-width:{max_width}px;padding:0 {gutter}px 20px 0;",
                    r#"vertical-align:top;text-align:left;font:15px/1.35 {font};">{card}</div>"#,
                ),
                max_width = GRID_CARD_MAX_WIDTH_PX,
                gutter = GRID_GUTTER_PX,
                font = FONT,
                card = card,
            )
        })
        .collect();
    format!(
        concat!(
            r#"<h2 style="margin:24px 0 12px;color:{fg};font:700 19px {font};">{title}</h2>"#,
            r#"<div style="font-size:0;line-height:0;">{blocks}</div>"#,
        ),
        fg = FOREGROUND,
        font = FONT,
        title = escape(title),
        blocks = blocks,
    )
}

fn grid_card(href: &str, media: &CardMedia, title: &str, details: &[String]) -> String {
    let image = match &media.image_src {
        Some(src) if !src.is_empty() => format!(
            r#"<img src="{}" alt="" width="288" style="display:block;width:100%;height:auto;border:0;border-radius:12px;">"#,
            escape(src)
        ),
        _ => format!(
            r#"<div class="w2d-elevated" style="padding:56px 12px;background:{SURFACE_ELEVATED};border-radius:12px;color:{FOREGROUND};text-align:center;font:600 15px/1.3 {FONT};">{}</div>"#,
            escape(title)
        ),
    };
    let detail_lines: String = details
        .iter()
        .map(|detail| {
            format!(
                r#"<br><span style="color:{MUTED_FOREGROUND};font:13px/1.5 {FONT};">{}</span>"#,
                escape(detail)
            )
        })
        .collect();
    format!(
        concat!(
            r#"<a href="{href}" style="display:block;color:{fg};text-decoration:none;">{image}{club}"#,
            r#"<div style="padding:6px 2px 0;"><strong style="font:700 15px/1.35 {font};">{title}</strong>{details}</div></a>"#,
        ),
        href = escape(href),
        fg = FOREGROUND,
        image = image,
        club = club_line(media),
        font = FONT,
        title = escape(title),
        details = detail_lines,
    )
}

/// The posting club's round profile picture and name, under the card's poster.
fn club_line(media: &CardMedia) -> String {
    let Some(club_name) = media.club_name.as_deref().filter(|name| !name.is_empty()) else {
        return String::new();
    };
    let logo = match media.club_logo_src.as_deref().filter(|src| !src.is_empty()) {
        Some(src) => format!(
            concat!(
                r#"<td width="20" valign="middle" style="width:20px;padding:0 6px 0 0;">"#,
                r#"<img src="{}" alt="" width="20" height="20" "#,
                r#"style="display:block;width:20px;height:20px;border:0;border-radius:10px;"></td>"#,
            ),
            escape(src)
        ),
        None => String::new(),
    };
    format!(
        concat!(
            r#"<table role="presentation" cellpadding="0" cellspacing="0" "#,
            r#"style="border-collapse:collapse;margin:10px 2px 0;"><tr>"#,
            r#"{logo}<td valign="middle" style="color:{muted};font:600 13px/1.3 {font};">{name}</td></tr></table>"#,
        ),
        logo = logo,
        muted = MUTED_FOREGROUND,
        font = FONT,
        name = escape(club_name),
    )
}

/// One event's poster, title, detail rows and link: the body of single-event emails.
fn event_spotlight(
    intro: &str,
    event: &Event,
    image_src: Option<&str>,
    frontend_url: &str,
    rows: &[(&str, String)],
) -> String {
    let url = event_url(event.id, frontend_url);
    let escaped_url = escape(&url);
    let title = escape(or(&event.title, "Untitled event"));
    let image = match image_src.filter(|src| !src.is_empty()) {
        Some(src) => format!(
            concat!(
                r#"<a href="{url}"><img src="{src}" "#,
                r#"alt="{title}" width="590" style="display:block;width:100%;max-width:590px;"#,
                r#"height:auto;margin:0 0 20px;border-radius:12px;"></a>"#,
            ),
            url = escaped_url,
            src = escape(src),
            title = title,
        ),
        None => String::new(),
    };
    let detail_rows: String = rows
        .iter()
        .map(|(label, value)| detail_row(label, value))
        .collect();
    format!(
        concat!(
            "{intro}{image}",
            r#"<a href="{url}" style="color:{fg};text-decoration:none;"><h2 style="margin:0 0 8px;font:700 19px {font};">"#,
            "{title}</h2></a>{rows}",
            r#"<div style="height:16px;"></div>"#,
            "{button}",
        ),
        intro = layout::paragraph(&escape(intro), true),
        image = image,
        url = escaped_url,
        fg = FOREGROUND,
        font = FONT,
        title = title,
        rows = detail_rows,
        button = layout::button(&url, "View event on wat2do"),
    )
}

pub(crate) fn detail_row(label: &str, value: &str) -> String {
    format!(
        concat!(
            r#"<div style="padding:12px 0;border-top:1px solid {border};">"#,
            r#"<div style="margin:0 0 4px;color:{muted};font:700 12px {font};"#,
            r#"letter-spacing:.06em;text-transform:uppercase;">{label}</div>"#,
            r#"<div style="color:{fg};font:15px/1.5 {font};"><strong>{value}</strong></div></div>"#,
        ),
        border = BORDER,
        muted = MUTED_FOREGROUND,
        font = FONT,
        label = escape(label),
        fg = FOREGROUND,
        value = escape(value),
    )
}

/// `Mon, Nov 2`.
fn day_label(day: impl chrono::Datelike + Copy, formatted: String) -> String {
    format!("{formatted} {}", day.day())
}

/// ("Fri, May 1", "11 AM") in the school's time zone.
fn format_event_date_time(start: Option<DateTime<Utc>>, tz: Tz) -> (String, String) {
    let Some(start) = start else {
        return ("Date TBA".to_owned(), "Time TBA".to_owned());
    };
    let local = start.with_timezone(&tz);
    (
        day_label(local, local.format("%a, %b").to_string()),
        time_label(local),
    )
}

fn time_label(local: DateTime<Tz>) -> String {
    use chrono::Timelike;
    let minute = if local.minute() == 0 {
        String::new()
    } else {
        format!(":{:02}", local.minute())
    };
    let hour = match local.hour() % 12 {
        0 => 12,
        hour => hour,
    };
    let am_pm = if local.hour() < 12 { "AM" } else { "PM" };
    format!("{hour}{minute} {am_pm}")
}

fn format_position_deadline(position: &PositionCard, tz: Tz) -> Option<String> {
    if let Some(deadline) = position.deadline_at {
        let local = deadline.with_timezone(&tz);
        return Some(day_label(local, local.format("%a, %b").to_string()));
    }
    let date = position.deadline_date?;
    Some(day_label(date, date.format("%a, %b").to_string()))
}

/// (local day, local time range) for one occurrence.
fn local_occurrence(event: &Event, tz: Tz) -> (String, String) {
    occurrence_times(event.dtstart_utc, event.dtend_utc, tz)
}

/// ("Fri, May 1", "11 AM - 2 PM") in the school's time zone.
pub(crate) fn occurrence_times(
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    tz: Tz,
) -> (String, String) {
    let (day, start) = format_event_date_time(start, tz);
    match end {
        Some(end) => (
            day,
            format!("{start} - {}", time_label(end.with_timezone(&tz))),
        ),
        None => (day, start),
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    const TORONTO: Tz = chrono_tz::America::Toronto;
    const LINKS: Links = Links {
        frontend_url: "https://uwaterloo.wat2do.io",
        preferences_url: "https://uwaterloo.wat2do.io/settings",
        unsubscribe_url: "https://uwaterloo.wat2do.io/unsubscribe",
    };

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    pub(crate) fn event(id: i64, title: &str) -> Event {
        Event {
            id,
            title: title.to_owned(),
            location: "SLC".to_owned(),
            dtstart_utc: Some(utc("2026-05-01T15:00:00+00:00")),
            dtend_utc: None,
        }
    }

    fn card(event: Event, image_src: Option<&str>) -> EventCard {
        EventCard {
            event,
            media: CardMedia {
                image_src: image_src.map(str::to_owned),
                ..CardMedia::default()
            },
        }
    }

    fn position() -> PositionCard {
        PositionCard {
            id: 7,
            title: "VP Events".to_owned(),
            deadline_at: Some(utc("2026-05-08T03:59:00+00:00")),
            deadline_date: None,
            media: CardMedia {
                image_src: Some("cid:position-7".to_owned()),
                club_name: Some("Esports".to_owned()),
                club_logo_src: Some("cid:club-esports".to_owned()),
            },
        }
    }

    #[test]
    fn the_subject_counts_events_and_positions() {
        assert_eq!(
            morning_email_subject(4, 2),
            "4 new events and 2 new positions"
        );
        assert_eq!(morning_email_subject(1, 0), "1 new event");
        assert_eq!(morning_email_subject(0, 1), "1 new position");
    }

    #[test]
    fn the_morning_html_escapes_event_values() {
        let mut tea = event(42, "<script>alert(1)</script>");
        tea.location = "SLC & DC".to_owned();
        let html = render_morning_email_html(
            "2 new events",
            &[card(tea, Some("cid:event-42"))],
            &[],
            TORONTO,
            &LINKS,
        );
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(html.contains("SLC &amp; DC"));
        assert!(html.contains(r#"src="cid:event-42""#));
        assert!(html.contains("background:#f9f9f9"));
        assert!(html.contains(r#"href="https://uwaterloo.wat2do.io/events/42""#));
        assert!(!html.contains("New positions"));
    }

    #[test]
    fn the_morning_html_lays_cards_out_two_per_row_and_stacks_them_on_phones() {
        let events: Vec<EventCard> = (1..=3)
            .map(|id| card(event(id, "Tea Tasting"), None))
            .collect();
        let html =
            render_morning_email_html("2 new events", &events, &[position()], TORONTO, &LINKS);
        let (events_table, positions_table) = html.split_once("New positions").unwrap();
        let card = "display:inline-block;box-sizing:border-box;width:100%;max-width:318px;";
        assert_eq!(events_table.matches(card).count(), 3);
        assert_eq!(positions_table.matches(card).count(), 1);
        assert!(events_table.contains("Tea Tasting"));
        assert!(positions_table.contains(r#"src="cid:position-7""#));
        assert!(positions_table.contains("Apply by Thu, May 7"));
        assert!(positions_table.contains(r#"href="https://uwaterloo.wat2do.io/positions""#));
        assert!(positions_table.contains(r#"src="cid:club-esports""#));
        assert!(positions_table.contains("Esports"));
    }

    #[test]
    fn the_morning_text_lists_every_card_and_the_unsubscribe_link() {
        let mut no_deadline = position();
        no_deadline.deadline_at = None;
        no_deadline.title = String::new();
        let mut dated = position();
        dated.deadline_at = None;
        dated.deadline_date = NaiveDate::from_ymd_opt(2026, 5, 8);
        let mut tba = event(43, "");
        tba.location = String::new();
        tba.dtstart_utc = None;
        let text = render_morning_email_text(
            "2 new events and 2 new positions",
            &[card(event(42, "Tea Tasting"), None), card(tba, None)],
            &[no_deadline, dated],
            TORONTO,
            &LINKS,
        );
        assert_eq!(
            text,
            "2 new events and 2 new positions\n\nNew events\n\n\
             - Tea Tasting | Fri, May 1 11 AM | SLC | https://uwaterloo.wat2do.io/events/42\n\
             - Untitled event | Date TBA Time TBA | Location TBA | https://uwaterloo.wat2do.io/events/43\n\n\
             New positions\n\n\
             - Untitled position | No deadline listed | https://uwaterloo.wat2do.io/positions\n\
             - VP Events | Apply by Fri, May 8 | https://uwaterloo.wat2do.io/positions\n\n\
             Manage email preferences: https://uwaterloo.wat2do.io/settings\n\
             Unsubscribe from the morning email: https://uwaterloo.wat2do.io/unsubscribe\n\n\
             wat2do helps students discover campus events."
        );
    }

    #[test]
    fn every_email_uses_the_site_font() {
        let html = render_morning_email_html(
            "Today",
            &[card(event(42, "Tea"), None)],
            &[],
            TORONTO,
            &LINKS,
        );
        assert!(html.contains("api.fontshare.com/v2/css?f[]=satoshi"));
        assert!(!html.contains("{font}"));
        assert!(!html.contains(" sans-serif;"));
        assert_eq!(
            html.matches("font:").count(),
            html.matches("Satoshi,system-ui").count()
        );
        let reminder = render_event_reminder_html(
            "x",
            &event(42, "Tea"),
            Some("cid:event-image"),
            TORONTO,
            &LINKS,
        );
        assert_eq!(
            reminder.matches("font:").count(),
            reminder.matches("Satoshi,system-ui").count()
        );
    }

    #[test]
    fn the_reminder_reads_the_occurrence_in_local_time() {
        let mut tea = event(42, "<Tea>");
        tea.dtend_utc = Some(utc("2026-05-01T16:30:00+00:00"));
        let subject = event_reminder_subject(&tea);
        assert_eq!(subject, "Starts in about 1 hour: <Tea>");
        assert_eq!(
            event_reminder_subject(&event(1, "")),
            "Starts in about 1 hour: Your event"
        );
        let text = render_event_reminder_text(&subject, &tea, TORONTO, &LINKS);
        assert!(text.contains("- When: Fri, May 1, 11 AM - 12:30 PM\n- Where: SLC\n"));
        assert!(
            text.contains(
                "Unsubscribe from event reminders: https://uwaterloo.wat2do.io/unsubscribe"
            )
        );
        let html =
            render_event_reminder_html(&subject, &tea, Some("cid:event-image"), TORONTO, &LINKS);
        assert!(html.contains("&lt;Tea&gt;"));
        assert!(html.contains(r#"<img src="cid:event-image""#));
        assert!(html.contains(r#"<img src="cid:wat2do-logo" alt="wat2do""#));
        assert_eq!(
            html.matches(r#"href="https://uwaterloo.wat2do.io/events/42""#)
                .count(),
            3
        );
        assert!(html.contains("You&#x27;re going to this event."));
        let bare = render_event_reminder_html(&subject, &tea, None, TORONTO, &LINKS);
        assert_eq!(
            bare.matches(r#"href="https://uwaterloo.wat2do.io/events/42""#)
                .count(),
            2
        );
    }

    #[test]
    fn times_follow_daylight_saving_and_half_hour_zones() {
        // 2026-11-01 is the end of daylight saving time in North America.
        let before = Some(Utc.with_ymd_and_hms(2026, 10, 31, 13, 0, 0).unwrap());
        let after = Some(Utc.with_ymd_and_hms(2026, 11, 2, 13, 0, 0).unwrap());
        assert_eq!(
            format_event_date_time(before, TORONTO),
            ("Sat, Oct 31".into(), "9 AM".into())
        );
        assert_eq!(
            format_event_date_time(after, TORONTO),
            ("Mon, Nov 2".into(), "8 AM".into())
        );
        let st_johns = chrono_tz::America::St_Johns;
        assert_eq!(
            format_event_date_time(after, st_johns),
            ("Mon, Nov 2".into(), "9:30 AM".into())
        );
        let midnight = Some(Utc.with_ymd_and_hms(2026, 11, 2, 5, 5, 0).unwrap());
        assert_eq!(
            format_event_date_time(midnight, TORONTO),
            ("Mon, Nov 2".into(), "12:05 AM".into())
        );
        let noon = Some(Utc.with_ymd_and_hms(2026, 11, 2, 17, 0, 0).unwrap());
        assert_eq!(format_event_date_time(noon, TORONTO).1, "12 PM");
    }
}
