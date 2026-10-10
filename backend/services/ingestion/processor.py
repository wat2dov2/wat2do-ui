"""Drain the local ingestion queue into events and positions, whatever the source."""

from __future__ import annotations

import fcntl
import logging
import time

from services.ingestion.directory import list_sources
from services.ingestion.queue import CONTROL, IngestionQueue
from services.scraper.pipeline import process_post

log = logging.getLogger(__name__)


def process_queue(queue: IngestionQueue) -> dict[str, int]:
    """Process queued captures until the queue is empty or the time budget ends."""
    stats = {"processed": 0, "failed": 0}
    queue.state_directory.mkdir(parents=True, exist_ok=True)
    with (queue.state_directory / "process.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**stats, "busy": 1}
        queue.prune()
        deadline = time.monotonic() + CONTROL.process_time_budget_seconds
        publishers: dict[int, str | None] | None = None
        while time.monotonic() < deadline and (item := queue.claim()) is not None:
            try:
                publisher_ig = None
                if item.directory_source_id is not None:
                    if publishers is None:
                        publishers = {s.id: s.default_club_ig for s in list_sources()}
                    publisher_ig = publishers.get(item.directory_source_id)
                process_post(item.post, school=item.school, publisher_ig=publisher_ig)
            except Exception:
                # Source content stays out of logs; the item is retried, then dropped.
                log.exception("Ingestion item failed (attempt %d)", item.attempts)
                queue.release(item)
                stats["failed"] += 1
            else:
                queue.complete(item)
                stats["processed"] += 1
    return stats
