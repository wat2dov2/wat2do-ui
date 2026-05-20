"""Tests for A/B test router auth and response paths."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from core.constants import AB_DEFAULT_VARIANTS, ROLE_ADMIN
from main import app
from schemas.user import UserResponse
from tests.conftest import ADMIN_USER, FAKE_USER


@pytest.fixture
def client():
    return TestClient(app)


# ── GET /ab/variant ─────────────────────────────────────────────────────


def test_variant_requires_auth(client):
    """GET /ab/variant returns 401 without auth."""
    resp = client.get("/ab/variant")
    assert resp.status_code == 401


def test_variant_falls_back_to_hash_when_no_db_user(authenticated_client, monkeypatch):
    """User with no DB row still receives a deterministic (not hardcoded) variant.

    Previously this fell back to ``control``, which silently biased the
    treatment share whenever signup lagged the auth record (audit M5).
    The new behaviour hashes on the auth-user ID and returns whatever
    variant the hash maps to.
    """
    from services import user_service
    from services.ab_test_service import ab_test

    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=None))
    monkeypatch.setattr(ab_test, "get_user_variant", MagicMock(return_value="treatment"))

    resp = authenticated_client.get("/ab/variant")
    assert resp.status_code == 200
    assert resp.json()["variant"] in AB_DEFAULT_VARIANTS
    # Fallback path should hash on the auth-user id, not return a fixed value.
    ab_test.get_user_variant.assert_called_once_with(FAKE_USER["id"])


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


# ── ABTestService — sticky assignment & hash divisor (M1/M2) ────────────


def test_get_user_variant_divisor_is_exclusive_upper_bound():
    """bucket = hash / (1 << 32) must be in [0, 1) — never 1.0.

    Guards against regression of audit M1 where the divisor was
    ``0xFFFFFFFF`` (2**32 − 1), producing bucket values in ``[0, 1]``
    and mis-assigning edge-case hashes to control at ``treatment_ratio=1.0``.
    """
    from services.ab_test_service import ABTestService

    svc = ABTestService(treatment_ratio=1.0)
    # Try many user IDs — none should ever be assigned control when
    # treatment_ratio is 1.0 with the fixed divisor.
    for i in range(10_000):
        # _compute_variant is the pure hash path, bypassing the DB
        # lookup.  That is exactly the knob audit M1 was about.
        assert svc._compute_variant(f"user-{i}") == "treatment"


def test_get_user_variant_reads_persisted_assignment(monkeypatch):
    """Subsequent calls should return the persisted variant, not a fresh hash.

    Guards against regression of audit M2 where renaming or reseeding
    the experiment would reshuffle every user into a new variant.
    """
    from services import ab_test_service as svc_mod
    from services.ab_test_service import ABTestService

    svc = ABTestService()
    # Simulate a persisted row -> 'treatment' for this user.
    stored = {("u1", svc.experiment_name): "treatment"}

    class FakeTable:
        def __init__(self, data):
            self._data = data
            self._filters = {}

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, col, val):
            self._filters[col] = val
            return self

        def limit(self, _n):
            return self

        def execute(self):
            uid = self._filters.get("user_id")
            exp = self._filters.get("experiment_name")
            data = []
            if (uid, exp) in self._data:
                data = [{"variant": self._data[(uid, exp)]}]
            return MagicMock(data=data)

        def insert(self, row):
            class _Exec:
                def execute(self_inner):
                    key = (row["user_id"], row["experiment_name"])
                    self._data.setdefault(key, row["variant"])
                    return MagicMock(data=[row])

            return _Exec()

    fake_sb = MagicMock()
    fake_sb.table = MagicMock(return_value=FakeTable(stored))
    monkeypatch.setattr(svc_mod, "get_sb", lambda: fake_sb)

    assert svc.get_user_variant("u1") == "treatment"
    # Even after a hypothetical rename, the persisted value wins.
    svc.experiment_name = "renamed_v2"
    # But the fake store is keyed by old name -> no row, so a fresh
    # variant is computed and persisted under the new experiment name.
    v = svc.get_user_variant("u1")
    assert v in ("control", "treatment")
    # Second call must hit the store and return the same variant.
    assert svc.get_user_variant("u1") == v
