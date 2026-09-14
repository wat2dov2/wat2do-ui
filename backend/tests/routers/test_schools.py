from unittest.mock import MagicMock

from services import school_service


def test_search_schools_route_is_public_and_delegates(client, monkeypatch):
    mock = MagicMock(
        return_value=[
            {
                "slug": "mit",
                "name": "Massachusetts Institute of Technology",
                "primary_color": "#A31F34",
                "secondary_color": "#FFFFFF",
                "email_domains": ["mit.edu"],
            }
        ]
    )
    monkeypatch.setattr(school_service, "search_schools", mock)

    resp = client.get("/schools?q=mit")

    assert resp.status_code == 200
    assert resp.json() == [
        {
            "slug": "mit",
            "name": "Massachusetts Institute of Technology",
            "primary_color": "#A31F34",
            "secondary_color": "#FFFFFF",
            "email_domains": ["mit.edu"],
            "language": "en",
            "faculties": [],
            "location_examples": [],
        }
    ]
    mock.assert_called_once_with("mit", limit=10)


def test_get_school_route_is_public_and_delegates(client, monkeypatch):
    mock = MagicMock(
        return_value={
            "slug": "mit",
            "name": "Massachusetts Institute of Technology",
            "primary_color": "#A31F34",
            "secondary_color": "#FFFFFF",
            "timezone": "America/New_York",
        }
    )
    monkeypatch.setattr(school_service, "get_school", mock)

    resp = client.get("/schools/mit")

    assert resp.status_code == 200
    assert resp.json() == {
        "slug": "mit",
        "name": "Massachusetts Institute of Technology",
        "primary_color": "#A31F34",
        "secondary_color": "#FFFFFF",
        "timezone": "America/New_York",
        "recipient_id": None,
        "semester_start": None,
        "semester_end": None,
        "social_preview_image_url": None,
        "language": "en",
        "faculties": [],
        "location_examples": [],
    }
    mock.assert_called_once_with("mit")


def test_get_school_route_returns_not_found(client, monkeypatch):
    monkeypatch.setattr(school_service, "get_school", MagicMock(return_value=None))

    resp = client.get("/schools/unknown")

    assert resp.status_code == 404
    assert resp.json() == {"detail": "School not found"}
