from unittest.mock import MagicMock

from services import event_service, v1_saved_event_service


def test_list_saved_events_requires_auth(client):
    assert client.get("/v1/saved-events/").status_code == 401


def test_list_saved_events_returns_ids(authenticated_client, monkeypatch):
    monkeypatch.setattr(
        v1_saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[42, 7]),
    )

    response = authenticated_client.get("/v1/saved-events/")

    assert response.status_code == 200
    assert response.json() == [42, 7]


def test_save_event_requires_auth(client):
    assert client.put("/v1/saved-events/42").status_code == 401


def test_save_event_rejects_unknown_event(authenticated_client, monkeypatch):
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=None))

    response = authenticated_client.put("/v1/saved-events/42")

    assert response.status_code == 404


def test_save_event_succeeds(authenticated_client, monkeypatch):
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=object()))
    save = MagicMock()
    monkeypatch.setattr(v1_saved_event_service, "save_event", save)

    response = authenticated_client.put("/v1/saved-events/42")

    assert response.status_code == 200
    assert response.json() == {"status": "saved"}
    save.assert_called_once()
    assert save.call_args.args[1] == 42


def test_unsave_event_succeeds(authenticated_client, monkeypatch):
    unsave = MagicMock(return_value=True)
    monkeypatch.setattr(v1_saved_event_service, "unsave_event", unsave)

    response = authenticated_client.delete("/v1/saved-events/42")

    assert response.status_code == 200
    assert response.json() == {"status": "unsaved"}
    unsave.assert_called_once()
    assert unsave.call_args.args[1] == 42
