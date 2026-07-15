"""Service-level tests for ``going_event_service``.

The reflection in ``pets-feature-reflection.md`` flagged that the
filter-name bug class — e.g. ``.eq("user_id", …)`` accidentally becoming
``.eq("owner_id", …)`` — passes every router-level test because those
never touch the Supabase query chain. These tests close that gap for the
strictly-per-user resource pattern by asserting on the chain directly.
"""

from uuid import uuid4

from core.tables import USER_GOING_EVENTS
from services import going_event_service
from services.going_event_service import (
    count_going_events,
    get_going_counts_for_events,
    get_going_event_ids,
    unmark_going,
)


def test_unmark_going_filters_by_user_id_and_event_id(fake_sb, patch_sb):
    """Both the user_id and event_id filters must land on the delete chain.

    Catches:
    - Dropping the user_id filter entirely (would let user A delete
      user B's going rows).
    - Renaming the column on the service side without updating the schema
      (``.eq("owner_id", …)`` against a ``user_id`` column silently
      matches zero rows and returns ``False``).
    """
    patch_sb("services.going_event_service")
    fake_sb.set_response(data=[{"id": "row-uuid"}])
    user_id = str(uuid4())

    deleted = unmark_going(user_id, 42)

    assert deleted is True
    fake_sb.table.assert_called_once_with(USER_GOING_EVENTS)
    fake_sb.delete.assert_called_once()
    fake_sb.eq.assert_any_call("user_id", user_id)
    fake_sb.eq.assert_any_call("event_id", 42)


def test_get_going_event_ids_filters_by_user_id(fake_sb, patch_sb):
    """Read-side filter must also be ``user_id`` (per ownership convention)."""
    patch_sb("services.going_event_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"event_id": 1}, {"event_id": 2}])

    ids = get_going_event_ids(user_id)

    assert ids == [1, 2]
    fake_sb.table.assert_called_with(USER_GOING_EVENTS)
    fake_sb.eq.assert_any_call("user_id", user_id)


def test_count_going_events_returns_postgrest_count(fake_sb, patch_sb):
    """``count="exact"`` result propagates via ``r.count``, not ``r.data``."""
    patch_sb("services.going_event_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[], count=37)

    assert count_going_events(user_id) == 37
    fake_sb.eq.assert_called_once_with("user_id", user_id)


def test_get_going_counts_for_events_aggregates_rows(monkeypatch, fake_sb, patch_sb):
    patch_sb("services.going_event_service")
    fake_sb.set_response(data=[{"event_id": 1}, {"event_id": 1}, {"event_id": 2}])
    monkeypatch.setattr(
        going_event_service,
        "fetch_all_pages",
        lambda fetch_page: fetch_page(0, 1000),
    )

    counts = get_going_counts_for_events([1, 2, 3])

    assert counts == {1: 2, 2: 1}
    fake_sb.in_.assert_called_once_with("event_id", [1, 2, 3])
