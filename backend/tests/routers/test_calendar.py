"""Router-level tests for calendar endpoints.

Verifies HTTP contracts (status codes, auth guards, content types) and
that the public feed enforces its per-token rate limit.  Service-layer
calls are mocked at the seam — the actual ICS rendering is covered by
``tests/services/test_calendar_service.py``.
"""

from unittest.mock import MagicMock

import pytest

from routers import calendar as calendar_router
from services import calendar_service

# ── GET /calendar/token ─────────────────────────────────────────────


def test_get_token_requires_auth(client):
    assert client.get("/calendar/token").status_code == 401


def test_get_token_returns_token_and_feed_url(authenticated_client, monkeypatch):
    monkeypatch.setattr(
        calendar_service,
        "get_or_create_token",
        MagicMock(return_value="tok_abc"),
    )

    resp = authenticated_client.get("/calendar/token")

    assert resp.status_code == 200
    body = resp.json()
    assert body["token"] == "tok_abc"
    assert body["feed_url"].endswith("/calendar/feed/tok_abc.ics")


# ── POST /calendar/token/regenerate ─────────────────────────────────


def test_regenerate_token_requires_auth(client):
    assert client.post("/calendar/token/regenerate").status_code == 401


def test_regenerate_token_returns_new_token(authenticated_client, monkeypatch):
    monkeypatch.setattr(
        calendar_service,
        "regenerate_token",
        MagicMock(return_value="tok_rotated"),
    )

    resp = authenticated_client.post("/calendar/token/regenerate")

    assert resp.status_code == 200
    body = resp.json()
    assert body["token"] == "tok_rotated"
    assert body["feed_url"].endswith("/calendar/feed/tok_rotated.ics")


# ── GET /calendar/feed/{token}.ics ──────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_feed_rate_limiter():
    """Clear the feed rate limiter between tests.

    ``_feed_rate_limiter`` is a module-level singleton; without this
    reset one test's calls would leak into another test's budget.
    """
    calendar_router._feed_rate_limiter._requests.clear()
    yield
    calendar_router._feed_rate_limiter._requests.clear()


def test_feed_unknown_token_returns_404(client, monkeypatch):
    monkeypatch.setattr(
        calendar_service,
        "get_user_id_by_token",
        MagicMock(return_value=None),
    )

    resp = client.get("/calendar/feed/unknown.ics")

    assert resp.status_code == 404


def test_feed_valid_token_returns_ics(client, monkeypatch):
    monkeypatch.setattr(
        calendar_service,
        "get_user_id_by_token",
        MagicMock(return_value="user-1"),
    )
    monkeypatch.setattr(
        calendar_service,
        "build_ics_for_user",
        MagicMock(return_value=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
    )

    resp = client.get("/calendar/feed/valid_token.ics")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    assert resp.content.startswith(b"BEGIN:VCALENDAR")


def test_feed_rate_limit_kicks_in(client, monkeypatch):
    """61st request with the same token returns 429."""
    monkeypatch.setattr(
        calendar_service,
        "get_user_id_by_token",
        MagicMock(return_value="user-1"),
    )
    monkeypatch.setattr(
        calendar_service,
        "build_ics_for_user",
        MagicMock(return_value=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
    )

    limit = calendar_router._feed_rate_limiter.max_requests
    for _ in range(limit):
        assert client.get("/calendar/feed/sametok.ics").status_code == 200

    over = client.get("/calendar/feed/sametok.ics")
    assert over.status_code == 429
    assert "Retry-After" in over.headers


def test_feed_rate_limit_is_per_token(client, monkeypatch):
    """A second token's bucket is independent — one bad client doesn't
    block others."""
    monkeypatch.setattr(
        calendar_service,
        "get_user_id_by_token",
        MagicMock(return_value="user-1"),
    )
    monkeypatch.setattr(
        calendar_service,
        "build_ics_for_user",
        MagicMock(return_value=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
    )

    limit = calendar_router._feed_rate_limiter.max_requests
    for _ in range(limit):
        client.get("/calendar/feed/tok_a.ics")
    # tok_a is now over budget
    assert client.get("/calendar/feed/tok_a.ics").status_code == 429
    # tok_b still has its own fresh budget
    assert client.get("/calendar/feed/tok_b.ics").status_code == 200
