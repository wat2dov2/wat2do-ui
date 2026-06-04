from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.club import ClubResponse
from schemas.user import UserResponse
from services import club_service, saved_club_service, user_service
from tests.conftest import FAKE_USER


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 42,
        "club_name": "Mock Club",
        "club_type": "Social",
        "categories": ["Games"],
        "created_by": FAKE_USER["id"],
        "school": "University of Waterloo",
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def _mock_db_user(**overrides) -> UserResponse:
    defaults = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": FAKE_USER["email"],
        "full_name": "Test User",
        "role": "user",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return UserResponse.model_validate(defaults)


# ── GET /saved-clubs/ ──────────────────────────────────────────────


def test_list_saved_clubs_requires_auth(client):
    response = client.get("/saved-clubs/")
    assert response.status_code == 401


def test_list_saved_clubs_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(saved_club_service, "get_saved_club_ids", MagicMock(return_value=[1, 3, 7]))

    resp = authenticated_client.get("/saved-clubs/")
    assert resp.status_code == 200
    assert resp.json() == [1, 3, 7]


# ── PUT /saved-clubs/{club_id} ────────────────────────────────────


def test_save_club_requires_auth(client):
    response = client.put("/saved-clubs/42")
    assert response.status_code == 401


def test_save_club_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=_mock_club()))
    monkeypatch.setattr(saved_club_service, "count_saved_clubs", MagicMock(return_value=0))
    monkeypatch.setattr(saved_club_service, "save_club", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-clubs/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"


def test_save_club_nonexistent_returns_404(authenticated_client, monkeypatch):
    """PUT to /saved-clubs/{club_id} returns 404 when the club does not exist."""
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=None))

    resp = authenticated_client.put("/saved-clubs/9999")
    assert resp.status_code == 404


def test_save_club_at_cap_returns_400(authenticated_client, monkeypatch):
    """Saving a new club when the user is at the cap returns 400."""
    from core.constants import MAX_SAVED_CLUBS_PER_USER

    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=_mock_club()))
    monkeypatch.setattr(
        saved_club_service, "count_saved_clubs", MagicMock(return_value=MAX_SAVED_CLUBS_PER_USER)
    )

    resp = authenticated_client.put("/saved-clubs/42")
    assert resp.status_code == 400


# ── DELETE /saved-clubs/{club_id} ─────────────────────────────────


def test_unsave_club_requires_auth(client):
    response = client.delete("/saved-clubs/42")
    assert response.status_code == 401


def test_unsave_club_succeeds(authenticated_client, monkeypatch):
    db_user = _mock_db_user()
    monkeypatch.setattr(user_service, "get_user_by_supabase_id", MagicMock(return_value=db_user))
    monkeypatch.setattr(saved_club_service, "unsave_club", MagicMock(return_value=True))

    resp = authenticated_client.delete("/saved-clubs/42")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unsaved"
