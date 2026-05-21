from datetime import datetime, timezone
from unittest.mock import MagicMock

from schemas.club import ClubResponse
from services import club_service
from tests.conftest import ADMIN_USER, FAKE_USER, OTHER_USER


def _mock_club(**overrides) -> ClubResponse:
    defaults = {
        "id": 1,
        "club_name": "Test Club",
        "club_type": "WUSA",
        "created_by": FAKE_USER["id"],
    }
    defaults.update(overrides)
    return ClubResponse.model_validate(defaults)


def test_club_response_parses_legacy_category_json_string():
    club = _mock_club(categories='["Creative Arts, Dance and Music"]')

    assert club.categories == ["Creative Arts, Dance and Music"]


def test_club_response_defaults_legacy_null_club_type():
    club = _mock_club(club_type=None)

    assert club.club_type == "Unknown"


def test_create_club_requires_auth(client):
    response = client.post("/clubs/", json={"club_name": "Test Club", "club_type": "WUSA"})
    assert response.status_code == 401


def test_delete_club_requires_auth(client):
    response = client.delete("/clubs/1")
    assert response.status_code == 401


def test_get_discord_integration_requires_auth(client):
    response = client.get("/clubs/1/integrations/discord")
    assert response.status_code == 401


def test_upsert_discord_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/discord",
        json={
            "connected": True,
            "server_id": "1",
            "server_name": "Test Server",
            "channel_id": "101",
            "channel_name": "#events",
        },
    )
    assert response.status_code == 401


def test_get_slack_integration_requires_auth(client):
    response = client.get("/clubs/1/integrations/slack")
    assert response.status_code == 401


def test_upsert_instagram_integration_requires_auth(client):
    response = client.put(
        "/clubs/1/integrations/instagram",
        json={"connected": True, "name": "@testclub", "metadata": {"handle": "testclub"}},
    )
    assert response.status_code == 401


def test_create_club_forbidden_for_regular_user(authenticated_client, monkeypatch):
    """Only admins can approve/create clubs."""
    monkeypatch.setattr(club_service, "create_club", MagicMock())

    resp = authenticated_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "WUSA"},
    )
    assert resp.status_code == 403
    club_service.create_club.assert_not_called()


def test_create_club_sets_admin_as_owner_by_default(admin_client, monkeypatch):
    """Admin-created clubs default to the admin as owner if no owner is provided."""
    created_club = _mock_club()
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={"club_name": "Test Club", "club_type": "WUSA"},
    )
    assert resp.status_code == 201
    assert mock_create.call_count == 1
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == ADMIN_USER["id"]


def test_create_club_can_assign_approved_owner(admin_client, monkeypatch):
    """Admins can create an approved club for a specific user."""
    created_club = _mock_club(created_by=FAKE_USER["id"])
    mock_create = MagicMock(return_value=created_club)
    monkeypatch.setattr(club_service, "create_club", mock_create)

    resp = admin_client.post(
        "/clubs/",
        json={
            "club_name": "Test Club",
            "club_type": "WUSA",
            "owner_user_id": FAKE_USER["id"],
        },
    )
    assert resp.status_code == 201
    _, kwargs = mock_create.call_args
    assert kwargs["created_by"] == FAKE_USER["id"]


def test_update_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can update their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "update_club", MagicMock(return_value=club))

    resp = authenticated_client.patch("/clubs/1", json={"club_name": "Updated"})
    assert resp.status_code == 200


def test_update_club_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.patch("/clubs/1", json={"club_name": "Hacked"})
    assert resp.status_code == 403


def test_delete_club_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner, non-admin user gets 403 on delete."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.delete("/clubs/1")
    assert resp.status_code == 403


def test_delete_club_owner_allowed(authenticated_client, monkeypatch):
    """Owner can delete their own club."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(club_service, "delete_club", MagicMock(return_value=True))

    resp = authenticated_client.delete("/clubs/1")
    assert resp.status_code == 204


def test_integration_non_owner_rejected(other_user_client, monkeypatch):
    """Non-owner cannot read/modify club integrations."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = other_user_client.get("/clubs/1/integrations/discord")
    assert resp.status_code == 403

    resp = other_user_client.put(
        "/clubs/1/integrations/discord",
        json={
            "connected": True,
            "name": "TestClub - #events",
            "metadata": {
                "server_id": "1",
                "server_name": "S",
                "channel_id": "101",
                "channel_name": "#e",
            },
        },
    )
    assert resp.status_code == 403

    resp = other_user_client.delete("/clubs/1/integrations/discord")
    assert resp.status_code == 403


def test_integration_owner_allowed(authenticated_client, monkeypatch):
    """Owner can read club integrations."""
    club = _mock_club(created_by=FAKE_USER["id"])
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))
    monkeypatch.setattr(
        club_service,
        "get_platform_integration",
        MagicMock(
            return_value={
                "club_id": 1,
                "platform": "discord",
                "connected": False,
                "name": None,
                "last_sync": None,
                "metadata": {},
            }
        ),
    )

    resp = authenticated_client.get("/clubs/1/integrations/discord")
    assert resp.status_code == 200


def test_update_legacy_club_non_admin_rejected(authenticated_client, monkeypatch):
    """Legacy clubs (created_by=None) can only be modified by admins."""
    club = _mock_club(created_by=None)
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=club))

    resp = authenticated_client.patch("/clubs/1", json={"club_name": "Hacked"})
    assert resp.status_code == 403
