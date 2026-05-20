"""Service-level tests for event_date_service.

The interesting paths are:
- ``replace_occurrences`` snapshot+restore on INSERT failure.
- ``list_for_events`` chunking when given >chunk_size ids.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from schemas.event_date import OccurrenceCreate
from services import event_date_service


def _occ_row(event_id: int, dtstart: str, occ_id: int = 1) -> dict:
    return {
        "id": occ_id,
        "event_id": event_id,
        "dtstart_utc": dtstart,
        "dtend_utc": None,
        "duration": None,
        "tz": None,
        "created_at": "2026-04-15T10:00:00+00:00",
    }


def _occ_create(dtstart_iso: str) -> OccurrenceCreate:
    return OccurrenceCreate(dtstart_utc=datetime.fromisoformat(dtstart_iso))


def test_replace_occurrences_restores_snapshot_on_insert_failure(fake_sb, patch_sb):
    """If create_occurrences raises, the snapshot is re-inserted.

    Pre-fix: a DELETE-then-INSERT with no rollback meant a failed INSERT
    left the event with zero occurrences (invisible in date-filtered
    listings AND treated as always-mutable by ``has_ended``). The fix
    snapshots the existing rows, then re-inserts them on failure.
    """
    patch_sb("services.event_date_service")
    # Sequence:
    #   1. list_for_event(event_id=42) -> snapshot row
    #   2. delete eq("event_id", 42)   -> [] (delete returns [])
    #   3. insert(new_payload)         -> RAISES
    #   4. insert(snapshot_payload)    -> [restored row]
    fake_sb.queue_responses(
        [
            [_occ_row(42, "2026-05-01T18:00:00+00:00", 99)],  # snapshot fetch
            [],  # delete
        ]
    )
    # The third execute (the insert that should fail) — set up via raise_on_execute
    # but queue_responses owns the side_effect, so swap to a smarter side_effect.
    state = {"call": 0}
    snapshot_resp = MagicMock(data=[_occ_row(42, "2026-05-01T18:00:00+00:00", 99)], count=0)
    delete_resp = MagicMock(data=[], count=0)
    restored_resp = MagicMock(data=[_occ_row(42, "2026-05-01T18:00:00+00:00", 99)], count=0)

    def _smart():
        state["call"] += 1
        n = state["call"]
        if n == 1:
            return snapshot_resp
        if n == 2:
            return delete_resp
        if n == 3:
            raise RuntimeError("simulated INSERT failure")
        if n == 4:
            return restored_resp
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart

    with pytest.raises(RuntimeError, match="simulated INSERT failure"):
        event_date_service.replace_occurrences(42, [_occ_create("2026-06-01T18:00:00+00:00")])

    # Confirm the restore-insert ran (call #4).
    assert state["call"] == 4

    # Confirm the restore payload contains the snapshot's dtstart, NOT the new one.
    restore_call = fake_sb.insert.call_args_list[-1]
    restore_payload = restore_call[0][0]
    assert isinstance(restore_payload, list)
    assert restore_payload[0]["dtstart_utc"] == "2026-05-01T18:00:00+00:00"


def test_list_for_events_chunks_large_id_lists(fake_sb, patch_sb):
    """>500 ids triggers multiple .in_() queries, not one URI-too-long request."""
    patch_sb("services.event_date_service")
    # 1200 event ids => 3 chunks of 500/500/200.
    ids = list(range(1, 1201))
    # Each chunk's response: empty (we don't care about the rows here, just
    # that the chunk loop fires multiple in_() calls).
    fake_sb.set_response(data=[])
    event_date_service.list_for_events(ids)
    # Each chunk made exactly one .in_() call → expect 3 calls total.
    assert fake_sb.in_.call_count == 3
    # First chunk should be 500 ids; last should be 200.
    chunk_sizes = [len(call[0][1]) for call in fake_sb.in_.call_args_list]
    assert chunk_sizes == [500, 500, 200]


def test_list_for_events_empty_input_no_query():
    """Empty event_ids returns {} without any DB call."""
    # No fake_sb / patch_sb — confirms the function short-circuits.
    assert event_date_service.list_for_events([]) == {}
