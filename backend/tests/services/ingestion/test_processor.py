import fcntl
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.ingestion import processor as module
from services.ingestion.queue import IngestionQueue, QueueItem


@pytest.fixture
def queue(tmp_path):
    return IngestionQueue(tmp_path / "ingestion")


def _item(url: str, **kwargs) -> QueueItem:
    return QueueItem(school="upenn", post={"url": url, "caption": url}, **kwargs)


def test_process_queue_reports_busy_when_another_run_holds_the_lock(queue, monkeypatch):
    process = Mock()
    monkeypatch.setattr(module, "process_post", process)
    queue.enqueue(_item("https://example.edu/events/1"))
    queue.state_directory.mkdir(parents=True, exist_ok=True)

    with (queue.state_directory / "process.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert module.process_queue(queue) == {"processed": 0, "failed": 0, "busy": 1}

    process.assert_not_called()
    assert queue.counts()["queued"] == 1


def test_process_queue_completes_successes_and_releases_failures(queue, monkeypatch, caplog):
    queue.enqueue(_item("https://example.edu/events/ok"))
    queue.enqueue(_item("https://example.edu/events/broken"))
    processed = []

    def process_post(post, *, school, publisher_ig):
        processed.append((post["url"], school, publisher_ig))
        if post["url"].endswith("broken"):
            raise RuntimeError("extraction failed")

    monkeypatch.setattr(module, "process_post", process_post)

    assert module.process_queue(queue) == {"processed": 1, "failed": 1}
    assert processed == [
        ("https://example.edu/events/ok", "upenn", None),
        ("https://example.edu/events/broken", "upenn", None),
    ]
    # The failure stays queued (and leased) for a later run; the success is remembered.
    assert queue.counts() == {"queued": 1, "checked": 1}
    assert queue.enqueue(_item("https://example.edu/events/ok")) is False
    assert "Ingestion item failed (attempt 1)" in caplog.text


def test_process_queue_looks_up_publishers_once_and_only_for_directory_items(queue, monkeypatch):
    queue.enqueue(_item("https://www.instagram.com/p/POST/"))
    queue.enqueue(_item("https://example.edu/events/1", directory_source_id=4))
    queue.enqueue(_item("https://example.edu/events/2", directory_source_id=5))
    queue.enqueue(_item("https://example.edu/events/3", directory_source_id=99))
    list_sources = Mock(
        return_value=[
            SimpleNamespace(id=4, default_club_ig="pennclubs"),
            SimpleNamespace(id=5, default_club_ig=None),
        ]
    )
    monkeypatch.setattr(module, "list_sources", list_sources)
    publishers = {}
    monkeypatch.setattr(
        module,
        "process_post",
        lambda post, *, school, publisher_ig: publishers.update({post["url"]: publisher_ig}),
    )

    assert module.process_queue(queue) == {"processed": 4, "failed": 0}
    list_sources.assert_called_once_with()
    assert publishers == {
        "https://www.instagram.com/p/POST/": None,
        "https://example.edu/events/1": "pennclubs",
        "https://example.edu/events/2": None,
        "https://example.edu/events/3": None,
    }


def test_instagram_only_queue_never_reads_directory_sources(queue, monkeypatch):
    queue.enqueue(_item("https://www.instagram.com/p/POST/"))
    list_sources = Mock()
    monkeypatch.setattr(module, "list_sources", list_sources)
    monkeypatch.setattr(module, "process_post", lambda *_args, **_kwargs: None)

    assert module.process_queue(queue) == {"processed": 1, "failed": 0}
    list_sources.assert_not_called()


def test_process_queue_stops_at_the_time_budget_and_prunes_first(queue, monkeypatch):
    queue.enqueue(_item("https://example.edu/events/1"))
    prune = Mock(return_value=0)
    monkeypatch.setattr(queue, "prune", prune)
    monkeypatch.setattr(
        module, "time", SimpleNamespace(monotonic=Mock(side_effect=[0.0, float("inf")]))
    )
    process = Mock()
    monkeypatch.setattr(module, "process_post", process)

    assert module.process_queue(queue) == {"processed": 0, "failed": 0}
    prune.assert_called_once_with()
    process.assert_not_called()
    assert queue.counts()["queued"] == 1
