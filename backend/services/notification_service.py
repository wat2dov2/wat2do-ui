"""Compatibility facade for the split notifications service.

The old monolithic ``notification_service`` module mixed preference CRUD,
delivery-log deduplication, schedule decisions, event-change fanout, digest
composition, and email rendering. Keep this import surface stable for routers,
jobs, and tests while the implementation lives under ``services.notifications``.
"""

from services import school_context
from services.email_service import email_service
from services.notifications.delivery_log import (
    _mark_log_failed,
    _mark_log_sent,
    _try_insert_log_row,
)
from services.notifications.digests import (
    _fetch_events_for_day,
    _fetch_events_for_range,
    _fetch_events_in_utc_range,
    _fetch_new_events_added_since,
    _last_successful_send_at,
    _send_digest,
    send_daily_new_events_digest,
    send_morning_digest,
    send_weekly_digest,
)
from services.notifications.event_change import (
    _compute_change_hash,
    _send_event_change,
    enqueue_event_change,
)
from services.notifications.preferences import get_preferences, is_enabled, set_preferences
from services.notifications.rendering import (
    _category_email_colors,
    _daily_new_events_subject,
    _digest_subject,
    _format_digest_window,
    _format_event_date_time,
    _format_occurrence_dt,
    _occurrence_set,
    _render_daily_new_events_html,
    _render_daily_new_events_text,
    _render_digest_html,
    _render_digest_text,
    _render_email_event_card,
    _render_event_change_html,
    _render_event_change_text,
    _render_occurrence_diff_html,
    _render_occurrence_diff_text,
)
from services.notifications.schedule import (
    _ensure_aware_utc,
    is_daily_new_events_time,
    is_morning_digest_time,
    is_weekly_digest_time,
)

_canonical_school_key = school_context.canonical_school_key
_school_for_user = school_context.school_for_user
_user_tz = school_context.resolve_user_timezone

__all__ = [
    "email_service",
    "get_preferences",
    "set_preferences",
    "is_enabled",
    "enqueue_event_change",
    "send_daily_new_events_digest",
    "send_morning_digest",
    "send_weekly_digest",
    "is_daily_new_events_time",
    "is_morning_digest_time",
    "is_weekly_digest_time",
    "_category_email_colors",
    "_canonical_school_key",
    "_compute_change_hash",
    "_daily_new_events_subject",
    "_digest_subject",
    "_ensure_aware_utc",
    "_fetch_events_for_day",
    "_fetch_events_for_range",
    "_fetch_events_in_utc_range",
    "_fetch_new_events_added_since",
    "_format_digest_window",
    "_format_event_date_time",
    "_format_occurrence_dt",
    "_last_successful_send_at",
    "_mark_log_failed",
    "_mark_log_sent",
    "_occurrence_set",
    "_render_daily_new_events_html",
    "_render_daily_new_events_text",
    "_render_digest_html",
    "_render_digest_text",
    "_render_email_event_card",
    "_render_event_change_html",
    "_render_event_change_text",
    "_render_occurrence_diff_html",
    "_render_occurrence_diff_text",
    "_school_for_user",
    "_send_digest",
    "_send_event_change",
    "_try_insert_log_row",
    "_user_tz",
]
