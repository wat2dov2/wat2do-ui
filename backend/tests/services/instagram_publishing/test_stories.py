from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services.instagram_emulator.device import EmulatorError
from services.instagram_publishing import stories

NOW = datetime(2026, 11, 17, 15, tzinfo=timezone.utc)


class _Table:
    """One data API table: every call chains, `execute` answers with its rows."""

    def __init__(self, rows, calls):
        self.rows = rows
        self.calls = calls

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return chain

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _Device:
    def __init__(self, free=5000, refused=()):
        self.free = free
        self.refused = set(refused)
        self.resets = []

    def free_data_megabytes(self):
        return self.free

    def reset_app(self, user):
        self.resets.append(user)


@pytest.fixture
def database(monkeypatch):
    tables = {
        "instagram_publish_batches": [
            {"id": "batch-1", "published_at": NOW.isoformat(), "school_record": {"slug": "uwo"}}
        ],
        "instagram_publish_items": [
            {"position": 1, "event": {"source_url": "https://www.instagram.com/p/AAA/?igsh=x"}},
            {"position": 2, "event": {"source_url": "https://uwo.ca/events/board-games"}},
            {"position": 3, "event": {"source_url": "https://instagram.com/reel/BBB"}},
            {"position": 4, "event": {"source_url": "https://www.instagram.com/p/AAA/"}},
            {"position": 5, "event": {"source_url": "https://www.instagram.com/p/CCC/"}},
        ],
    }
    calls = []
    monkeypatch.setattr(
        stories, "get_sb", lambda: SimpleNamespace(table=lambda name: _Table(tables[name], calls))
    )
    return SimpleNamespace(tables=tables, calls=calls)


@pytest.fixture
def shared(monkeypatch):
    posts = []

    def share(device, school, url):
        if url in device.refused:
            raise EmulatorError("Instagram never showed Add to story")
        posts.append((school, url))

    monkeypatch.setattr(stories, "share_to_story", share)
    return posts


def _updates(calls):
    return [args[0] for name, args, _ in calls if name == "update"]


def test_each_event_post_goes_to_the_story_once_in_slide_order(database, shared):
    stories.share_due(_Device(), "uwo", NOW)
    assert shared == [
        ("uwo", "https://www.instagram.com/p/AAA/"),
        ("uwo", "https://www.instagram.com/reel/BBB/"),
        ("uwo", "https://www.instagram.com/p/CCC/"),
    ]
    # Marked before the first share, so a worker stopped halfway never shares again.
    assert _updates(database.calls) == [
        {"story_status": "failed", "story_error": "Stopped while sharing"},
        {"story_status": "posted", "story_error": None},
    ]
    oldest = (NOW - timedelta(hours=stories._CONTROL.story_max_age_hours)).isoformat()
    assert ("gte", ("published_at", oldest), {}) in database.calls
    assert ("eq", ("story_status", "pending"), {}) in database.calls


def test_a_post_that_cannot_be_shared_is_left_out_and_the_rest_go_on(database, shared):
    device = _Device(refused={"https://www.instagram.com/reel/BBB/"})
    stories.share_due(device, "uwo", NOW)
    assert [url for _, url in shared] == [
        "https://www.instagram.com/p/AAA/",
        "https://www.instagram.com/p/CCC/",
    ]
    assert device.resets == [stories.EMULATOR.android_user_by_school["uwo"]]
    assert _updates(database.calls)[-1] == {
        "story_status": "posted",
        "story_error": "2 of 3 posts shared",
    }


def test_nothing_shared_is_a_failed_story(database, shared):
    database.tables["instagram_publish_items"] = [
        {"position": 1, "event": {"source_url": "https://www.instagram.com/p/AAA/"}}
    ]
    stories.share_due(_Device(refused={"https://www.instagram.com/p/AAA/"}), "uwo", NOW)
    assert _updates(database.calls)[-1] == {
        "story_status": "failed",
        "story_error": "0 of 1 posts shared",
    }


def test_another_schools_carousel_and_low_storage_wait(database, shared):
    stories.share_due(_Device(), "ubc", NOW)
    stories.share_due(_Device(free=10), "uwo", NOW)
    assert shared == []
    assert _updates(database.calls) == []


def test_schools_due_lists_each_school_once(database):
    database.tables["instagram_publish_batches"].append(
        {"id": "batch-2", "published_at": NOW.isoformat(), "school_record": {"slug": "uwo"}}
    )
    assert stories.schools_due(NOW) == ["uwo"]
