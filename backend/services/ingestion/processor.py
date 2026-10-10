"""Drain the local ingestion queue into events and positions, whatever the source."""

from __future__ import annotations

import fcntl
import logging
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

from services.ingestion import changes
from services.ingestion.agent import ingest
from services.ingestion.directory import list_sources
from services.ingestion.queue import CONTROL, IngestionQueue, QueueItem

log = logging.getLogger(__name__)


def process_queue(queue: IngestionQueue) -> dict[str, int]:
    """Run parallel Haiku agents until every queued capture is handled."""
    queue.state_directory.mkdir(parents=True, exist_ok=True)
    with (queue.state_directory / "process.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"processed": 0, "failed": 0, "busy": 1}
        queue.prune()
        # An interrupted run may have left changes whose side effects never ran.
        changes.drain()
        publishers = {source.id: source.default_club_ig for source in list_sources()}
        stats: Counter[str] = Counter(processed=0, failed=0)
        stats_lock = threading.Lock()
        club_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)

        def work() -> None:
            while (item := queue.claim()) is not None:
                # Two posts from one club never race to edit the same listings.
                with club_locks[_club_key(item)]:
                    outcome = _process(queue, item, publishers)
                with stats_lock:
                    stats[outcome] += 1

        with ThreadPoolExecutor(CONTROL.parallel_agents) as pool:
            for future in [pool.submit(work) for _ in range(CONTROL.parallel_agents)]:
                future.result()
    return dict(stats)


def _process(queue: IngestionQueue, item: QueueItem, publishers: dict[int, str | None]) -> str:
    publisher_ig = (
        publishers.get(item.directory_source_id) if item.directory_source_id is not None else None
    )
    try:
        ingest(item.post, school=item.school, publisher_ig=publisher_ig)
    except Exception:
        # Source content stays out of logs; the item is retried, then dropped.
        log.exception("Ingestion item failed (attempt %d)", item.attempts)
        queue.release(item)
        return "failed"
    queue.complete(item)
    return "processed"


def _club_key(item: QueueItem) -> str:
    if item.directory_source_id is not None:
        return f"directory:{item.directory_source_id}"
    owner = str(item.post.get("ownerUsername") or "").strip().lstrip("@").lower()
    return f"instagram:{owner}" if owner else f"url:{urlsplit(item.source_url).path}"
