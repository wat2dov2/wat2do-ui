"""Email subject/body rendering for notification sends."""

from datetime import datetime, timezone
from html import escape
from zoneinfo import ZoneInfo

from services.notifications.schedule import ensure_aware_utc


def _digest_subject(count: int, when: str) -> str:
    noun = "event" if count == 1 else "events"
    return f"{count} {noun} for you {when}"


def _daily_new_events_subject(count: int, school: str) -> str:
    noun = "event" if count == 1 else "events"
    return f"{count} new {noun} at {school}"


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


def _format_digest_window(window_start: datetime, window_end: datetime, tz: ZoneInfo) -> str:
    start = ensure_aware_utc(window_start).astimezone(tz)
    end = ensure_aware_utc(window_end).astimezone(tz)
    return (
        f"{start.strftime('%b')} {start.day}, "
        f"{start.hour % 12 or 12}:{start.minute:02d} "
        f"{'AM' if start.hour < 12 else 'PM'} - "
        f"{end.strftime('%b')} {end.day}, "
        f"{end.hour % 12 or 12}:{end.minute:02d} "
        f"{'AM' if end.hour < 12 else 'PM'}"
    )


def _category_email_colors(category: str | None) -> tuple[str, str]:
    c = category or "Events"
    if c == "Arts & Culture":
        return "#fdf2f8", "#db2777"
    if c == "Business":
        return "#e0f2fe", "#0284c7"
    if c == "Community Service":
        return "#f0fdf4", "#16a34a"
    if c == "Environment":
        return "#ecfdf5", "#059669"
    if c == "Games & Recreation":
        return "#ecfeff", "#0891b2"
    if c == "Health":
        return "#ecfdf5", "#059669"
    if c == "Media & Web":
        return "#eef2ff", "#4f46e5"
    if c == "Politics & Advocacy":
        return "#fff1f2", "#e11d48"
    if c == "Religion & Spirituality":
        return "#f5f3ff", "#7c3aed"
    return "#f4f4f5", "#52525b"


def _render_email_event_card(event: dict, tz: ZoneInfo) -> str:
    title = escape(str(event.get("title") or "Untitled event"))
    location = escape(str(event.get("location") or "Location TBA"))
    ig = event.get("ig_handle")
    formatted_handle = f"@{str(ig).lstrip('@')}" if ig else None
    organization = escape(str(event.get("organization") or formatted_handle or "Campus event"))
    category = str(event.get("category") or "Events")
    category_bg, category_fg = _category_email_colors(category)
    date_label, time_label = _format_event_date_time(event, tz)
    image_url = event.get("source_image_url")
    if image_url:
        media = (
            f'<img src="{escape(str(image_url), quote=True)}" alt="{title}" '
            'style="display:block;width:100%;height:180px;object-fit:cover;'
            'border:0;background:#f4f4f5;" />'
        )
    else:
        media = (
            '<div style="height:180px;background:linear-gradient(135deg,#f4f4f5,#e4e4e7);'
            "display:flex;align-items:center;justify-content:center;color:#a1a1aa;"
            'font:600 13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
            "No image</div>"
        )
    return (
        '<div style="border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;'
        'background:#ffffff;margin:0 0 18px 0;">'
        f'<div style="position:relative;">{media}'
        '<div style="position:absolute;top:10px;left:10px;">'
        f'<span style="display:inline-block;background:{category_bg};color:{category_fg};'
        "border-radius:999px;padding:4px 9px;font:700 11px -apple-system,"
        f'BlinkMacSystemFont,Segoe UI,sans-serif;">{escape(category)}</span>'
        "</div>"
        '<div style="position:absolute;bottom:10px;left:10px;">'
        '<span style="display:inline-block;background:#ffffff;border:1px solid #18181b;'
        "color:#18181b;border-radius:999px;padding:4px 9px;font:700 11px "
        f'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">{organization}</span>'
        "</div>"
        "</div>"
        '<div style="padding:16px 18px 14px 18px;">'
        f'<h2 style="margin:0 0 14px 0;color:#18181b;font:700 18px/1.25 '
        f'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">{title}</h2>'
        '<div style="color:#71717a;font:500 12px/1.5 -apple-system,'
        'BlinkMacSystemFont,Segoe UI,sans-serif;">'
        f"<div>{escape(date_label)}</div>"
        f"<div>{escape(time_label)}</div>"
        f"<div>{location}</div>"
        "</div>"
        "</div>"
        "</div>"
    )


