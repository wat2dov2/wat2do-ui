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
