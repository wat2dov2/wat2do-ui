"""The receipt with QR tickets, and the refund notice, that ticket buyers get by email."""

from __future__ import annotations

import io
import logging
from html import escape
from typing import Literal
from zoneinfo import ZoneInfo

import segno

from schemas.event import EventResponse
from schemas.event_date import OccurrenceResponse
from services import school_service
from services.email_layout import (
    EMAIL_THEME,
    email_button,
    email_logo,
    email_note,
    email_paragraph,
    email_shell,
)
from services.email_service import EmailMessage, InlineImage, email_service
from services.notifications.email_images import event_hero_image
from services.notifications.rendering import detail_row_html, local_occurrence
from services.school_context import school_frontend_url

log = logging.getLogger(__name__)

# Large enough for a door scanner to read off a dimmed phone screen.
_QR_SCALE = 8
_QR_BORDER = 2

RefundReason = Literal["refunded", "cancelled"]


def format_money(cents: int, currency: str) -> str:
    return f"${cents / 100:,.2f} {currency.upper()}"


def ticket_url(school: str | None, code: str) -> str:
    """The page a ticket's QR code opens: the holder's ticket, or check-in for club officers."""
    return f"{school_frontend_url(school)}/tickets/{code}"


def ticket_qr_png(url: str) -> bytes:
    buffer = io.BytesIO()
    segno.make_qr(url, error="m").save(buffer, kind="png", scale=_QR_SCALE, border=_QR_BORDER)
    return buffer.getvalue()


def occurrence_label(event: EventResponse, occurrence: OccurrenceResponse) -> str:
    """ "Fri, Oct 24 · 7 PM - 10 PM" in the school's own time zone."""
    day, times = local_occurrence(occurrence.model_dump(mode="json"), _school_zone(event.school))
    return f"{day} · {times}"


def send_confirmation(
    *,
    order: dict,
    codes: list[str],
    event: EventResponse,
    occurrence: OccurrenceResponse,
    club_name: str | None,
) -> None:
    """Receipt and one scannable QR code per ticket, sent once per paid order."""
    count = len(codes)
    total = format_money(order["unit_amount_cents"] * count, order["currency"])
    when = occurrence_label(event, occurrence)
    host = club_name or "the club"
    links = [ticket_url(event.school, code) for code in codes]
    qr_images = [
        InlineImage(
            content_id=f"ticket-{index}",
            filename=f"ticket-{index}.png",
            content_type="image/png",
            content=ticket_qr_png(link),
        )
        for index, link in enumerate(links, start=1)
    ]
    hero = event_hero_image(event.source_image_url)
    tickets_html = "".join(
        _ticket_card(index, count, image.content_id, link)
        for index, (image, link) in enumerate(zip(qr_images, links, strict=True), start=1)
    )
    rows = [
        ("When", None, when),
        ("Where", None, event.location or "Location TBA"),
        (
            "Tickets",
            None,
            f"{count} × {format_money(order['unit_amount_cents'], order['currency'])}",
        ),
        ("Total paid", None, total),
        ("Paid to", None, host),
    ]
    poster = (
        f'<img src="cid:{hero.content_id}" alt="{escape(event.title, quote=True)}" width="590" '
        'style="display:block;width:100%;max-width:590px;height:auto;margin:0 0 20px;'
        'border-radius:12px;">'
        if hero is not None
        else ""
    )
    html = email_shell(
        heading="You're in",
        content=(
            email_paragraph(
                f"Your {'ticket' if count == 1 else f'{count} tickets'} for "
                f"<strong>{escape(event.title)}</strong> {'is' if count == 1 else 'are'} below. "
                "Show the QR code at the door."
            )
            + poster
            + "".join(detail_row_html(label, old, new) for label, old, new in rows)
            + '<div style="height:20px;"></div>'
            + tickets_html
            + email_note(
                escape(
                    f"Your payment went straight to {host} through Stripe, with no booking fees. "
                    f"Can't make it? Ask {host} for a refund from your ticket page, "
                    "and you'll get an email when they decide."
                )
            )
        ),
    )
    text = "\n".join(
        [
            f"You're in: {event.title}",
            "",
            f"When: {when}",
            f"Where: {event.location or 'Location TBA'}",
            f"Total paid: {total} to {host}",
            "",
            *[f"Ticket {index}: {link}" for index, link in enumerate(links, start=1)],
            "",
            "Show the QR code on each ticket at the door.",
            f"Can't make it? Ask {host} for a refund from your ticket page.",
        ]
    )
    email_service.send_safely(
        EmailMessage(
            to=[order["buyer_email"]],
            subject=f"Your {'ticket' if count == 1 else 'tickets'} for {event.title}",
            body_html=html,
            body_text=text,
            idempotency_key=f"ticket-confirmation:{order['id']}",
            inline_images=[
                email_logo(event.school),
                *([hero] if hero is not None else []),
                *qr_images,
            ],
        )
    )


