"""Service-level tests for chunked occurrence reads."""

from types import SimpleNamespace
from uuid import UUID

import pytest

from services import event_date_service


def _occ_row(event_id: int, dtstart: str, occ_id: int = 1) -> dict:
    return {
        "id": str(UUID(int=occ_id)),
        "event_id": event_id,
        "dtstart_utc": dtstart,
        "dtend_utc": None,
        "duration": None,
        "tz": None,
        "created_at": "2026-04-15T10:00:00+00:00",
    }


def test_list_by_ids_fetches_only_selected_occurrences(fake_sb, patch_sb):
    patch_sb("services.event_date_service")
    occurrence_id = str(UUID(int=99))
    fake_sb.set_response(data=[_occ_row(42, "2026-05-01T18:00:00+00:00", 99)])

    result = event_date_service.list_by_ids([occurrence_id])

    assert result[0].id == UUID(occurrence_id)
    fake_sb.in_.assert_called_once_with("id", (occurrence_id,))


@pytest.mark.parametrize("read", ["event", "events", "occurrences"])
def test_occurrence_reads_exclude_unused_database_metadata(fake_sb, patch_sb, read):
    patch_sb("services.event_date_service")
    row = _occ_row(42, "2026-05-01T18:00:00+00:00", 99)
    fake_sb.set_response(data=[row])

    if read == "event":
        [occurrence] = event_date_service.list_for_event(42)
    elif read == "events":
        [occurrence] = event_date_service.list_for_events([42])[42]
    else:
        [occurrence] = event_date_service.list_by_ids([row["id"]])

    columns = fake_sb.select.call_args.args[0].split(",")
    assert "*" not in columns
    assert "created_at" not in columns
    assert {"id", "event_id", "dtstart_utc", "dtend_utc", "duration", "tz"} == set(columns)
    assert occurrence.model_dump(mode="json") == {
        "id": row["id"],
        "event_id": 42,
        "dtstart_utc": "2026-05-01T18:00:00Z",
        "dtend_utc": None,
        "duration": None,
        "tz": None,
    }


@pytest.mark.parametrize("count", [0, 1, 499, 500, 501, 1200])
@pytest.mark.parametrize("by_occurrence", [False, True])
def test_occurrence_reads_preserve_batch_boundaries(fake_sb, patch_sb, count, by_occurrence):
    patch_sb("services.event_date_service")
    ids = (
        [str(UUID(int=index + 1)) for index in range(count)]
        if by_occurrence
        else list(range(count))
    )
    fake_sb.set_response(data=[])

    if by_occurrence:
        result = event_date_service.list_by_ids(ids + ids)
        assert result == []
    else:
        result = event_date_service.list_for_events(ids)
        assert result == {event_id: [] for event_id in ids}

    calls = fake_sb.in_.call_args_list
    assert [list(call.args[1]) for call in calls] == [
        ids[start : start + 500] for start in range(0, count, 500)
    ]
    assert all(call.args[0] == ("id" if by_occurrence else "event_id") for call in calls)
    assert fake_sb.execute.call_count == len(calls)


def test_list_for_events_empty_input_no_query():
    """Empty event_ids returns {} without any DB call."""
    # No database fixture: empty input must short-circuit.
    assert event_date_service.list_for_events([]) == {}


def test_list_for_events_preserves_rows_and_empty_groups_across_batches(fake_sb, patch_sb):
    patch_sb("services.event_date_service")
    first = _occ_row(1, "2026-05-01T18:00:00+00:00", 1)
    last = _occ_row(501, "2026-05-02T18:00:00+00:00", 2)
    unrelated = _occ_row(999, "2026-05-03T18:00:00+00:00", 3)
    fake_sb.execute.side_effect = [
        SimpleNamespace(data=[first, unrelated]),
        SimpleNamespace(data=[last]),
    ]

    result = event_date_service.list_for_events(list(range(1, 502)))

    assert len(result) == 501
    assert result[1][0].id == UUID(first["id"])
    assert result[501][0].id == UUID(last["id"])
    assert result[2] == []
    assert 999 not in result
