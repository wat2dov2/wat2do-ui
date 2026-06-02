from services import club_service






# --- Invitation Service Tests ---

def test_create_invitation_enforces_school_matching_for_non_admins(monkeypatch, fake_sb, patch_sb):
    import pytest
    from unittest.mock import MagicMock
    from core.exceptions import ValidationError
    from services import user_service
    from schemas.user import UserResponse
    from datetime import datetime, timezone
    from uuid import UUID

    patch_sb("services.club_service")
    
    # Mock club
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=MagicMock(id=1, club_name="UW Club")))
    # Mock inviter (non-admin from Waterloo)
    mock_inviter = UserResponse(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="test@uwaterloo.ca",
        school="University of Waterloo",
        role="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=mock_inviter))
    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))

    # Inviting an email from the same school should proceed (we fake the upsert/insert DB responses)
    fake_sb.queue_responses([
        [{"id": "inv-1", "club_id": 1, "email": "invitee@uwaterloo.ca"}]
    ])
    res = club_service.create_invitation(1, "invitee@uwaterloo.ca", mock_inviter.id)
    assert res is not None

    # Inviting an email from a different school should raise ValidationError
    with pytest.raises(ValidationError) as excinfo:
        club_service.create_invitation(1, "invitee@wlu.ca", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo.value)

    # Inviting an email from an invalid domain should raise ValidationError
    with pytest.raises(ValidationError) as excinfo2:
        club_service.create_invitation(1, "invitee@example.com", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo2.value)


def test_create_invitation_allows_admins_to_invite_any_domain(monkeypatch, fake_sb, patch_sb):
    from unittest.mock import MagicMock
    from services import user_service
    from schemas.user import UserResponse
    from datetime import datetime, timezone
    from uuid import UUID

    patch_sb("services.club_service")

    # Mock club
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=MagicMock(id=1, club_name="UW Club")))
    # Mock admin inviter (no school)
    mock_admin = UserResponse(
        id=UUID("33333333-3333-3333-3333-333333333333"),
        email="admin@example.com",
        school=None,
        role="admin",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=mock_admin))
    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))

    # Admins should be allowed to invite ANY domain
    fake_sb.queue_responses([
        [{"id": "inv-2", "club_id": 1, "email": "invitee@wlu.ca"}]
    ])
    res = club_service.create_invitation(1, "invitee@wlu.ca", mock_admin.id)
    assert res is not None


