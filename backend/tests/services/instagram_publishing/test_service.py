from datetime import datetime, timezone
from unittest.mock import Mock

import pytest

from schemas.instagram_publishing import InstagramPublishBatchUpdate
from services.instagram_publishing import service


def test_select_events_orders_by_ai_score_and_limits_each_organization():
    candidates = [
        {
            "id": 1,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        },
        {
            "id": 2,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-26T10:00:00+00:00",
        },
        {
            "id": 3,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-27T10:00:00+00:00",
        },
        {
            "id": 4,
            "organization": "Another Club",
            "dtstart_utc": "2026-07-28T10:00:00+00:00",
        },
    ]
    scores = [
        {"event_id": 1, "overall_score": 9.0},
        {"event_id": 2, "overall_score": 8.0},
        {"event_id": 3, "overall_score": 7.0},
        {"event_id": 4, "overall_score": 6.0},
    ]

    selected = service._select_events(candidates, scores)

    assert [event["id"] for event, _ in selected] == [1, 2, 4]


def test_select_events_filters_below_threshold():
    candidates = [
        {
            "id": 1,
            "organization": "Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        }
    ]

    assert service._select_events(candidates, [{"event_id": 1, "overall_score": 2.0}]) == []


def test_generate_due_batches_uses_enabled_controlbox_accounts(monkeypatch):
    generated_accounts = []
    monkeypatch.setattr(service, "_batch_exists", lambda *_: False)
    monkeypatch.setattr(
        service,
        "_generate_account_batch",
        lambda account, *_: generated_accounts.append(account) or "generated",
    )

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 13, tzinfo=timezone.utc),
    )

    assert result == {
        "accounts": 1,
        "generated": 1,
        "empty": 0,
        "skipped": 0,
        "failed": 0,
    }
    assert generated_accounts[0].key == "wat2do"
    assert generated_accounts[0].instagram_business_account_id == "17841476154506771"


def test_generate_due_batches_runs_when_the_scheduler_starts_late(monkeypatch):
    generate = Mock(return_value="generated")
    monkeypatch.setattr(service, "_generate_account_batch", generate)
    monkeypatch.setattr(service, "_batch_exists", lambda *_: False)

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 14, 48, tzinfo=timezone.utc),
    )

    assert result["accounts"] == 1
    generate.assert_called_once()


def _batch(items: list[dict]) -> dict:
    return {
        "id": "batch-1",
        "account_key": "wat2do",
        "school": "uwaterloo",
        "status": "ready_for_review",
        "version": 3,
        "items": items,
    }


def _item(item_id: str, event_id: int, snapshot: dict) -> dict:
    return {"id": item_id, "event_id": event_id, "event_snapshot": snapshot}


@pytest.fixture
def draft_editor(monkeypatch):
    """Stub every I/O edge of ``update_batch`` and record what it did."""
    calls = {"event_renders": [], "cover_renders": [], "created": [], "updated": [], "rpc": []}

    class _Rpc:
        def __init__(self, name, params):
            calls["rpc"].append((name, params))

        def execute(self):
            return Mock(data=[{"id": "batch-1"}])

    monkeypatch.setattr(service, "get_sb", lambda: Mock(rpc=_Rpc))
    monkeypatch.setattr(
        service,
        "render_event_asset",
        lambda snapshot: calls["event_renders"].append(int(snapshot["id"])) or "https://a/e.png",
    )
    monkeypatch.setattr(
        service,
        "render_cover_asset",
        lambda events, school, body: (
            calls["cover_renders"].append(([int(e["id"]) for e in events], school, body))
            or "https://a/cover.png"
        ),
    )
    monkeypatch.setattr(
        service,
        "_create_item",
        lambda _batch, snapshot: (
            calls["created"].append(int(snapshot["id"])) or f"item-new-{snapshot['id']}"
        ),
    )
    monkeypatch.setattr(
        service,
        "_update_item_fields",
        lambda item_id, fields: calls["updated"].append((item_id, sorted(fields))),
    )
    return calls


def test_update_batch_reorders_without_re_rendering_unchanged_slides(monkeypatch, draft_editor):
    snapshots = {1: {"id": 1, "title": "One"}, 2: {"id": 2, "title": "Two"}}
    batch = _batch([_item("item-1", 1, snapshots[1]), _item("item-2", 2, snapshots[2])])
    monkeypatch.setattr(service, "get_batch", lambda _id: batch)
    monkeypatch.setattr(service, "_load_event_snapshots", lambda _ids: snapshots)

    service.update_batch(
        "batch-1",
        InstagramPublishBatchUpdate(
            version=3, caption="Caption", cover_body="Body", event_ids=[2, 1]
        ),
    )

    assert draft_editor["event_renders"] == []
    assert draft_editor["created"] == []
    # The cover always recompiles from the slides the editor is holding.
    assert draft_editor["cover_renders"] == [([2, 1], "uwaterloo", "Body")]
    _, params = draft_editor["rpc"][0]
    assert params["p_item_ids"] == ["item-2", "item-1"]
    assert params["p_cover_body"] == "Body"


def test_update_batch_re_renders_edited_events_and_appends_new_ones(monkeypatch, draft_editor):
    stored = {"id": 1, "title": "Old title"}
    snapshots = {1: {"id": 1, "title": "New title"}, 5: {"id": 5, "title": "Added"}}
    batch = _batch([_item("item-1", 1, stored)])
    monkeypatch.setattr(service, "get_batch", lambda _id: batch)
    monkeypatch.setattr(service, "_load_event_snapshots", lambda _ids: snapshots)

    service.update_batch(
        "batch-1",
        InstagramPublishBatchUpdate(version=3, caption="Caption", event_ids=[1, 5]),
    )

    assert draft_editor["event_renders"] == [1]
    assert draft_editor["created"] == [5]
    # A re-rendered slide must drop the Meta container built from the old image.
    assert draft_editor["updated"] == [
        ("item-1", ["asset_url", "event_snapshot", "meta_container_id"])
    ]
    _, params = draft_editor["rpc"][0]
    assert params["p_item_ids"] == ["item-1", "item-new-5"]


def test_update_batch_rejects_events_without_a_date(monkeypatch, draft_editor):
    batch = _batch([])
    monkeypatch.setattr(service, "get_batch", lambda _id: batch)
    monkeypatch.setattr(service, "_load_event_snapshots", lambda _ids: {})

    with pytest.raises(Exception, match="dated, existing event"):
        service.update_batch(
            "batch-1",
            InstagramPublishBatchUpdate(version=3, caption="Caption", event_ids=[9]),
        )
