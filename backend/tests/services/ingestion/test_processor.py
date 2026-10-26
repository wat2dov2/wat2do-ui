import fcntl
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.ingestion import processor as module
from services.ingestion.items import Item


class FakeQueue:
    """The Supabase ingestion queue, in memory: one row per URL, claimed by stage."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.lock = threading.Lock()

    def add(
        self,
        url,
        *,
        status="ready",
        post=None,
        source="instagram",
        directory_source_id=None,
        carousel_requested=False,
    ):
        self.rows[url] = {
            "carousel_requested": carousel_requested,
            "status": status,
            "post": post if post is not None or status == "fetch" else {"url": url},
            "source": source,
            "directory_source_id": directory_source_id,
            "attempts": 0,
            "waiting": False,
        }

    def claim(self, stage):
        with self.lock:
            for url, row in self.rows.items():
                if row["status"] == stage and not row["waiting"]:
                    row["status"] = "working" if stage == "ready" else "fetch"
                    row["waiting"] = True
                    row["attempts"] += 1
                    return Item(
                        source_url=url,
                        school="upenn",
                        source=row["source"],
                        post=row["post"],
                        directory_source_id=row["directory_source_id"],
                        attempts=row["attempts"],
                        carousel_requested=row["carousel_requested"],
                    )
        return None

    def mark_fetched(self, item, post):
        self.rows[item.source_url].update(status="ready", post=post, attempts=0, waiting=False)

    def mark(self, item, status):
        self.rows[item.source_url].update(status=status, waiting=False)

    def release(self, item, stage, *, delay_seconds=None):
        # Released rows wait for their retry time, which never passes within a test.
        self.rows[item.source_url].update(status=stage, waiting=True)

    def statuses(self):
        return {url: row["status"] for url, row in self.rows.items()}


@pytest.fixture
def queue(monkeypatch, tmp_path):
    fake = FakeQueue()
    monkeypatch.setattr(module, "items", fake)
    monkeypatch.setattr(module, "state_directory", lambda: tmp_path)
    monkeypatch.setattr(module.changes, "drain", lambda **kwargs: None)
    monkeypatch.setattr(module, "remove_leftovers", lambda _prefix: None)
    monkeypatch.setattr(module, "list_sources", lambda: [])
    monkeypatch.setattr(
        module, "listen_for_changes", lambda _table, _wake, stopping: stopping.wait()
    )
    monkeypatch.setattr(
        module, "fetch_post", lambda url: pytest.fail("Fetched without a fetch row")
    )
    return fake


def test_process_queue_reports_busy_when_another_run_holds_the_lock(queue, monkeypatch, tmp_path):
    queue.add("https://example.edu/events/1")
    monkeypatch.setattr(module.agent, "ingest", Mock())

    with (tmp_path / "process.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert module.process_queue(wait_for_work=False) == {"busy": 1}

    module.agent.ingest.assert_not_called()


def test_rows_end_done_not_event_or_retried(queue, monkeypatch, caplog):
    queue.add("https://example.edu/events/listed")
    queue.add("https://example.edu/events/meme")
    queue.add("https://example.edu/events/broken", post={"url": "x", "caption": "Secret text"})

    def ingest(post, *, school, publisher_ig, **_):
        if post["url"] == "x":
            raise RuntimeError("agent failed")
        return post["url"].endswith("listed")

    monkeypatch.setattr(module.agent, "ingest", ingest)

    assert module.process_queue(wait_for_work=False) == {"processed": 2, "failed": 1}
    assert queue.statuses() == {
        "https://example.edu/events/listed": "done",
        "https://example.edu/events/meme": "not_event",
        "https://example.edu/events/broken": "ready",
    }
    assert "Ingestion item failed (attempt 1)" in caplog.text
    assert "Secret text" not in caplog.text


def test_fetched_posts_become_ready_and_are_processed_in_one_run(queue, monkeypatch):
    queue.add("https://www.instagram.com/p/NEW/", status="fetch")
    queue.add("https://www.instagram.com/p/DELETED/", status="fetch")
    fetched = {"https://www.instagram.com/p/NEW/": {"url": "new", "ownerUsername": "club"}}
    monkeypatch.setattr(module, "fetch_post", fetched.get)
    seen = []
    monkeypatch.setattr(module.agent, "ingest", lambda post, **_: seen.append(post["url"]) or True)

    stats = module.process_queue(wait_for_work=False)

    assert stats == {"fetched": 1, "processed": 1}
    assert seen == ["new"]
    assert queue.statuses() == {
        "https://www.instagram.com/p/NEW/": "done",
        # An empty page is looked at once more before it is given up as gone.
        "https://www.instagram.com/p/DELETED/": "fetch",
    }


def test_an_empty_post_twice_is_gone(queue, monkeypatch):
    queue.add("https://www.instagram.com/p/DELETED/", status="fetch")
    queue.rows["https://www.instagram.com/p/DELETED/"]["attempts"] = 1
    monkeypatch.setattr(module, "fetch_post", lambda _url: None)

    assert module.process_queue(wait_for_work=False) == {"gone": 1}
    assert queue.statuses() == {"https://www.instagram.com/p/DELETED/": "gone"}


def test_a_login_wall_pauses_fetching_without_giving_up(queue, monkeypatch):
    queue.add("https://www.instagram.com/p/A/", status="fetch")
    queue.add("https://www.instagram.com/p/B/", status="fetch")
    calls = []

    def blocked(url):
        calls.append(url)
        raise module.FetchBlocked("Instagram asked for a login")

    monkeypatch.setattr(module, "fetch_post", blocked)
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"fetch_lanes": 1}))

    stats = module.process_queue(wait_for_work=False)

    # One refusal pauses every lane instead of burning through the queue.
    assert stats == {"fetch_blocked": 1}
    assert calls == ["https://www.instagram.com/p/A/"]
    assert set(queue.statuses().values()) == {"fetch"}


def test_publishers_are_looked_up_only_for_directory_rows(queue, monkeypatch):
    queue.add("https://www.instagram.com/p/POST/")
    queue.add("https://example.edu/events/1", source="directory", directory_source_id=4)
    queue.add("https://example.edu/events/2", source="directory", directory_source_id=99)
    list_sources = Mock(return_value=[SimpleNamespace(id=4, default_club_ig="pennclubs")])
    monkeypatch.setattr(module, "list_sources", list_sources)
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_agents": 1}))
    publishers = {}
    monkeypatch.setattr(
        module.agent,
        "ingest",
        lambda post, *, school, publisher_ig, **_: publishers.update({post["url"]: publisher_ig}),
    )

    module.process_queue(wait_for_work=False)

    # Loaded on the first directory row, and again for an unknown source.
    assert list_sources.call_count == 2
    assert publishers == {
        "https://www.instagram.com/p/POST/": None,
        "https://example.edu/events/1": "pennclubs",
        "https://example.edu/events/2": None,
    }


def test_leftovers_are_cleared_and_changes_settled_before_any_work(queue, monkeypatch):
    order = []
    monkeypatch.setattr(module, "remove_leftovers", lambda _prefix: order.append("leftovers"))
    monkeypatch.setattr(module.changes, "drain", lambda **kwargs: order.append(("drain", kwargs)))
    queue.add("https://example.edu/events/1")
    monkeypatch.setattr(module.agent, "ingest", lambda post, **_: order.append("ingest"))

    module.process_queue(wait_for_work=False)

    # Startup also settles rows a killed agent left with placeholder posters.
    assert order == ["leftovers", ("drain", {"include_pending_posters": True}), "ingest"]


def test_posts_from_one_club_never_run_at_the_same_time(queue, monkeypatch):
    for index in range(4):
        url = f"https://www.instagram.com/p/P{index}/"
        queue.add(url, post={"url": url, "ownerUsername": "@UWImprov"})
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
        return True

    monkeypatch.setattr(module.agent, "ingest", ingest)

    assert module.process_queue(wait_for_work=False) == {"processed": 4}
    assert max(overlaps) == 1


def test_a_running_processor_wakes_when_the_queue_changes(queue, monkeypatch):
    wakes = []
    monkeypatch.setattr(
        module,
        "listen_for_changes",
        lambda _table, wake, stopping: wakes.append(wake) or stopping.wait(),
    )
    handled = threading.Event()
    monkeypatch.setattr(module.agent, "ingest", lambda post, **_: handled.set() or True)
    stopping = threading.Event()
    runner = threading.Thread(target=module.process_queue, kwargs={"stopping": stopping})
    runner.start()
    try:
        for _ in range(200):
            if wakes:
                break
            time.sleep(0.01)
        time.sleep(0.05)
        queue.add("https://example.edu/events/new")
        wakes[0]()
        # Woken by the Realtime push, long before the retry fallback.
        assert handled.wait(5)
    finally:
        stopping.set()
        runner.join(5)
    assert not runner.is_alive()
    assert queue.statuses() == {"https://example.edu/events/new": "done"}


def test_the_agent_hears_each_rows_kind_and_carousel_request(queue, monkeypatch):
    queue.add("https://www.instagram.com/p/POST/", carousel_requested=True)
    queue.add("https://wat2do.io/dm/upenn/abc", source="dm")
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_agents": 1}))
    seen = {}
    monkeypatch.setattr(
        module.agent,
        "ingest",
        lambda post, *, source, carousel_requested, **_: seen.update(
            {post["url"]: (source, carousel_requested)}
        ),
    )
    module.process_queue(wait_for_work=False)
    assert seen == {
        "https://www.instagram.com/p/POST/": ("instagram", True),
        "https://wat2do.io/dm/upenn/abc": ("dm", False),
    }
