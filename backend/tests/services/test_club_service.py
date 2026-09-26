import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from postgrest import SyncPostgrestClient

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


@pytest.mark.parametrize(
    "categories",
    [
        ["Arts & Culture"],
        ["Business", "Technology"],
        ['Arts, "Culture" (campus)', "Littérature\\théâtre"],
    ],
)
@pytest.mark.parametrize(
    ("search", "expected_search"),
    [("Campus Arts", "Campus Arts"), ('  Campus, "Arts" (U.W.)  ', "Campus Arts UW")],
)
def test_directory_categories_use_jsonb_containment_with_search(
    monkeypatch, categories, search, expected_search
):
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=[], headers={"Content-Range": "*/0"})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        database = SyncPostgrestClient("https://database.test", http_client=client)
        monkeypatch.setattr(club_service, "get_sb", lambda: database)

        clubs, total = club_service.list_clubs(
            school="uwaterloo",
            search=search,
            categories=categories,
            min_events=1,
            skip=20,
            limit=10,
        )

    assert (clubs, total) == ([], 0)
    assert len(requests) == 1
    params = requests[0].url.params
    assert "categories" not in params  # JSONB has no PostgreSQL array-overlap operator.
    assert (
        params["or"]
        == "("
        + ",".join(f"categories.cs.{json.dumps(json.dumps([category]))}" for category in categories)
        + ")"
    )
    assert params["club_name"] == f"ilike.%{expected_search}%"
    assert params["school_id"] == "eq.1"
    assert params["event_count"] == "gte.1"
    assert params["status"] == "eq.approved"
    assert params["offset"] == "20"
    assert params["limit"] == "10"


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
    revalidate.assert_called_once_with(
        ["uwaterloo", "uwaterloo"], resources=("events", "positions", "clubs")
    )


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


@pytest.mark.parametrize("auto_approve", [False, True])
def test_create_club_refreshes_public_directory_only_when_approved(
    monkeypatch, fake_sb, patch_sb, auto_approve
):
    from schemas.club import ClubCreate

    patch_sb("services.club_service")
    row = {
        "id": 7,
        "club_name": "Tea Club",
        "school": "uwaterloo",
        "status": "approved" if auto_approve else "pending",
    }
    fake_sb.set_response(data=[row])
    monkeypatch.setattr(club_service, "get_club", lambda _: ClubResponse(**row))
    monkeypatch.setattr(club_service, "add_club_member", MagicMock())
    refresh = MagicMock()
    monkeypatch.setattr(club_service.event_feed_revalidation_service, "revalidate_school", refresh)

    club_service.create_club(
        ClubCreate(club_name="Tea Club"),
        created_by="11111111-1111-1111-1111-111111111111",
        auto_approve=auto_approve,
    )
    if auto_approve:
        refresh.assert_called_once_with("uwaterloo", resources=("clubs",))
    else:
        refresh.assert_not_called()


@pytest.mark.parametrize(
    "updates,resources",
    [
        ({"categories": ["Arts & Culture"]}, ("clubs",)),
        ({"club_name": "New club name"}, ("events", "positions", "clubs")),
        ({"club_page": "https://example.com/club"}, ("events", "positions", "clubs")),
        ({"ig": "updatedclub"}, ("events", "positions", "clubs")),
        ({"discord": "https://discord.gg/club"}, ("events", "positions", "clubs")),
        ({"school": "western"}, ("events", "positions", "clubs")),
    ],
)
def test_club_update_refreshes_only_datasets_that_embed_changed_fields(
    monkeypatch, fake_sb, patch_sb, updates, resources
):
    patch_sb("services.club_service")
    row = {"id": 7, "club_name": "Tea Club", "school": "uwaterloo"}
    monkeypatch.setattr(club_service, "get_club", lambda _: ClubResponse(**row))
    fake_sb.set_response(data=[{**row, **updates}])
    refresh = MagicMock()
    monkeypatch.setattr(club_service.event_feed_revalidation_service, "revalidate_schools", refresh)

    club_service.update_club(7, ClubUpdate(**updates))
    refresh.assert_called_once_with(
        ["uwaterloo", updates.get("school", "uwaterloo")], resources=resources
    )


def test_club_status_change_refreshes_visibility_dependencies(monkeypatch, fake_sb, patch_sb):
    patch_sb("services.club_service")
    row = {"id": 7, "club_name": "Tea Club", "school": "uwaterloo", "status": "pending"}
    monkeypatch.setattr(club_service, "get_club", lambda _: ClubResponse(**row))
    fake_sb.set_response(data=[{**row, "status": "approved"}])
    refresh = MagicMock()
    monkeypatch.setattr(club_service.event_feed_revalidation_service, "revalidate_school", refresh)

    club_service.set_club_status(7, "approved")
    refresh.assert_called_once_with("uwaterloo", resources=("events", "positions", "clubs"))


@pytest.mark.parametrize("database_fails", [False, True])
def test_club_delete_refreshes_cascaded_content_only_after_commit(
    monkeypatch, fake_sb, patch_sb, database_fails
):
    patch_sb("services.club_service")
    monkeypatch.setattr(
        club_service,
        "get_club",
        lambda _: ClubResponse(id=7, club_name="Tea Club", school="uwaterloo"),
    )
    fake_sb.set_response(data=[{"id": 7}])
    if database_fails:
        fake_sb.raise_on_execute(RuntimeError("database unavailable"))
    refresh = MagicMock()
    monkeypatch.setattr(club_service.event_feed_revalidation_service, "revalidate_school", refresh)

    if database_fails:
        with pytest.raises(RuntimeError):
            club_service.delete_club(7)
        refresh.assert_not_called()
    else:
        assert club_service.delete_club(7)
        refresh.assert_called_once_with("uwaterloo", resources=("events", "positions", "clubs"))


def test_club_directory_pages_use_unique_order_for_identical_names(monkeypatch):
    requests = []
    rows = [
        {"id": club_id, "club_name": "Debate Club", "school_record": {"slug": "uwaterloo"}}
        for club_id in (7, 8)
    ]

    def respond(request):
        requests.append(request)
        offset = int(request.url.params["offset"])
        return httpx.Response(
            200, json=rows[offset : offset + 1], headers={"Content-Range": f"{offset}-{offset}/2"}
        )

    monkeypatch.setattr(club_service.position_service, "get_club_position_counts", lambda _: {})
    with httpx.Client(transport=httpx.MockTransport(respond)) as http_client:
        client = SyncPostgrestClient("https://example.supabase.co/rest/v1", http_client=http_client)
        monkeypatch.setattr(club_service, "get_sb", lambda: client)
        first, total = club_service.list_clubs(skip=0, limit=1)
        second, _ = club_service.list_clubs(skip=1, limit=1)

    assert [club.id for club in first + second] == [7, 8]
    assert total == 2
    assert [request.url.params["order"] for request in requests] == ["club_name.asc,id.asc"] * 2
