from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import httpx
import pytest

from core.config import settings
from core.constants import (
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)
from jobs import send_notifications
from schemas.notification_preference import NotificationPreferenceUpdate
from services.notifications import (
    delivery_log,
    event_change,
    event_reminder,
    morning_email,
    preferences,
    rendering,
    unsubscribe,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(autouse=True)
def _school_timezone(monkeypatch):
    def resolve_timezone(_user):
        return ZoneInfo("America/Toronto")

    monkeypatch.setattr(morning_email, "resolve_user_timezone", resolve_timezone)
    monkeypatch.setattr(event_reminder, "resolve_user_timezone", resolve_timezone)
    monkeypatch.setattr(morning_email.school_service, "get_school_id", lambda _school: 1)


def _user(**overrides) -> dict:
    defaults = {
        "id": USER_ID,
        "email": "alice@uwaterloo.ca",
        "school": "uwaterloo",
    }
    defaults.update(overrides)
    return defaults


def _event(**overrides) -> dict:
    defaults = {
        "id": 42,
        "title": "Tea Tasting",
        "location": "SLC",
        "dtstart_utc": "2026-05-01T15:00:00+00:00",
        "added_at": "2026-05-01T12:00:00+00:00",
    }
    defaults.update(overrides)
    return defaults


def test_preferences_resolve_only_active_defaults(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    fake_sb.set_response(
        data=[
            {
                "notification_type": NOTIFICATION_TYPE_EVENT_CHANGE,
                "enabled": False,
                "updated_at": None,
            }
        ]
    )

    result = preferences.get_preferences(USER_ID)

    assert [item.notification_type for item in result] == [
        NOTIFICATION_TYPE_MORNING_EMAIL,
        NOTIFICATION_TYPE_EVENT_REMINDER,
        NOTIFICATION_TYPE_EVENT_CHANGE,
    ]
    assert result[0].enabled is True
    assert result[1].enabled is True
    assert result[2].enabled is False


def test_set_preferences_uses_user_type_conflict_key(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    preferences.set_preferences(
        USER_ID,
        [
            NotificationPreferenceUpdate(
                notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
                enabled=False,
            )
        ],
    )

    _payload, kwargs = fake_sb.upsert.call_args
    assert kwargs["on_conflict"] == "user_id,notification_type"


def test_claim_delivery_returns_only_claimed_rows(fake_sb, patch_sb):
    patch_sb("services.notifications.delivery_log")
    fake_sb.set_response(data=[{"id": "row-1", "claimed": True}])

    assert (
        delivery_log.claim_delivery(
            user_id=USER_ID,
            notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
            target_id="2026-05-01",
        )
        == "row-1"
    )
    fake_sb.rpc.assert_called_once()

    fake_sb.set_response(data=[{"id": "row-1", "claimed": False}])
    assert (
        delivery_log.claim_delivery(
            user_id=USER_ID,
            notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
            target_id="2026-05-01",
        )
        is None
    )


def test_event_change_empty_diff_is_noop():
    assert event_change.enqueue_event_change(None, {}, []) == 0


def test_morning_subject_uses_recommendation_count():
    assert rendering.morning_email_subject(4) == "4 new picks for you"
    assert rendering.morning_email_subject(1) == "1 new pick for you"


def test_morning_html_escapes_event_values(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    html = rendering.render_morning_email_html(
        subject="1 new pick for you",
        picks=[_event(title="<script>alert(1)</script>", location="SLC & DC")],
        tz=ZoneInfo("America/Toronto"),
        preferences_url="https://wat2do.app/settings",
        unsubscribe_url="https://wat2do.app/unsubscribe",
    )

    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "SLC &amp; DC" in html
    assert "/?eventId=42" in html
    assert "Today's drop" not in html
    assert "/100" not in html
    assert "background:#121212" in html


def test_unsubscribe_token_round_trip_and_tamper(monkeypatch):
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    token = unsubscribe.create_unsubscribe_token(
        USER_ID,
        NOTIFICATION_TYPE_EVENT_REMINDER,
    )

    assert unsubscribe.verify_unsubscribe_token(token) == unsubscribe.UnsubscribeTarget(
        user_id=USER_ID,
        notification_type=NOTIFICATION_TYPE_EVENT_REMINDER,
    )
    assert unsubscribe.verify_unsubscribe_token(f"{token}x") is None


def test_dispatch_batch_loaders_do_not_scale_per_user(monkeypatch):
    users = [_user(id=f"11111111-1111-1111-1111-{index:012d}") for index in range(20)]
    calls = {
        "preferences": 0,
        "candidates": 0,
        "stored": 0,
        "exclusions": 0,
    }

    monkeypatch.setattr(morning_email, "_fetch_users", lambda: users)
    monkeypatch.setattr(morning_email, "_eligible_users", lambda loaded, _now: loaded)

    def enabled(user_ids, _notification_type):
        calls["preferences"] += 1
        return set(user_ids)

    monkeypatch.setattr(morning_email, "get_enabled_user_ids", enabled)
    monkeypatch.setattr(
        morning_email,
        "_load_candidates_by_school",
        lambda _users, _now: calls.__setitem__("candidates", calls["candidates"] + 1) or {},
    )
    monkeypatch.setattr(
        morning_email,
        "get_stored_recommendations_for_users",
        lambda _ids: calls.__setitem__("stored", calls["stored"] + 1) or {},
    )
    monkeypatch.setattr(
        morning_email,
        "_load_going_exclusions",
        lambda _users, _events: calls.__setitem__("exclusions", calls["exclusions"] + 1) or {},
    )
    stats = morning_email.dispatch_morning_emails(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))

    assert stats["eligible"] == 20
    assert stats["prepared"] == 0
    assert calls == {
        "preferences": 1,
        "candidates": 1,
        "stored": 1,
        "exclusions": 1,
    }


def test_morning_email_eligibility_tracks_eastern_dst_and_delayed_starts():
    user = _user()

    assert morning_email._eligible_users(
        [user],
        datetime(2026, 1, 15, 14, tzinfo=timezone.utc),
    ) == [user]
    assert morning_email._eligible_users(
        [user],
        datetime(2026, 7, 15, 13, 59, tzinfo=timezone.utc),
    ) == [user]
    assert (
        morning_email._eligible_users(
            [user],
            datetime(2026, 7, 15, 12, 59, tzinfo=timezone.utc),
        )
        == []
    )


def test_notification_job_fails_when_any_delivery_fails(monkeypatch):
    dispatch = MagicMock(
        return_value={
            "eligible": 2,
            "prepared": 2,
            "sent": 1,
            "failed": 1,
            "skipped": 0,
        }
    )
    monkeypatch.setattr(send_notifications, "dispatch_morning_emails", dispatch)
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_MORNING_EMAIL,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 1
    dispatch.assert_called_once_with(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))


def test_notification_job_succeeds_without_delivery_failures(monkeypatch):
    monkeypatch.setattr(
        send_notifications,
        "dispatch_morning_emails",
        MagicMock(
            return_value={
                "eligible": 2,
                "prepared": 1,
                "sent": 1,
                "failed": 0,
                "skipped": 0,
            }
        ),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_MORNING_EMAIL,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 0


def test_notification_job_dispatches_event_reminders(monkeypatch):
    dispatch = MagicMock(
        return_value={
            "due": 1,
            "prepared": 1,
            "sent": 1,
            "failed": 0,
            "skipped": 0,
        }
    )
    monkeypatch.setattr(send_notifications, "dispatch_event_reminders", dispatch)
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_EVENT_REMINDER,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 0
    dispatch.assert_called_once_with(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))


def test_candidate_loader_uses_fixed_previous_24_hours(fake_sb, patch_sb):
    patch_sb("services.notifications.morning_email")
    fake_sb.set_response(data=[])

    result = morning_email._load_candidates_by_school(
        [_user()],
        datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result == {"uwaterloo": []}
    fake_sb.gt.assert_called_once_with("added_at", "2026-04-30T13:00:00+00:00")


def test_event_reminder_window_centers_on_one_hour():
    now = datetime(2026, 5, 1, 13, tzinfo=timezone.utc)

    assert event_reminder._reminder_window(now) == (
        now + timedelta(minutes=45),
        now + timedelta(minutes=65),
    )


def test_event_reminder_loader_uses_occurrence_window(fake_sb, patch_sb):
    patch_sb("services.notifications.event_reminder")
    fake_sb.set_response(data=[])
    window_start = datetime(2026, 5, 1, 13, 45, tzinfo=timezone.utc)
    window_end = datetime(2026, 5, 1, 14, 5, tzinfo=timezone.utc)

    assert event_reminder._load_due_reminders(window_start, window_end) == []

    fake_sb.gte.assert_called_once_with(
        "occurrence.dtstart_utc",
        "2026-05-01T13:45:00+00:00",
    )
    fake_sb.lt.assert_called_once_with(
        "occurrence.dtstart_utc",
        "2026-05-01T14:05:00+00:00",
    )
    fake_sb.eq.assert_called_once_with("event.cancelled", False)


def test_event_reminder_dispatch_uses_preferences_and_selected_occurrences(monkeypatch):
    reminder = {
        "user_id": USER_ID,
        "event_date_id": "22222222-2222-2222-2222-222222222222",
        "event": _event(),
    }
    monkeypatch.setattr(event_reminder, "_load_due_reminders", lambda _start, _end: [reminder])
    monkeypatch.setattr(event_reminder, "_load_users", lambda _ids: {USER_ID: _user()})
    monkeypatch.setattr(
        event_reminder,
        "get_enabled_user_ids",
        lambda _ids, _notification_type: {USER_ID},
    )
    send = MagicMock(return_value=True)
    monkeypatch.setattr(event_reminder, "_send_event_reminder", send)

    stats = event_reminder.dispatch_event_reminders(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))

    assert stats == {
        "due": 1,
        "prepared": 1,
        "sent": 1,
        "failed": 0,
        "skipped": 0,
    }
    send.assert_called_once_with(user=_user(), reminder=reminder)


def test_event_reminder_send_is_idempotent_per_occurrence_start(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    claim = MagicMock(return_value="row-1")
    monkeypatch.setattr(event_reminder, "claim_delivery", claim)
    deliver = MagicMock(return_value=True)
    monkeypatch.setattr(event_reminder, "deliver_claimed_email", deliver)
    reminder = {
        "user_id": USER_ID,
        "event_date_id": "22222222-2222-2222-2222-222222222222",
        "event": _event(title="<Tea>"),
    }

    assert event_reminder._send_event_reminder(user=_user(), reminder=reminder) is True

    claim.assert_called_once_with(
        user_id=USER_ID,
        notification_type=NOTIFICATION_TYPE_EVENT_REMINDER,
        target_id=("22222222-2222-2222-2222-222222222222:2026-05-01T15:00:00+00:00"),
    )
    message = deliver.call_args.kwargs["message"]
    assert message.subject == "Starts in about 1 hour: <Tea>"
    assert "&lt;Tea&gt;" in message.body_html
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_select_picks_uses_threshold_without_email_cap():
    candidates = [_event(id=event_id) for event_id in range(1, 13)]
    stored = [
        {
            "event_id": event_id,
            "predicted_score": 0.29 if event_id == 3 else 0.31,
        }
        for event_id in reversed(range(1, 13))
    ]

    result = morning_email._select_picks(
        user=_user(),
        candidates_by_school={"uwaterloo": candidates},
        stored=stored,
        excluded_event_ids={2},
    )

    assert [event["id"] for event in result] == [12, 11, 10, 9, 8, 7, 6, 5, 4, 1]
    assert all("recommendation_score" not in event for event in result)


def test_send_prepared_email_adds_unsubscribe_headers_without_rankings(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: "row-1")
    deliver = MagicMock(return_value=True)
    monkeypatch.setattr(morning_email, "deliver_claimed_email", deliver)

    result = morning_email._send_prepared_email(
        user=_user(),
        picks=[_event()],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is True
    message = deliver.call_args.kwargs["message"]
    assert message.headers["List-Unsubscribe"].startswith("<https://wat2do.app/")
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "Today's drop" not in message.body_html
    assert "Today's drop" not in message.body_text
    assert "/100" not in message.body_html
    assert "/100" not in message.body_text


def test_send_prepared_email_skips_when_delivery_is_already_claimed(monkeypatch):
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: None)
    deliver = MagicMock()
    monkeypatch.setattr(morning_email, "deliver_claimed_email", deliver)

    result = morning_email._send_prepared_email(
        user=_user(),
        picks=[_event()],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is None
    deliver.assert_not_called()


def test_claimed_delivery_retries_timeouts_then_marks_sent(monkeypatch):
    mark_sent = MagicMock()
    mark_failed = MagicMock()
    monkeypatch.setattr(delivery_log, "_mark_log_sent", mark_sent)
    monkeypatch.setattr(delivery_log, "_mark_log_failed", mark_failed)
    send = MagicMock(side_effect=[httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"), True])
    monkeypatch.setattr(delivery_log.email_service, "send", send)

    result = delivery_log.deliver_claimed_email(
        row_id="row-1",
        message=MagicMock(),
        provider_attempts=3,
        log_context="test",
    )

    assert result is True
    assert send.call_count == 3
    mark_sent.assert_called_once_with("row-1")
    mark_failed.assert_not_called()


def test_claimed_delivery_does_not_retry_terminal_provider_error(monkeypatch):
    monkeypatch.setattr(delivery_log, "_mark_log_sent", MagicMock())
    mark_failed = MagicMock()
    monkeypatch.setattr(delivery_log, "_mark_log_failed", mark_failed)
    request = httpx.Request("POST", "https://api.resend.com/emails")
    response = httpx.Response(400, request=request)
    send = MagicMock(
        side_effect=httpx.HTTPStatusError(
            "bad request",
            request=request,
            response=response,
        )
    )
    monkeypatch.setattr(delivery_log.email_service, "send", send)

    result = delivery_log.deliver_claimed_email(
        row_id="row-1",
        message=MagicMock(),
        provider_attempts=3,
        log_context="test",
    )

    assert result is False
    send.assert_called_once()
    mark_failed.assert_called_once_with("row-1", "provider_http_400")
