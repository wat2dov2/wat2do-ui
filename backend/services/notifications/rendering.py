"""Pure HTML and plain-text rendering for active notification types."""

from datetime import datetime, timezone
from html import escape
from zoneinfo import ZoneInfo

from core.config import settings

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
# Loot colors are decorative accents and never replace functional email colors.
_LOOT_COLORS = {
    "grey": "#a3a3a3",
    "bronze": "#f97316",
    "silver": "#d4d4d8",
    "gold": "#fbbf24",
    "diamond": "#60a5fa",
}


def morning_email_subject(picks_count: int) -> str:
    picks_label = f"{picks_count} new {'pick' if picks_count == 1 else 'picks'}"
    return f"{picks_label} for you"


def render_morning_email_text(
    *,
    subject: str,
    picks: list[dict],
    daily_score: int,
    loot_tier: str,
    tz: ZoneInfo,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    lines = [
        subject,
        "",
        f"Today's drop: {daily_score}/100 - {_loot_label(loot_tier)}",
        "",
        "New picks for you",
        "",
    ]
    lines.extend(_text_event(event, tz) for event in picks)
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
    daily_score: int,
    loot_tier: str,
    tz: ZoneInfo,
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    content = _loot_score_card(daily_score, loot_tier) + _event_section(
        "New picks for you", picks, tz
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
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    return "\n".join(
        [
            subject,
            "",
            _text_event(event, tz),
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
    preferences_url: str,
    unsubscribe_url: str,
) -> str:
    content = (
        f'<p style="margin:0 0 18px;color:{_EMAIL_THEME["muted_foreground"]};'
        'font:15px/1.6 sans-serif;">You marked this event as Going.</p>'
        + _event_section("Coming up", [event], tz)
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


def _loot_score_card(score: int, tier: str) -> str:
    tier_color = _LOOT_COLORS[tier]
    return (
        f'<div style="margin:0 0 24px;padding:16px;background:{_EMAIL_THEME["surface_elevated"]};'
        f'border:1px solid {_EMAIL_THEME["border"]};border-radius:12px;">'
        f'<p style="margin:0 0 6px;color:{_EMAIL_THEME["muted_foreground"]};'
        'font:700 12px sans-serif;letter-spacing:.06em;text-transform:uppercase;">'
        "Today's drop</p>"
        f'<p style="margin:0 0 12px;color:{_EMAIL_THEME["foreground"]};'
        f'font:800 24px sans-serif;">{score}/100 '
        f'<span style="color:{tier_color};font-size:15px;">{_loot_label(tier)}</span></p>'
        f'<div style="height:8px;background:{_EMAIL_THEME["border"]};border-radius:999px;'
        'overflow:hidden;">'
        f'<div style="width:{score}%;height:8px;background:{tier_color};'
        'border-radius:999px;"></div></div></div>'
    )


def _loot_label(tier: str) -> str:
    return f"{tier.title()} loot"


def _event_section(title: str, events: list[dict], tz: ZoneInfo) -> str:
    cards = "".join(_event_card(event, tz) for event in events)
    return (
        f'<h2 style="margin:24px 0 12px;color:{_EMAIL_THEME["foreground"]};'
        'font:700 19px sans-serif;">'
        f"{escape(title)}</h2>{cards}"
    )


def _event_card(event: dict, tz: ZoneInfo) -> str:
    event_id = int(event["id"])
    event_url = f"{settings.frontend_url.rstrip('/')}/?eventId={event_id}"
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


def _text_event(event: dict, tz: ZoneInfo) -> str:
    date_label, time_label = _format_event_date_time(event, tz)
    event_url = f"{settings.frontend_url.rstrip('/')}/?eventId={int(event['id'])}"
    return (
        f"- {event.get('title') or 'Untitled event'} | {date_label} {time_label} | "
        f"{event.get('location') or 'Location TBA'} | {event_url}"
    )


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


def _render_event_change_text(summary: dict, diff: dict) -> str:
    lines = [
        f"Update to an event you're going to: {summary.get('title', '')}",
        "",
    ]
    for field, change in diff.items():
        if field == "occurrences":
            lines.extend(_render_occurrence_diff_text(change))
        elif field == "cancelled":
            lines.append(_render_cancelled_diff_text(change))
        else:
            lines.append(f"  {field}: {change.get('old')} -> {change.get('new')}")
    lines.extend(["", f"Location: {summary.get('location', '')}"])
    return "\n".join(lines)


def _render_event_change_html(summary: dict, diff: dict) -> str:
    parts: list[str] = []
    for field, change in diff.items():
        if field == "occurrences":
            parts.append(_render_occurrence_diff_html(change))
        elif field == "cancelled":
            parts.append(_render_cancelled_diff_html(change))
        else:
            parts.append(
                f"<li><strong>{escape(str(field))}</strong>: "
                f"{escape(str(change.get('old')))} &rarr; "
                f"{escape(str(change.get('new')))}</li>"
            )
    return (
        "<p>Update to an event you're going to: "
        f"<strong>{escape(str(summary.get('title', '')))}</strong></p>"
        f"<ul>{''.join(parts)}</ul>"
        f"<p>Location: {escape(str(summary.get('location', '')))}</p>"
    )


def _render_cancelled_diff_text(change: dict) -> str:
    if change.get("new") is True:
        return "  status: cancelled"
    if change.get("old") is True and change.get("new") is False:
        return "  status: no longer cancelled"
    return f"  cancelled: {change.get('old')} -> {change.get('new')}"


def _render_cancelled_diff_html(change: dict) -> str:
    if change.get("new") is True:
        return "<li><strong>status</strong>: cancelled</li>"
    if change.get("old") is True and change.get("new") is False:
        return "<li><strong>status</strong>: no longer cancelled</li>"
    return (
        "<li><strong>cancelled</strong>: "
        f"{escape(str(change.get('old')))} &rarr; "
        f"{escape(str(change.get('new')))}</li>"
    )


def _occurrence_set(items: list[dict] | None) -> set[str]:
    if not items:
        return set()
    return {str(item["dtstart_utc"]) for item in items if item.get("dtstart_utc")}


def _format_occurrence_dt(dtstart_iso: str) -> str:
    try:
        dt = datetime.fromisoformat(dtstart_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return dtstart_iso
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _render_occurrence_diff_text(change: dict) -> list[str]:
    old_set = _occurrence_set(change.get("old"))
    new_set = _occurrence_set(change.get("new"))
    added = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)
    if not added and not removed:
        return ["  dates: edited"]
    lines = ["  dates:"]
    lines.extend(f"    + added {_format_occurrence_dt(value)}" for value in added)
    lines.extend(f"    - removed {_format_occurrence_dt(value)}" for value in removed)
    return lines


def _render_occurrence_diff_html(change: dict) -> str:
    old_set = _occurrence_set(change.get("old"))
    new_set = _occurrence_set(change.get("new"))
    added = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)
    if not added and not removed:
        return "<li><strong>dates</strong>: edited</li>"
    items = [
        f"<li>added <strong>{escape(_format_occurrence_dt(value))}</strong></li>" for value in added
    ]
    items.extend(
        f"<li>removed <strong>{escape(_format_occurrence_dt(value))}</strong></li>"
        for value in removed
    )
    return f"<li><strong>dates</strong>:<ul>{''.join(items)}</ul></li>"
