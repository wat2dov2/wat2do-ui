from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.notification_preference import NotificationPreferenceResponse
from services.notifications import preferences, unsubscribe


def _preference(notification_type: str, enabled: bool):
    return NotificationPreferenceResponse.model_validate(
        {
            "notification_type": notification_type,
            "enabled": enabled,
            "updated_at": datetime.now(timezone.utc),
        }
    )


def test_get_requires_auth(client):
    assert client.get("/notification-preferences").status_code == 401


def test_get_returns_only_active_preferences(authenticated_client, monkeypatch):
    monkeypatch.setattr(
        preferences,
        "get_preferences",
        MagicMock(
            return_value=[
                _preference("morning_email", True),
                _preference("event_reminder", True),
                _preference("event_change", False),
            ]
        ),
    )

    response = authenticated_client.get("/notification-preferences")

    assert response.status_code == 200
    assert [item["notification_type"] for item in response.json()["preferences"]] == [
        "morning_email",
        "event_reminder",
        "event_change",
    ]


def test_patch_accepts_active_preferences(authenticated_client, monkeypatch):
    setter = MagicMock()
    monkeypatch.setattr(preferences, "set_preferences", setter)

    response = authenticated_client.patch(
        "/notification-preferences",
        json={
            "preferences": [
                {"notification_type": "morning_email", "enabled": False},
                {"notification_type": "event_reminder", "enabled": True},
                {"notification_type": "event_change", "enabled": True},
            ]
        },
    )

    assert response.status_code == 204
    updates = setter.call_args.args[1]
    assert [update.notification_type for update in updates] == [
        "morning_email",
        "event_reminder",
        "event_change",
    ]


def test_patch_rejects_removed_digest_type(authenticated_client):
    response = authenticated_client.patch(
        "/notification-preferences",
        json={"preferences": [{"notification_type": "daily_new_events", "enabled": True}]},
    )
    assert response.status_code == 422


def test_unsubscribe_confirmation_posts_token_in_query(client, monkeypatch):
    monkeypatch.setattr(
        unsubscribe,
        "verify_unsubscribe_token",
        MagicMock(return_value="11111111-1111-1111-1111-111111111111"),
    )

    response = client.get("/notification-preferences/unsubscribe?token=signed-token")

    assert response.status_code == 200
    assert 'method="post" action="?token=signed-token"' in response.text
    assert 'name="token"' not in response.text


def test_unsubscribe_confirmation_submits_existing_query_contract(client, monkeypatch):
    apply_unsubscribe = MagicMock(return_value=True)
    monkeypatch.setattr(unsubscribe, "unsubscribe", apply_unsubscribe)

    response = client.post("/notification-preferences/unsubscribe?token=signed-token")

    assert response.status_code == 200
    apply_unsubscribe.assert_called_once_with("signed-token")
