"""Pure HTML and plain-text rendering for active notification types."""

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

# Email clients do not reliably support CSS custom properties or OKLCH.
# These resolved sRGB values preserve the app's semantic dark-theme roles.
_EMAIL_THEME = {
    "background": "#121212",
    "surface": "#1a1a1a",
    "surface_elevated": "#222222",
    "foreground": "#f7f7f7",
    "muted_foreground": "#a3a3a3",
    "border": "#3a3a3a",
}


def morning_email_subject(picks_count: int) -> str:
    picks_label = f"{picks_count} new {'pick' if picks_count == 1 else 'picks'}"
    return f"{picks_label} for you"


def render_morning_email_text(
    *,
    subject: str,
    picks: list[dict],
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    lines = [
        subject,
        "",
        "New picks for you",
        "",
    ]
    lines.extend(_text_event(event, tz, frontend_url) for event in picks)
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
    picks: list[dict],
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    content = _event_section("New picks for you", picks, tz, frontend_url)
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
    return "\n".join(
        [
            subject,
            "",
            _text_event(event, tz, frontend_url),
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
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    content = (
        f'<p style="margin:0 0 18px;color:{_EMAIL_THEME["muted_foreground"]};'
        'font:15px/1.6 sans-serif;">You marked this event as Going.</p>'
        + _event_section("Coming up", [event], tz, frontend_url)
    )
    return _email_shell(
        subject=subject,
        content=content,
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
        f'<p style="margin:0 0 8px;color:{_EMAIL_THEME["muted_foreground"]};'
        'font:700 12px sans-serif;letter-spacing:.08em;text-transform:uppercase;">wat2do</p>'
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


def _event_section(
    title: str,
    events: list[dict],
    tz: ZoneInfo,
    frontend_url: str,
) -> str:
    cards = "".join(_event_card(event, tz, frontend_url) for event in events)
    return (
        f'<h2 style="margin:24px 0 12px;color:{_EMAIL_THEME["foreground"]};'
        'font:700 19px sans-serif;">'
        f"{escape(title)}</h2>{cards}"
    )


def _event_card(event: dict, tz: ZoneInfo, frontend_url: str) -> str:
    event_url = _event_url(event, frontend_url)
    title = escape(str(event.get("title") or "Untitled event"))
    location = escape(str(event.get("location") or "Location TBA"))
    date_label, time_label = _format_event_date_time(event, tz)
    return (
        f'<a style="display:block;margin:0 0 10px;padding:14px;'
        f"background:{_EMAIL_THEME['surface_elevated']};"
        f"border:1px solid {_EMAIL_THEME['border']};border-radius:12px;"
        f'color:{_EMAIL_THEME["foreground"]};text-decoration:none;" '
        f'href="{escape(event_url, quote=True)}">'
        f'<strong style="font:700 16px sans-serif;">{title}</strong><br>'
        f'<span style="color:{_EMAIL_THEME["muted_foreground"]};font:13px/1.5 sans-serif;">'
        f"{escape(date_label)} at {escape(time_label)} &middot; {location}</span></a>"
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
    tz: ZoneInfo,
    frontend_url: str,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    event_url = escape(_event_url(event, frontend_url), quote=True)
    title = escape(str(event.get("title") or "Untitled event"))
    image_url = event.get("source_image_url")
    image = (
        f'<a href="{event_url}"><img src="{escape(str(image_url), quote=True)}" '
        f'alt="{title}" width="590" style="display:block;width:100%;max-width:590px;'
        'height:auto;margin:0 0 20px;border-radius:12px;"></a>'
        if image_url
        else ""
    )
    rows = "".join(
        _change_row_html(label, old, new) for label, old, new in _describe_changes(diff, tz)
    )
    content = (
        f'<p style="margin:0 0 18px;color:{_EMAIL_THEME["muted_foreground"]};'
        "font:15px/1.6 sans-serif;\">You're going to this event. Here's what changed.</p>"
        f"{image}"
        f'<a href="{event_url}" style="color:{_EMAIL_THEME["foreground"]};'
        f'text-decoration:none;"><h2 style="margin:0 0 8px;font:700 19px sans-serif;">'
        f"{title}</h2></a>"
        f"{rows}"
        f'<a href="{event_url}" style="display:inline-block;margin:20px 0 0;padding:12px 20px;'
        f"background:{_EMAIL_THEME['foreground']};color:{_EMAIL_THEME['background']};"
        'border-radius:999px;font:700 14px sans-serif;text-decoration:none;">'
        "View event on wat2do</a>"
    )
    return _email_shell(
        subject=subject,
        content=content,
        preferences_url=preferences_url,
        unsubscribe_url=unsubscribe_url,
    )


def _change_row_html(label: str, old: str | None, new: str | None) -> str:
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
