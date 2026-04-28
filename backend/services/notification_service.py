"""Notifications: preference CRUD + send pipeline.

Owns every outbound user-facing email. Public entry points:
- ``get_preferences(user_id)`` / ``set_preferences(user_id, updates)``:
  settings page wiring.
- ``is_enabled(user_id, notification_type)``: resolver used by the
  pipeline; callers never hit the prefs table directly.
- ``enqueue_event_change(event_id, diff)``: fanout hook invoked from
  the events PATCH router on a non-empty diff.
- ``send_morning_digest(user, local_date)`` and
  ``send_weekly_digest(user, iso_year, iso_week)``: per-user entry
  points called by the cron worker in ``jobs/send_notifications.py``.

Send pipeline for every type:
    1. is_enabled? if not, skip silently.
    2. _try_insert_log_row(...) with status='pending'.
       Uniqueness constraint => None means "already sent" (dedup).
    3. email_service.send(...).
    4. On success: _mark_log_sent. On failure: _mark_log_failed.

Skips never produce a log row — the UNIQUE constraint protects sends,
not decisions (see migration comments).
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from core.constants import (
    EVENT_STATUS_ACTIVE,
    NOTIFICATION_CHANNEL_EMAIL,
    NOTIFICATION_DEFAULT_ENABLED,
    NOTIFICATION_STATUS_FAILED,
    NOTIFICATION_STATUS_PENDING,
    NOTIFICATION_STATUS_SENT,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
    NOTIFICATION_TYPES,
    PG_UNIQUE_VIOLATION,
    SCHOOL_ALIASES,
    SCHOOL_TIMEZONES,
)
from core.database import get_sb
from core.tables import (
    EVENTS,
    EVENTS_LISTING,
    NOTIFICATIONS_LOG,
    NOTIFICATION_PREFERENCES,
    USERS,
    USER_SAVED_EVENTS,
)
from schemas.notification_preference import (
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
)
from services.email_service import EmailMessage, email_service

log = logging.getLogger(__name__)

# Cron-firing constants — hour-of-day / day-of-week in the user's local
# timezone. The hourly cron iterates users, converts UTC → local per
# user's school tz, and fires when the local clock matches. Change
# these once to move the send time for every school.
MORNING_DIGEST_HOUR = 9
WEEKLY_DIGEST_HOUR = 18
WEEKLY_DIGEST_WEEKDAY = 6  # Python weekday(): Mon=0 ... Sun=6


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


def get_preferences(user_id: str) -> list[NotificationPreferenceResponse]:
    """Return one resolved entry per notification type.

    Types with no row in ``notification_preferences`` fall back to
    ``NOTIFICATION_DEFAULT_ENABLED`` — absence means "never explicitly
    set", not "disabled". Callers render one toggle per entry.
    """
    rows = (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .select("notification_type, enabled, updated_at")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    by_type = {row["notification_type"]: row for row in rows}

    prefs: list[NotificationPreferenceResponse] = []
    for t in NOTIFICATION_TYPES:
        if t in by_type:
            prefs.append(NotificationPreferenceResponse.model_validate(by_type[t]))
            continue
        prefs.append(
            NotificationPreferenceResponse(
                notification_type=t,
                enabled=NOTIFICATION_DEFAULT_ENABLED[t],
                updated_at=None,
            )
        )
    return prefs


def set_preferences(
    user_id: str, updates: list[NotificationPreferenceUpdate]
) -> None:
    """Upsert one row per (user, type) pair from ``updates``."""
    if not updates:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "user_id": user_id,
            "notification_type": u.notification_type,
            "enabled": u.enabled,
            "updated_at": now_iso,
        }
        for u in updates
    ]
    (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .upsert(payload, on_conflict="user_id,notification_type")
        .execute()
    )


def is_enabled(user_id: str, notification_type: str) -> bool:
    """Resolve a user's current opt-in state for a notification type."""
    r = (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .select("enabled")
        .eq("user_id", user_id)
        .eq("notification_type", notification_type)
        .limit(1)
        .execute()
    )
    if r.data:
        return bool(r.data[0]["enabled"])
    return NOTIFICATION_DEFAULT_ENABLED.get(notification_type, False)


# ---------------------------------------------------------------------------
# event_change — router-triggered fanout
# ---------------------------------------------------------------------------


