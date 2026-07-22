from datetime import datetime, timezone
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import httpx

from core.config import settings
from core.constants import (
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)
from schemas.notification_preference import NotificationPreferenceUpdate
from services.notifications import (
    delivery_log,
    event_change,
    morning_email,
    preferences,
    rendering,
    unsubscribe,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


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
        NOTIFICATION_TYPE_EVENT_CHANGE,
    ]
    assert result[0].enabled is True
    assert result[1].enabled is False


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


def test_morning_subject_matrix():
    assert rendering.morning_email_subject(2, 4) == "2 events today + 4 new picks"
    assert rendering.morning_email_subject(1, 0) == "1 event today"
    assert rendering.morning_email_subject(0, 1) == "1 new pick for you"


def test_morning_html_escapes_event_values(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    html = rendering.render_morning_email_html(
        subject="1 event today",
        today=[_event(title="<script>alert(1)</script>", location="SLC & DC")],
        picks=[],
        tz=ZoneInfo("America/Toronto"),
        preferences_url="https://wat2do.app/settings",
        unsubscribe_url="https://wat2do.app/unsubscribe",
    )

    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "SLC &amp; DC" in html
    assert "/?eventId=42" in html


def test_unsubscribe_token_round_trip_and_tamper(monkeypatch):
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    token = unsubscribe.create_unsubscribe_token(USER_ID)

    assert unsubscribe.verify_unsubscribe_token(token) == USER_ID
    assert unsubscribe.verify_unsubscribe_token(f"{token}x") is None


def test_dispatch_batch_loaders_do_not_scale_per_user(monkeypatch):
    users = [_user(id=f"11111111-1111-1111-1111-{index:012d}") for index in range(20)]
    calls = {
        "preferences": 0,
        "today": 0,
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
        "_load_going_today",
        lambda _users, _now: calls.__setitem__("today", calls["today"] + 1) or {},
    )
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
        "today": 1,
        "candidates": 1,
        "stored": 1,
        "exclusions": 1,
    }


def test_candidate_loader_uses_fixed_previous_24_hours(fake_sb, patch_sb):
    patch_sb("services.notifications.morning_email")
    fake_sb.set_response(data=[])

    result = morning_email._load_candidates_by_school(
        [_user()],
        datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result == {"uwaterloo": []}
    fake_sb.gt.assert_called_once_with("added_at", "2026-04-30T13:00:00+00:00")


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


def test_send_prepared_email_adds_unsubscribe_headers(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: "row-1")
    monkeypatch.setattr(morning_email, "_mark_log_sent", MagicMock())
    send = MagicMock(return_value=True)
    monkeypatch.setattr(morning_email.email_service, "send", send)

    result = morning_email._send_prepared_email(
        user=_user(),
        today=[_event()],
        picks=[],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is True
    message = send.call_args.args[0]
    assert message.headers["List-Unsubscribe"].startswith("<https://wat2do.app/")
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_send_prepared_email_skips_when_delivery_is_already_claimed(monkeypatch):
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: None)
    send = MagicMock()
    monkeypatch.setattr(morning_email.email_service, "send", send)

    result = morning_email._send_prepared_email(
        user=_user(),
        today=[_event()],
        picks=[],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is None
    send.assert_not_called()


def test_send_prepared_email_retries_timeouts_then_marks_sent(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: "row-1")
    mark_sent = MagicMock()
    mark_failed = MagicMock()
    monkeypatch.setattr(morning_email, "_mark_log_sent", mark_sent)
    monkeypatch.setattr(morning_email, "_mark_log_failed", mark_failed)
    send = MagicMock(side_effect=[httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"), True])
    monkeypatch.setattr(morning_email.email_service, "send", send)

    result = morning_email._send_prepared_email(
        user=_user(),
        today=[_event()],
        picks=[],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is True
    assert send.call_count == 3
    mark_sent.assert_called_once_with("row-1")
    mark_failed.assert_not_called()


def test_send_prepared_email_does_not_retry_terminal_provider_error(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.app")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: "row-1")
    monkeypatch.setattr(morning_email, "_mark_log_sent", MagicMock())
    mark_failed = MagicMock()
    monkeypatch.setattr(morning_email, "_mark_log_failed", mark_failed)
    request = httpx.Request("POST", "https://api.resend.com/emails")
    response = httpx.Response(400, request=request)
    send = MagicMock(
        side_effect=httpx.HTTPStatusError(
            "bad request",
            request=request,
            response=response,
        )
    )
    monkeypatch.setattr(morning_email.email_service, "send", send)

    result = morning_email._send_prepared_email(
        user=_user(),
        today=[_event()],
        picks=[],
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is False
    send.assert_called_once()
    mark_failed.assert_called_once_with("row-1", "provider_http_400")
