import uuid
from unittest.mock import MagicMock

from schemas.club import ClubResponse
from schemas.club_membership import ClubMembershipResponse, ClubMembershipWithUserResponse
from services import club_membership_service, club_service
from tests.conftest import FAKE_USER, OTHER_USER


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 1,
        "club_name": "Test Club",
        "club_type": "WUSA",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def _mock_membership(**overrides) -> ClubMembershipResponse:
    defaults = {
        "id": uuid.uuid4(),
        "club_id": 1,
        "user_id": uuid.UUID(FAKE_USER["id"]),
        "status": "pending",
        "role": "member",
        "created_at": "2026-06-05T00:00:00Z",
        "updated_at": "2026-06-05T00:00:00Z",
    }
    defaults.update(overrides)
    return ClubMembershipResponse.model_validate(defaults)


def _mock_membership_with_user(**overrides) -> ClubMembershipWithUserResponse:
    defaults = {
        "id": uuid.uuid4(),
        "club_id": 1,
        "user_id": uuid.UUID(FAKE_USER["id"]),
        "status": "pending",
        "role": "member",
        "created_at": "2026-06-05T00:00:00Z",
        "updated_at": "2026-06-05T00:00:00Z",
        "user": {
            "id": uuid.UUID(FAKE_USER["id"]),
            "email": FAKE_USER["email"],
            "username": "fakeuser",
            "full_name": "Fake User",
            "avatar_url": None,
        },
    }
    defaults.update(overrides)
    return ClubMembershipWithUserResponse.model_validate(defaults)


# --- Authentication & Basic Checks ---


def test_join_club_requires_auth(client):
    response = client.post("/clubs/1/join")
    assert response.status_code == 401


def test_leave_club_requires_auth(client):
    response = client.delete("/clubs/1/membership")
    assert response.status_code == 401


def test_list_members_requires_auth(client):
    response = client.get("/clubs/1/memberships")
    assert response.status_code == 401


# --- Join Request Flow ---


def test_request_to_join_club_success(authenticated_client, monkeypatch):
    club = _mock_club()
    membership = _mock_membership()
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(
        club_membership_service, "create_membership_request", MagicMock(return_value=membership)
    )

    response = authenticated_client.post("/clubs/1/join")
    assert response.status_code == 201
    assert response.json()["status"] == "pending"


def test_request_to_join_nonexistent_club(authenticated_client, monkeypatch):
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=None))

    response = authenticated_client.post("/clubs/999/join")
    assert response.status_code == 404


# --- Leave / Cancel Request Flow ---


def test_leave_club_success(authenticated_client, monkeypatch):
    club = _mock_club()
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_membership_service, "delete_membership", MagicMock(return_value=True))

    response = authenticated_client.delete("/clubs/1/membership")
    assert response.status_code == 204


def test_leave_club_not_member(authenticated_client, monkeypatch):
    club = _mock_club()
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_membership_service, "delete_membership", MagicMock(return_value=False))

    response = authenticated_client.delete("/clubs/1/membership")
    assert response.status_code == 404


# --- Get Membership Status ---


def test_get_my_membership_status(authenticated_client, monkeypatch):
    club = _mock_club()
    membership = _mock_membership()
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(
        club_membership_service, "get_user_membership_status", MagicMock(return_value=membership)
    )

    response = authenticated_client.get("/clubs/1/membership")
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


# --- Admin Roster Management Flow ---


def test_list_club_members_owner_allowed(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    memberships = [_mock_membership_with_user()]
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    monkeypatch.setattr(
        club_membership_service, "list_club_memberships", MagicMock(return_value=memberships)
    )

    response = authenticated_client.get("/clubs/1/memberships")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_club_members_non_owner_forbidden(other_user_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=False))

    response = other_user_client.get("/clubs/1/memberships")
    assert response.status_code == 403


def test_update_club_membership_owner_allowed(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    membership = _mock_membership(status="approved")
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    monkeypatch.setattr(
        club_membership_service, "update_membership_status", MagicMock(return_value=membership)
    )

    response = authenticated_client.patch(
        f"/clubs/1/memberships/{OTHER_USER['id']}", json={"status": "approved"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "approved"


def test_update_club_membership_non_owner_forbidden(other_user_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=False))

    response = other_user_client.patch(
        f"/clubs/1/memberships/{OTHER_USER['id']}", json={"status": "approved"}
    )
    assert response.status_code == 403


def test_remove_club_member_owner_allowed(authenticated_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=True))
    monkeypatch.setattr(club_membership_service, "delete_membership", MagicMock(return_value=True))

    response = authenticated_client.delete(f"/clubs/1/memberships/{OTHER_USER['id']}")
    assert response.status_code == 204


def test_remove_club_member_non_owner_forbidden(other_user_client, monkeypatch):
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "is_club_member", MagicMock(return_value=False))

    response = other_user_client.delete(f"/clubs/1/memberships/{OTHER_USER['id']}")
    assert response.status_code == 403