def _compute_change_hash(diff: dict[str, dict[str, Any]]) -> str:
    """Stable short hash over the diff content for dedup.

    Idempotent rediscovery of the same diff collapses to one log row.
    A second distinct change to the same event gets its own hash and
    therefore its own send.
    """
    payload = json.dumps(diff, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def enqueue_event_change(
    event_id: int, diff: dict[str, dict[str, Any]]
) -> int:
    """Fanout an event_change alert to everyone who saved the event.

    Returns the number of emails actually sent (after prefs + dedup).
    No-op on empty diff. Safe to call on missing events.
    """
    if not diff:
        return 0

    event_row = (
        get_sb()
        .table(EVENTS)
        .select("title, location, status")
        .eq("id", event_id)
        .limit(1)
        .execute()
    ).data or []
    if not event_row:
        log.warning("enqueue_event_change: event %s not found", event_id)
        return 0
    event_summary = event_row[0]

    saved_rows = (
        get_sb()
        .table(USER_SAVED_EVENTS)
        .select("user_id")
        .eq("event_id", event_id)
        .execute()
    ).data or []
    user_ids = [r["user_id"] for r in saved_rows]
    if not user_ids:
        return 0

    users = (
        get_sb()
        .table(USERS)
        .select("id, email")
        .in_("id", user_ids)
        .execute()
    ).data or []
    by_id = {u["id"]: u for u in users}

    change_hash = _compute_change_hash(diff)
    target_id = f"{event_id}:{change_hash}"

    sent = 0
    for user_id in user_ids:
        user = by_id.get(user_id)
        if not user or not user.get("email"):
            continue
        if not is_enabled(user_id, NOTIFICATION_TYPE_EVENT_CHANGE):
            continue
        if _send_event_change(
            user_id=user_id,
            email=user["email"],
            event_id=event_id,
            event_summary=event_summary,
            diff=diff,
            target_id=target_id,
        ):
            sent += 1
    return sent


def _send_event_change(
    *,
    user_id: str,
    email: str,
    event_id: int,
    event_summary: dict,
    diff: dict,
    target_id: str,
) -> bool:
    row_id = _try_insert_log_row(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
        target_id=target_id,
        changed_fields=diff,
    )
    if row_id is None:
        return False
    subject = f"Update: {event_summary.get('title', 'an event you saved')}"
    try:
        email_service.send(
            EmailMessage(
                to=email,
                subject=subject,
                body_html=_render_event_change_html(event_summary, diff),
                body_text=_render_event_change_text(event_summary, diff),
                idempotency_key=f"{NOTIFICATION_TYPE_EVENT_CHANGE}:{user_id}:{target_id}",
            )
        )
    except Exception as e:
        log.warning(
            "event_change send failed user=%s event=%s: %s", user_id, event_id, e
        )
        _mark_log_failed(row_id)
        return False
    _mark_log_sent(row_id)
    return True


# ---------------------------------------------------------------------------
# Digests — cron-triggered
# ---------------------------------------------------------------------------


def send_morning_digest(user: dict, local_date: date) -> bool:
    """Send one user's morning digest for ``local_date``. No-op on skip."""
    user_id = user["id"]
    email = user.get("email")
    if not email:
        return False
    if not is_enabled(user_id, NOTIFICATION_TYPE_MORNING_DIGEST):
        return False

    events = _fetch_events_for_day(
        school=user.get("school"),
        local_date=local_date,
        tz=_user_tz(user),
    )
    if not events:
        log.info(
            "skipped morning_digest user=%s reason=no_events date=%s",
            user_id,
            local_date,
        )
        return False

    return _send_digest(
        user_id=user_id,
        email=email,
        notification_type=NOTIFICATION_TYPE_MORNING_DIGEST,
        target_id=local_date.isoformat(),
        subject=_digest_subject(len(events), "today"),
        events=events,
    )


def send_weekly_digest(user: dict, week_start: date) -> bool:
    """Send one user's weekly digest previewing the week that starts ``week_start``.

    ``week_start`` is the Monday of the preview week — on Sunday 6pm local,
    the cron passes tomorrow. target_id is the ISO week label for that
    preview week, so two Sundays in the same real week (e.g. a DST day)
    can't double-send.
    """
    user_id = user["id"]
    email = user.get("email")
    if not email:
        return False
    if not is_enabled(user_id, NOTIFICATION_TYPE_WEEKLY_DIGEST):
        return False

    tz = _user_tz(user)
    week_end = week_start + timedelta(days=6)
    events = _fetch_events_for_range(
        school=user.get("school"),
        start_date=week_start,
        end_date=week_end,
        tz=tz,
    )
    iso = week_start.isocalendar()
    if not events:
        log.info(
            "skipped weekly_digest user=%s reason=no_events week=%s-W%s",
            user_id,
            iso[0],
            iso[1],
        )
        return False

    return _send_digest(
        user_id=user_id,
        email=email,
        notification_type=NOTIFICATION_TYPE_WEEKLY_DIGEST,
        target_id=f"{iso[0]}-W{iso[1]:02d}",
        subject=_digest_subject(len(events), "this week"),
        events=events,
    )


def is_morning_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return the user's local date if ``now_utc`` is 9am-local, else None.

    Dispatcher helper for the hourly cron: lets the cron stay school-
    agnostic and makes the decision testable (inject a fixed ``now_utc``).
    """
    local = now_utc.astimezone(_user_tz(user))
    if local.hour == MORNING_DIGEST_HOUR:
        return local.date()
    return None


def is_weekly_digest_time(user: dict, now_utc: datetime) -> date | None:
    """Return Monday-of-preview-week if ``now_utc`` is Sunday 6pm-local.

    Sunday evening previews the UPCOMING week (tomorrow onwards), so the
    returned date is ``local.date() + 1 day`` — always a Monday.
    """
    local = now_utc.astimezone(_user_tz(user))
    if (
        local.weekday() == WEEKLY_DIGEST_WEEKDAY
        and local.hour == WEEKLY_DIGEST_HOUR
    ):
        return local.date() + timedelta(days=1)
    return None


def _send_digest(
    *,
    user_id: str,
    email: str,
    notification_type: str,
    target_id: str,
    subject: str,
    events: list[dict],
) -> bool:
    row_id = _try_insert_log_row(
        user_id=user_id,
        notification_type=notification_type,
        target_id=target_id,
    )
    if row_id is None:
        return False
    try:
        email_service.send(
            EmailMessage(
                to=email,
                subject=subject,
                body_html=_render_digest_html(subject, events),
                body_text=_render_digest_text(subject, events),
                idempotency_key=f"{notification_type}:{user_id}:{target_id}",
            )
        )
    except Exception as e:
        log.warning(
            "digest send failed user=%s type=%s target=%s: %s",
            user_id,
            notification_type,
            target_id,
            e,
        )
        _mark_log_failed(row_id)
        return False
    _mark_log_sent(row_id)
    return True


# ---------------------------------------------------------------------------
# Private log-row helpers
# ---------------------------------------------------------------------------


def _try_insert_log_row(
    *,
    user_id: str,
    notification_type: str,
    target_id: str,
    changed_fields: dict | None = None,
    channel: str = NOTIFICATION_CHANNEL_EMAIL,
) -> str | None:
    """Insert a ``pending`` log row. Return the row id, or None on dedup.

    The UNIQUE (user_id, notification_type, target_id, channel) key is
    what makes this safe across worker restarts and concurrent runs.
    """
    payload: dict[str, Any] = {
        "user_id": user_id,
        "notification_type": notification_type,
        "target_id": target_id,
        "channel": channel,
        "status": NOTIFICATION_STATUS_PENDING,
    }
    if changed_fields is not None:
        payload["changed_fields"] = changed_fields
    try:
        r = get_sb().table(NOTIFICATIONS_LOG).insert(payload).execute()
    except Exception as e:
        if PG_UNIQUE_VIOLATION in str(e):
            return None
        raise
    if r.data:
        return r.data[0]["id"]
    return None


def _mark_log_sent(row_id: str) -> None:
    (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .update(
            {
                "status": NOTIFICATION_STATUS_SENT,
                "sent_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", row_id)
        .execute()
    )


def _mark_log_failed(row_id: str) -> None:
    (
        get_sb()
        .table(NOTIFICATIONS_LOG)
        .update({"status": NOTIFICATION_STATUS_FAILED})
        .eq("id", row_id)
        .execute()
    )


# ---------------------------------------------------------------------------
# Timezone + event fetch helpers (digest composition)
# ---------------------------------------------------------------------------


def _user_tz(user: dict) -> ZoneInfo:
    school = (user.get("school") or "").strip().lower()
    canonical = SCHOOL_ALIASES.get(school, school)
    tz_name = SCHOOL_TIMEZONES.get(canonical)
    if not tz_name:
        log.warning(
            "unresolved school=%r for user=%s; falling back to UTC",
            school,
            user.get("id"),
        )
        return ZoneInfo("UTC")
    return ZoneInfo(tz_name)


def _fetch_events_for_day(
    *, school: str | None, local_date: date, tz: ZoneInfo
) -> list[dict]:
    start_local = datetime.combine(local_date, time.min, tzinfo=tz)
    end_local = datetime.combine(local_date, time.max, tzinfo=tz)
    return _fetch_events_in_utc_range(
        school=school,
        start_utc=start_local.astimezone(timezone.utc),
        end_utc=end_local.astimezone(timezone.utc),
    )


def _fetch_events_for_range(
    *,
    school: str | None,
    start_date: date,
    end_date: date,
    tz: ZoneInfo,
) -> list[dict]:
    start_local = datetime.combine(start_date, time.min, tzinfo=tz)
    end_local = datetime.combine(end_date, time.max, tzinfo=tz)
    return _fetch_events_in_utc_range(
        school=school,
        start_utc=start_local.astimezone(timezone.utc),
        end_utc=end_local.astimezone(timezone.utc),
    )


def _fetch_events_in_utc_range(
    *,
    school: str | None,
    start_utc: datetime,
    end_utc: datetime,
) -> list[dict]:
    """Fetch events with at least one occurrence in [start_utc, end_utc].

    Reads from the events_listing view so the dtstart_utc filter and sort
    operate on the joined event_dates row. Multi-occurrence events with
    several occurrences in the range collapse to one entry per event,
    keyed on the earliest matching occurrence (the row order from the
    view's ``order(dtstart_utc)``).
    """
    q = (
        get_sb()
        .table(EVENTS_LISTING)
        .select("id, title, location, dtstart_utc")
        .eq("status", EVENT_STATUS_ACTIVE)
        .gte("dtstart_utc", start_utc.isoformat())
        .lte("dtstart_utc", end_utc.isoformat())
        .order("dtstart_utc")
    )
    if school:
        q = q.eq("school", school)
    rows = q.execute().data or []
    seen: set[int] = set()
    deduped: list[dict] = []
    for row in rows:
        eid = row.get("id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(row)
    return deduped


# ---------------------------------------------------------------------------
# Rendering — minimal v1 templates inlined here
# ---------------------------------------------------------------------------


def _digest_subject(count: int, when: str) -> str:
    noun = "event" if count == 1 else "events"
    return f"{count} {noun} for you {when}"


def _render_event_change_text(summary: dict, diff: dict) -> str:
    lines = [
        f"Update to an event you saved: {summary.get('title', '')}",
        "",
    ]
    for field, change in diff.items():
        if field == "occurrences":
            lines.extend(_render_occurrence_diff_text(change))
        else:
            lines.append(
                f"  {field}: {change.get('old')} -> {change.get('new')}"
            )
    lines.append("")
    lines.append(f"Location: {summary.get('location', '')}")
    return "\n".join(lines)


def _render_event_change_html(summary: dict, diff: dict) -> str:
    parts: list[str] = []
    for field, change in diff.items():
        if field == "occurrences":
            parts.append(_render_occurrence_diff_html(change))
        else:
            parts.append(
                f"<li><strong>{field}</strong>: "
                f"{change.get('old')} &rarr; {change.get('new')}</li>"
            )
    rows = "".join(parts)
    return (
        f"<p>Update to an event you saved: <strong>{summary.get('title', '')}</strong></p>"
        f"<ul>{rows}</ul>"
        f"<p>Location: {summary.get('location', '')}</p>"
    )


# ---------------------------------------------------------------------------
# Occurrence-list diff rendering
#
# After the v1-style EventDates port, ``compute_event_diff`` emits a single
# ``occurrences`` field whose old/new values are full lists of occurrence
# dicts. Dumping the raw Python list-of-dicts into the email body produced
# unreadable output ("`[{'dtstart_utc': '2026-05-01T18:00:00+00:00', ...}, ...]`").
# These helpers render added / removed / unchanged dates as a human-friendly
# bullet list keyed on dtstart_utc.
# ---------------------------------------------------------------------------


def _occurrence_set(items: list[dict] | None) -> set[str]:
    """Return the set of dtstart_utc strings on a list of occurrence dicts."""
    if not items:
        return set()
    return {it.get("dtstart_utc") for it in items if it.get("dtstart_utc")}


def _format_occurrence_dt(dtstart_iso: str) -> str:
    """Pretty-format ``2026-05-01T18:00:00+00:00`` -> ``2026-05-01 18:00 UTC``.

    Falls back to the raw string if the value isn't ISO-8601 — defensive
    against legacy or malformed rows.
    """
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
    return (
        f"<li><strong>dates</strong>:<ul>{''.join(items)}</ul></li>"
    )


def _render_digest_text(subject: str, events: list[dict]) -> str:
    lines = [subject, ""]
    for e in events:
        lines.append(
            f"  - {e.get('title', '')} @ {e.get('location', '')} "
            f"({e.get('dtstart_utc', '')})"
        )
    return "\n".join(lines)


def _render_digest_html(subject: str, events: list[dict]) -> str:
    items = "".join(
        f"<li><strong>{e.get('title', '')}</strong> @ {e.get('location', '')} "
        f"<em>({e.get('dtstart_utc', '')})</em></li>"
        for e in events
    )
    return f"<p>{subject}</p><ul>{items}</ul>"