def send_refund_notice(
    *,
    order: dict,
    count: int,
    amount_cents: int,
    event: EventResponse,
    club_name: str | None,
    reason: RefundReason,
) -> None:
    host = club_name or "The club"
    amount = format_money(amount_cents, order["currency"])
    tickets = "ticket" if count == 1 else f"{count} tickets"
    lead = (
        f"{event.title} was cancelled, so your {tickets} {'was' if count == 1 else 'were'} "
        "refunded automatically."
        if reason == "cancelled"
        else f"{host} refunded your {tickets} for {event.title}."
    )
    html = email_shell(
        heading="Event cancelled" if reason == "cancelled" else "Ticket refunded",
        content=(
            email_paragraph(escape(lead))
            + email_paragraph(
                f"<strong>{escape(amount)}</strong> is on its way back to your card. "
                "It usually appears within 5 to 10 business days.",
                muted=True,
            )
            + email_button(f"{school_frontend_url(event.school)}/events/{event.id}", "View event")
        ),
    )
    text = "\n".join(
        [
            lead,
            f"{amount} is on its way back to your card, usually within 5 to 10 business days.",
        ]
    )
    email_service.send_safely(
        EmailMessage(
            to=[order["buyer_email"]],
            subject=(
                f"{event.title} was cancelled: you've been refunded"
                if reason == "cancelled"
                else f"Refund for {event.title}"
            ),
            body_html=html,
            body_text=text,
            inline_images=[email_logo(event.school)],
        )
    )


def send_refund_request(
    *,
    ticket: dict,
    order: dict,
    holder_name: str,
    event: EventResponse,
    club_name: str | None,
    recipients: list[str],
) -> None:
    """Tells every officer of the club that a holder wants their money back."""
    if not recipients:
        return
    amount = format_money(order["unit_amount_cents"], order["currency"])
    host = club_name or "your club"
    note = ticket.get("refund_request_note")
    desk = f"{school_frontend_url(event.school)}/club-panel/events/{event.id}"
    lead = f"{holder_name} asked {host} for a refund of one {amount} ticket to {event.title}."
    html = email_shell(
        heading="Refund request",
        content=(
            email_paragraph(escape(lead))
            + (email_note(escape(f"“{note}”")) if note else "")
            + email_paragraph(
                "Refund or decline it from the ticket desk. Either way, they get an email.",
                muted=True,
            )
            + email_button(desk, "Open the ticket desk")
        ),
    )
    text = "\n".join(
        [
            lead,
            *([f'Their note: "{note}"'] if note else []),
            "",
            f"Refund or decline it from the ticket desk: {desk}",
        ]
    )
    email_service.send_safely(
        EmailMessage(
            to=recipients,
            subject=f"Refund request: {event.title}",
            body_html=html,
            body_text=text,
            idempotency_key=f"ticket-refund-request:{ticket['id']}",
            inline_images=[email_logo(event.school)],
        )
    )


def send_refund_declined(
    *, ticket: dict, order: dict, event: EventResponse, club_name: str | None
) -> None:
    """Tells the holder the club said no, so nobody waits on an answer that never comes."""
    host = club_name or "The club"
    link = ticket_url(event.school, ticket["code"])
    lead = f"{host} declined your refund request for {event.title}. Your ticket still works."
    html = email_shell(
        heading="Refund request declined",
        content=email_paragraph(escape(lead)) + email_button(link, "View your ticket"),
    )
    email_service.send_safely(
        EmailMessage(
            to=[order["buyer_email"]],
            subject=f"Your refund request for {event.title}",
            body_html=html,
            body_text=f"{lead}\n\nYour ticket: {link}",
            idempotency_key=f"ticket-refund-declined:{ticket['id']}",
            inline_images=[email_logo(event.school)],
        )
    )


def _ticket_card(index: int, count: int, content_id: str, link: str) -> str:
    border = EMAIL_THEME["border"]
    muted = EMAIL_THEME["muted_foreground"]
    label = f"Ticket {index} of {count}" if count > 1 else "Your ticket"
    return (
        f'<div style="margin:0 0 16px;padding:20px;border:1px solid {border};border-radius:12px;'
        'text-align:center;">'
        f'<div style="margin:0 0 12px;color:{muted};font:700 12px sans-serif;'
        f'letter-spacing:.06em;text-transform:uppercase;">{escape(label)}</div>'
        f'<a href="{escape(link, quote=True)}"><img src="cid:{content_id}" alt="Ticket QR code" '
        'width="220" height="220" style="display:block;margin:0 auto 12px;border:0;"></a>'
        f'<a href="{escape(link, quote=True)}" style="color:{EMAIL_THEME["foreground"]};'
        'font:600 14px sans-serif;">Open ticket</a></div>'
    )


def _school_zone(school: str | None) -> ZoneInfo:
    record = school_service.get_school(school)
    return ZoneInfo(record.timezone if record is not None else "America/Toronto")
