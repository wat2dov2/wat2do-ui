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
# GET /scraped-events/ -- requires get_admin_user, returns paginated response
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
    """GET /scraped-events/ as admin returns paginated 200."""
    monkeypatch.setattr(
        scraped_event_service,
        "get_scraped_events",
        MagicMock(return_value=([_mock_scraped_event()], 1)),
    )

    resp = admin_client.get("/scraped-events/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert body["total_pages"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["source"] == "test-scraper"


def test_list_scraped_events_with_pagination_params(admin_client, monkeypatch):
    """GET /scraped-events/?page=2&page_size=25 passes correct offset/limit."""
    mock_fn = MagicMock(return_value=([], 30))
    monkeypatch.setattr(scraped_event_service, "get_scraped_events", mock_fn)

    resp = admin_client.get("/scraped-events/?page=2&page_size=25")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 30
    assert body["page"] == 2
    assert body["page_size"] == 25
    assert body["total_pages"] == 2
    _, kwargs = mock_fn.call_args
    assert kwargs["offset"] == 25
    assert kwargs["limit"] == 25


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


# ---------------------------------------------------------------------------
# M9 — source field length cap & non-empty
# ---------------------------------------------------------------------------


def test_create_scraped_event_rejects_empty_source(admin_client):
    """Empty source is rejected with 422 (audit M9)."""
    resp = admin_client.post(
        "/scraped-events/",
        json={"source": "", "raw_data": {"x": 1}},
    )
    assert resp.status_code == 422


def test_create_scraped_event_rejects_oversize_source(admin_client):
    """Source longer than 255 chars is rejected with 422 (audit M9)."""
    resp = admin_client.post(
        "/scraped-events/",
        json={"source": "a" * 300, "raw_data": {"x": 1}},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# M9 / M12 — raw_data size cap
# ---------------------------------------------------------------------------


def test_create_scraped_event_rejects_oversize_raw_data(admin_client):
    """raw_data larger than the schema's raw_data byte cap is rejected (audit M9/M12)."""
    big_blob = {"payload": "x" * 40_000}
    resp = admin_client.post(
        "/scraped-events/",
        json={"source": "test-scraper", "raw_data": big_blob},
    )
    assert resp.status_code == 422
