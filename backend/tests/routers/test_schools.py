from unittest.mock import MagicMock

from services import school_service


def test_search_schools_route_is_public_and_delegates(client, monkeypatch):
    mock = MagicMock(return_value=["Massachusetts Institute of Technology"])
    monkeypatch.setattr(school_service, "search_schools", mock)

    resp = client.get("/schools?q=mit")

    assert resp.status_code == 200
    assert resp.json() == ["Massachusetts Institute of Technology"]
    mock.assert_called_once_with("mit", limit=10)
