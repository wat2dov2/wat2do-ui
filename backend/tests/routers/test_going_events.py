from unittest.mock import MagicMock

from services import event_service, going_event_service

OCCURRENCE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def test_list_going_events_requires_auth(client):
    assert client.get("/going-events/").status_code == 401


def test_list_going_events_returns_grouped_selections(
    authenticated_client,
    monkeypatch,
):
    monkeypatch.setattr(
        going_event_service,
        "get_going_event_selections",
        MagicMock(return_value=[{"event_id": 42, "occurrence_ids": [OCCURRENCE_ID]}]),
    )

    response = authenticated_client.get("/going-events/")

    assert response.status_code == 200
    assert response.json() == [{"event_id": 42, "occurrence_ids": [OCCURRENCE_ID]}]


def test_put_replaces_complete_selection(authenticated_client, monkeypatch):
    mutation = MagicMock(
        return_value={
            "status": "going",
            "event_id": 42,
            "occurrence_ids": [OCCURRENCE_ID],
            "going_count": 4,
        }
    )
    monkeypatch.setattr(going_event_service, "set_going_occurrences", mutation)

    response = authenticated_client.put(
        "/going-events/42",
        json={"occurrence_ids": [OCCURRENCE_ID]},
    )

    assert response.status_code == 200
    assert response.json()["going_count"] == 4
    mutation.assert_called_once()
    assert mutation.call_args.args[1] == 42
    assert [str(value) for value in mutation.call_args.args[2]] == [OCCURRENCE_ID]


def test_put_rejects_empty_selection(authenticated_client):
    response = authenticated_client.put(
        "/going-events/42",
        json={"occurrence_ids": []},
    )
    assert response.status_code == 422


def test_delete_uses_same_rpc_with_empty_selection(authenticated_client, monkeypatch):
    mutation = MagicMock(
        return_value={
            "status": "not_going",
            "event_id": 42,
            "occurrence_ids": [],
            "going_count": 2,
        }
    )
    monkeypatch.setattr(going_event_service, "set_going_occurrences", mutation)

    response = authenticated_client.delete("/going-events/42")

    assert response.status_code == 200
    mutation.assert_called_once()
    assert mutation.call_args.args[1:] == (42, [])


def test_attendees_uses_aggregate_count_rpc(client, monkeypatch):
    monkeypatch.setattr(event_service, "get_event", MagicMock(return_value=object()))
    monkeypatch.setattr(
        going_event_service,
        "get_going_counts_for_events",
        MagicMock(return_value={42: 4}),
    )
    monkeypatch.setattr(
        going_event_service,
        "get_event_attendees",
        MagicMock(
            return_value=[{"name": "Sean Y.", "avatar_url": "https://example.com/avatar.jpg"}]
        ),
    )

    response = client.get("/going-events/42/attendees")

    assert response.status_code == 200
    assert response.json() == {
        "going_count": 4,
        "attendees": [{"name": "Sean Y.", "avatar_url": "https://example.com/avatar.jpg"}],
    }
