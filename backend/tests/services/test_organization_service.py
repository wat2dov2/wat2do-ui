from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from schemas.organization import OrganizationResponse, OrganizationUpdate
from services import organization_service


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        organization_service.school_service,
        "get_school",
        lambda _school: SimpleNamespace(id=1),
    )


# --- Invitation Service Tests ---


def test_create_invitation_enforces_school_matching_for_non_admins(monkeypatch, fake_sb, patch_sb):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock
    from uuid import UUID

    import pytest

    from core import allowed_emails
    from core.exceptions import ValidationError
    from schemas.user import UserResponse
    from services import user_service

    patch_sb("services.organization_service")

    # Mock organization
    monkeypatch.setattr(
        organization_service,
        "get_organization",
        MagicMock(return_value=MagicMock(id=1, organization_name="UW Organization")),
    )
    # Mock inviter (non-admin from Waterloo)
    mock_inviter = UserResponse(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        email="test@uwaterloo.ca",
        school="uwaterloo",
        role="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=mock_inviter))
    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))
    monkeypatch.setattr(
        allowed_emails,
        "get_school_for_email",
        lambda email: (
            "uwaterloo"
            if email.endswith("@uwaterloo.ca")
            else "wlu"
            if email.endswith("@wlu.ca")
            else None
        ),
    )

    # Inviting an email from the same school should proceed (we fake the upsert/insert DB responses)
    fake_sb.queue_responses(
        [[{"id": "inv-1", "organization_id": 1, "email": "invitee@uwaterloo.ca"}]]
    )
    res = organization_service.create_invitation(1, "invitee@uwaterloo.ca", mock_inviter.id)
    assert res is not None

    # Inviting an email from a different school should raise ValidationError
    with pytest.raises(ValidationError) as excinfo:
        organization_service.create_invitation(1, "invitee@wlu.ca", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo.value)

    # Inviting an email from an invalid domain should raise ValidationError
    with pytest.raises(ValidationError) as excinfo2:
        organization_service.create_invitation(1, "invitee@example.com", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo2.value)


def test_create_invitation_allows_admins_to_invite_any_domain(monkeypatch, fake_sb, patch_sb):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock
    from uuid import UUID

    from schemas.user import UserResponse
    from services import user_service

    patch_sb("services.organization_service")

    # Mock organization
    monkeypatch.setattr(
        organization_service,
        "get_organization",
        MagicMock(return_value=MagicMock(id=1, organization_name="UW Organization")),
    )
    # Mock admin inviter (no school)
    mock_admin = UserResponse(
        id=UUID("33333333-3333-3333-3333-333333333333"),
        email="admin@example.com",
        school=None,
        role="admin",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(user_service, "get_user", MagicMock(return_value=mock_admin))
    monkeypatch.setattr(user_service, "get_user_by_email", MagicMock(return_value=None))

    # Admins should be allowed to invite ANY domain
    fake_sb.queue_responses([[{"id": "inv-2", "organization_id": 1, "email": "invitee@wlu.ca"}]])
    res = organization_service.create_invitation(1, "invitee@wlu.ca", mock_admin.id)
    assert res is not None


def test_normalize_organization_name_collapses_case_and_whitespace():
    assert (
        organization_service._normalize_organization_name("  UW   Tea  Organization ")
        == "uw tea organization"
    )
    assert organization_service._normalize_organization_name(None) == ""


def test_lookup_organization_by_school_and_name_exact_match(fake_sb, patch_sb):
    patch_sb("services.organization_service")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 3,
                    "organization_name": "UW Tea Organization",
                    "organization_type": "independent",
                    "ig": "uwtea",
                    "school": "uwaterloo",
                },
                {
                    "id": 9,
                    "organization_name": "Other Club",
                    "organization_type": "independent",
                    "ig": None,
                    "school": "uwaterloo",
                },
            ]
        ]
    )

    result = organization_service.lookup_organization_by_school_and_name(
        "uwaterloo", "  uw tea   organization "
    )
    assert result is not None
    assert result["id"] == 3


def test_lookup_organization_by_school_and_name_miss(fake_sb, patch_sb):
    patch_sb("services.organization_service")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 3,
                    "organization_name": "UW Tea Organization",
                    "organization_type": "independent",
                    "ig": "uwtea",
                    "school": "uwaterloo",
                }
            ]
        ]
    )
    assert (
        organization_service.lookup_organization_by_school_and_name("uwaterloo", "No Such Club")
        is None
    )


def test_lookup_organization_by_school_and_name_picks_lowest_id_on_dupes(fake_sb, patch_sb):
    patch_sb("services.organization_service")
    # Query orders by id ASC; first normalized match wins.
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 5,
                    "organization_name": "tea   club",
                    "organization_type": "independent",
                    "ig": "b",
                    "school": "uwaterloo",
                },
                {
                    "id": 12,
                    "organization_name": "Tea Club",
                    "organization_type": "independent",
                    "ig": "a",
                    "school": "uwaterloo",
                },
            ]
        ]
    )
    result = organization_service.lookup_organization_by_school_and_name("uwaterloo", "Tea Club")
    assert result is not None
    assert result["id"] == 5


def test_lookup_organization_by_school_and_name_empty_inputs():
    assert organization_service.lookup_organization_by_school_and_name("", "Tea") is None
    assert organization_service.lookup_organization_by_school_and_name("uwaterloo", "") is None


def test_update_organization_type_revalidates_event_feed(
    monkeypatch,
    fake_sb,
    patch_sb,
):
    patch_sb("services.organization_service")
    existing = OrganizationResponse(
        id=7,
        organization_name="UW Tea Organization",
        organization_type="independent",
        school="uwaterloo",
    )
    monkeypatch.setattr(
        organization_service,
        "get_organization",
        MagicMock(return_value=existing),
    )
    revalidate = MagicMock()
    monkeypatch.setattr(
        organization_service.event_feed_revalidation_service,
        "revalidate_schools",
        revalidate,
    )
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 7,
                    "organization_name": "UW Tea Organization",
                    "organization_type": "wusa",
                    "school": "uwaterloo",
                }
            ]
        ]
    )

    updated = organization_service.update_organization(
        7,
        OrganizationUpdate(organization_type="wusa"),
    )

    assert updated is not None
    assert updated.organization_type == "wusa"
    revalidate.assert_called_once_with(["uwaterloo", "uwaterloo"])
