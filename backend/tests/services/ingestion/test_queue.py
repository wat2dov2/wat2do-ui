import sqlite3
from types import SimpleNamespace

import pytest

from services.ingestion import queue as module
from services.ingestion.queue import IngestionQueue, QueueItem

POST_URL = "https://www.instagram.com/p/ABC123/"


@pytest.fixture
def clock(monkeypatch):
    state = SimpleNamespace(now=1_000_000.0)
    monkeypatch.setattr(module, "time", SimpleNamespace(time=lambda: state.now))
    return state


@pytest.fixture
def queue(tmp_path, clock):
    return IngestionQueue(tmp_path / "ingestion")


def _item(url: str = POST_URL, caption: str = "Tea night", **kwargs) -> QueueItem:
    return QueueItem(
        school="uwaterloo",
        post={"url": url, "caption": caption, "images": ["https://cdn/signed.jpg?sig=1"]},
        **kwargs,
    )


def test_default_state_directory_follows_xdg_state_home(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    assert module.default_state_directory() == tmp_path / "wat2do/ingestion"


def test_content_hash_ignores_rotating_media_urls():
    signed = _item()
    resigned = QueueItem(
        school="uwaterloo",
        post={**signed.post, "images": ["https://cdn/signed.jpg?sig=2"]},
    )
    assert signed.content_hash == resigned.content_hash
    assert _item(caption="Tea night moved").content_hash != signed.content_hash


def test_enqueue_dedupes_by_source_url_and_round_trips_the_capture(queue):
    item = _item(directory_source_id=4)

    assert queue.enqueue(item) is True
    assert queue.enqueue(_item(caption="Different text", directory_source_id=4)) is False

    with sqlite3.connect(queue.database_path) as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert queue.counts() == {"queued": 1, "checked": 0}
    claimed = queue.claim()
    assert claimed == item
    assert claimed.attempts == 1


def test_completed_unchanged_content_is_not_requeued(queue):
    item = _item()
    queue.enqueue(item)
    queue.complete(queue.claim())

    assert queue.counts() == {"queued": 0, "checked": 1}
    assert queue.enqueue(_item()) is False
    assert queue.counts() == {"queued": 0, "checked": 1}


def test_changed_content_is_requeued_after_completion(queue):
    queue.enqueue(_item())
    queue.complete(queue.claim())

    assert queue.enqueue(_item(caption="Tea night moved to SLC")) is True
    claimed = queue.claim()
    assert claimed.post["caption"] == "Tea night moved to SLC"
    assert claimed.attempts == 1


def test_claim_leases_the_oldest_item_until_its_lease_expires(queue, clock):
    queue.enqueue(_item("https://example.edu/events/2"))
    clock.now += 1
    queue.enqueue(_item("https://example.edu/events/1"))

    first = queue.claim()
    second = queue.claim()

    assert first.source_url == "https://example.edu/events/2"
    assert second.source_url == "https://example.edu/events/1"
    assert queue.claim() is None

    clock.now += module.CONTROL.claim_lease_seconds - 1
    assert queue.claim() is None
    clock.now += 2
    reclaimed = queue.claim()
    assert reclaimed.source_url == first.source_url
    assert reclaimed.attempts == 2


def test_released_item_waits_for_its_lease_then_drops_after_max_attempts(queue, clock):
    queue.enqueue(_item())

    for attempt in range(1, module.CONTROL.max_attempts + 1):
        item = queue.claim()
        assert item.attempts == attempt
        queue.release(item)
        assert queue.claim() is None
        clock.now += module.CONTROL.claim_lease_seconds + 1

    assert queue.claim() is None
    assert queue.counts() == {"queued": 0, "checked": 1}
    assert queue.enqueue(_item()) is False


def test_prune_forgets_checked_content_after_the_ttl(queue, clock):
    queue.enqueue(_item("https://example.edu/events/old"))
    queue.complete(queue.claim())
    clock.now += 1
    queue.enqueue(_item("https://example.edu/events/new"))
    queue.complete(queue.claim())

    clock.now += module.CONTROL.checked_ttl_days * 86400 - 0.5
    assert queue.prune() == 1
    assert queue.counts() == {"queued": 0, "checked": 1}
    assert queue.enqueue(_item("https://example.edu/events/old")) is True
    assert queue.enqueue(_item("https://example.edu/events/new")) is False


def test_repeated_scrapes_of_a_rejected_page_keep_one_checked_row(queue, clock):
    for _ in range(5):
        queue.enqueue(_item(url="https://events.example.edu/listing", caption="All events"))
        item = queue.claim()
        if item is not None:
            queue.complete(item)
        clock.now += 12 * 3600

    with sqlite3.connect(queue.database_path) as db:
        rows = db.execute("SELECT source_url FROM checked").fetchall()
    assert rows == [("https://events.example.edu/listing",)]
    assert queue.counts() == {"queued": 0, "checked": 1}
