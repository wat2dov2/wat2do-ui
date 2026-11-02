
from services import position_service


def test_get_club_position_counts_aggregates_open_count(fake_sb, patch_sb):
    patch_sb("services.position_service")
    fake_sb.set_response(
        data=[
            {"club_id": 1},
            {"club_id": 1},
            {"club_id": 2},
        ]
    )

    counts = position_service.get_club_position_counts([1, 2, 99])

    assert counts == {1: 2, 2: 1, 99: 0}
    fake_sb.eq.assert_called_once_with("is_active", True)
