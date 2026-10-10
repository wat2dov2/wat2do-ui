"""Local, source-agnostic queue of captured posts and directory pages.

Producers (the Instagram browser worker and the directory scraper) enqueue one
item per exact post or event URL. The processor claims items, persists any
verified events and positions, and deletes the item. A short-lived ``checked``
record keeps unchanged pages from being re-reviewed; it expires on its own.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from core.controlbox import controlbox

CONTROL = controlbox.ingestion


def default_state_directory() -> Path:
    return Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "wat2do/ingestion"


@dataclass(frozen=True)
class QueueItem:
    """One captured source in the Instagram post shape used by the pipeline.

    ``post`` carries ``url``, ``caption``, ``images``, ``timestamp`` and, for
    Instagram, ``ownerUsername``/``coauthors``. ``directory_source_id`` is set
    only for official directory pages.
    """

    school: str
    post: dict
    directory_source_id: int | None = None
    attempts: int = field(default=0, compare=False)

    @property
    def source_url(self) -> str:
        return self.post["url"]

    @property
    def content_hash(self) -> str:
        # Signed media URLs rotate; the identity of a capture is its URL and text.
        identity = {"url": self.source_url, "caption": self.post.get("caption") or ""}
        return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


class IngestionQueue:
    def __init__(self, state_directory: Path | None = None) -> None:
        self.state_directory = state_directory or default_state_directory()
        self.database_path = self.state_directory / "queue.sqlite3"

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        self.state_directory.mkdir(parents=True, exist_ok=True)
        with closing(
            sqlite3.connect(self.database_path, timeout=CONTROL.storage_busy_timeout_seconds)
        ) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                "CREATE TABLE IF NOT EXISTS items ("
                " source_url TEXT PRIMARY KEY,"
                " school TEXT NOT NULL,"
                " post TEXT NOT NULL,"
                " directory_source_id INTEGER,"
                " content_hash TEXT NOT NULL,"
                " attempts INTEGER NOT NULL DEFAULT 0,"
                " enqueued_at REAL NOT NULL,"
                " leased_until REAL NOT NULL DEFAULT 0)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS checked ("
                " source_url TEXT PRIMARY KEY,"
                " content_hash TEXT NOT NULL,"
                " checked_at REAL NOT NULL)"
            )
            with db:
                yield db

    def enqueue(self, item: QueueItem) -> bool:
        """Queue a capture unless it is already queued or was checked unchanged."""
        with self._db() as db:
            checked = db.execute(
                "SELECT content_hash FROM checked WHERE source_url = ?", (item.source_url,)
            ).fetchone()
            if checked and checked[0] == item.content_hash:
                return False
            cursor = db.execute(
                "INSERT OR IGNORE INTO items"
                " (source_url, school, post, directory_source_id, content_hash, enqueued_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    item.source_url,
                    item.school,
                    json.dumps(item.post),
                    item.directory_source_id,
                    item.content_hash,
                    time.time(),
                ),
            )
            return cursor.rowcount == 1

    def claim(self) -> QueueItem | None:
        """Lease the oldest available item; an expired lease makes it claimable again."""
        now = time.time()
        with self._db() as db:
            row = db.execute(
                "UPDATE items SET leased_until = ?, attempts = attempts + 1"
                " WHERE source_url = (SELECT source_url FROM items WHERE leased_until < ?"
                " ORDER BY enqueued_at, source_url LIMIT 1)"
                " RETURNING school, post, directory_source_id, attempts",
                (now + CONTROL.claim_lease_seconds, now),
            ).fetchone()
        if row is None:
            return None
        return QueueItem(
            school=row[0], post=json.loads(row[1]), directory_source_id=row[2], attempts=row[3]
        )

    def complete(self, item: QueueItem) -> None:
        """Forget a processed item and remember its content for the TTL."""
        with self._db() as db:
            db.execute("DELETE FROM items WHERE source_url = ?", (item.source_url,))
            db.execute(
                "INSERT OR REPLACE INTO checked (source_url, content_hash, checked_at)"
                " VALUES (?, ?, ?)",
                (item.source_url, item.content_hash, time.time()),
            )

    def release(self, item: QueueItem) -> None:
        """Return a failed item, dropping it once its attempts are exhausted.

        The item keeps its lease, so a later run retries it after the lease
        expires instead of the same run exhausting every attempt at once.
        """
        if item.attempts >= CONTROL.max_attempts:
            self.complete(item)

    def prune(self) -> int:
        cutoff = time.time() - CONTROL.checked_ttl_days * 86400
        with self._db() as db:
            return db.execute("DELETE FROM checked WHERE checked_at < ?", (cutoff,)).rowcount

    def counts(self) -> dict[str, int]:
        with self._db() as db:
            return {
                "queued": db.execute("SELECT count(*) FROM items").fetchone()[0],
                "checked": db.execute("SELECT count(*) FROM checked").fetchone()[0],
            }
