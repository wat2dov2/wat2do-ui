"""Turn the Supabase ingestion queue into events and positions, whatever the source.

The processor stays running. ``fetch_lanes`` threads fill in notified Instagram
posts with the logged-out fetcher; ``parallel_agents`` slots each run one Haiku
agent on the next ready row. Supabase Realtime wakes both as soon as a row is
added or changes; with nothing waiting they sleep.
"""

from __future__ import annotations

import fcntl
import logging
import os
import threading
import time
from collections import Counter, defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

from core.tables import INGESTION_ITEMS
from services.claude_code import remove_leftovers
from services.ingestion import agent, changes, items
from services.ingestion.directory import list_sources
from services.ingestion.instagram_fetch import FetchBlocked, fetch_post
from services.ingestion.items import CONTROL, Item
from services.ingestion.realtime_listener import listen_for_changes

log = logging.getLogger(__name__)


def state_directory() -> Path:
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "wat2do/ingestion"


class _Wake:
    """Counts wake-ups so a thread never sleeps through one that arrived meanwhile."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self.generation = 0

    def notify(self) -> None:
        with self._condition:
            self.generation += 1
            self._condition.notify_all()

    def wait(self, seen: int, timeout: float) -> None:
        with self._condition:
            self._condition.wait_for(lambda: self.generation != seen, timeout)


class _Processor:
    def __init__(self, stopping: threading.Event) -> None:
        self.stopping = stopping
        self.wake = _Wake()
        self.stats: Counter[str] = Counter()
        self._stats_lock = threading.Lock()
        self._club_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        self._publishers: dict[int, str | None] = {}
        self._fetch_paused_until = 0.0

    def count(self, outcome: str) -> None:
        with self._stats_lock:
            self.stats[outcome] += 1

    def work(self, step: Callable[[], bool], *, wait_for_work: bool) -> None:
        """Repeat ``step`` until it finds nothing; then sleep until woken, or stop."""
        while not self.stopping.is_set():
            seen = self.wake.generation
            try:
                if step():
                    continue
            except Exception as exc:
                # Supabase or network trouble: wait, then carry on with the next row.
                log.warning("Ingestion queue unavailable (%s)", type(exc).__name__)
                self.stopping.wait(CONTROL.realtime_reconnect_seconds)
                continue
            if not wait_for_work:
                return
            # Released rows become claimable again once their retry time passes.
            self.wake.wait(seen, CONTROL.retry_backoff_seconds)

    def fetch_next(self) -> bool:
        pause = self._fetch_paused_until - time.monotonic()
        if pause > 0:
            self.wake.wait(self.wake.generation, pause)
            return False
        item = items.claim("fetch")
        if item is None:
            return False
        try:
            post = fetch_post(item.source_url)
        except FetchBlocked as exc:
            log.warning("Instagram refused logged-out fetches (%s); pausing", exc)
            self._fetch_paused_until = time.monotonic() + CONTROL.fetch_block_pause_seconds
            items.release(item, "fetch", delay_seconds=CONTROL.fetch_block_pause_seconds)
            self.count("fetch_blocked")
            return False
        except ValueError:
            items.mark(item, "gone")
            self.count("gone")
            return True
        if post is None:
            # An empty page is usually a deleted post; look once more before giving up.
            if item.attempts >= 2:
                items.mark(item, "gone")
                self.count("gone")
            else:
                items.release(item, "fetch")
            return True
        items.mark_fetched(item, post)
        self.count("fetched")
        self.wake.notify()
        return True

    def process_next(self) -> bool:
        item = items.claim("ready")
        if item is None:
            return False
        # Two posts from one club never race to edit the same listings.
        with self._club_locks[_club_key(item)]:
            try:
                changed = agent.ingest(
                    item.post or {}, school=item.school, publisher_ig=self._publisher(item)
                )
            except Exception:
                # Source content stays out of logs; the row is retried, then given up.
                log.exception("Ingestion item failed (attempt %d)", item.attempts)
                items.release(item, "ready")
                self.count("failed")
                return True
        items.mark(item, "done" if changed else "not_event")
        self.count("processed")
        return True

    def _publisher(self, item: Item) -> str | None:
        if item.directory_source_id is None:
            return None
        if item.directory_source_id not in self._publishers:
            self._publishers.update(
                {source.id: source.default_club_ig for source in list_sources()}
            )
        return self._publishers.get(item.directory_source_id)


def process_queue(
    *, wait_for_work: bool = True, stopping: threading.Event | None = None
) -> dict[str, int]:
    """Fetch and process queued rows; keep waiting for more unless ``wait_for_work`` is off."""
    stopping = stopping or threading.Event()
    directory = state_directory()
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "process.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"busy": 1}
        # Nothing else runs agents now, so whatever a killed run left behind can go.
        remove_leftovers(agent.WORKDIR_PREFIX)
        # An interrupted run may have left changes whose side effects never ran,
        # including rows whose agent was killed before storing their posters.
        changes.drain(include_pending_posters=True)
        processor = _Processor(stopping)
        if wait_for_work:
            threading.Thread(
                target=listen_for_changes,
                args=(INGESTION_ITEMS, processor.wake.notify, stopping),
                name="ingestion-queue-listener",
                daemon=True,
            ).start()
            threading.Thread(
                target=_wake_on_stop, args=(processor,), name="ingestion-shutdown", daemon=True
            ).start()
        stages = [
            (processor.fetch_next, CONTROL.fetch_lanes),
            (processor.process_next, CONTROL.parallel_agents),
        ]
        try:
            if wait_for_work:
                _run_together(processor, stages, wait_for_work=True)
            else:
                # A one-off run fetches everything first so agents see every post.
                for stage in stages:
                    _run_together(processor, [stage], wait_for_work=False)
        finally:
            stopping.set()
            processor.wake.notify()
    return dict(processor.stats)


def _wake_on_stop(processor: _Processor) -> None:
    """Sleeping workers notice shutdown at once."""
    processor.stopping.wait()
    processor.wake.notify()


def _run_together(
    processor: _Processor, stages: list[tuple[Callable[[], bool], int]], *, wait_for_work: bool
) -> None:
    workers = [step for step, count in stages for _ in range(count)]
    with ThreadPoolExecutor(len(workers)) as pool:
        futures = [
            pool.submit(processor.work, step, wait_for_work=wait_for_work) for step in workers
        ]
        for future in futures:
            future.result()


def _club_key(item: Item) -> str:
    if item.directory_source_id is not None:
        return f"directory:{item.directory_source_id}"
    owner = str((item.post or {}).get("ownerUsername") or "").strip().lstrip("@").lower()
    return f"instagram:{owner}" if owner else f"url:{urlsplit(item.source_url).path}"
