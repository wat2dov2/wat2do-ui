"""Durable local scheduling for the one human-authenticated Instagram browser.

Only the worker executes browser operations. Callers submit sanitized identities
and wait for results; no cookies, tokens, or browser profiles enter this database.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from schemas.school import validate_recipient_id
from services.instagram_notifications.browser_digest import BrowserDigestError, DigestResolution
from services.instagram_notifications.browser_session import (
    canonical_post_url,
    validate_account_username,
)

CONTROL = controlbox.instagram_browser
ENGAGEMENT_ACTIONS = frozenset({"like", "save", "repost"})


def default_state_directory() -> Path:
    return (
        Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
        / "wat2do/instagram-browser"
    )


@dataclass(frozen=True)
class BrowserJob:
    id: str
    kind: str
    school: str
    recipient_id: str
    account_username: str
    payload: dict[str, Any]
    state: str
    created_at: float
    result: dict[str, Any] | None
    error: str | None


class BrowserJobQueue:
    """SQLite transactions provide cross-process admission and school rotation."""

    def __init__(self, state_directory: Path | None = None) -> None:
        self.state_directory = state_directory or default_state_directory()
        self.state_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database_path = self.state_directory / "jobs.sqlite3"
        with closing(self._connect()) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    dedupe_key TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL CHECK(kind IN ('digest', 'engagement')),
                    school TEXT NOT NULL,
                    recipient_id TEXT NOT NULL,
                    account_username TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending'
                        CHECK(state IN ('pending','running','succeeded','failed','cancelled','unsupported')),
                    created_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    result TEXT,
                    error TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS jobs_waiting ON jobs(state, kind, created_at);
                CREATE TABLE IF NOT EXISTS school_turns (
                    school TEXT PRIMARY KEY,
                    last_served INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
        self.database_path.chmod(0o600)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database_path, timeout=CONTROL.request_timeout_seconds)
        db.row_factory = sqlite3.Row
        return db

    def get_setting(self, key: str, default: Any = None) -> Any:
        with closing(self._connect()) as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

    def enqueue_digest(self, recipient_id: str, account_username: str, cache_ent_id: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,255}", cache_ent_id):
            raise ValueError("Instagram cache ID is invalid")
        return self._enqueue(
            "digest", "", recipient_id, account_username, {"cache_ent_id": cache_ent_id}
        )

    def enqueue_engagement(
        self,
        *,
        school: str,
        recipient_id: str,
        account_username: str,
        post_url: str,
        action: str,
        event_id: int | None = None,
        dry_run: bool = False,
    ) -> str:
        if not re.fullmatch(r"[a-z0-9-]{1,80}", school) or action not in ENGAGEMENT_ACTIONS:
            raise ValueError("Instagram engagement school or action is invalid")
        return self._enqueue(
            "engagement",
            school,
            recipient_id,
            account_username,
            {
                "post_url": canonical_post_url(post_url),
                "action": action,
                "event_id": event_id,
                "dry_run": dry_run,
            },
        )

    def _enqueue(
        self, kind: str, school: str, recipient_id: str, username: str, payload: dict[str, Any]
    ) -> str:
        recipient_id = validate_recipient_id(recipient_id)
        username = validate_account_username(username)
        identity = [kind, recipient_id, username]
        if kind == "digest":
            identity.append(payload["cache_ent_id"])
        else:
            # p/ and reel/ can reference the same media. Dedupe by its shortcode.
            identity.extend([payload["post_url"].rstrip("/").split("/")[-1], payload["action"]])
        if payload.get("dry_run"):
            identity.extend(["inspect", uuid.uuid4().hex])
        dedupe_key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT id,state FROM jobs WHERE dedupe_key=?", (dedupe_key,)
            ).fetchone()
            if existing:
                # Digest retries are reads. Engagement retries always require an explicit retry.
                if kind == "digest" and existing["state"] in {"failed", "cancelled"}:
                    db.execute(
                        "UPDATE jobs SET state='pending',created_at=?,started_at=NULL,finished_at=NULL,error=NULL,result=NULL WHERE id=?",
                        (time.time(), existing["id"]),
                    )
                return existing["id"]
            job_id = uuid.uuid4().hex
            db.execute(
                "INSERT INTO jobs(id,dedupe_key,kind,school,recipient_id,account_username,payload,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    job_id,
                    dedupe_key,
                    kind,
                    school,
                    recipient_id,
                    username,
                    json.dumps(payload),
                    time.time(),
                ),
            )
        return job_id

    def get(self, job_id: str) -> BrowserJob | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return self._job(row) if row else None

    @staticmethod
    def _job(row: sqlite3.Row) -> BrowserJob:
        return BrowserJob(
            **{
                key: row[key]
                for key in (
                    "id",
                    "kind",
                    "school",
                    "recipient_id",
                    "account_username",
                    "state",
                    "created_at",
                    "error",
                )
            },
            payload=json.loads(row["payload"]),
            result=json.loads(row["result"]) if row["result"] else None,
        )

    def claim_next(
        self, *, now: float | None = None, allow_engagement: bool = True
    ) -> BrowserJob | None:
        now = time.time() if now is None else now
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=?,error='Digest caller deadline expired' WHERE kind='digest' AND state='pending' AND created_at<?",
                (now, now - CONTROL.result_timeout_seconds),
            )
            row = db.execute(
                "SELECT * FROM jobs WHERE state='pending' AND kind='digest' ORDER BY created_at,id LIMIT 1"
            ).fetchone()
            if not row and allow_engagement:
                # One action per school per round, largest current backlog first.
                stored_round = db.execute(
                    "SELECT value FROM settings WHERE key='school_round'"
                ).fetchone()
                round_number = json.loads(stored_round[0]) if stored_round else 1
                query = """
                    SELECT jobs.school, COUNT(*) AS quantity
                    FROM jobs LEFT JOIN school_turns turns ON turns.school=jobs.school
                    WHERE jobs.state='pending' AND jobs.kind='engagement'
                        AND COALESCE(turns.last_served,0) < ?
                    GROUP BY jobs.school ORDER BY quantity DESC, MIN(jobs.created_at), jobs.school LIMIT 1
                """
                school = db.execute(query, (round_number,)).fetchone()
                if not school:
                    round_number += 1
                    school = db.execute(query, (round_number,)).fetchone()
                db.execute(
                    "INSERT INTO settings VALUES ('school_round',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (json.dumps(round_number),),
                )
                if school:
                    row = db.execute(
                        "SELECT * FROM jobs WHERE state='pending' AND kind='engagement' AND school=? ORDER BY created_at,id LIMIT 1",
                        (school["school"],),
                    ).fetchone()
            if not row:
                return None
            db.execute(
                "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                (now, row["id"]),
            )
            if row["kind"] == "engagement":
                turn = round_number
                db.execute(
                    "INSERT INTO school_turns VALUES (?,?) ON CONFLICT(school) DO UPDATE SET last_served=excluded.last_served",
                    (row["school"], turn),
                )
            return self._job(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())

    def finish(
        self, job_id: str, *, result: dict[str, Any] | None = None, error: str | None = None
    ) -> None:
        state = (
            "failed"
            if error
            else "unsupported"
            if result and result.get("status") == "unsupported"
            else "succeeded"
        )
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE jobs SET state=?,result=?,error=?,finished_at=? WHERE id=? AND state='running'",
                (state, json.dumps(result) if result else None, error, time.time(), job_id),
            )

    def recover_interrupted(self) -> None:
        """Called only after obtaining the singleton worker and exclusive browser locks."""
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE jobs SET state='pending',started_at=NULL WHERE kind='digest' AND state='running'"
            )
            db.execute(
                "UPDATE jobs SET state='failed',finished_at=?,error='Worker interrupted; inspect browser state before retrying' WHERE kind='engagement' AND state='running'",
                (time.time(),),
            )

    def retry(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND state IN ('failed','unsupported','cancelled')",
                (time.time(), job_id),
            ).rowcount
        if not changed:
            raise ValueError("Only failed, unsupported, or cancelled jobs may be retried")

    def cancel(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND state='pending'",
                (time.time(), job_id),
            )

    def status(self) -> dict[str, Any]:
        with closing(self._connect()) as db:
            groups = [
                dict(row)
                for row in db.execute(
                    "SELECT kind,school,state,COUNT(*) AS quantity FROM jobs GROUP BY kind,school,state ORDER BY kind,school,state"
                )
            ]
            recent = [
                dict(row)
                for row in db.execute(
                    "SELECT id,kind,school,state,error,finished_at FROM jobs WHERE state IN ('failed','unsupported') ORDER BY finished_at DESC LIMIT 20"
                )
            ]
        return {
            "queues": groups,
            "recent_failures": recent,
            "worker": self.get_setting("worker"),
            "paused": self.get_setting("paused", False),
            "source": self.get_setting("source_status"),
        }


class QueuedInstagramDigestResolver:
    """Synchronous notification-facing facade; this class never controls Brave."""

    def __init__(self, queue: BrowserJobQueue | None = None) -> None:
        try:
            self.queue = queue or BrowserJobQueue()
        except (OSError, sqlite3.Error) as exc:
            raise BrowserDigestError("Instagram browser queue storage is unavailable") from exc

    def resolve(
        self, intended_recipient_id: str, account_username: str, cache_ent_id: str
    ) -> DigestResolution:
        try:
            return self._resolve(intended_recipient_id, account_username, cache_ent_id)
        except (OSError, sqlite3.Error) as exc:
            raise BrowserDigestError("Instagram browser queue storage is unavailable") from exc

    def _resolve(
        self, intended_recipient_id: str, account_username: str, cache_ent_id: str
    ) -> DigestResolution:
        try:
            job_id = self.queue.enqueue_digest(
                intended_recipient_id, account_username, cache_ent_id
            )
        except (ValueError, sqlite3.Error) as exc:
            raise BrowserDigestError("Could not enqueue Instagram digest") from exc
        deadline = time.monotonic() + CONTROL.result_timeout_seconds
        while time.monotonic() < deadline:
            job = self.queue.get(job_id)
            if job and job.state == "succeeded" and job.result:
                return DigestResolution(
                    account_username=job.result["account_username"],
                    media_ids=tuple(job.result["media_ids"]),
                    page_count=job.result["page_count"],
                )
            if job and job.state in {"failed", "cancelled"}:
                raise BrowserDigestError(job.error or "Instagram digest job was cancelled")
            worker = self.queue.get_setting("worker", {})
            if (
                self.queue.get_setting("paused", False)
                or not worker.get("running")
                or time.time() - worker.get("heartbeat", 0)
                > CONTROL.job_timeout_seconds + CONTROL.request_timeout_seconds
            ):
                self.queue.cancel(job_id)
                raise BrowserDigestError(
                    "Instagram browser worker is unavailable or paused; start it on the Mac mini"
                )
            time.sleep(CONTROL.worker_poll_interval_seconds)
        self.queue.cancel(job_id)
        raise BrowserDigestError("Instagram digest queue timed out; notification can be retried")
