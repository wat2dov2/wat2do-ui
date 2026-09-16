from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from schemas.club import ClubResponse, ClubUpdate
from services import club_service


@pytest.mark.parametrize("owner", [None, "existing-owner"])
def test_claim_accepts_owner_and_executive_requests(monkeypatch, fake_sb, patch_sb, owner):
    from uuid import UUID

    patch_sb("services.club_service")
    monkeypatch.setattr(club_service, "get_club", lambda _: SimpleNamespace(created_by=owner))
    monkeypatch.setattr(club_service, "is_club_member", lambda *_: False)
    fake_sb.set_response(data=[{"id": "claim"}])

    club_service.create_claim(1, UUID("11111111-1111-1111-1111-111111111111"), "Treasurer", None)

    payload = fake_sb.insert.call_args.args[0]
    assert payload["executive_role"] == "Treasurer"
    assert payload["status"] == "pending"


def test_claim_approval_never_replaces_an_existing_owner(monkeypatch, fake_sb, patch_sb):
    from uuid import UUID

    patch_sb("services.club_service")
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    fake_sb.set_response(data=[{"club_id": 1, "user_id": str(user_id)}])
    add_manager = MagicMock()
    monkeypatch.setattr(club_service, "add_club_member", add_manager)

    club_service.update_claim(user_id, "approved")

    fake_sb.is_.assert_called_once_with("created_by", "null")
    add_manager.assert_called_once_with(1, user_id)


def test_rejected_claim_does_not_grant_access(monkeypatch, fake_sb, patch_sb):
    from uuid import UUID

    patch_sb("services.club_service")
    fake_sb.set_response(data=[{"club_id": 1, "user_id": "applicant"}])
    add_manager = MagicMock()
    monkeypatch.setattr(club_service, "add_club_member", add_manager)

    club_service.update_claim(UUID("11111111-1111-1111-1111-111111111111"), "rejected")

    add_manager.assert_not_called()
    fake_sb.is_.assert_not_called()


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        club_service.school_service,
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

    patch_sb("services.club_service")

    # Mock club
    monkeypatch.setattr(
        club_service,
        "get_club",
        MagicMock(
            return_value=MagicMock(
                id=1,
                club_name="UW Club",
                school="uwaterloo",
            )
        ),
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
    send = MagicMock(return_value=True)
    monkeypatch.setattr("services.email_service.email_service.send", send)
    monkeypatch.setattr(
        "services.school_context.settings.frontend_url",
        "https://wat2do.io",
    )
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
    fake_sb.queue_responses([[{"id": "inv-1", "club_id": 1, "email": "invitee@uwaterloo.ca"}]])
    res = club_service.create_invitation(1, "invitee@uwaterloo.ca", mock_inviter.id)
    assert res is not None
    message = send.call_args.args[0]
    assert "https://uwaterloo.wat2do.io/invite/" in message.body_html
    assert "https://uwaterloo.wat2do.io/invite/" in message.body_text

    # Inviting an email from a different school should raise ValidationError
    with pytest.raises(ValidationError) as excinfo:
        club_service.create_invitation(1, "invitee@wlu.ca", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo.value)

    # Inviting an email from an invalid domain should raise ValidationError
    with pytest.raises(ValidationError) as excinfo2:
        club_service.create_invitation(1, "invitee@example.com", mock_inviter.id)
    assert "You can only invite emails matching your school domain" in str(excinfo2.value)


def test_create_invitation_allows_admins_to_invite_any_domain(monkeypatch, fake_sb, patch_sb):
    from datetime import datetime, timezone
    from unittest.mock import MagicMock
    from uuid import UUID

    from schemas.user import UserResponse
    from services import user_service

    patch_sb("services.club_service")

    # Mock club
    monkeypatch.setattr(
        club_service,
        "get_club",
        MagicMock(
            return_value=MagicMock(
                id=1,
                club_name="UW Club",
                school="uwaterloo",
            )
        ),
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
    monkeypatch.setattr(
        "services.email_service.email_service.send",
        MagicMock(return_value=True),
    )

    # Admins should be allowed to invite ANY domain
    fake_sb.queue_responses([[{"id": "inv-2", "club_id": 1, "email": "invitee@wlu.ca"}]])
    res = club_service.create_invitation(1, "invitee@wlu.ca", mock_admin.id)
    assert res is not None


def test_normalize_club_name_collapses_case_and_whitespace():
    assert club_service._normalize_club_name("  UW   Tea  Club ") == "uw tea club"
    assert club_service._normalize_club_name(None) == ""


def test_list_clubs_hydrates_event_and_position_counts(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.club_service")
    fake_sb.set_response(
        data=[
            {
                "id": 7,
                "school_id": 1,
                "club_name": "UW Design Club",
                "event_count": 3,
                "status": "approved",
                "club_type": "student-club",
                "school_record": {"slug": "uwaterloo"},
            }
        ],
        count=1,
    )
    monkeypatch.setattr(
        club_service.position_service,
        "get_club_position_counts",
        lambda _club_ids: {7: 2},
    )

    clubs, total = club_service.list_clubs()

    assert total == 1
    assert clubs[0].event_count == 3
    assert clubs[0].position_count == 2


def test_directory_minimum_uses_computed_count_before_paging(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(data=[], count=0)
    club_service.list_clubs(min_events=3, skip=20, limit=10)
    fake_sb.gte.assert_called_once_with("event_count", 3)
    assert "event_count" in fake_sb.select.call_args.args[0]
    fake_sb.range.assert_called_once_with(20, 29)


def test_directory_categories_match_any_selection(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(data=[])
    club_service.list_clubs(categories=["Business", "Technology"])
    fake_sb.overlaps.assert_called_once_with("categories", ["Business", "Technology"])


def test_lookup_club_by_school_and_name_exact_match(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 3,
                    "club_name": "UW Tea Club",
                    "club_type": "independent",
                    "ig": "uwtea",
                    "school": "uwaterloo",
                },
                {
                    "id": 9,
                    "club_name": "Other Club",
                    "club_type": "independent",
                    "ig": None,
                    "school": "uwaterloo",
                },
            ]
        ]
    )

    result = club_service.lookup_club_by_school_and_name("uwaterloo", "  uw tea   club ")
    assert result is not None
    assert result["id"] == 3


def test_lookup_club_by_school_and_name_miss(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 3,
                    "club_name": "UW Tea Club",
                    "club_type": "independent",
                    "ig": "uwtea",
                    "school": "uwaterloo",
                }
            ]
        ]
    )
    assert club_service.lookup_club_by_school_and_name("uwaterloo", "No Such Club") is None


