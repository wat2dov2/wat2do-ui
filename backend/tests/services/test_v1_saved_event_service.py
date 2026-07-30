from uuid import uuid4

from core.tables import V1_SAVED_EVENTS
from services.v1_saved_event_service import get_saved_event_ids, unsave_event


def test_get_saved_event_ids_filters_by_user_id(fake_sb, patch_sb):
    patch_sb("services.v1_saved_event_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"event_id": 42}, {"event_id": 7}])

    assert get_saved_event_ids(user_id) == [42, 7]
    fake_sb.table.assert_called_with(V1_SAVED_EVENTS)
    fake_sb.eq.assert_any_call("user_id", user_id)


def test_unsave_event_filters_by_user_and_event(fake_sb, patch_sb):
    patch_sb("services.v1_saved_event_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"id": str(uuid4())}])

    assert unsave_event(user_id, 42) is True
    fake_sb.table.assert_called_once_with(V1_SAVED_EVENTS)
    fake_sb.delete.assert_called_once()
    fake_sb.eq.assert_any_call("user_id", user_id)
    fake_sb.eq.assert_any_call("event_id", 42)
