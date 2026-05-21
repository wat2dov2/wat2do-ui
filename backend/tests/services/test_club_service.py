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
