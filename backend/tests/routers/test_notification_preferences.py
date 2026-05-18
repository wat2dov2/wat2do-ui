"""Router tests for /notification-preferences.

Checks auth + shape only; prefs resolution and upsert behaviour live in
``tests/services/test_notification_service.py``.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.notification_preference import NotificationPreferenceResponse
from services import notification_service


def _resp(**overrides) -> NotificationPreferenceResponse:
    defaults = {
        "notification_type": "morning_digest",
        "enabled": True,
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return NotificationPreferenceResponse.model_validate(defaults)


def test_get_requires_auth(client):
    resp = client.get("/notification-preferences")
    assert resp.status_code == 401


def test_patch_requires_auth(client):
    resp = client.patch(
        "/notification-preferences",
        json={"preferences": [{"notification_type": "morning_digest", "enabled": False}]},
    )
    assert resp.status_code == 401


def test_get_returns_full_preferences_list(authenticated_client, monkeypatch):
    """GET should return every supported type, one entry each."""
    mock_get = MagicMock(return_value=[
        _resp(notification_type="morning_digest", enabled=True),
        _resp(notification_type="weekly_digest", enabled=False),
        _resp(notification_type="event_change", enabled=True),
        _resp(notification_type="daily_new_events", enabled=False),
    ])
    monkeypatch.setattr(notification_service, "get_preferences", mock_get)

    resp = authenticated_client.get("/notification-preferences")

    assert resp.status_code == 200
    body = resp.json()
    types = [p["notification_type"] for p in body["preferences"]]
    assert types == [
        "morning_digest",
        "weekly_digest",
        "event_change",
        "daily_new_events",
    ]
    # The opt-out we set through to the response.
    assert body["preferences"][1]["enabled"] is False


def test_patch_calls_set_preferences_with_payload(authenticated_client, monkeypatch):
    """PATCH should pass a parsed list of NotificationPreferenceUpdate objects to the service."""
    mock_set = MagicMock(return_value=None)
    monkeypatch.setattr(notification_service, "set_preferences", mock_set)

    resp = authenticated_client.patch(
        "/notification-preferences",
        json={
            "preferences": [
                {"notification_type": "morning_digest", "enabled": False},
                {"notification_type": "event_change", "enabled": True},
                {"notification_type": "daily_new_events", "enabled": True},
            ]
        },
    )

    assert resp.status_code == 204
    args, _ = mock_set.call_args
    # args: (user_id, updates)
    assert len(args[1]) == 3
    assert args[1][0].notification_type == "morning_digest"
    assert args[1][0].enabled is False
    assert args[1][2].notification_type == "daily_new_events"
    assert args[1][2].enabled is True


def test_patch_rejects_empty_preferences(authenticated_client, monkeypatch):
    """Bulk update requires at least one entry — 422 on empty list."""
    monkeypatch.setattr(
        notification_service, "set_preferences", MagicMock(return_value=None)
    )

    resp = authenticated_client.patch(
        "/notification-preferences", json={"preferences": []}
    )
    assert resp.status_code == 422


def test_patch_rejects_unknown_notification_type(authenticated_client, monkeypatch):
    """Literal-typed notification_type rejects values outside the allowed set."""
    monkeypatch.setattr(
        notification_service, "set_preferences", MagicMock(return_value=None)
    )

    resp = authenticated_client.patch(
        "/notification-preferences",
        json={"preferences": [{"notification_type": "never_heard_of_it", "enabled": True}]},
    )
    assert resp.status_code == 422