def test_lookup_club_by_school_and_name_picks_lowest_id_on_dupes(fake_sb, patch_sb):
    patch_sb("services.club_service")
    # Query orders by id ASC; first normalized match wins.
    fake_sb.queue_responses(
        [
            [
                {
                    "id": 5,
                    "club_name": "tea   club",
                    "club_type": "independent",
                    "ig": "b",
                    "school": "uwaterloo",
                },
                {
                    "id": 12,
                    "club_name": "Tea Club",
                    "club_type": "independent",
                    "ig": "a",
                    "school": "uwaterloo",
                },
            ]
        ]
    )
    result = club_service.lookup_club_by_school_and_name("uwaterloo", "Tea Club")
    assert result is not None
    assert result["id"] == 5


def test_lookup_club_by_school_and_name_empty_inputs():
    assert club_service.lookup_club_by_school_and_name("", "Tea") is None
    assert club_service.lookup_club_by_school_and_name("uwaterloo", "") is None


@pytest.mark.parametrize(
    "updates",
    [
        {"club_type": "wusa"},
        {"logo_url": "https://wat2do.io/media/organization-logos/tea.jpg"},
    ],
)
def test_update_club_revalidates_event_feed(monkeypatch, fake_sb, patch_sb, updates):
    patch_sb("services.club_service")
    row = {
        "id": 7,
        "club_name": "UW Tea Club",
        "club_type": "independent",
        "logo_url": None,
        "school": "uwaterloo",
    }
    monkeypatch.setattr(club_service, "get_club", MagicMock(return_value=ClubResponse(**row)))
    revalidate = MagicMock()
    monkeypatch.setattr(
        club_service.event_feed_revalidation_service, "revalidate_schools", revalidate
    )
    fake_sb.queue_responses([[{**row, **updates}]])

    updated = club_service.update_club(7, ClubUpdate(**updates))

    assert updated is not None
    for field, value in updates.items():
        assert getattr(updated, field) == value
    revalidate.assert_called_once_with(["uwaterloo", "uwaterloo"])


@pytest.mark.parametrize("platform", ["discord", "slack", "telegram", "facebook"])
@pytest.mark.parametrize("metadata", [None, {}, {"custom": "value"}])
def test_integration_metadata_writes_preserve_empty_columns_and_extra(platform, metadata):
    columns = club_service._metadata_to_columns(platform, metadata)

    assert set(columns) == club_service._METADATA_COLUMNS | {"extra"}
    assert all(columns[column] is None for column in club_service._METADATA_COLUMNS)
    assert columns["extra"] == (metadata or {})


def test_integration_metadata_alias_precedence_and_unknown_keys():
    columns = club_service._metadata_to_columns(
        "slack",
        {
            "server_id": "canonical",
            "workspace_id": "alias",
            "workspace_name": "Workspace",
            "custom": "retained",
        },
    )

    assert columns["server_id"] == "canonical"
    assert columns["server_name"] == "Workspace"
    assert columns["extra"] == {"custom": "retained"}
    assert club_service._metadata_to_columns("discord", {"workspace_id": "alias"})["extra"] == {}


@pytest.mark.parametrize("extra", [None, [], "invalid", {"custom": "value", "count": 1}])
def test_integration_metadata_reads_keep_only_string_extras(extra):
    result = club_service._columns_to_metadata(
        "slack", {"server_id": "server", "server_name": "", "extra": extra}
    )

    assert result == {
        "workspace_id": "server",
        **({"custom": "value"} if isinstance(extra, dict) else {}),
    }


def test_integration_metadata_extras_override_column_aliases():
    assert club_service._columns_to_metadata(
        "slack", {"server_id": "column", "extra": {"workspace_id": "extra"}}
    ) == {"workspace_id": "extra"}


@pytest.mark.parametrize("platform", ["discord", "slack", "telegram", "facebook"])
def test_empty_integration_response_preserves_wire_defaults(platform):
    response = club_service._empty_integration_response(7, platform)

    assert response.model_dump(mode="json") == {
        "club_id": 7,
        "platform": platform,
        "connected": False,
        "name": None,
        "last_sync": None,
        "metadata": {},
    }
