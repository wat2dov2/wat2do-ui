"""Service tests for interaction aggregation."""

from services.interaction_service import get_click_counts_for_events


def test_get_click_counts_for_events_uses_shared_rpc(fake_sb, patch_sb):
    patch_sb("services.interaction_service")
    fake_sb.set_response(
        data=[
            {"event_id": 1, "click_count": 9},
            {"event_id": 2, "click_count": 4},
        ]
    )

    counts = get_click_counts_for_events([2, 1, 2])

    assert counts == {1: 9, 2: 4}
    fake_sb.rpc.assert_called_once_with("get_event_click_counts", {"p_event_ids": [1, 2]})
