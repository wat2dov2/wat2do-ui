"""Tests for interactions router — auth, ownership, batch limits, dedup, rate limiting."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from core.auth import get_current_user, get_optional_user
from core.constants import MAX_INTERACTION_BATCH_SIZE
from main import app
from tests.conftest import FAKE_USER, OTHER_USER


# ── Helpers ────────────────────────────────────────────────────────────


FAKE_DB_USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_DB_USER_ID = "00000000-0000-0000-0000-000000000099"


def _make_db_user(user_id=FAKE_DB_USER_ID, email=FAKE_USER["email"]):
    from datetime import datetime, timezone
    from schemas.user import UserResponse

    return UserResponse(
        id=user_id,
        email=email,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _batch_payload(
    session_id: str = "sess-1",
    token: str | None = None,
    user_id: str | None = None,
    interactions: list | None = None,
) -> dict:
    """Build a minimal InteractionBatch payload."""
    payload: dict = {
        "session_id": session_id,
        "interactions": interactions or [
            {"event_id": 1, "interaction_type": "view"},
            {"event_id": 2, "interaction_type": "click"},
        ],
    }
    if token is not None:
        payload["token"] = token
    if user_id is not None:
        payload["user_id"] = user_id
    return payload


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def authenticated_client():
    """Client with Bearer auth returning FAKE_USER."""
    app.dependency_overrides[get_optional_user] = lambda: FAKE_USER
    c = TestClient(app)
    yield c
    app.dependency_overrides.pop(get_optional_user, None)


@pytest.fixture
def other_user_client():
    """Client authenticated as a different user."""
    app.dependency_overrides[get_optional_user] = lambda: OTHER_USER
    c = TestClient(app)
    yield c
    app.dependency_overrides.pop(get_optional_user, None)


@pytest.fixture(autouse=True)
def _clear_rate_limiters():
    """Reset all interaction rate limiters between tests."""
    from routers.interactions import _interaction_limiter
    from core.rate_limit import anon_interaction_rate_limiter
    _interaction_limiter._requests.clear()
    anon_interaction_rate_limiter._requests.clear()
    yield
    _interaction_limiter._requests.clear()
    anon_interaction_rate_limiter._requests.clear()


# ── Anonymous tracking (no auth) ──────────────────────────────────────


def test_batch_202_anonymous(client, monkeypatch):
    """POST /interactions/batch returns 202 without auth (anonymous tracking)."""
    from services import interaction_service

    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    resp = client.post("/interactions/batch", json=_batch_payload())
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 2


def test_batch_anonymous_passes_no_user_id(client, monkeypatch):
    """Anonymous request passes user_id=None to the service."""
    from services import interaction_service

    mock_record = MagicMock(return_value=2)
    monkeypatch.setattr(interaction_service, "record_interactions", mock_record)

    client.post("/interactions/batch", json=_batch_payload())
    _, kwargs = mock_record.call_args
    assert kwargs["user_id"] is None
    assert kwargs["session_id"] == "sess-1"


# ── Authenticated tracking (Bearer header) ────────────────────────────


def test_batch_202_with_bearer_auth(authenticated_client, monkeypatch):
    """Authenticated user via Bearer header records interactions."""
    from services import interaction_service, user_service

    db_user = _make_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", lambda **kw: kw["interactions"])
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    resp = authenticated_client.post("/interactions/batch", json=_batch_payload())
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 2

    _, kwargs = interaction_service.record_interactions.call_args
    assert kwargs["user_id"] == FAKE_DB_USER_ID


# ── Authenticated tracking (body token / sendBeacon) ──────────────────


def test_batch_202_with_body_token(client, monkeypatch):
    """Body token (sendBeacon compat) resolves user and records interactions."""
    from routers import interactions
    from services import interaction_service, user_service

    db_user = _make_db_user()

    monkeypatch.setattr(interactions, "_resolve_user", lambda cred: FAKE_USER)
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", lambda **kw: kw["interactions"])
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    resp = client.post("/interactions/batch", json=_batch_payload(token="fake-jwt"))
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 2

    _, kwargs = interaction_service.record_interactions.call_args
    assert kwargs["user_id"] == FAKE_DB_USER_ID


def test_batch_falls_back_when_body_token_invalid(client, monkeypatch):
    """Invalid body token falls back to anonymous (user_id=None)."""
    from routers import interactions
    from services import interaction_service

    monkeypatch.setattr(interactions, "_resolve_user", MagicMock(side_effect=Exception("invalid token")))
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=1))

    resp = client.post("/interactions/batch", json=_batch_payload(token="bad"))
    assert resp.status_code == 202

    _, kwargs = interaction_service.record_interactions.call_args
    assert kwargs["user_id"] is None


# ── Batch size limit ──────────────────────────────────────────────────


def test_batch_rejects_oversized_payload(client):
    """Batch exceeding MAX_INTERACTION_BATCH_SIZE is rejected with 400."""
    oversized = [{"event_id": i, "interaction_type": "view"} for i in range(MAX_INTERACTION_BATCH_SIZE + 1)]
    resp = client.post("/interactions/batch", json=_batch_payload(interactions=oversized))
    assert resp.status_code == 400
    assert "maximum size" in resp.json()["detail"]


def test_batch_accepts_max_size(client, monkeypatch):
    """Batch exactly at MAX_INTERACTION_BATCH_SIZE is accepted."""
    from services import interaction_service

    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=MAX_INTERACTION_BATCH_SIZE))

    at_limit = [{"event_id": i, "interaction_type": "view"} for i in range(MAX_INTERACTION_BATCH_SIZE)]
    resp = client.post("/interactions/batch", json=_batch_payload(interactions=at_limit))
    assert resp.status_code == 202


# ── User-ID ownership validation ─────────────────────────────────────


def test_batch_rejects_user_id_without_auth(client):
    """Unauthenticated request with user_id in payload is rejected (401)."""
    resp = client.post(
        "/interactions/batch",
        json=_batch_payload(user_id=FAKE_DB_USER_ID),
    )
    assert resp.status_code == 401
    assert "another user" in resp.json()["detail"]


def test_batch_rejects_mismatched_user_id(authenticated_client, monkeypatch):
    """Authenticated user cannot submit interactions with a different user_id (403)."""
    from services import user_service

    db_user = _make_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))

    resp = authenticated_client.post(
        "/interactions/batch",
        json=_batch_payload(user_id=OTHER_DB_USER_ID),
    )
    assert resp.status_code == 403
    assert "another user" in resp.json()["detail"]


def test_batch_accepts_matching_user_id(authenticated_client, monkeypatch):
    """Authenticated user can submit interactions with their own user_id."""
    from services import interaction_service, user_service

    db_user = _make_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", lambda **kw: kw["interactions"])
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    resp = authenticated_client.post(
        "/interactions/batch",
        json=_batch_payload(user_id=FAKE_DB_USER_ID),
    )
    assert resp.status_code == 202


# ── Deduplication ─────────────────────────────────────────────────────


def test_dedup_filters_duplicates_for_authenticated_user(authenticated_client, monkeypatch):
    """Authenticated requests pass through dedup; all-duplicate batch returns 0."""
    from services import interaction_service, user_service

    db_user = _make_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    # Dedup returns empty list (all duplicates)
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", lambda **kw: [])

    resp = authenticated_client.post("/interactions/batch", json=_batch_payload())
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 0


def test_dedup_not_called_for_anonymous(client, monkeypatch):
    """Anonymous requests skip deduplication entirely."""
    from services import interaction_service

    mock_dedup = MagicMock()
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", mock_dedup)
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    client.post("/interactions/batch", json=_batch_payload())
    mock_dedup.assert_not_called()


# ── Rate limiting ─────────────────────────────────────────────────────


def test_rate_limit_triggers_429(authenticated_client, monkeypatch):
    """Exceeding the rate limit returns 429 with Retry-After header."""
    from routers.interactions import _interaction_limiter
    from services import interaction_service, user_service

    db_user = _make_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(interaction_service, "check_duplicate_interactions", lambda **kw: kw["interactions"])
    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    original_max = _interaction_limiter.max_requests
    _interaction_limiter.max_requests = 2
    try:
        r1 = authenticated_client.post("/interactions/batch", json=_batch_payload())
        r2 = authenticated_client.post("/interactions/batch", json=_batch_payload())
        assert r1.status_code == 202
        assert r2.status_code == 202

        r3 = authenticated_client.post("/interactions/batch", json=_batch_payload())
        assert r3.status_code == 429
        assert "Too many requests" in r3.json()["detail"]
        assert "Retry-After" in r3.headers
        assert int(r3.headers["Retry-After"]) >= 1
    finally:
        _interaction_limiter.max_requests = original_max


def test_anon_rate_limit_by_ip_triggers_429(client, monkeypatch):
    """Anonymous requests are IP-rate-limited; exceeding the limit returns 429."""
    from core.rate_limit import anon_interaction_rate_limiter
    from services import interaction_service

    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    original_max = anon_interaction_rate_limiter.max_requests
    anon_interaction_rate_limiter.max_requests = 2
    try:
        r1 = client.post("/interactions/batch", json=_batch_payload())
        r2 = client.post("/interactions/batch", json=_batch_payload())
        assert r1.status_code == 202
        assert r2.status_code == 202

        r3 = client.post("/interactions/batch", json=_batch_payload())
        assert r3.status_code == 429
        assert "Too many requests" in r3.json()["detail"]
        assert "Retry-After" in r3.headers
    finally:
        anon_interaction_rate_limiter.max_requests = original_max


def test_anon_rate_limit_does_not_affect_user_keyed_limiter(client, monkeypatch):
    """Anonymous IP limiter is separate from the per-user limiter."""
    from routers.interactions import _interaction_limiter
    from services import interaction_service

    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=2))

    # Set user-keyed limiter to 1 — should not affect anonymous requests
    _interaction_limiter.max_requests = 1
    try:
        r1 = client.post("/interactions/batch", json=_batch_payload())
        r2 = client.post("/interactions/batch", json=_batch_payload())
        assert r1.status_code == 202
        assert r2.status_code == 202  # not hit because user limiter is separate
    finally:
        _interaction_limiter.max_requests = 30


# ── Edge cases ────────────────────────────────────────────────────────


def test_batch_handles_db_error_gracefully(client, monkeypatch):
    """If the interactions table is unavailable, returns recorded=0."""
    from services import interaction_service
    from postgrest.exceptions import APIError

    monkeypatch.setattr(
        interaction_service,
        "record_interactions",
        MagicMock(
            side_effect=APIError(
                {"message": "table missing", "code": "42P01", "details": "", "hint": ""}
            )
        ),
    )

    resp = client.post("/interactions/batch", json=_batch_payload())
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 0


def test_batch_rejects_invalid_interaction_type(client):
    """Invalid interaction_type is rejected by Pydantic validation."""
    payload = {
        "session_id": "sess-1",
        "interactions": [
            {"event_id": 1, "interaction_type": "invalid_type"},
        ],
    }
    resp = client.post("/interactions/batch", json=payload)
    assert resp.status_code == 422


def test_batch_empty_interactions_accepted(client, monkeypatch):
    """Empty interactions list is accepted (no-op)."""
    from services import interaction_service

    monkeypatch.setattr(interaction_service, "record_interactions", MagicMock(return_value=0))

    resp = client.post(
        "/interactions/batch",
        json=_batch_payload(interactions=[]),
    )
    assert resp.status_code == 202
    assert resp.json()["recorded"] == 0
