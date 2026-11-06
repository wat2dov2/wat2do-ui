"""Pure HTML and plain-text rendering of event change emails.

The scheduled morning email and event reminders render in Rust
(`rust/src/notifications/rendering.rs`); keep the event spotlight there in step
with this one.
"""

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from services.email_layout import (
    EMAIL_FONT,
    EMAIL_THEME,
    email_button,
    email_paragraph,
    email_shell,
)


def _event_url(event: dict, frontend_url: str) -> str:
    return f"{frontend_url}/events/{int(event['id'])}"


def _format_event_date_time(event: dict, tz: ZoneInfo) -> tuple[str, str]:
    raw = event.get("dtstart_utc")
    if not raw:
        return "Date TBA", "Time TBA"
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(tz)
    except ValueError:
        return str(raw), "Time TBA"
    date_label = f"{dt.strftime('%a, %b')} {dt.day}"
    minute = f":{dt.minute:02d}" if dt.minute else ""
    hour = dt.hour % 12 or 12
    am_pm = "AM" if dt.hour < 12 else "PM"
    return date_label, f"{hour}{minute} {am_pm}"


def event_change_subject(event: dict, diff: dict) -> str:
    title = event.get("title") or "an event you're going to"
    cancelled = diff.get("cancelled", {}).get("new") is True
    return f"{'Cancelled' if cancelled else 'Changed'}: {title}"


def render_event_change_text(
    *,
    subject: str,
    event: dict,
    diff: dict,
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
    refund_url: str | None,
) -> str:
    lines = [subject, "", "You're going to this event. Here's what changed:", ""]
    for label, old, new in _describe_changes(diff, tz):
        if old and new:
            lines.append(f"- {label}: {old} -> {new}")
        else:
            lines.append(f"- {label}: {new or f'{old} (removed)'}")
    if refund_url:
        lines.extend(["", f"{REFUND_OFFER} Request a refund: {refund_url}"])
    lines.extend(
        [
            "",
            f"View the event: {_event_url(event, frontend_url)}",
            "",
            f"Manage email preferences: {preferences_url}",
            f"Unsubscribe from event change emails: {unsubscribe_url}",
            "",
            "wat2do helps students discover campus events.",
        ]
    )
    return "\n".join(lines)


def render_event_change_html(
    *,
    subject: str,
    event: dict,
    diff: dict,
    image_src: str | None,
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
    refund_url: str | None,
) -> str:
    refund = (
        '<div style="height:24px;"></div>'
        + email_paragraph(escape(REFUND_OFFER))
        + email_button(refund_url, "Request a refund")
        if refund_url
        else ""
    )
    return email_shell(
        heading=subject,
        content=_event_spotlight(
            intro="You're going to this event. Here's what changed.",
            event=event,
            image_src=image_src,
            frontend_url=frontend_url,
            rows=_describe_changes(diff, tz),
        )
        + refund,
        footer_links=[
            ("Manage email preferences", preferences_url),
            ("Unsubscribe", unsubscribe_url),
        ],
    )


# Shown to holders of paid tickets when an event's time or place changes.
REFUND_OFFER = "Your ticket still works. If the change doesn't suit you, ask the club for a refund."


def _event_spotlight(
    *,
    intro: str,
    event: dict,
    image_src: str | None,
    frontend_url: str,
    rows: list[tuple[str, str | None, str | None]],
) -> str:
    """One event's poster, title, detail rows, and link: the body of single-event emails."""
    event_url = escape(_event_url(event, frontend_url), quote=True)
    title = escape(str(event.get("title") or "Untitled event"))
    image = (
        f'<a href="{event_url}"><img src="{escape(image_src, quote=True)}" '
        f'alt="{title}" width="590" style="display:block;width:100%;max-width:590px;'
        'height:auto;margin:0 0 20px;border-radius:12px;"></a>'
        if image_src
        else ""
    )
    return (
        f"{email_paragraph(escape(intro), muted=True)}"
        f"{image}"
        f'<a href="{event_url}" style="color:{EMAIL_THEME["foreground"]};'
        f'text-decoration:none;"><h2 style="margin:0 0 8px;font:700 19px {EMAIL_FONT};">'
        f"{title}</h2></a>"
        + "".join(_detail_row_html(label, old, new) for label, old, new in rows)
        + '<div style="height:16px;"></div>'
        + email_button(_event_url(event, frontend_url), "View event on wat2do")
    )


def _detail_row_html(label: str, old: str | None, new: str | None) -> str:
    muted = EMAIL_THEME["muted_foreground"]
    struck = (
        f'<span style="color:{muted};text-decoration:line-through;">{escape(old)}</span>'
        if old
        else ""
    )
    if old and new:
        value = f"{struck} &rarr; <strong>{escape(new)}</strong>"
    elif new:
        value = f"<strong>{escape(new)}</strong>"
    else:
        value = f'{struck} <span style="color:{muted};">(removed)</span>'
    return (
        f'<div style="padding:12px 0;border-top:1px solid {EMAIL_THEME["border"]};">'
        f'<div style="margin:0 0 4px;color:{muted};font:700 12px {EMAIL_FONT};'
        f'letter-spacing:.06em;text-transform:uppercase;">{escape(label)}</div>'
        f'<div style="color:{EMAIL_THEME["foreground"]};font:15px/1.5 {EMAIL_FONT};">'
        f"{value}</div></div>"
    )


def _describe_changes(diff: dict, tz: ZoneInfo) -> list[tuple[str, str | None, str | None]]:
    """(label, old, new) rows in reading order: status, location, then dates.

    A date whose start or end moved within the same local day reads as one
    "old time -> new time" row; anything else is an added or removed date.
    """
    rows: list[tuple[str, str | None, str | None]] = []
    cancelled = diff.get("cancelled")
    if cancelled and cancelled.get("new") is True:
        rows.append(("Status", None, "Cancelled"))
    elif cancelled and cancelled.get("old") is True:
        rows.append(("Status", "Cancelled", "Back on"))
    location = diff.get("location")
    if location:
        rows.append(("Location", location.get("old") or "TBA", location.get("new") or "TBA"))
    occurrences = diff.get("occurrences")
    if occurrences:
        rows.extend(_describe_date_changes(occurrences, tz))
    return rows


def _describe_date_changes(change: dict, tz: ZoneInfo) -> list[tuple[str, str | None, str | None]]:
    old = [_local_occurrence(item, tz) for item in change.get("old") or []]
    new = [_local_occurrence(item, tz) for item in change.get("new") or []]
    removed = [item for item in old if item not in new]
    added = [item for item in new if item not in old]
    rows: list[tuple[str, str | None, str | None]] = []
    for day, times in removed:
        moved = next((item for item in added if item[0] == day), None)
        if moved is not None:
            added.remove(moved)
            rows.append((day, times, moved[1]))
        else:
            rows.append(("Removed date", f"{day}, {times}", None))
    rows.extend(("Added date", None, f"{day}, {times}") for day, times in added)
    return rows


def _local_occurrence(item: dict, tz: ZoneInfo) -> tuple[str, str]:
    """(local day label, local time range) for one occurrence."""
    day, start = _format_event_date_time(item, tz)
    if not item.get("dtend_utc"):
        return day, start
    _, end = _format_event_date_time({"dtstart_utc": item["dtend_utc"]}, tz)
    return day, f"{start} - {end}"
