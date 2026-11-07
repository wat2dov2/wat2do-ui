//! The emails tickets send: the holder's tickets with their QR codes, refund
//! notices, and refund requests to the club's team. Each is built and sent
//! after the response, so a slow poster download never delays anyone.

use std::sync::Arc;

use sqlx::PgPool;

use super::codes;
use crate::api::events::model::{Event, Occurrence};
use crate::api::events::store::school_timezone;
use crate::email::layout::{self, BORDER, FONT, FOREGROUND, MUTED_FOREGROUND, escape};
use crate::email::{EmailMessage, InlineImage, send_in_background};
use crate::notifications::email_images::event_hero_image;
use crate::notifications::rendering::{detail_row, occurrence_times};
use crate::settings::Settings;
use crate::time_zones::Tz;

/// What a paid order cost, for its receipt.
#[derive(Debug, Clone, Copy)]
pub struct Payment<'a> {
    pub unit_amount_cents: i32,
    pub currency: &'a str,
}

/// "$1,234.50 CAD".
pub fn format_money(cents: i64, currency: &str) -> String {
    let dollars = (cents / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in dollars.chars().enumerate() {
        if index > 0 && (dollars.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    format!("${grouped}.{:02} {}", cents % 100, currency.to_uppercase())
}

/// The event's school's site, where every link in these emails points.
fn site(settings: &Settings, event: &Event) -> String {
    crate::schools::frontend_url(&settings.frontend_url, event.school.as_deref())
        .unwrap_or_else(|_| settings.frontend_url.clone())
}

async fn zone(db: &PgPool, event: &Event) -> Tz {
    match school_timezone(db, event.school.as_deref()).await {
        Ok(zone) => zone.parse().unwrap_or(Tz::AMERICA_TORONTO),
        Err(_) => Tz::AMERICA_TORONTO,
    }
}

/// "Fri, Oct 24 · 7 PM - 10 PM" in the school's own time zone.
fn when(occurrence: &Occurrence, tz: Tz) -> String {
    let (day, times) = occurrence_times(Some(occurrence.dtstart_utc), occurrence.dtend_utc, tz);
    format!("{day} \u{b7} {times}")
}

/// The holder's tickets, one scannable QR code each: once when a free ticket
/// is taken or handed out, once per paid order.
#[allow(clippy::too_many_arguments)]
pub fn send_tickets(
    db: PgPool,
    settings: &'static Settings,
    event: Event,
    occurrence: Occurrence,
    recipient: String,
    codes: Vec<String>,
    payment: Option<(i32, String)>,
    idempotency_key: String,
) {
    tokio::spawn(async move {
        let tz = zone(&db, &event).await;
        let hero = event_hero_image(event.source_image_url.as_deref()).await;
        let payment = payment.as_ref().map(|(cents, currency)| Payment {
            unit_amount_cents: *cents,
            currency,
        });
        match tickets_message(
            settings,
            &event,
            &occurrence,
            tz,
            &recipient,
            &codes,
            payment,
            hero,
        ) {
            Ok(mut message) => {
                message.idempotency_key = Some(idempotency_key);
                send_in_background(message);
            }
            Err(error) => tracing::error!("Could not build the tickets email: {error:#}"),
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn tickets_message(
    settings: &Settings,
    event: &Event,
    occurrence: &Occurrence,
    tz: Tz,
    recipient: &str,
    codes: &[String],
    payment: Option<Payment<'_>>,
    hero: Option<Arc<InlineImage>>,
) -> anyhow::Result<EmailMessage> {
    let site = site(settings, event);
    let count = codes.len();
    let host = event.club.clone().unwrap_or_else(|| "the club".to_owned());
    let when = when(occurrence, tz);
    let where_ = event
        .location
        .clone()
        .unwrap_or_else(|| "Location TBA".to_owned());
    let links: Vec<String> = codes
        .iter()
        .map(|code| codes::ticket_url(&site, code))
        .collect();
    let qr_images = links
        .iter()
        .enumerate()
        .map(|(index, link)| {
            Ok(Arc::new(InlineImage {
                content_id: format!("ticket-{}", index + 1),
                filename: format!("ticket-{}.png", index + 1),
                content_type: "image/png".to_owned(),
                content: codes::qr_png(link)?,
            }))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    let mut rows = vec![
        ("When".to_owned(), when.clone()),
        ("Where".to_owned(), where_.clone()),
    ];
    let mut text_payment = Vec::new();
    match payment {
        Some(payment) => {
            let unit = format_money(payment.unit_amount_cents.into(), payment.currency);
            let total = format_money(
                i64::from(payment.unit_amount_cents) * count as i64,
                payment.currency,
            );
            rows.push(("Tickets".to_owned(), format!("{count} \u{d7} {unit}")));
            rows.push(("Total paid".to_owned(), total.clone()));
            rows.push(("Paid to".to_owned(), host.clone()));
            text_payment.push(format!("Total paid: {total} to {host}"));
        }
        None => rows.push(("Hosted by".to_owned(), host.clone())),
    }
    let tickets = if count == 1 {
        "ticket".to_owned()
    } else {
        format!("{count} tickets")
    };
    let verb = if count == 1 { "is" } else { "are" };
    let lead = format!(
        "Your {tickets} for <strong>{}</strong> {verb} below. Show the QR code at the door.",
        escape(&event.title)
    );
    let closing = match payment {
        Some(_) => format!(
            "Your payment went straight to {host} through Stripe, with no booking fees. \
             Can't make it? Ask {host} for a refund from your ticket's page, \
             and you'll get an email when they decide."
        ),
        None => {
            "Can't make it? Give your ticket back from its page, so someone else can go.".to_owned()
        }
    };
    let poster = hero.as_ref().map_or(String::new(), |image| {
        format!(
            r#"<img src="cid:{}" alt="{}" width="590" style="display:block;width:100%;max-width:590px;height:auto;margin:0 0 20px;border-radius:12px;">"#,
            image.content_id,
            escape(&event.title)
        )
    });
    let cards: String = qr_images
        .iter()
        .zip(&links)
        .enumerate()
        .map(|(index, (image, link))| ticket_card(index + 1, count, &image.content_id, link))
        .collect();
    let content = format!(
        "{}{poster}{}<div style=\"height:20px;\"></div>{cards}{}",
        layout::paragraph(&lead, false),
        rows.iter()
            .map(|(label, value)| detail_row(label, value))
            .collect::<String>(),
        layout::note(&escape(&closing)),
    );
    let mut text = vec![
        format!("You're in: {}", event.title),
        String::new(),
        format!("When: {when}"),
        format!("Where: {where_}"),
    ];
    text.extend(text_payment);
    text.push(String::new());
    text.extend(
        links
            .iter()
            .enumerate()
            .map(|(index, link)| format!("Ticket {}: {link}", index + 1)),
    );
    text.push(String::new());
    text.push("Show the QR code on each ticket at the door.".to_owned());
    text.push(closing);
    Ok(EmailMessage {
        to: vec![recipient.to_owned()],
        subject: format!(
            "Your {} for {}",
            if count == 1 { "ticket" } else { "tickets" },
            event.title
        ),
        body_html: layout::shell("You're in", &content, &[]),
        body_text: text.join("\n"),
        inline_images: std::iter::once(layout::LOGO.clone())
            .chain(hero)
            .chain(qr_images)
            .collect(),
        ..EmailMessage::default()
    })
}

fn ticket_card(index: usize, count: usize, content_id: &str, link: &str) -> String {
    let label = if count > 1 {
        format!("Ticket {index} of {count}")
    } else {
        "Your ticket".to_owned()
    };
    let link = escape(link);
    format!(
        concat!(
            r#"<div style="margin:0 0 16px;padding:20px;border:1px solid {border};border-radius:12px;text-align:center;">"#,
            r#"<div style="margin:0 0 12px;color:{muted};font:700 12px {font};letter-spacing:.06em;text-transform:uppercase;">{label}</div>"#,
            r#"<a href="{link}"><img src="cid:{content_id}" alt="Ticket QR code" width="220" height="220" style="display:block;margin:0 auto 12px;border:0;"></a>"#,
            r#"<a href="{link}" style="color:{fg};font:600 14px {font};">Open ticket</a></div>"#,
        ),
        border = BORDER,
        muted = MUTED_FOREGROUND,
        font = FONT,
        fg = FOREGROUND,
        label = escape(&label),
        link = link,
        content_id = content_id,
    )
}

/// Money on its way back: one refunded ticket, or every ticket of a cancelled event.
pub fn send_refund_notice(
    settings: &Settings,
    event: &Event,
    recipient: &str,
    count: usize,
    amount_cents: i64,
    currency: &str,
    cancelled: bool,
) {
    let host = event.club.clone().unwrap_or_else(|| "The club".to_owned());
    let amount = format_money(amount_cents, currency);
    let tickets = if count == 1 {
        "ticket".to_owned()
    } else {
        format!("{count} tickets")
    };
    let lead = if cancelled {
        format!(
            "{} was cancelled, so your {tickets} {} refunded automatically.",
            event.title,
            if count == 1 { "was" } else { "were" }
        )
    } else {
        format!("{host} refunded your {tickets} for {}.", event.title)
    };
    let event_url = format!("{}/events/{}", site(settings, event), event.id);
    let content = format!(
        "{}{}{}",
        layout::paragraph(&escape(&lead), false),
        layout::paragraph(
            &format!(
                "<strong>{}</strong> is on its way back to your card. \
                 It usually appears within 5 to 10 business days.",
                escape(&amount)
            ),
            true,
        ),
        layout::button(&event_url, "View event"),
    );
    send_in_background(EmailMessage {
        to: vec![recipient.to_owned()],
        subject: if cancelled {
            format!("{} was cancelled: you've been refunded", event.title)
        } else {
            format!("Refund for {}", event.title)
        },
        body_html: layout::shell(
            if cancelled {
                "Event cancelled"
            } else {
                "Ticket refunded"
            },
            &content,
            &[],
        ),
        body_text: format!(
            "{lead}\n{amount} is on its way back to your card, usually within 5 to 10 business days."
        ),
        inline_images: vec![layout::LOGO.clone()],
        ..EmailMessage::default()
    });
}

/// Tells everyone on the club's team that a holder wants their money back.
#[allow(clippy::too_many_arguments)]
pub fn send_refund_request(
    settings: &Settings,
    event: &Event,
    recipients: Vec<String>,
    holder_name: &str,
    amount_cents: i64,
    currency: &str,
    note: Option<&str>,
    ticket_id: uuid::Uuid,
) {
    if recipients.is_empty() {
        return;
    }
    let host = event.club.clone().unwrap_or_else(|| "your club".to_owned());
    let amount = format_money(amount_cents, currency);
    let desk = format!("{}/club-panel/events/{}", site(settings, event), event.id);
    let lead = format!(
        "{holder_name} asked {host} for a refund of one {amount} ticket to {}.",
        event.title
    );
    let quoted = note.map_or(String::new(), |note| {
        layout::note(&escape(&format!("\u{201c}{note}\u{201d}")))
    });
    let content = format!(
        "{}{quoted}{}{}",
        layout::paragraph(&escape(&lead), false),
        layout::paragraph(
            "Refund or decline it from the ticket desk. Either way, they get an email.",
            true,
        ),
        layout::button(&desk, "Open the ticket desk"),
    );
    let mut text = vec![lead.clone()];
    if let Some(note) = note {
        text.push(format!("Their note: \"{note}\""));
    }
    text.push(String::new());
    text.push(format!("Refund or decline it from the ticket desk: {desk}"));
    send_in_background(EmailMessage {
        to: recipients,
        subject: format!("Refund request: {}", event.title),
        body_html: layout::shell("Refund request", &content, &[]),
        body_text: text.join("\n"),
        idempotency_key: Some(format!("ticket-refund-request:{ticket_id}")),
        inline_images: vec![layout::LOGO.clone()],
        ..EmailMessage::default()
    });
}

/// Tells the holder the club said no, so nobody waits on an answer that never comes.
pub fn send_refund_declined(settings: &Settings, event: &Event, recipient: &str, code: &str) {
    let host = event.club.clone().unwrap_or_else(|| "The club".to_owned());
    let link = codes::ticket_url(&site(settings, event), code);
    let lead = format!(
        "{host} declined your refund request for {}. Your ticket still works.",
        event.title
    );
    send_in_background(EmailMessage {
        to: vec![recipient.to_owned()],
        subject: format!("Your refund request for {}", event.title),
        body_html: layout::shell(
            "Refund request declined",
            &format!(
                "{}{}",
                layout::paragraph(&escape(&lead), false),
                layout::button(&link, "View your ticket")
            ),
            &[],
        ),
        body_text: format!("{lead}\n\nYour ticket: {link}"),
        idempotency_key: Some(format!("ticket-refund-declined:{code}")),
        inline_images: vec![layout::LOGO.clone()],
        ..EmailMessage::default()
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_settings;

    fn event() -> Event {
        crate::api::tickets::tests::event_with_dates(42, &[(2026, 11, 20, 23)])
    }

    #[test]
    fn money_reads_like_a_receipt() {
        assert_eq!(format_money(1500, "cad"), "$15.00 CAD");
        assert_eq!(format_money(123_456_789, "usd"), "$1,234,567.89 USD");
        assert_eq!(format_money(5, "cad"), "$0.05 CAD");
    }

    #[test]
    fn a_free_ticket_email_has_its_qr_code_and_no_payment_lines() {
        let settings = test_settings(&[("FRONTEND_URL", "https://wat2do.io")]);
        let event = event();
        let occurrence = event.occurrences[0].clone();
        let message = tickets_message(
            &settings,
            &event,
            &occurrence,
            Tz::AMERICA_TORONTO,
            "a@b.c",
            &["CODE2222222222222222222A".to_owned()],
            None,
            None,
        )
        .unwrap();
        assert_eq!(message.subject, "Your ticket for Board Games Night");
        assert!(message.body_html.contains("cid:ticket-1"));
        assert!(message.body_html.contains("Hosted by"));
        assert!(!message.body_html.contains("Total paid"));
        assert!(
            message
                .body_text
                .contains("https://uwaterloo.wat2do.io/tickets/CODE2222222222222222222A")
        );
        assert!(message.body_text.contains("Give your ticket back"));
        // The logo, then one QR code per ticket.
        assert_eq!(message.inline_images.len(), 2);
        assert_eq!(message.inline_images[1].content_type, "image/png");
        assert!(message.body_text.contains("Fri, Nov 20 \u{b7} 6 PM"));
    }

    #[test]
    fn a_paid_receipt_counts_every_ticket() {
        let settings = test_settings(&[("FRONTEND_URL", "https://wat2do.io")]);
        let event = event();
        let occurrence = event.occurrences[0].clone();
        let message = tickets_message(
            &settings,
            &event,
            &occurrence,
            Tz::AMERICA_TORONTO,
            "a@b.c",
            &["A".repeat(24), "B".repeat(24)],
            Some(Payment {
                unit_amount_cents: 1500,
                currency: "cad",
            }),
            None,
        )
        .unwrap();
        assert_eq!(message.subject, "Your tickets for Board Games Night");
        assert!(message.body_html.contains("Ticket 2 of 2"));
        assert!(
            message
                .body_text
                .contains("Total paid: $30.00 CAD to Board Game Club")
        );
        assert_eq!(message.inline_images.len(), 3);
    }
}
