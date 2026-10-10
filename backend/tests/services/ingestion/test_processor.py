import fcntl
import shutil
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.ingestion import processor as module
from services.ingestion.queue import IngestionQueue, QueueItem


@pytest.fixture
def queue(tmp_path):
    return IngestionQueue(tmp_path / "ingestion")


@pytest.fixture(autouse=True)
def no_database(monkeypatch):
    drains = []
    monkeypatch.setattr(module.changes, "drain", lambda: drains.append(True))
    monkeypatch.setattr(module, "list_sources", lambda: [])
    return drains


def _item(url: str, **kwargs) -> QueueItem:
    return QueueItem(school="upenn", post={"url": url, "caption": url}, **kwargs)


def test_process_queue_reports_busy_when_another_run_holds_the_lock(queue, monkeypatch):
    process = Mock()
    monkeypatch.setattr(module, "ingest", process)
    queue.enqueue(_item("https://example.edu/events/1"))
    queue.state_directory.mkdir(parents=True, exist_ok=True)

    with (queue.state_directory / "process.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert module.process_queue(queue, wait_for_work=False) == {
            "processed": 0,
            "failed": 0,
            "busy": 1,
        }

    process.assert_not_called()
    assert queue.counts()["queued"] == 1


def test_process_queue_completes_successes_and_releases_failures(queue, monkeypatch, caplog):
    queue.enqueue(_item("https://example.edu/events/ok"))
    queue.enqueue(_item("https://example.edu/events/broken"))
    processed = []

    def ingest(post, *, school, publisher_ig):
        processed.append((post["url"], school, publisher_ig))
        if post["url"].endswith("broken"):
            raise RuntimeError("extraction failed")

    monkeypatch.setattr(module, "ingest", ingest)

    assert module.process_queue(queue, wait_for_work=False) == {"processed": 1, "failed": 1}
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
        "ingest",
        lambda post, *, school, publisher_ig: publishers.update({post["url"]: publisher_ig}),
    )

    assert module.process_queue(queue, wait_for_work=False) == {"processed": 4, "failed": 0}
    # Loaded on the first directory item, and again for an unknown source.
    assert list_sources.call_count == 2
    assert publishers == {
        "https://www.instagram.com/p/POST/": None,
        "https://example.edu/events/1": "pennclubs",
        "https://example.edu/events/2": None,
        "https://example.edu/events/3": None,
    }


def test_process_queue_drains_everything_and_settles_leftovers_first(
    queue, monkeypatch, no_database
):
    for index in range(10):
        queue.enqueue(_item(f"https://example.edu/events/{index}", directory_source_id=index))
    prune = Mock(return_value=0)
    monkeypatch.setattr(queue, "prune", prune)
    seen = []
    monkeypatch.setattr(module, "ingest", lambda post, **_: seen.append(post["url"]))

    assert module.process_queue(queue, wait_for_work=False) == {"processed": 10, "failed": 0}
    prune.assert_called_once_with()
    assert no_database == [True]
    assert sorted(seen) == sorted(f"https://example.edu/events/{i}" for i in range(10))
    assert queue.counts() == {"queued": 0, "checked": 10}


def test_posts_from_one_club_never_run_at_the_same_time(queue, monkeypatch):
    for index in range(4):
        queue.enqueue(
            QueueItem(
                school="uwaterloo",
                post={
                    "url": f"https://www.instagram.com/p/P{index}/",
                    "ownerUsername": "@UWImprov",
                },
            )
        )
    running = []
    overlaps = []
    guard = threading.Lock()

    def ingest(post, **_):
        with guard:
            running.append(post["url"])
            overlaps.append(len(running))
        time.sleep(0.02)
        with guard:
            running.remove(post["url"])

    monkeypatch.setattr(module, "ingest", ingest)

    assert module.process_queue(queue, wait_for_work=False) == {"processed": 4, "failed": 0}
    assert max(overlaps) == 1


def test_agent_failure_keeps_the_capture_queued_without_logging_it(queue, monkeypatch, caplog):
    from services.ingestion import agent

    post = {"url": "https://www.instagram.com/p/FAIL/", "caption": "Secret caption text"}
    queue.enqueue(QueueItem(school="ubc", post=post))
    monkeypatch.setattr(agent, "already_imported", lambda _url: False)
    monkeypatch.setattr(
        agent.school_service, "get_school", lambda slug: SimpleNamespace(slug=slug, id=1)
    )
    monkeypatch.setattr(
        agent, "resolve_club_for_scrape", Mock(return_value=SimpleNamespace(club_id=None))
    )
    monkeypatch.setattr(agent, "_render", lambda *args, **kwargs: "prompt")
    monkeypatch.setattr(agent.changes, "stamp_new_rows", lambda *args, **kwargs: None)
    monkeypatch.setattr(agent.shutil, "which", lambda name: name)
    monkeypatch.setattr(agent, "_agent_environment", lambda: {})
    monkeypatch.setattr(
        agent.subprocess,
        "run",
        lambda args, **kwargs: agent.subprocess.CompletedProcess(args, 1, stdout=""),
    )

    assert module.process_queue(queue, wait_for_work=False) == {"processed": 0, "failed": 1}
    # The capture waits for a later run instead of exhausting its attempts now.
    assert queue.counts() == {"queued": 1, "checked": 0}
    assert queue.claim() is None
    assert "Secret caption text" not in caplog.text


def test_a_running_processor_wakes_as_soon_as_an_item_is_queued(monkeypatch):
    # Unix socket paths must stay short, so this queue lives directly under /tmp.
    directory = Path(tempfile.mkdtemp(prefix="w2d-", dir="/tmp"))
    queue = IngestionQueue(directory)
    handled = threading.Event()
    monkeypatch.setattr(module, "ingest", lambda post, **_: handled.set())
    stopping = threading.Event()
    runner = threading.Thread(
        target=module.process_queue, args=(queue,), kwargs={"stopping": stopping}
    )
    runner.start()
    try:
        for _ in range(100):
            if queue.wake_path.exists():
                break
            time.sleep(0.01)
        assert queue.claim() is None
        queue.enqueue(_item("https://example.edu/events/new"))
        # Woken by the enqueue itself, long before any lease-based fallback.
        assert handled.wait(5)
        stopping.set()
        runner.join(5)
        assert not runner.is_alive()
        assert queue.counts() == {"queued": 0, "checked": 1}
    finally:
        stopping.set()
        shutil.rmtree(directory, ignore_errors=True)


def test_wake_without_a_running_processor_is_harmless(queue):
    queue.wake_processor()
    assert queue.enqueue(_item("https://example.edu/events/1")) is True
