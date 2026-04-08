from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.scraped_event import ScrapedEventResponse
from services import scraped_event_service
from tests.conftest import ADMIN_USER


def _mock_scraped_event(**overrides) -> ScrapedEventResponse:
    defaults = {
        "id": "se-001",
        "event_id": 99,
        "source": "test-scraper",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "raw_data": {"name": "Scraped Event"},
    }
    defaults.update(overrides)
    return ScrapedEventResponse.model_validate(defaults)


# ---------------------------------------------------------------------------
# GET /scraped-events/ -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_list_scraped_events_requires_auth(client):
    """GET /scraped-events/ without auth returns 401."""
    resp = client.get("/scraped-events/")
    assert resp.status_code == 401


def test_list_scraped_events_forbidden_for_non_admin(authenticated_client):
    """GET /scraped-events/ as regular user returns 403."""
    resp = authenticated_client.get("/scraped-events/")
    assert resp.status_code == 403


def test_list_scraped_events_admin(admin_client, monkeypatch):
    """GET /scraped-events/ as admin returns 200."""
    monkeypatch.setattr(
        scraped_event_service, "get_scraped_events", MagicMock(return_value=[_mock_scraped_event()])
    )

    resp = admin_client.get("/scraped-events/")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# POST /scraped-events/ -- requires get_admin_user
# ---------------------------------------------------------------------------

def test_create_scraped_event_requires_auth(client):
    """POST /scraped-events/ without auth returns 401."""
    resp = client.post("/scraped-events/", json={"source": "test-scraper"})
    assert resp.status_code == 401


def test_create_scraped_event_forbidden_for_non_admin(authenticated_client):
    """POST /scraped-events/ as regular user returns 403."""
    resp = authenticated_client.post("/scraped-events/", json={"source": "test-scraper"})
    assert resp.status_code == 403


def test_create_scraped_event_admin(admin_client, monkeypatch):
    """POST /scraped-events/ as admin returns 201."""
    monkeypatch.setattr(
        scraped_event_service, "create_scraped_event", MagicMock(return_value=_mock_scraped_event())
    )

    resp = admin_client.post(
        "/scraped-events/",
        json={"source": "test-scraper", "raw_data": {"name": "Scraped Event"}},
    )
    assert resp.status_code == 201
    assert resp.json()["source"] == "test-scraper"
