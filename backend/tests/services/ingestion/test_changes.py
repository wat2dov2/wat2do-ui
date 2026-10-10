from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest

from core.tables import EVENTS, INGESTION_CHANGES, POSITIONS
from schemas.event import EventResponse
from services.ingestion import changes as module

_GOING = "6f1c2a52-3b8e-4a0f-9c1d-2f6b7e9a1c33"


def _occurrence(event_id: int, day: int) -> dict:
    start = datetime(2026, 10, day, 23, 0, tzinfo=timezone.utc).isoformat()
    return {
        "id": f"00000000-0000-0000-0000-0000000000{day}",
        "event_id": event_id,
        "dtstart_utc": start,
        "dtend_utc": None,
        "duration": None,
        "tz": "America/Toronto",
    }


@pytest.fixture
def db(monkeypatch):
    """Serve ``ingestion_changes`` rows and record every write and side effect."""
    state = SimpleNamespace(rows=[], updates=[], deletes=[], revalidated=[], alerts=[], events={})

    class Query:
        def __init__(self, table):
            self.table, self.filters, self.action, self.payload = table, [], "select", None

        def select(self, *_):
            return self

        def update(self, payload):
            self.action, self.payload = "update", payload
            return self

        def delete(self):
            self.action = "delete"
            return self

        def eq(self, column, value):
            self.filters.append((column, value))
            return self

        def gte(self, column, value):
            self.filters.append((f"{column}>=", value))
            return self

        def in_(self, column, values):
            self.filters.append((column, list(values)))
            return self

        def execute(self):
            if self.action == "update":
                state.updates.append((self.table, self.payload, self.filters))
            elif self.action == "delete":
                state.deletes.append((self.table, self.filters))
            elif self.table == INGESTION_CHANGES:
                return SimpleNamespace(data=state.rows)
            else:
                return SimpleNamespace(data=[{"slug": "uwaterloo"}])
            return SimpleNamespace(data=[])

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(table=Query))
    monkeypatch.setattr(
        module.event_feed_revalidation_service,
        "revalidate_schools",
        lambda schools, *, resources: state.revalidated.append((list(schools), resources)),
    )
    monkeypatch.setattr(
        module.event_service, "get_event", lambda event_id: state.events.get(event_id)
    )
    monkeypatch.setattr(
        module,
        "enqueue_event_change",
        lambda event, diff, recipients: state.alerts.append((event.id, diff, recipients)),
    )
    return state


def _event(event_id: int, *, days: list[int], location: str = "AL 113") -> EventResponse:
    return EventResponse.model_validate(
        {
            "id": event_id,
            "title": "Drop-In Jams",
            "location": location,
            "club": "Improv Club, UW",
            "school": "uwaterloo",
            "added_at": "2026-10-01T00:00:00Z",
            "cancelled": False,
            "occurrences": [_occurrence(event_id, d) for d in days],
        }
    )


def test_drain_does_nothing_without_changes(db):
    module.drain()
    assert db.revalidated == [] and db.updates == [] and db.deletes == []


def test_drain_refreshes_feeds_and_clears_rows(db):
    db.rows = [
        {"kind": "event", "record_id": 5, "school_id": 7, "snapshot": None},
        {"kind": "position", "record_id": 9, "school_id": 7, "snapshot": None},
    ]
    module.drain()

    assert db.updates == [] and db.alerts == []
    assert db.revalidated == [(["uwaterloo"], ("events", "clubs", "positions"))]
    assert db.deletes == [
        (INGESTION_CHANGES, [("kind", "event"), ("record_id", [5])]),
        (INGESTION_CHANGES, [("kind", "position"), ("record_id", [9])]),
    ]


def test_stamp_new_rows_gives_rows_from_the_source_its_caption_and_post_time(db):
    since = datetime(2026, 10, 10, tzinfo=timezone.utc)
    posted = datetime(2026, 10, 9, 18, tzinfo=timezone.utc)
    module.stamp_new_rows(
        "https://www.instagram.com/p/NEW/", caption="x" * 6000, posted_at=posted, since=since
    )

    [(event_table, event_payload, event_filters), (position_table, position_payload, _)] = (
        db.updates
    )
    assert event_table == EVENTS and position_table == POSITIONS
    assert event_filters == [
        ("source_url", "https://www.instagram.com/p/NEW/"),
        ("added_at>=", since.isoformat()),
    ]
    assert len(event_payload["description"]) == module.MAX_EVENT_DESCRIPTION_LENGTH
    assert (
        event_payload["source_posted_at"]
        == event_payload["last_source_posted_at"]
        == posted.isoformat()
    )
    assert len(position_payload["description"]) == module.MAX_POSITION_DESCRIPTION_LENGTH


def test_stamp_new_rows_skips_directory_pages_without_text(db):
    module.stamp_new_rows(
        "https://wusa.ca/event/jam/",
        caption="",
        posted_at=None,
        since=datetime(2026, 10, 10, tzinfo=timezone.utc),
    )
    assert db.updates == []


def test_drain_alerts_people_going_when_a_date_is_removed(db):
    db.events[3] = _event(3, days=[14, 28])
    db.rows = [
        {
            "kind": "event",
            "record_id": 3,
            "school_id": 7,
            "snapshot": {
                "location": "AL 113",
                "cancelled": False,
                "occurrences": [_occurrence(3, d) for d in (14, 21, 28)],
                "going_user_ids": [_GOING],
            },
        }
    ]

    module.drain()

    [(event_id, diff, recipients)] = db.alerts
    assert event_id == 3 and set(diff) == {"occurrences"}
    assert recipients == [UUID(_GOING)]
    assert db.updates == []


def test_drain_skips_alerts_without_material_changes_or_attendees(db):
    db.events[3] = _event(3, days=[14])
    snapshot = {"location": "AL 113", "cancelled": False, "occurrences": [_occurrence(3, 14)]}
    db.rows = [
        {
            "kind": "event",
            "record_id": 3,
            "school_id": 7,
            "snapshot": {**snapshot, "going_user_ids": [_GOING]},
        },
        {
            "kind": "event",
            "record_id": 4,
            "school_id": 7,
            "snapshot": {**snapshot, "location": "AL 116", "going_user_ids": []},
        },
    ]
    module.drain()
    assert db.alerts == []
