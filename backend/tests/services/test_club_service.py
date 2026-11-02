import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from postgrest import SyncPostgrestClient

from schemas.club import ClubResponse, ClubUpdate
from services import club_service


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        club_service.school_service,
        "get_school",
        lambda _school: SimpleNamespace(id=1),
    )


# --- Invitation Service Tests ---


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
    "categories,search,expected_search",
    [
        (["Arts & Culture"], "Campus Arts", "Campus Arts"),
        (["Business", "Technology"], '  Campus, "Arts" (U.W.)  ', "Campus Arts UW"),
        (['Arts, "Culture" (campus)', "Littérature\\théâtre"], "Campus Arts", "Campus Arts"),
    ],
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
        ClubCreate(submitted_by_email="submitter@example.com", club_name="Tea Club"),
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
        ({"club_type": "wusa"}, ("events", "positions", "clubs")),
        (
            {"logo_url": "https://wat2do.io/media/organization-logos/tea.jpg"},
            ("events", "positions", "clubs"),
        ),
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

    updated = club_service.update_club(7, ClubUpdate(**updates))
    assert updated is not None
    assert updated.model_dump(include=set(updates)) == updates
    refresh.assert_called_once_with(
        ["uwaterloo", updates.get("school", "uwaterloo")], resources=resources
    )


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
        client = SyncPostgrestClient("https://data.example.test", http_client=http_client)
        monkeypatch.setattr(club_service, "get_sb", lambda: client)
        first, total = club_service.list_clubs(skip=0, limit=1)
        second, _ = club_service.list_clubs(skip=1, limit=1)

    assert [club.id for club in first + second] == [7, 8]
    assert total == 2
    assert [request.url.params["order"] for request in requests] == ["club_name.asc,id.asc"] * 2


@pytest.mark.parametrize(
    "records,expected",
    [
        ([{"id": 1, "ig": "Union", "logo_url": "union.jpg"}], 1),
        ([{"id": 1, "ig": "union"}, {"id": 2, "ig": "union"}], None),
        ([{"id": 1, "ig": "other"}], None),
    ],
)
def test_school_handle_lookup_rejects_ambiguous_or_different_handles(
    monkeypatch, records, expected
):
    monkeypatch.setattr(club_service.school_service, "get_school_id", lambda _: 99)
    lookup = MagicMock(return_value=records)
    monkeypatch.setattr(club_service, "_get_clubs_for_school_lookup", lookup)
    result = club_service.lookup_club_by_school_and_ig("cornell", "@UNION")
    assert (result["id"] if result else None) == expected
    lookup.assert_called_once_with(99)


def test_school_lookup_reads_clubs_beyond_first_page(fake_sb, patch_sb):
    patch_sb("services.club_service")
    first_page = [
        {"id": i, "club_name": f"Club {i}", "ig": None} for i in range(club_service.MAX_PAGE_SIZE)
    ]
    fake_sb.queue_responses(
        [first_page, [{"id": 9999, "club_name": "Students Union", "ig": "official_union"}]]
    )
    result = club_service.lookup_club_by_school_and_ig("uwaterloo", "official_union")
    assert result is not None and result["id"] == 9999


def test_anonymous_club_contact_does_not_grant_membership_or_leak_publicly(
    monkeypatch, fake_sb, patch_sb
):
    from schemas.club import ClubCreate

    patch_sb("services.club_service")
    row = {
        "id": 7,
        "club_name": "Visitor Club",
        "school": "uwaterloo",
        "status": "pending",
        "submitted_by_email": "visitor@example.com",
    }
    fake_sb.set_response(data=[row])
    monkeypatch.setattr(club_service, "get_club", lambda _: ClubResponse(**row))
    membership = MagicMock()
    monkeypatch.setattr(club_service, "add_club_member", membership)
    result = club_service.create_club(
        ClubCreate(club_name="Visitor Club", submitted_by_email="visitor@example.com"),
        created_by=None,
    )
    payload = fake_sb.insert.call_args.args[0]
    assert payload["created_by"] is None
    assert payload["status"] == "pending"
    assert payload["submitted_by_email"] == "visitor@example.com"
    assert payload["submitted"] is True
    membership.assert_not_called()
    assert "submitted_by_email" not in result.model_dump()


def test_public_club_response_preserves_creation_time():
    from datetime import datetime, timezone

    timestamp = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
    club = club_service._club_response(
        {"id": 1, "club_name": "New Club", "created_at": timestamp.isoformat()}
    )
    assert club.created_at == timestamp
    assert club.model_dump(mode="json")["created_at"] == "2026-10-02T12:00:00Z"
    assert club_service._club_response({"id": 2, "club_name": "Older Club"}).created_at is None


def test_new_club_member_follows_the_club(monkeypatch, fake_sb, patch_sb):
    from uuid import UUID

    from services import saved_club_service, user_service

    patch_sb("services.club_service")
    user_id = UUID("11111111-1111-1111-1111-111111111111")
    monkeypatch.setattr(
        user_service,
        "get_user",
        lambda _id: SimpleNamespace(email="lead@uwo.ca", full_name=None, avatar_url=None),
    )
    follow = MagicMock()
    monkeypatch.setattr(saved_club_service, "save_club", follow)
    fake_sb.set_response(data=[{"joined_at": "2026-10-25T12:00:00+00:00"}])

    club_service.add_club_member(7, user_id)

    follow.assert_called_once_with(str(user_id), 7)
