"""Service tests for interaction aggregation."""

from unittest.mock import MagicMock

import pytest

from services import interaction_service


@pytest.mark.parametrize("resource", ["event", "position"])
def test_click_counts_include_later_ids_beyond_postgrest_row_limit(fake_sb, patch_sb, resource):
    patch_sb("services.interaction_service")
    rows = [{f"{resource}_id": item_id, "click_count": item_id + 1} for item_id in range(1, 1002)]
    fake_sb.queue_responses([rows[:1000], rows[1000:]])

    counts = interaction_service._get_click_counts(list(range(1, 1002)), resource)

    assert len(counts) == 1001
    assert counts[1001] == 1002
    assert [call.args for call in fake_sb.range.call_args_list] == [(0, 999), (1000, 1999)]
    assert [call.args for call in fake_sb.order.call_args_list] == [(f"{resource}_id",)] * 2


def test_click_counts_fail_without_returning_a_partial_page(fake_sb, patch_sb):
    patch_sb("services.interaction_service")
    fake_sb.execute.side_effect = [
        MagicMock(data=[{"position_id": item_id, "click_count": 1} for item_id in range(1000)]),
        RuntimeError("Database unavailable"),
    ]
    assert interaction_service.get_click_counts_for_positions(list(range(1001))) == {}
