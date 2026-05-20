from unittest.mock import MagicMock

from postgrest.exceptions import APIError

from services import credit_service


def test_active_promoted_event_ids_falls_back_to_expires_at(fake_sb, patch_sb):
    patch_sb("services.credit_service")
    missing_end_date = APIError(
        {
            "code": "42703",
            "message": "column event_promotions.end_date does not exist",
            "details": None,
            "hint": None,
        }
    )
    fake_sb.execute.side_effect = [
        missing_end_date,
        MagicMock(data=[{"event_id": 7}, {"event_id": 7}, {"event_id": 9}], count=0),
    ]

    assert sorted(credit_service.get_active_promoted_event_ids()) == [7, 9]
    assert [call.args[0] for call in fake_sb.gt.call_args_list] == ["end_date", "expires_at"]
