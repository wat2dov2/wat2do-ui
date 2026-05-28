from services import club_service


def test_user_owns_club_named_matches_normalized_name(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(
        data=[
            {
                "id": 1,
                "club_name": "Test   Org",
                "club_type": "WUSA",
                "created_by": "user-1",
            }
        ]
    )

    assert club_service.user_owns_club_named("user-1", "test org") is True
    fake_sb.table.assert_called_once_with("clubs")
    fake_sb.eq.assert_called_once_with("created_by", "user-1")


def test_user_owns_club_named_rejects_missing_or_unmatched_name(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(
        data=[
            {
                "id": 1,
                "club_name": "Another Club",
                "club_type": "WUSA",
                "created_by": "user-1",
            }
        ]
    )

    assert club_service.user_owns_club_named("user-1", None) is False
    assert club_service.user_owns_club_named("user-1", "Test Org") is False


def test_resolve_event_club_prefers_explicit_club_id(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(
        data=[
            {
                "id": 1,
                "club_name": "First Club",
                "club_type": "WUSA",
                "created_by": "user-1",
            },
            {
                "id": 2,
                "club_name": "Second Club",
                "club_type": "Athletics",
                "created_by": "user-1",
            },
        ]
    )

    club = club_service.resolve_event_club_for_owner(
        "user-1",
        club_id=2,
        organization="First Club",
    )

    assert club is not None
    assert club.id == 2


def test_resolve_event_club_single_club_ignores_organization_text(fake_sb, patch_sb):
    patch_sb("services.club_service")
    fake_sb.set_response(
        data=[
            {
                "id": 1,
                "club_name": "Verified Club",
                "club_type": "WUSA",
                "created_by": "user-1",
            },
        ]
    )

    club = club_service.resolve_event_club_for_owner("user-1", organization="Typed Org")

    assert club is not None
    assert club.club_name == "Verified Club"


def test_list_clubs_school_missing_column_fallback(fake_sb, patch_sb):
    from unittest.mock import MagicMock

    from postgrest.exceptions import APIError

    patch_sb("services.club_service")
    missing_school = APIError(
        {
            "code": "42703",
            "message": "column clubs.school does not exist",
            "details": None,
            "hint": None,
        }
    )
    fake_sb.execute.side_effect = [
        missing_school,
        MagicMock(
            data=[
                {"id": 1, "club_name": "UW Chess Club", "club_type": "WUSA", "school": None},
                {
                    "id": 2,
                    "club_name": "UofT Board Games",
                    "club_type": "Independent",
                    "school": "University of Toronto",
                },
            ]
        ),
    ]

    # Filter for University of Waterloo should match the one with school=None (which defaults to Waterloo)
    clubs = club_service.list_clubs(school="University of Waterloo")
    assert len(clubs) == 1
    assert clubs[0].club_name == "UW Chess Club"


def test_create_club_school_missing_column_fallback(fake_sb, patch_sb):
    from unittest.mock import MagicMock

    from postgrest.exceptions import APIError

    from schemas.club import ClubCreate

    patch_sb("services.club_service")
    missing_school = APIError(
        {
            "code": "42703",
            "message": "column clubs.school does not exist",
            "details": None,
            "hint": None,
        }
    )
    fake_sb.execute.side_effect = [
        missing_school,
        MagicMock(data=[{"id": 1, "club_name": "New Club", "club_type": "WUSA"}]),
    ]

    club_data = ClubCreate(club_name="New Club", club_type="WUSA", school="University of Waterloo")
    res = club_service.create_club(club_data, created_by="user-1")
    assert res.club_name == "New Club"


def test_update_club_school_missing_column_fallback(fake_sb, patch_sb):
    from unittest.mock import MagicMock

    from postgrest.exceptions import APIError

    from schemas.club import ClubUpdate

    patch_sb("services.club_service")
    missing_school = APIError(
        {
            "code": "42703",
            "message": "column clubs.school does not exist",
            "details": None,
            "hint": None,
        }
    )

    fake_sb.execute.side_effect = [
        # get_club call inside update_club
        MagicMock(data=[{"id": 1, "club_name": "Old Name", "club_type": "WUSA"}]),
        # update call itself raising 42703
        missing_school,
        # fallback update call
        MagicMock(data=[{"id": 1, "club_name": "New Name", "club_type": "WUSA"}]),
    ]

    club_data = ClubUpdate(club_name="New Name", school="University of Waterloo")
    res = club_service.update_club(1, club_data)
    assert res is not None
    assert res.club_name == "New Name"
