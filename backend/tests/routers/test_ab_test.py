"""Tests for A/B test router auth and response paths."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.constants import AB_VARIANT_CONTROL, ROLE_ADMIN
from main import app
from schemas.user import UserResponse
from tests.conftest import FAKE_USER, ADMIN_USER


@pytest.fixture
def client():
    return TestClient(app)


# ── GET /ab/variant ─────────────────────────────────────────────────────


def test_variant_requires_auth(client):
    """GET /ab/variant returns 401 without auth."""
    resp = client.get("/ab/variant")
    assert resp.status_code == 401


def test_variant_returns_control_when_no_db_user(authenticated_client, monkeypatch):
    """User with no DB row gets the control variant."""
    from services import user_service

    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))

    resp = authenticated_client.get("/ab/variant")
    assert resp.status_code == 200
    assert resp.json()["variant"] == AB_VARIANT_CONTROL


def test_variant_returns_assigned_variant(authenticated_client, monkeypatch):
    """User with a DB row gets their deterministic variant."""
    from services import user_service
    from services.ab_test_service import ab_test

    db_user = UserResponse(
        id="00000000-0000-0000-0000-000000000001",
        email=FAKE_USER["email"],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(ab_test, "get_user_variant", MagicMock(return_value="treatment"))

    resp = authenticated_client.get("/ab/variant")
    assert resp.status_code == 200
    assert resp.json()["variant"] == "treatment"


# ── GET /ab/metrics ─────────────────────────────────────────────────────


def test_metrics_requires_auth(client):
    """GET /ab/metrics returns 401 without auth."""
    resp = client.get("/ab/metrics")
    assert resp.status_code == 401


def test_metrics_forbidden_for_non_admin(authenticated_client):
    """GET /ab/metrics returns 403 for a regular user."""
    resp = authenticated_client.get("/ab/metrics")
    assert resp.status_code == 403


def test_metrics_returns_data_for_admin(admin_client, monkeypatch):
    """GET /ab/metrics returns CTR data for admin."""
    from services.ab_test_service import ab_test

    metrics = {
        "control": {"impressions": 100, "clicks": 10, "ctr": 0.1},
        "treatment": {"impressions": 80, "clicks": 12, "ctr": 0.15},
    }
    monkeypatch.setattr(ab_test, "get_ctr_by_variant", MagicMock(return_value=metrics))

    resp = admin_client.get("/ab/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "control" in data
    assert "treatment" in data
    assert data["control"]["ctr"] == 0.1
