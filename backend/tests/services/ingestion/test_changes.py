from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from core.tables import EVENTS, INGESTION_CHANGES, POSITIONS
from services.ingestion import changes as module


@pytest.fixture
def db(monkeypatch):
    """Serve ``ingestion_changes`` rows and record every write and side effect."""
    state = SimpleNamespace(rows=[], updates=[], deletes=[], revalidated=[], pending={})

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

        def like(self, column, pattern):
            self.filters.append((f"{column}~", pattern))
            return self

        def execute(self):
            if self.action == "update":
                state.updates.append((self.table, self.payload, self.filters))
            elif self.action == "delete":
                state.deletes.append((self.table, self.filters))
            elif self.table == INGESTION_CHANGES:
                return SimpleNamespace(data=state.rows)
            elif ("source_image_url~", "pending:%") in self.filters:
                return SimpleNamespace(
                    data=[{"id": record_id} for record_id in state.pending.get(self.table, [])]
                )
            else:
                return SimpleNamespace(data=[{"slug": "uwaterloo"}])
            return SimpleNamespace(data=[])

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(table=Query))
    monkeypatch.setattr(
        module.event_feed_revalidation_service,
        "revalidate_schools",
        lambda schools, *, resources: state.revalidated.append((list(schools), resources)),
    )
    return state


def test_drain_does_nothing_without_changes(db):
    module.drain()
    assert db.revalidated == [] and db.updates == [] and db.deletes == []


def test_drain_refreshes_feeds_and_clears_rows(db):
    db.rows = [
        {"kind": "event", "record_id": 5, "school_id": 7},
        {"kind": "position", "record_id": 9, "school_id": 7},
    ]
    module.drain()

    assert db.updates == []
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
    assert event_payload["source_posted_at"] == posted.isoformat()
    assert len(position_payload["description"]) == module.MAX_POSITION_DESCRIPTION_LENGTH


def test_stamp_new_rows_skips_directory_pages_without_text(db):
    module.stamp_new_rows(
        "https://wusa.ca/event/jam/",
        caption="",
        posted_at=None,
        since=datetime(2026, 10, 10, tzinfo=timezone.utc),
    )
    assert db.updates == []


def test_drain_leaves_another_agents_rows_until_their_posters_are_stored(db):
    db.rows = [
        {"kind": "event", "record_id": 5, "school_id": 7},
        {"kind": "event", "record_id": 6, "school_id": 7},
    ]
    db.pending = {EVENTS: [6]}
    module.drain()
    # Only event 5 settles; event 6 would otherwise reach feeds with a placeholder image.
    assert db.deletes == [(INGESTION_CHANGES, [("kind", "event"), ("record_id", [5])])]

    db.deletes.clear()
    module.drain(include_pending_posters=True)
    assert db.deletes == [(INGESTION_CHANGES, [("kind", "event"), ("record_id", [5, 6])])]
