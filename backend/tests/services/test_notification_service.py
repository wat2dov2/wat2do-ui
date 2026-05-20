"""Service-level tests for notification_service.

Covers the pieces router tests can't reach:
- Preference resolution (default fallback, explicit rows).
- Dedup via ``_try_insert_log_row`` — the UNIQUE constraint is the
  whole safety argument; assert the exception → None branch works.
- Fanout skips (no diff / no event / no saves / opt-out).
- Time-of-day dispatcher helpers — the cron's correctness depends on
  these returning the right date in the right timezone.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

from core.constants import (
    NOTIFICATION_TYPE_DAILY_NEW_EVENTS,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_MORNING_DIGEST,
    NOTIFICATION_TYPE_WEEKLY_DIGEST,
    PG_UNIQUE_VIOLATION,
)
from services import notification_service


def _user(**overrides) -> dict:
    defaults = {
        "id": "11111111-1111-1111-1111-111111111111",
        "email": "alice@uwaterloo.ca",
        "school": "university of waterloo",
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# Preferences — is_enabled / get_preferences / set_preferences
# ---------------------------------------------------------------------------


def test_is_enabled_missing_row_returns_default(fake_sb, patch_sb):
    """No row in prefs table → code default (True for all v1 types)."""
    patch_sb("services.notification_service")
    fake_sb.set_response(data=[])

    assert notification_service.is_enabled("user-uuid", NOTIFICATION_TYPE_EVENT_CHANGE) is True
    assert notification_service.is_enabled("user-uuid", NOTIFICATION_TYPE_DAILY_NEW_EVENTS) is False
    fake_sb.eq.assert_any_call("user_id", "user-uuid")
    fake_sb.eq.assert_any_call("notification_type", NOTIFICATION_TYPE_EVENT_CHANGE)


def test_is_enabled_explicit_row_returns_value(fake_sb, patch_sb):
    """Explicit row overrides the default (opt-out stays opt-out)."""
    patch_sb("services.notification_service")
    fake_sb.set_response(data=[{"enabled": False}])

    assert notification_service.is_enabled("user-uuid", NOTIFICATION_TYPE_MORNING_DIGEST) is False


def test_set_preferences_upserts_with_conflict_key(fake_sb, patch_sb):
    """Upsert must target the (user_id, notification_type) uniqueness key."""
    from schemas.notification_preference import NotificationPreferenceUpdate

    patch_sb("services.notification_service")
    fake_sb.set_response(data=[])

    updates = [
        NotificationPreferenceUpdate(
            notification_type=NOTIFICATION_TYPE_MORNING_DIGEST, enabled=False
        ),
    ]
    notification_service.set_preferences("user-uuid", updates)

    fake_sb.upsert.assert_called_once()
    payload, kwargs = fake_sb.upsert.call_args
    assert kwargs.get("on_conflict") == "user_id,notification_type"
    assert payload[0][0]["user_id"] == "user-uuid"
    assert payload[0][0]["enabled"] is False


def test_get_preferences_merges_default_for_missing_types(fake_sb, patch_sb):
    """Types with no row in the table come back as defaults, not omitted."""
    patch_sb("services.notification_service")
    fake_sb.set_response(
        data=[
            {
                "notification_type": NOTIFICATION_TYPE_MORNING_DIGEST,
                "enabled": False,
                "updated_at": None,
            },
        ]
    )

    prefs = notification_service.get_preferences("user-uuid")

    types = [p.notification_type for p in prefs]
    assert NOTIFICATION_TYPE_MORNING_DIGEST in types
    assert NOTIFICATION_TYPE_WEEKLY_DIGEST in types
    assert NOTIFICATION_TYPE_EVENT_CHANGE in types
    assert NOTIFICATION_TYPE_DAILY_NEW_EVENTS in types
    morning = next(p for p in prefs if p.notification_type == NOTIFICATION_TYPE_MORNING_DIGEST)
    assert morning.enabled is False  # explicit opt-out
    weekly = next(p for p in prefs if p.notification_type == NOTIFICATION_TYPE_WEEKLY_DIGEST)
    assert weekly.enabled is True  # default
    daily_new = next(p for p in prefs if p.notification_type == NOTIFICATION_TYPE_DAILY_NEW_EVENTS)
    assert daily_new.enabled is False  # opt-in only


# ---------------------------------------------------------------------------
# Dedup — _try_insert_log_row
# ---------------------------------------------------------------------------


def test_try_insert_log_row_returns_id_on_success(fake_sb, patch_sb):
    patch_sb("services.notification_service")
    fake_sb.set_response(data=[{"id": "log-row-uuid"}])

    row_id = notification_service._try_insert_log_row(
        user_id="user-uuid",
        notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
        target_id="42:abc123",
    )
    assert row_id == "log-row-uuid"


def test_try_insert_log_row_returns_none_on_unique_violation(fake_sb, patch_sb):
    """Dedup: unique-violation on the INSERT must collapse to None, not raise."""
    patch_sb("services.notification_service")
    fake_sb.raise_on_execute(Exception(f"duplicate key value ... {PG_UNIQUE_VIOLATION}"))

    row_id = notification_service._try_insert_log_row(
        user_id="user-uuid",
        notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
        target_id="42:abc123",
    )
    assert row_id is None


def test_try_insert_log_row_reraises_other_errors(fake_sb, patch_sb):
    """Non-uniqueness errors must not be swallowed."""
    patch_sb("services.notification_service")
    fake_sb.raise_on_execute(RuntimeError("connection refused"))

    with pytest.raises(RuntimeError, match="connection refused"):
        notification_service._try_insert_log_row(
            user_id="user-uuid",
            notification_type=NOTIFICATION_TYPE_EVENT_CHANGE,
            target_id="42:abc123",
        )


# ---------------------------------------------------------------------------
# enqueue_event_change — early-exit branches
# ---------------------------------------------------------------------------


def test_enqueue_event_change_empty_diff_noop():
    """Empty diff = nothing to notify. No DB calls, no-op return 0."""
    assert notification_service.enqueue_event_change(42, {}) == 0


# ---------------------------------------------------------------------------
# Occurrence-list diff rendering — the v1-style EventDates port produces a
# single ``occurrences`` field in the diff whose old/new values are full
# lists of occurrence dicts. Rendering must produce a human-readable bullet
# list, not the raw Python repr.
# ---------------------------------------------------------------------------


def _occ(dtstart_iso: str) -> dict:
    return {
        "dtstart_utc": dtstart_iso,
        "dtend_utc": None,
        "duration": None,
        "tz": None,
    }


def test_render_event_change_text_renders_added_occurrence():
    """Adding a date renders as ``+ added 2026-06-01 18:00 UTC``."""
    diff = {
        "occurrences": {
            "old": [_occ("2026-05-01T18:00:00+00:00")],
            "new": [_occ("2026-05-01T18:00:00+00:00"), _occ("2026-06-01T18:00:00+00:00")],
        },
    }
    summary = {"title": "Tea Tasting", "location": "SLC"}
    text = notification_service._render_event_change_text(summary, diff)
    assert "+ added 2026-06-01 18:00 UTC" in text
    # The unchanged date should NOT appear under added/removed.
    assert "+ added 2026-05-01" not in text
    # No raw Python repr leakage.
    assert "{'dtstart_utc'" not in text


def test_render_event_change_text_renders_removed_occurrence():
    diff = {
        "occurrences": {
            "old": [_occ("2026-05-01T18:00:00+00:00"), _occ("2026-06-01T18:00:00+00:00")],
            "new": [_occ("2026-05-01T18:00:00+00:00")],
        },
    }
    summary = {"title": "Tea Tasting", "location": "SLC"}
    text = notification_service._render_event_change_text(summary, diff)
    assert "- removed 2026-06-01 18:00 UTC" in text


def test_render_event_change_html_lists_added_and_removed():
    """HTML rendering uses <li> bullets nested under a <strong>dates</strong> heading."""
    diff = {
        "occurrences": {
            "old": [_occ("2026-05-01T18:00:00+00:00")],
            "new": [_occ("2026-06-01T18:00:00+00:00")],
        },
    }
    summary = {"title": "Tea Tasting", "location": "SLC"}
    html = notification_service._render_event_change_html(summary, diff)
    assert "<strong>dates</strong>" in html
    assert "added <strong>2026-06-01 18:00 UTC</strong>" in html
    assert "removed <strong>2026-05-01 18:00 UTC</strong>" in html
    # No Python list repr.
    assert "{'dtstart_utc'" not in html


def test_render_event_change_falls_back_to_edited_when_only_metadata_changed():
    """If nothing was added or removed (e.g. tz/duration changed but
    dtstart stayed the same), the diff still surfaces a generic
    ``dates: edited`` line rather than nothing.
    """
    diff = {
        "occurrences": {
            "old": [{"dtstart_utc": "2026-05-01T18:00:00+00:00", "tz": "UTC"}],
            "new": [{"dtstart_utc": "2026-05-01T18:00:00+00:00", "tz": "America/Toronto"}],
        },
    }
    summary = {"title": "Tea Tasting", "location": "SLC"}
    text = notification_service._render_event_change_text(summary, diff)
    assert "dates: edited" in text


def test_render_event_change_text_handles_malformed_iso_gracefully():
    """Malformed dtstart strings round-trip without crashing — fall back
    to the raw value."""
    diff = {
        "occurrences": {
            "old": [],
            "new": [_occ("not-a-date")],
        },
    }
    summary = {"title": "X", "location": "Y"}
    # Should not raise.
    text = notification_service._render_event_change_text(summary, diff)
    assert "not-a-date" in text  # raw value preserved


def test_enqueue_event_change_missing_event_returns_zero(fake_sb, patch_sb):
    """Event row fetched but empty → log warn, return 0."""
    patch_sb("services.notification_service")
    fake_sb.set_response(data=[])

    diff = {"status": {"old": "CONFIRMED", "new": "CANCELLED"}}
    assert notification_service.enqueue_event_change(9999, diff) == 0


def test_enqueue_event_change_no_saved_users_returns_zero(fake_sb, patch_sb):
    """Event exists but no one saved it → no fanout."""
    patch_sb("services.notification_service")
    fake_sb.queue_responses(
        [
            # 1: fetch event
            [{"title": "T", "location": "L", "dtstart_utc": None, "status": "CANCELLED"}],
            # 2: user_saved_events lookup — empty
            [],
        ]
    )

    diff = {"status": {"old": "CONFIRMED", "new": "CANCELLED"}}
    assert notification_service.enqueue_event_change(42, diff) == 0


# ---------------------------------------------------------------------------
# Cron dispatcher helpers
# ---------------------------------------------------------------------------


def test_is_morning_digest_time_returns_date_at_9am_local():
    """Waterloo (America/Toronto) at 13:00 UTC is 09:00 local (EDT in May)."""
    user = _user(school="university of waterloo")
    now_utc = datetime(2026, 5, 1, 13, 0, tzinfo=timezone.utc)
    result = notification_service.is_morning_digest_time(user, now_utc)
    assert result == date(2026, 5, 1)


def test_is_morning_digest_time_returns_none_off_hour():
    user = _user(school="university of waterloo")
    now_utc = datetime(2026, 5, 1, 16, 0, tzinfo=timezone.utc)  # noon local
    assert notification_service.is_morning_digest_time(user, now_utc) is None


def test_is_weekly_digest_time_returns_next_monday_on_sunday_6pm():
    """Sunday 6pm local → returns tomorrow (Monday) as the preview week start."""
    user = _user(school="university of waterloo")
    # 2026-05-03 is a Sunday; 18:00 EDT = 22:00 UTC
    now_utc = datetime(2026, 5, 3, 22, 0, tzinfo=timezone.utc)
    result = notification_service.is_weekly_digest_time(user, now_utc)
    assert result == date(2026, 5, 4)  # Monday
    assert result.weekday() == 0  # Monday


def test_is_weekly_digest_time_returns_none_not_sunday():
    """Monday 6pm local → None."""
    user = _user(school="university of waterloo")
    # 2026-05-04 is a Monday; 18:00 EDT = 22:00 UTC
    now_utc = datetime(2026, 5, 4, 22, 0, tzinfo=timezone.utc)
    assert notification_service.is_weekly_digest_time(user, now_utc) is None


def test_is_weekly_digest_time_returns_none_sunday_off_hour():
    user = _user(school="university of waterloo")
    # 2026-05-03 is Sunday; 15:00 UTC = 11am local, not 6pm
    now_utc = datetime(2026, 5, 3, 15, 0, tzinfo=timezone.utc)
    assert notification_service.is_weekly_digest_time(user, now_utc) is None


def test_unknown_school_falls_back_to_utc():
    """User with an unrecognised school gets UTC — digest still fires, just on UTC clock."""
    user = _user(email="person@example.edu", school="Some Unknown University")
    # 9am UTC directly
    now_utc = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
    assert notification_service.is_morning_digest_time(user, now_utc) == date(2026, 5, 1)


def test_is_daily_new_events_time_returns_local_timestamp_at_1030():
    """Waterloo (America/Toronto) at 14:30 UTC is 10:30 local (EDT in May)."""
    user = _user(school="university of waterloo")
    now_utc = datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc)
    result = notification_service.is_daily_new_events_time(user, now_utc)
    assert result is not None
    assert result.date() == date(2026, 5, 1)
    assert result.hour == 10
    assert result.minute == 30


def test_is_daily_new_events_time_returns_none_off_minute():
    user = _user(school="university of waterloo")
    now_utc = datetime(2026, 5, 1, 14, 0, tzinfo=timezone.utc)
    assert notification_service.is_daily_new_events_time(user, now_utc) is None


def test_send_daily_new_events_digest_sends_since_last_email(monkeypatch):
    user = _user(id="user-uuid", school="University of Waterloo")
    now_utc = datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc)
    previous_sent_at = datetime(2026, 4, 30, 14, 30, tzinfo=timezone.utc)
    event = {
        "id": 123,
        "title": "Tea Tasting",
        "location": "SLC",
        "dtstart_utc": "2026-05-03T18:00:00+00:00",
        "source_image_url": "https://example.com/tea.jpg",
        "category": "Food",
        "organization": "Tea Club",
        "added_at": "2026-05-01T12:00:00+00:00",
    }
    sent = MagicMock()
    mark_sent = MagicMock()
    captured = {}

    monkeypatch.setattr(notification_service, "is_enabled", lambda *_: True)
    monkeypatch.setattr(
        notification_service,
        "_last_successful_send_at",
        lambda *_: previous_sent_at,
    )

    def fake_fetch(*, school, start_utc, end_utc):
        captured.update({"school": school, "start_utc": start_utc, "end_utc": end_utc})
        return [event]

    monkeypatch.setattr(notification_service, "_fetch_new_events_added_since", fake_fetch)
    monkeypatch.setattr(notification_service, "_try_insert_log_row", lambda **_: "row-1")
    monkeypatch.setattr(notification_service, "_mark_log_sent", mark_sent)
    monkeypatch.setattr(notification_service.email_service, "send", sent)

    assert notification_service.send_daily_new_events_digest(user, now_utc) is True

    assert captured == {
        "school": "University of Waterloo",
        "start_utc": previous_sent_at,
        "end_utc": now_utc,
    }
    sent.assert_called_once()
    msg = sent.call_args.args[0]
    assert msg.to == "alice@uwaterloo.ca"
    assert msg.subject == "1 new event at University of Waterloo"
    assert "Tea Tasting" in msg.body_text
    assert "Tea Tasting" in msg.body_html
    assert "https://example.com/tea.jpg" in msg.body_html
    assert msg.idempotency_key == "daily_new_events:user-uuid:2026-05-01"
    mark_sent.assert_called_once_with("row-1")


def test_send_daily_new_events_digest_skips_without_events(monkeypatch):
    user = _user(id="user-uuid", school="University of Waterloo")
    monkeypatch.setattr(notification_service, "is_enabled", lambda *_: True)
    monkeypatch.setattr(notification_service, "_last_successful_send_at", lambda *_: None)
    monkeypatch.setattr(notification_service, "_fetch_new_events_added_since", lambda **_: [])
    insert = MagicMock()
    monkeypatch.setattr(notification_service, "_try_insert_log_row", insert)

    now_utc = datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc)
    assert notification_service.send_daily_new_events_digest(user, now_utc) is False
    insert.assert_not_called()


def test_render_daily_new_events_html_escapes_event_text():
    html = notification_service._render_daily_new_events_html(
        subject="1 new event at University of Waterloo",
        school="University of Waterloo",
        events=[
            {
                "title": "<script>alert(1)</script>",
                "location": "SLC & DC",
                "dtstart_utc": "2026-05-03T18:00:00+00:00",
                "category": "Technology",
                "organization": "Hack Club",
            }
        ],
        tz=ZoneInfo("America/Toronto"),
        window_start=datetime(2026, 4, 30, 14, 30, tzinfo=timezone.utc),
        window_end=datetime(2026, 5, 1, 14, 30, tzinfo=timezone.utc),
    )
    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "SLC &amp; DC" in html
