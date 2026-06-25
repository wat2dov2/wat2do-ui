"""One-off event email notification sends."""

import html
import logging

from schemas.event import EventResponse
from schemas.user import UserResponse
from services.email_service import EmailMessage, email_service

log = logging.getLogger(__name__)


def send_event_email_notification(*, event: EventResponse, user: UserResponse) -> bool:
    """Email the current user a compact event summary.

    This is intentionally a direct send, not a scheduled reminder. Reminder
    timing needs a product model of its own; this action is the lightweight
    "send me this event" option exposed from the event card/modal.
    """

    try:
        return email_service.send(
            EmailMessage(
                to=user.email,
                subject=f"Event: {event.title}",
                body_html=_render_event_email_html(event),
                body_text=_render_event_email_text(event),
            )
        )
    except Exception as exc:
        log.warning("event email send failed user=%s event=%s: %s", user.id, event.id, exc)
        return False


def _render_event_email_html(event: EventResponse) -> str:
    title = html.escape(event.title)
    organization = html.escape(event.organization or "wat2do")
    rows = [
        ("When", _format_occurrences(event)),
        ("Where", event.location or "TBA"),
        ("Organization", event.organization or "Unknown"),
        ("Price", "Free" if (event.price or 0) == 0 else f"${event.price:g}"),
    ]
    details = "".join(
        f"<p><strong>{html.escape(label)}:</strong> {html.escape(value)}</p>"
        for label, value in rows
    )
    source_link = (
        f'<p><a href="{html.escape(event.source_url)}">Open source event page</a></p>'
        if event.source_url
        else ""
    )
    description = f"<p>{html.escape(event.description)}</p>" if event.description else ""
    return f"""
    <div>
      <p>{organization} shared this event with you.</p>
      <h1>{title}</h1>
      {details}
      {description}
      {source_link}
    </div>
    """


def _render_event_email_text(event: EventResponse) -> str:
    lines = [
        event.title,
        "",
        f"When: {_format_occurrences(event)}",
        f"Where: {event.location or 'TBA'}",
        f"Organization: {event.organization or 'Unknown'}",
        f"Price: {'Free' if (event.price or 0) == 0 else f'${event.price:g}'}",
    ]
    if event.description:
        lines.extend(["", event.description])
    if event.source_url:
        lines.extend(["", event.source_url])
    return "\n".join(lines)


def _format_occurrences(event: EventResponse) -> str:
    if not event.occurrences:
        return "TBA"
    return (
        "; ".join(
            occurrence.dtstart_utc.isoformat()
            for occurrence in event.occurrences
            if occurrence.dtstart_utc is not None
        )
        or "TBA"
    )