def _render_daily_new_events_text(
    *,
    subject: str,
    events: list[dict],
    school: str,
    tz: ZoneInfo,
    window_start: datetime,
    window_end: datetime,
) -> str:
    lines = [
        subject,
        f"Newly added events for {school}.",
        f"Window: {_format_digest_window(window_start, window_end, tz)}",
        "",
    ]
    for event in events:
        date_label, time_label = _format_event_date_time(event, tz)
        lines.append(
            f"- {event.get('title', 'Untitled event')} | {date_label} "
            f"{time_label} | {event.get('location', 'Location TBA')}"
        )
    lines.extend(["", "You are receiving this because you opted in during signup."])
    return "\n".join(lines)


def _render_daily_new_events_html(
    *,
    subject: str,
    events: list[dict],
    school: str,
    tz: ZoneInfo,
    window_start: datetime,
    window_end: datetime,
) -> str:
    cards = "".join(_render_email_event_card(event, tz) for event in events)
    return (
        '<div style="margin:0;padding:0;background:#f7f7f8;">'
        '<div style="max-width:640px;margin:0 auto;padding:28px 18px 32px 18px;">'
        '<div style="margin:0 0 18px 0;">'
        '<p style="margin:0 0 8px 0;color:#71717a;font:700 12px/1.4 '
        "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-transform:uppercase;"
        'letter-spacing:.08em;">wat2do</p>'
        f'<h1 style="margin:0;color:#18181b;font:800 28px/1.1 '
        f'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">{escape(subject)}</h1>'
        f'<p style="margin:10px 0 0 0;color:#52525b;font:500 14px/1.5 '
        f'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Newly added events for '
        f"{escape(school)} from {escape(_format_digest_window(window_start, window_end, tz))}.</p>"
        "</div>"
        f"{cards}"
        '<p style="margin:18px 0 0 0;color:#71717a;font:500 12px/1.5 '
        '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">'
        "You are receiving this because you opted in during signup."
        "</p>"
        "</div>"
        "</div>"
    )


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
    lines.append("")
    lines.append(f"Location: {summary.get('location', '')}")
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
                f"<li><strong>{field}</strong>: {change.get('old')} &rarr; {change.get('new')}</li>"
            )
    rows = "".join(parts)
    return (
        f"<p>Update to an event you're going to: <strong>{summary.get('title', '')}</strong></p>"
        f"<ul>{rows}</ul>"
        f"<p>Location: {summary.get('location', '')}</p>"
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
    return f"<li><strong>cancelled</strong>: {change.get('old')} &rarr; {change.get('new')}</li>"


def _occurrence_set(items: list[dict] | None) -> set[str]:
    """Return the set of dtstart_utc strings on a list of occurrence dicts."""
    if not items:
        return set()
    return {it.get("dtstart_utc") for it in items if it.get("dtstart_utc")}


def _format_occurrence_dt(dtstart_iso: str) -> str:
    """Pretty-format ``2026-05-01T18:00:00+00:00`` -> ``2026-05-01 18:00 UTC``."""
    try:
        dt = datetime.fromisoformat(dtstart_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return dtstart_iso
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _render_occurrence_diff_text(change: dict) -> list[str]:
    """Render ``occurrences`` change as plain-text bullets."""
    old_set = _occurrence_set(change.get("old"))
    new_set = _occurrence_set(change.get("new"))
    added = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)
    if not added and not removed:
        return ["  dates: edited"]
    out: list[str] = ["  dates:"]
    for ts in added:
        out.append(f"    + added {_format_occurrence_dt(ts)}")
    for ts in removed:
        out.append(f"    - removed {_format_occurrence_dt(ts)}")
    return out


def _render_occurrence_diff_html(change: dict) -> str:
    """Render ``occurrences`` change as one HTML <li> per added/removed date."""
    old_set = _occurrence_set(change.get("old"))
    new_set = _occurrence_set(change.get("new"))
    added = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)
    if not added and not removed:
        return "<li><strong>dates</strong>: edited</li>"
    items: list[str] = []
    for ts in added:
        items.append(f"<li>added <strong>{_format_occurrence_dt(ts)}</strong></li>")
    for ts in removed:
        items.append(f"<li>removed <strong>{_format_occurrence_dt(ts)}</strong></li>")
    return f"<li><strong>dates</strong>:<ul>{''.join(items)}</ul></li>"


def _render_digest_text(subject: str, events: list[dict]) -> str:
    lines = [subject, ""]
    for e in events:
        lines.append(
            f"  - {e.get('title', '')} @ {e.get('location', '')} ({e.get('dtstart_utc', '')})"
        )
    return "\n".join(lines)


def _render_digest_html(subject: str, events: list[dict]) -> str:
    items = "".join(
        f"<li><strong>{e.get('title', '')}</strong> @ {e.get('location', '')} "
        f"<em>({e.get('dtstart_utc', '')})</em></li>"
        for e in events
    )
    return f"<p>{subject}</p><ul>{items}</ul>"
