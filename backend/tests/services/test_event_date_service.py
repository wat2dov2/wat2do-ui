"""Service-level tests for chunked occurrence reads."""

from uuid import UUID

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
    fake_sb.in_.assert_called_once_with("id", [occurrence_id])


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
