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
from collections.abc import Callable
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
_AVAILABLE_ACCOUNT_SQL = (
    "account_username NOT IN (SELECT value FROM json_each(COALESCE("
    "(SELECT value FROM settings WHERE key='excluded_accounts'),'[]')))"
)


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
    attempts: int


class BrowserJobQueue:
    """SQLite transactions provide cross-process admission and school rotation."""

    def __init__(self, state_directory: Path | None = None) -> None:
        self.state_directory = state_directory or default_state_directory()
        self.state_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database_path = self.state_directory / "jobs.sqlite3"
        with closing(self._connect()) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            schema = """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    dedupe_key TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL CHECK(kind IN ('digest', 'retrieval', 'engagement')),
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

                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS diagnostic_events (
                    id TEXT PRIMARY KEY, event TEXT NOT NULL, created_at REAL NOT NULL
                );
            """
            # SQLite cannot add values to a CHECK constraint in place.
            # Rebuild atomically while preserving every job and its history.
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT sql FROM sqlite_master WHERE name='jobs'").fetchone()
            if existing and "'retrieval'" not in existing[0]:
                db.execute("ALTER TABLE jobs RENAME TO jobs_previous")
                db.execute(schema.split(";")[0])
                db.execute("INSERT INTO jobs SELECT * FROM jobs_previous")
                db.execute("DROP TABLE jobs_previous")
            for statement in schema.split(";"):
                if statement.strip():
                    db.execute(statement)
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
        previous = self.get_setting(key) if key == "paused" else None
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

        if key == "paused" and previous != value:
            self.record_diagnostic("paused" if value else "resumed")

    def record_diagnostic(self, state: str, job: BrowserJob | None = None) -> None:
        """Persist allowlisted diagnostics locally without delaying browser work on HTTP."""
        event = {
            "event": f"Browser worker: {state}",
            "sender_id": "instagram-browser-worker",
            "school": job.school if job else None,
            "ig_account": job.account_username if job else None,
            "post_url": (job.payload.get("url") or job.payload.get("post_url")) if job else None,
            "payload": {
                "state": state,
                "job_id": job.id if job else None,
                "kind": job.kind if job else None,
                "reason": job.error if job else self.get_setting("paused", False),
                "recorded_at": time.time(),
            },
        }
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO diagnostic_events VALUES (?,?,?)",
                (uuid.uuid4().hex, json.dumps(event), time.time()),
            )

    def publish_diagnostics(self, *, should_stop: Callable[[], bool] | None = None) -> None:
        """Keep unsent events durable when production logging is unavailable."""
        from services.automate_log_service import create_automate_log

        with closing(self._connect()) as db:
            events = db.execute(
                "SELECT id,event FROM diagnostic_events ORDER BY created_at LIMIT ?",
                (CONTROL.source_page_size,),
            ).fetchall()
        for event in events:
            if should_stop is not None and should_stop():
                break
            if not create_automate_log(**json.loads(event["event"])):
                break
            with closing(self._connect()) as db, db:
                db.execute("DELETE FROM diagnostic_events WHERE id=?", (event["id"],))

    def account_excluded(self, username: str) -> bool:
        return username in self.get_setting("excluded_accounts", [])

    def peek_account_username(self) -> str | None:
        """Choose a public bootstrap profile without claiming or switching an account."""
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT account_username FROM jobs WHERE state IN ('pending','running') "
                f"AND {_AVAILABLE_ACCOUNT_SQL} ORDER BY created_at,id LIMIT 1"
            ).fetchone()
        return row["account_username"] if row else None

    def enqueue_digest(self, recipient_id: str, account_username: str, cache_ent_id: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,255}", cache_ent_id):
            raise ValueError("Instagram cache ID is invalid")
        return self._enqueue(
            "digest", "", recipient_id, account_username, {"cache_ent_id": cache_ent_id}
        )

    def enqueue_retrieval(
        self,
        *,
        school: str,
        recipient_id: str,
        account_username: str,
        url: str,
        cutoff_days: int = 1,
    ) -> str:
        from services.instagram_notifications.browser_ingestion import canonical_target_url

        if not re.fullmatch(r"[a-z0-9-]{1,80}", school) or not 1 <= cutoff_days <= 1825:
            raise ValueError("Instagram retrieval school or cutoff is invalid")
        return self._enqueue(
            "retrieval",
            school,
            recipient_id,
            account_username,
            {"url": canonical_target_url(url), "cutoff_days": cutoff_days},
        )

    def enqueue_engagement(
        self,
        *,
        school: str,
        recipient_id: str,
        account_username: str,
        post_url: str,
        event_id: int | None = None,
        dry_run: bool = False,
    ) -> str:
        if not re.fullmatch(r"[a-z0-9-]{1,80}", school):
            raise ValueError("Instagram engagement school is invalid")
        return self._enqueue(
            "engagement",
            school,
            recipient_id,
            account_username,
            {
                "post_url": canonical_post_url(post_url),
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
        elif kind == "retrieval":
            identity.extend([payload["url"], str(payload["cutoff_days"])])
        else:
            # p/ and reel/ can reference the same media. Dedupe by its shortcode.
            identity.extend([payload["post_url"].rstrip("/").split("/")[-1]])
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
                        "UPDATE jobs SET state='pending',created_at=?,started_at=NULL,finished_at=NULL,error=NULL,result=NULL,attempts=0 WHERE id=?",
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
        self.record_diagnostic("queued", self.get(job_id))
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
                    "attempts",
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
            paused = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
            if paused and json.loads(paused[0]):
                return None
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=?,error='Digest caller deadline expired' WHERE kind='digest' AND state='pending' AND created_at<?",
                (now, now - CONTROL.result_timeout_seconds),
            )
            row = db.execute(
                "SELECT * FROM jobs WHERE state='pending' AND kind='digest' "
                f"AND {_AVAILABLE_ACCOUNT_SQL} "
                "ORDER BY created_at,id LIMIT 1"
            ).fetchone()
            if not row and allow_engagement:
                row = self._select_engagement(db, now, require_waited=True)
            if not row:
                row = db.execute(
                    "SELECT * FROM jobs WHERE state='pending' AND kind='retrieval' "
                    f"AND {_AVAILABLE_ACCOUNT_SQL} "
                    "ORDER BY created_at,id LIMIT 1"
                ).fetchone()
            if not row and allow_engagement:
                row = self._select_engagement(db, now)
            if not row:
                return None
            if row["kind"] == "engagement":
                db.execute(
                    "INSERT INTO settings VALUES ('engagement_school',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (json.dumps(row["school"]),),
                )
            db.execute(
                "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                (now, row["id"]),
            )
            return self._job(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())

    @staticmethod
    def _select_engagement(
        db: sqlite3.Connection, now: float, *, require_waited: bool = False
    ) -> sqlite3.Row | None:
        """An aged post triggers a yield; complete the selected school's posts together."""
        cooldown = db.execute(
            "SELECT value FROM settings WHERE key='next_engagement_at'"
        ).fetchone()
        if cooldown and now < json.loads(cooldown[0]):
            return None
        if (
            require_waited
            and not db.execute(
                "SELECT 1 FROM jobs WHERE state='pending' AND kind='engagement' "
                f"AND {_AVAILABLE_ACCOUNT_SQL} AND created_at<=? LIMIT 1",
                (now - CONTROL.engagement_max_wait_seconds,),
            ).fetchone()
        ):
            return None
        selected = db.execute("SELECT value FROM settings WHERE key='engagement_school'").fetchone()
        return db.execute(
            "SELECT * FROM jobs WHERE state='pending' AND kind='engagement' "
            f"AND {_AVAILABLE_ACCOUNT_SQL} "
            "ORDER BY CASE WHEN school=? THEN 0 ELSE 1 END,created_at,id LIMIT 1",
            (json.loads(selected[0]) if selected else None,),
        ).fetchone()

    def claim_companions(
        self, first: BrowserJob, *, limit: int, allow_engagement: bool = True
    ) -> list[BrowserJob]:
        """Atomically claim a compatible batch; never parallelize account switches."""
        if first.kind == "engagement" or limit <= 0:
            return []
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            paused = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
            if paused and json.loads(paused[0]):
                return []
            now = time.time()
            if first.kind == "retrieval" and (
                db.execute(
                    "SELECT 1 FROM jobs WHERE state='pending' AND kind='digest' "
                    f"AND {_AVAILABLE_ACCOUNT_SQL} LIMIT 1"
                ).fetchone()
                or (allow_engagement and self._select_engagement(db, now, require_waited=True))
            ):
                return []
            account_filter = (
                "AND recipient_id=? AND account_username=?" if first.kind == "digest" else ""
            )
            arguments: list[str | int] = [first.kind]
            if first.kind == "digest":
                arguments.extend([first.recipient_id, first.account_username])
            arguments.append(limit)
            rows = db.execute(
                "SELECT * FROM jobs WHERE state='pending' AND kind=? "
                f"AND {_AVAILABLE_ACCOUNT_SQL} "
                + account_filter
                + " ORDER BY created_at,id LIMIT ?",
                arguments,
            ).fetchall()
            for row in rows:
                db.execute(
                    "UPDATE jobs SET state='running',started_at=?,attempts=attempts+1 WHERE id=?",
                    (now, row["id"]),
                )
            return [
                self._job(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())
                for row in rows
            ]

    def finish(
        self,
        job_id: str,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        requeue: bool = False,
    ) -> None:
        """Complete a claim or atomically schedule a safe read retry."""
        state = (
            "pending"
            if requeue
            else "failed"
            if error
            else "unsupported"
            if result and result.get("status") == "unsupported"
            else "succeeded"
        )
        with closing(self._connect()) as db, db:
            if requeue:
                job = db.execute("SELECT kind FROM jobs WHERE id=?", (job_id,)).fetchone()
                if job and job["kind"] == "engagement":
                    raise ValueError("Engagement cannot be automatically requeued")
            now = time.time()
            db.execute(
                "UPDATE jobs SET state=?,result=?,error=?,finished_at=?,"
                "started_at=CASE WHEN ? THEN NULL ELSE started_at END,"
                "created_at=CASE WHEN ? THEN ? ELSE created_at END WHERE id=? AND state='running'",
                (
                    state,
                    json.dumps(result) if result and not requeue else None,
                    error if not requeue else None,
                    None if requeue else now,
                    requeue,
                    requeue,
                    now,
                    job_id,
                ),
            )

    def recover_interrupted(self) -> None:
        """Called only after obtaining the singleton worker and exclusive browser locks."""
        newly_paused = False
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            uncertain_action = db.execute(
                "SELECT 1 FROM jobs WHERE kind='engagement' AND state='running' "
                "AND json_extract(payload,'$.dry_run') IS NOT 1 LIMIT 1"
            ).fetchone()
            paused = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
            if uncertain_action and not (paused and json.loads(paused[0])):
                db.execute(
                    "INSERT INTO settings VALUES ('paused',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (
                        json.dumps(
                            "Worker interrupted during engagement; inspect browser state before resuming"
                        ),
                    ),
                )
                newly_paused = True
            db.execute(
                "UPDATE jobs SET state='pending',started_at=NULL WHERE kind IN ('digest','retrieval') AND state='running'"
            )
            db.execute(
                "UPDATE jobs SET state='failed',finished_at=?,error='Worker interrupted; inspect browser state before retrying' WHERE kind='engagement' AND state='running'",
                (time.time(),),
            )
        if newly_paused:
            self.record_diagnostic("paused")

    def retry(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND state IN ('failed','unsupported','cancelled')",
                (time.time(), job_id),
            ).rowcount
        if not changed:
            raise ValueError("Only failed, unsupported, or cancelled jobs may be retried")
        self.record_diagnostic("queued", self.get(job_id))

    def cancel(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND state='pending'",
                (time.time(), job_id),
            )

    def refresh_retrieval(self, job_id: str) -> None:
        """Refresh expired public media fields without touching engagement history."""
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,started_at=NULL,finished_at=NULL,attempts=0 WHERE id=? AND kind='retrieval' AND state IN ('succeeded','failed','cancelled')",
                (time.time(), job_id),
            ).rowcount
        if not changed:
            raise ValueError("Only completed retrieval jobs may be refreshed")
        self.record_diagnostic("queued", self.get(job_id))

    def retrieval_results(self) -> list[BrowserJob]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT * FROM jobs WHERE kind='retrieval' AND state='succeeded' ORDER BY created_at,id"
            ).fetchall()
        return [self._job(row) for row in rows]

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
            "notification_source": self.get_setting("notification_source_status"),
            "notification_import": self.get_setting("notification_import_status"),
            "notification_import_error": self.get_setting("notification_import_error"),
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
            paused = self.queue.get_setting("paused", False)
            if (
                paused
                or not worker.get("running")
                or time.time() - worker.get("heartbeat", 0)
                > CONTROL.job_timeout_seconds + CONTROL.request_timeout_seconds
            ):
                self.queue.cancel(job_id)
                reason = (
                    f"Instagram browser worker is paused: {paused}"
                    if isinstance(paused, str) and paused
                    else "Instagram browser worker is unavailable or paused; inspect it on the Mac mini"
                )
                raise BrowserDigestError(reason)
            time.sleep(CONTROL.worker_poll_interval_seconds)
        self.queue.cancel(job_id)
        raise BrowserDigestError("Instagram digest queue timed out; notification can be retried")
