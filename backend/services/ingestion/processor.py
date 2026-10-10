"""Turn the local ingestion queue into events and positions, whatever the source.

The processor stays running with ``parallel_agents`` slots. Each slot takes the
next queued capture, runs one Haiku agent on it, and takes the next; with
nothing queued it sleeps until a producer adds an item and wakes it.
"""

from __future__ import annotations

import contextlib
import fcntl
import logging
import socket
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

from services.ingestion import changes
from services.ingestion.agent import ingest
from services.ingestion.directory import list_sources
from services.ingestion.queue import CONTROL, IngestionQueue, QueueItem

log = logging.getLogger(__name__)


class _Wake:
    """Counts wake-ups so a slot never sleeps through one that arrived meanwhile."""

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


def process_queue(
    queue: IngestionQueue,
    *,
    wait_for_work: bool = True,
    stopping: threading.Event | None = None,
) -> dict[str, int]:
    """Run agents on queued captures; keep waiting for more unless ``wait_for_work`` is off."""
    stopping = stopping or threading.Event()
    queue.state_directory.mkdir(parents=True, exist_ok=True)
    with (queue.state_directory / "process.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"processed": 0, "failed": 0, "busy": 1}
        queue.prune()
        # An interrupted run may have left changes whose side effects never ran.
        changes.drain()
        wake = _Wake()
        stats: Counter[str] = Counter(processed=0, failed=0)
        stats_lock = threading.Lock()
        club_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        publishers: dict[int, str | None] = {}

        def work() -> None:
            while not stopping.is_set():
                seen = wake.generation
                item = queue.claim()
                if item is None:
                    if not wait_for_work:
                        return
                    # A released item becomes claimable again once its lease ends.
                    wake.wait(seen, CONTROL.claim_lease_seconds)
                    continue
                # Two posts from one club never race to edit the same listings.
                with club_locks[_club_key(item)]:
                    outcome = _process(queue, item, _publisher(item, publishers))
                with stats_lock:
                    stats[outcome] += 1

        listener = (
            threading.Thread(
                target=_listen_for_wakes,
                args=(queue.wake_path, wake, stopping),
                name="ingestion-wake",
                daemon=True,
            )
            if wait_for_work
            else None
        )
        if listener:
            listener.start()
        try:
            with ThreadPoolExecutor(CONTROL.parallel_agents) as pool:
                for future in [pool.submit(work) for _ in range(CONTROL.parallel_agents)]:
                    future.result()
        finally:
            stopping.set()
            wake.notify()
    return dict(stats)


def _process(queue: IngestionQueue, item: QueueItem, publisher_ig: str | None) -> str:
    try:
        ingest(item.post, school=item.school, publisher_ig=publisher_ig)
    except Exception:
        # Source content stays out of logs; the item is retried, then dropped.
        log.exception("Ingestion item failed (attempt %d)", item.attempts)
        queue.release(item)
        return "failed"
    queue.complete(item)
    return "processed"


def _publisher(item: QueueItem, publishers: dict[int, str | None]) -> str | None:
    if item.directory_source_id is None:
        return None
    if item.directory_source_id not in publishers:
        publishers.update({source.id: source.default_club_ig for source in list_sources()})
    return publishers.get(item.directory_source_id)


def _club_key(item: QueueItem) -> str:
    if item.directory_source_id is not None:
        return f"directory:{item.directory_source_id}"
    owner = str(item.post.get("ownerUsername") or "").strip().lstrip("@").lower()
    return f"instagram:{owner}" if owner else f"url:{urlsplit(item.source_url).path}"


def _listen_for_wakes(path: Path, wake: _Wake, stopping: threading.Event) -> None:
    """Wake idle slots whenever a producer signals that it queued something."""
    with contextlib.suppress(FileNotFoundError):
        path.unlink()
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as listener:
        listener.bind(str(path))
        # The timeout only lets shutdown be noticed; work never waits on it.
        listener.settimeout(1)
        try:
            while not stopping.is_set():
                try:
                    listener.recv(16)
                except TimeoutError:
                    continue
                wake.notify()
        finally:
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
            # Sleeping slots notice shutdown too.
            wake.notify()
