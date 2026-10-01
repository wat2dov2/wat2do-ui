"""Service tests for interaction aggregation."""

from unittest.mock import MagicMock

import pytest

from schemas.interaction import InteractionCreate
from services import interaction_service
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
        MagicMock(data=[{"event_id": item_id, "click_count": 1} for item_id in range(1000)]),
        RuntimeError("Database unavailable"),
    ]
    assert get_click_counts_for_events(list(range(1001))) == {}


@pytest.mark.parametrize("anonymous", [False, True])
@pytest.mark.parametrize(
    ("existing_pairs", "expected_indices"),
    [
        ([], [0, 1, 3, 4, 5]),
        ([(1, "click")], [0, 3, 4, 5]),
        ([(1, "click")] * 2, [3, 4, 5]),
        ([(9, "click")] * 4, [0]),
        ([(9, "click")] * 5, []),
        ([(1, "click")] * 2 + [(1, "share")] * 2, [4]),
    ],
)
def test_interaction_caps_preserve_order_and_actor_scope(
    fake_sb, patch_sb, monkeypatch, anonymous, existing_pairs, expected_indices
):
    patch_sb("services.interaction_service")
    monkeypatch.setattr(interaction_service, "MAX_DUPLICATE_INTERACTIONS", 2)
    monkeypatch.setattr(interaction_service, "MAX_USER_INTERACTIONS_PER_WINDOW", 5)
    fake_sb.set_response(
        data=[{"event_id": event_id, "interaction_type": kind} for event_id, kind in existing_pairs]
    )
    interactions = [
        InteractionCreate(event_id=event_id, interaction_type=kind)
        for event_id, kind in [
            (1, "click"),
            (1, "click"),
            (1, "click"),
            (1, "share"),
            (2, "click"),
            (3, "click"),
        ]
    ]
    check = (
        interaction_service.check_duplicate_interactions_for_session
        if anonymous
        else interaction_service.check_duplicate_interactions
    )

    result = check("actor-1", interactions)

    assert result == [interactions[index] for index in expected_indices]
    assert all(item is interactions[index] for item, index in zip(result, expected_indices))
    fake_sb.eq.assert_called_once_with("session_id" if anonymous else "user_id", "actor-1")
    if anonymous:
        fake_sb.is_.assert_called_once_with("user_id", "null")
    else:
        fake_sb.is_.assert_not_called()


@pytest.mark.parametrize("anonymous", [False, True])
def test_interaction_dedup_skips_empty_batches_and_fails_closed(monkeypatch, anonymous):
    get_sb = MagicMock(side_effect=RuntimeError("database unavailable"))
    monkeypatch.setattr(interaction_service, "get_sb", get_sb)
    check = (
        interaction_service.check_duplicate_interactions_for_session
        if anonymous
        else interaction_service.check_duplicate_interactions
    )

    assert check("actor-1", []) == []
    get_sb.assert_not_called()
    assert check("actor-1", [InteractionCreate(event_id=1, interaction_type="click")]) == []
    get_sb.assert_called_once()


@pytest.mark.parametrize("anonymous", [False, True])
def test_interaction_dedup_includes_history_from_later_pages(
    fake_sb, patch_sb, monkeypatch, anonymous
):
    patch_sb("services.interaction_service")
    monkeypatch.setattr(interaction_service, "MAX_DUPLICATE_INTERACTIONS", 1)
    monkeypatch.setattr(interaction_service, "MAX_USER_INTERACTIONS_PER_WINDOW", 2000)
    fake_sb.queue_responses(
        [
            [{"event_id": event_id, "interaction_type": "click"} for event_id in range(2, 1002)],
            [{"event_id": 1, "interaction_type": "click"}],
        ]
    )
    check = (
        interaction_service.check_duplicate_interactions_for_session
        if anonymous
        else interaction_service.check_duplicate_interactions
    )

    assert check("actor-1", [InteractionCreate(event_id=1, interaction_type="click")]) == []
    assert [call.args for call in fake_sb.range.call_args_list] == [(0, 999), (1000, 1999)]


def test_positions_share_batch_transport_but_do_not_feed_event_recommendations(fake_sb, patch_sb):
    from core.tables import POSITION_INTERACTIONS, USER_INTERACTIONS
    from schemas.interaction import InteractionCreate
    from services.interaction_service import record_interactions

    patch_sb("services.interaction_service")
    fake_sb.set_response(data=[{"id": "recorded"}])
    assert (
        record_interactions(
            None,
            "session",
            [
                InteractionCreate(event_id=1, interaction_type="click"),
                InteractionCreate(position_id=1, interaction_type="click"),
            ],
        )
        == 2
    )
    assert [call.args[0] for call in fake_sb.table.call_args_list] == [
        USER_INTERACTIONS,
        POSITION_INTERACTIONS,
    ]
    rows = [call.args[0] for call in fake_sb.insert.call_args_list]
    assert rows[0][0]["event_id"] == 1
    assert "position_id" not in rows[0][0]
    assert rows[1][0]["position_id"] == 1
    assert "event_id" not in rows[1][0]


@pytest.mark.parametrize(
    "payload",
    [
        {"interaction_type": "click"},
        {"event_id": 1, "position_id": 1, "interaction_type": "click"},
        {"position_id": 1, "interaction_type": "going"},
    ],
)
def test_interaction_target_is_unambiguous(payload):
    from pydantic import ValidationError

    from schemas.interaction import InteractionCreate

    with pytest.raises(ValidationError):
        InteractionCreate(**payload)
