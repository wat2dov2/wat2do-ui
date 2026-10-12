"""Pure HTML and plain-text rendering for active notification types."""

from datetime import datetime
from html import escape
from itertools import batched
from pathlib import Path
from zoneinfo import ZoneInfo

from services.email_service import InlineImage

# Email clients do not reliably support CSS custom properties or OKLCH.
# These resolved sRGB values preserve the app's semantic light-theme roles.
_EMAIL_THEME = {
    "background": "#f9f9f9",
    "surface": "#ffffff",
    "surface_elevated": "#f3f3f3",
    "foreground": "#171717",
    "muted_foreground": "#5c5c5c",
    "border": "#d6d6d6",
}


# Embedded in every notification email; the shared shell shows it as cid:wat2do-logo.
EMAIL_LOGO = InlineImage(
    content_id="wat2do-logo",
    filename="wat2do-logo.png",
    content_type="image/png",
    content=Path(__file__).with_name("wat2do-logo.png").read_bytes(),
)


def morning_email_subject(event_count: int, position_count: int) -> str:
    counts = [
        f"{count} new {noun if count == 1 else noun + 's'}"
        for count, noun in ((event_count, "event"), (position_count, "position"))
        if count
    ]
    return " and ".join(counts)


def render_morning_email_text(
    *,
    subject: str,
    events: list[dict],
    positions: list[dict],
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    lines = [subject, ""]
    if events:
        lines.extend(["New events", ""])
        lines.extend(_text_event(event, tz, frontend_url) for event in events)
        lines.append("")
    if positions:
        lines.extend(["New positions", ""])
        lines.extend(_text_position(position, tz, frontend_url) for position in positions)
        lines.append("")
    lines.extend(
        [
            f"Manage email preferences: {preferences_url}",
            f"Unsubscribe from the morning email: {unsubscribe_url}",
            "",
            "wat2do helps students discover campus events.",
        ]
    )
    return "\n".join(lines)


def render_morning_email_html(
    *,
    subject: str,
    events: list[dict],
    positions: list[dict],
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    """Cards in two columns, like the app's event grid.

    Each event and position carries ``image_src``: an embedded ``cid:`` image or the poster URL.
    """
    content = ""
    if events:
        content += _grid_section(
            "New events", [_event_grid_card(event, tz, frontend_url) for event in events]
        )
    if positions:
        content += _grid_section(
            "New positions",
            [_position_grid_card(position, tz, frontend_url) for position in positions],
        )
    return _email_shell(
        subject=subject,
        content=content,
        preferences_url=preferences_url,
        unsubscribe_url=unsubscribe_url,
    )


def event_reminder_subject(event: dict) -> str:
    return f"Starts in about 1 hour: {event.get('title') or 'Your event'}"


def render_event_reminder_text(
    *,
    subject: str,
    event: dict,
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    day, times = _local_occurrence(event, tz)
    return "\n".join(
        [
            subject,
            "",
            "You're going to this event. It starts in about an hour.",
            "",
            f"- When: {day}, {times}",
            f"- Where: {event.get('location') or 'Location TBA'}",
            "",
            f"View the event: {_event_url(event, frontend_url)}",
            "",
            f"Manage email preferences: {preferences_url}",
            f"Unsubscribe from event reminders: {unsubscribe_url}",
            "",
            "wat2do helps students discover campus events.",
        ]
    )


def render_event_reminder_html(
    *,
    subject: str,
    event: dict,
    image_src: str | None,
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    day, times = _local_occurrence(event, tz)
    return _email_shell(
        subject=subject,
        content=_event_spotlight(
            intro="You're going to this event. It starts in about an hour.",
            event=event,
            image_src=image_src,
            frontend_url=frontend_url,
            rows=[
                ("When", None, f"{day}, {times}"),
                ("Where", None, str(event.get("location") or "Location TBA")),
            ],
        ),
        preferences_url=preferences_url,
        unsubscribe_url=unsubscribe_url,
    )


def _email_shell(
    *,
    subject: str,
    content: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    return (
        f'<div style="margin:0;background:{_EMAIL_THEME["background"]};padding:28px 16px;">'
        f'<div style="max-width:640px;margin:0 auto;background:{_EMAIL_THEME["surface"]};'
        f'border:1px solid {_EMAIL_THEME["border"]};border-radius:16px;padding:24px;">'
        f'<img src="cid:{EMAIL_LOGO.content_id}" alt="wat2do" width="80" height="57" '
        'style="display:block;margin:0 0 16px;border:0;">'
        f'<h1 style="margin:0 0 24px;color:{_EMAIL_THEME["foreground"]};'
        f'font:800 28px sans-serif;">{escape(subject)}</h1>'
        f"{content}"
        f'<p style="margin:24px 0 0;color:{_EMAIL_THEME["muted_foreground"]};'
        'font:12px/1.6 sans-serif;">'
        f'<a style="color:{_EMAIL_THEME["foreground"]};" '
        f'href="{escape(preferences_url, quote=True)}">Manage email preferences</a>'
        " &middot; "
        f'<a style="color:{_EMAIL_THEME["foreground"]};" '
        f'href="{escape(unsubscribe_url, quote=True)}">Unsubscribe</a><br>'
        "wat2do helps students discover campus events."
        "</p></div></div>"
    )


def _grid_section(title: str, cards: list[str]) -> str:
    rows = "".join(
        "<tr>"
        + "".join(
            f'<td width="50%" valign="top" style="width:50%;padding:0 {6 if side == 0 else 0}px '
            f'20px {6 if side == 1 else 0}px;">{card}</td>'
            for side, card in enumerate(pair)
        )
        + ('<td width="50%" style="width:50%;"></td>' if len(pair) == 1 else "")
        + "</tr>"
        for pair in batched(cards, 2)
    )
    return (
        f'<h2 style="margin:24px 0 12px;color:{_EMAIL_THEME["foreground"]};'
        f'font:700 19px sans-serif;">{escape(title)}</h2>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="width:100%;border-collapse:collapse;table-layout:fixed;">{rows}</table>'
    )


def _event_grid_card(event: dict, tz: ZoneInfo, frontend_url: str) -> str:
    date_label, time_label = _format_event_date_time(event, tz)
    return _grid_card(
        href=_event_url(event, frontend_url),
        image_src=event.get("image_src"),
        club_name=event.get("club_name"),
        club_logo_src=event.get("club_logo_src"),
        title=str(event.get("title") or "Untitled event"),
        details=[f"{date_label} · {time_label}", str(event.get("location") or "Location TBA")],
    )


def _position_grid_card(position: dict, tz: ZoneInfo, frontend_url: str) -> str:
    deadline = _format_position_deadline(position, tz)
    return _grid_card(
        href=f"{frontend_url}/positions",
        image_src=position.get("image_src"),
        club_name=position.get("club_name"),
        club_logo_src=position.get("club_logo_src"),
        title=str(position.get("title") or "Untitled position"),
        details=[f"Apply by {deadline}"] if deadline else [],
    )


def _grid_card(
    *,
    href: str,
    image_src: str | None,
    club_name: str | None,
    club_logo_src: str | None,
    title: str,
    details: list[str],
) -> str:
    if image_src:
        image = (
            f'<img src="{escape(image_src, quote=True)}" alt="" width="288" '
            'style="display:block;width:100%;height:auto;border:0;border-radius:12px;">'
        )
    else:
        image = (
            f'<div style="padding:56px 12px;background:{_EMAIL_THEME["surface_elevated"]};'
            f"border-radius:12px;color:{_EMAIL_THEME['foreground']};text-align:center;"
            f'font:600 15px/1.3 sans-serif;">{escape(title)}</div>'
        )
    detail_lines = "".join(
        f'<br><span style="color:{_EMAIL_THEME["muted_foreground"]};font:13px/1.5 sans-serif;">'
        f"{escape(detail)}</span>"
        for detail in details
    )
    return (
        f'<a href="{escape(href, quote=True)}" style="display:block;'
        f'color:{_EMAIL_THEME["foreground"]};text-decoration:none;">{image}'
        f"{_club_line(club_name, club_logo_src)}"
        f'<div style="padding:6px 2px 0;"><strong style="font:700 15px/1.35 sans-serif;">'
        f"{escape(title)}</strong>{detail_lines}</div></a>"
    )


def _club_line(club_name: str | None, club_logo_src: str | None) -> str:
    """The posting club's round profile picture and name, under the card's poster."""
    if not club_name:
        return ""
    logo = (
        f'<td width="20" valign="middle" style="width:20px;padding:0 6px 0 0;">'
        f'<img src="{escape(club_logo_src, quote=True)}" alt="" width="20" height="20" '
        f'style="display:block;width:20px;height:20px;border:0;border-radius:10px;"></td>'
        if club_logo_src
        else ""
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        'style="border-collapse:collapse;margin:10px 2px 0;"><tr>'
        f'{logo}<td valign="middle" style="color:{_EMAIL_THEME["muted_foreground"]};'
        f'font:600 13px/1.3 sans-serif;">{escape(club_name)}</td></tr></table>'
    )


def _format_position_deadline(position: dict, tz: ZoneInfo) -> str | None:
    if position.get("deadline_at"):
        deadline = datetime.fromisoformat(str(position["deadline_at"]).replace("Z", "+00:00"))
        deadline = deadline.astimezone(tz)
    elif position.get("deadline_date"):
        deadline = datetime.fromisoformat(str(position["deadline_date"]))
    else:
        return None
    return f"{deadline.strftime('%a, %b')} {deadline.day}"


def _text_position(position: dict, tz: ZoneInfo, frontend_url: str) -> str:
    deadline = _format_position_deadline(position, tz)
    deadline_label = f"Apply by {deadline}" if deadline else "No deadline listed"
    return (
        f"- {position.get('title') or 'Untitled position'} | {deadline_label} | "
        f"{frontend_url}/positions"
    )


def _text_event(event: dict, tz: ZoneInfo, frontend_url: str) -> str:
    date_label, time_label = _format_event_date_time(event, tz)
    event_url = _event_url(event, frontend_url)
    return (
        f"- {event.get('title') or 'Untitled event'} | {date_label} {time_label} | "
        f"{event.get('location') or 'Location TBA'} | {event_url}"
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
) -> str:
    lines = [subject, "", "You're going to this event. Here's what changed:", ""]
    for label, old, new in _describe_changes(diff, tz):
        if old and new:
            lines.append(f"- {label}: {old} -> {new}")
        else:
            lines.append(f"- {label}: {new or f'{old} (removed)'}")
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
) -> str:
    return _email_shell(
        subject=subject,
        content=_event_spotlight(
            intro="You're going to this event. Here's what changed.",
            event=event,
            image_src=image_src,
            frontend_url=frontend_url,
            rows=_describe_changes(diff, tz),
        ),
        preferences_url=preferences_url,
        unsubscribe_url=unsubscribe_url,
    )


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
        f'<p style="margin:0 0 18px;color:{_EMAIL_THEME["muted_foreground"]};'
        f'font:15px/1.6 sans-serif;">{escape(intro)}</p>'
        f"{image}"
        f'<a href="{event_url}" style="color:{_EMAIL_THEME["foreground"]};'
        f'text-decoration:none;"><h2 style="margin:0 0 8px;font:700 19px sans-serif;">'
        f"{title}</h2></a>"
        + "".join(_detail_row_html(label, old, new) for label, old, new in rows)
        + f'<a href="{event_url}" style="display:inline-block;margin:20px 0 0;padding:12px 20px;'
        f"background:{_EMAIL_THEME['foreground']};color:{_EMAIL_THEME['background']};"
        'border-radius:999px;font:700 14px sans-serif;text-decoration:none;">'
        "View event on wat2do</a>"
    )


def _detail_row_html(label: str, old: str | None, new: str | None) -> str:
    muted = _EMAIL_THEME["muted_foreground"]
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
        f'<div style="padding:12px 0;border-top:1px solid {_EMAIL_THEME["border"]};">'
        f'<div style="margin:0 0 4px;color:{muted};font:700 12px sans-serif;'
        f'letter-spacing:.06em;text-transform:uppercase;">{escape(label)}</div>'
        f'<div style="color:{_EMAIL_THEME["foreground"]};font:15px/1.5 sans-serif;">'
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
