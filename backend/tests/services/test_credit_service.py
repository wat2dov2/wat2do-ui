from unittest.mock import MagicMock

from services import credit_service


def test_get_active_promoted_event_ids(fake_sb, patch_sb):
    patch_sb("services.credit_service")
    fake_sb.set_response(data=[{"event_id": 7}, {"event_id": 9}])

    assert sorted(credit_service.get_active_promoted_event_ids()) == [7, 9]
    assert [call.args[0] for call in fake_sb.gt.call_args_list] == ["end_date"]

