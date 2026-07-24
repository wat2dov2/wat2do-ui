from datetime import datetime, timezone
from unittest.mock import Mock

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


def test_generate_due_batches_ignores_non_matching_local_hour(monkeypatch):
    generate = Mock(return_value="generated")
    monkeypatch.setattr(service, "_generate_account_batch", generate)

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 12, tzinfo=timezone.utc),
    )

    assert result["accounts"] == 0
    generate.assert_not_called()
