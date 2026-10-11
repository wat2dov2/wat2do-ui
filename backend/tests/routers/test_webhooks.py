from unittest.mock import MagicMock

import pytest

from core.config import settings
from services.notifications import event_change


@pytest.fixture
def send(monkeypatch):
    monkeypatch.setattr(settings, "event_change_alerts_key", "alerts-key")
    send = MagicMock(return_value=3)
    monkeypatch.setattr(event_change, "send_due_alerts", send)
    return send


def test_event_change_alerts_sends_due_alerts(client, send):
    response = client.post(
        "/webhooks/event-change-alerts", headers={"Authorization": "Bearer alerts-key"}
    )

    assert response.status_code == 200
    assert response.json() == {"sent": 3}
    send.assert_called_once_with()


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}])
def test_event_change_alerts_rejects_other_callers(client, send, headers):
    response = client.post("/webhooks/event-change-alerts", headers=headers)

    assert response.status_code in {401, 403}
    send.assert_not_called()


def test_event_change_alerts_fails_closed_without_a_key(client, send, monkeypatch):
    monkeypatch.setattr(settings, "event_change_alerts_key", "")
    response = client.post("/webhooks/event-change-alerts", headers={"Authorization": "Bearer "})

    assert response.status_code in {401, 403, 500}
    send.assert_not_called()
