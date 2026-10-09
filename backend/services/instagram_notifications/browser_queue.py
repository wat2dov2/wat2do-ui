"""Durable local scheduling for the one human-authenticated Instagram browser.

Only the worker executes browser operations. Callers submit sanitized identities
and wait for results; no cookies, tokens, or browser profiles enter this database.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import time
import uuid
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass, replace
from functools import wraps
from pathlib import Path
from typing import Any, ParamSpec, TypeVar, cast

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from schemas.school import validate_recipient_id
from services.instagram_notifications.browser_digest import BrowserDigestError, DigestResolution
from services.instagram_notifications.browser_review import (
    ReviewSnapshotError,
    ReviewSnapshotStore,
    decode_review_artifact,
    encode_review_artifact,
)
from services.instagram_notifications.browser_session import (
    canonical_post_url,
    validate_account_username,
)

CONTROL = controlbox.instagram_browser
WORKER_INSTALLATION_PAUSE = "Browser worker installation in progress"
_REVIEW_PREFIX = "notification_reviewed_target:"
_ARTIFACT_FORMAT = "wat2do-instagram-review-v1"
log = logging.getLogger(__name__)
_P = ParamSpec("_P")
_R = TypeVar("_R")
_AVAILABLE_ACCOUNT_SQL = (
    "account_username NOT IN (SELECT value FROM json_each(COALESCE("
    "(SELECT value FROM settings WHERE key='excluded_accounts'),'[]')))"
)


def _retry_storage(operation: Callable[_P, _R]) -> Callable[_P, _R]:
    """Retry a rolled-back queue transaction, never the browser operation it records."""

    @wraps(operation)
    def retry(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        queue = cast("BrowserJobQueue", args[0])
        for attempt in range(CONTROL.storage_retry_limit):
            try:
                return operation(*args, **kwargs)
            except sqlite3.Error as exc:
                code = getattr(exc, "sqlite_errorcode", None)
                code = code & 0xFF if type(code) is int else None
                if code not in {sqlite3.SQLITE_FULL, sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}:
                    queue.storage_unavailable = True
                    raise
                if attempt + 1 == CONTROL.storage_retry_limit:
                    queue.storage_unavailable = True
                    raise
                time.sleep(CONTROL.storage_retry_interval_seconds)
        raise AssertionError("Validated storage retry limit must be positive")

    return retry


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
    started_at: float | None
    result: dict[str, Any] | None
    error: str | None
    attempts: int


class BrowserJobQueue:
    """SQLite transactions provide cross-process admission and school rotation."""

    @_retry_storage
    def __init__(self, state_directory: Path | None = None) -> None:
        self.storage_unavailable = False
        self._pending_pause: Any = None
        self._pending_rate_limit = False
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
                CREATE TABLE IF NOT EXISTS review_snapshots (
                    digest TEXT PRIMARY KEY, payload BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS review_artifacts (
                    path TEXT PRIMARY KEY, reference TEXT NOT NULL,
                    original_sha256 TEXT NOT NULL, original_bytes INTEGER NOT NULL
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
            db.execute(
                "INSERT INTO settings VALUES ('delivery_generation',?) ON CONFLICT(key) DO NOTHING",
                (json.dumps(str(uuid.uuid4())),),
            )
            generation = json.loads(
                db.execute("SELECT value FROM settings WHERE key='delivery_generation'").fetchone()[
                    0
                ]
            )
            if not isinstance(generation, str) or str(uuid.UUID(generation)) != generation:
                raise ValueError("Browser queue delivery generation is invalid")
        self._delivery_generation = generation
        self.database_path.chmod(0o600)

    @property
    def delivery_generation(self) -> str:
        """Identify the durable queue so a recreated database can recover cloud delivery."""
        return self._delivery_generation

    @_retry_storage
    def recorded_engagement_sources(
        self, *, recipient_id: str, account_username: str, event_ids: list[int]
    ) -> list[dict[str, Any]]:
        """Recover an existing selection only when original jobs identify each source exactly."""
        recipient_id = validate_recipient_id(recipient_id)
        account_username = validate_account_username(account_username)
        if any(type(event_id) is not int for event_id in event_ids) or len(set(event_ids)) != len(
            event_ids
        ):
            raise ValueError("Engagement source event IDs must be unique integers")
        if not event_ids:
            return []
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT payload FROM jobs WHERE kind='engagement' AND recipient_id=? "
                "AND account_username=? AND COALESCE(json_extract(payload,'$.dry_run'),0)=0 "
                "AND json_extract(payload,'$.event_id') IN ("
                + ",".join("?" for _ in event_ids)
                + ")",
                (recipient_id, account_username, *event_ids),
            ).fetchall()
        sources: dict[int, set[str]] = {event_id: set() for event_id in event_ids}
        for row in rows:
            payload = json.loads(row["payload"])
            sources[payload["event_id"]].add(canonical_post_url(payload["post_url"]))
        if any(len(urls) != 1 for urls in sources.values()):
            raise ValueError("Original carousel sources cannot be recovered faithfully")
        return [
            {"post_url": next(iter(sources[event_id])), "event_id": event_id}
            for event_id in event_ids
        ]

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database_path, timeout=CONTROL.storage_busy_timeout_seconds)
        db.row_factory = sqlite3.Row
        return db

    @_retry_storage
    def get_setting(self, key: str, default: Any = None) -> Any:
        if key == "paused" and self._pending_pause:
            return self._pending_pause
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            value = json.loads(row[0]) if row else default
            if (
                key.startswith(_REVIEW_PREFIX)
                and isinstance(value, dict)
                and "review_snapshot" in value
            ):
                restored = ReviewSnapshotStore(db).get(value["review_snapshot"])
                if self._review_identity(restored) != value.get("codex_review"):
                    raise ReviewSnapshotError("Review snapshot decision metadata is invalid")
                return restored
            return value

    @staticmethod
    def _review_identity(value: Any) -> dict:
        decision = value.get("codex_review") if isinstance(value, dict) else None
        return (
            {
                key: decision[key]
                for key in ("reviewer", "decision", "school", "source_url")
                if key in decision
            }
            if isinstance(decision, dict)
            else {}
        )

    def _review_reference(self, db: sqlite3.Connection, value: Any) -> dict:
        return {
            "review_snapshot": ReviewSnapshotStore(db).put(value),
            "codex_review": self._review_identity(value),
        }

    @_retry_storage
    def set_setting(self, key: str, value: Any) -> None:
        if key == "paused" and value:
            # A full disk must not erase an auth or uncertain-action safety hold.
            try:
                previous = self.get_setting(key)
            finally:
                self._pending_pause = value
        else:
            previous = self.get_setting(key) if key == "paused" else None
        with closing(self._connect()) as db, db:
            if key.startswith(_REVIEW_PREFIX) and isinstance(value, dict):
                db.execute("BEGIN IMMEDIATE")
                if "review_snapshot" in value:
                    value = ReviewSnapshotStore(db).get(value["review_snapshot"])
                value = self._review_reference(db, value)
            db.execute(
                "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

        if key == "paused":
            self._pending_pause = None

        if key == "paused" and previous != value:
            self.record_diagnostic("paused" if value else "resumed")

    @_retry_storage
    def compact_review_settings(self) -> dict[str, int]:
        """Losslessly migrate legacy review records; concurrent decisions win."""
        with closing(self._connect()) as db:
            keys = db.execute(
                "SELECT key FROM settings WHERE key GLOB ? ORDER BY key", (_REVIEW_PREFIX + "*",)
            ).fetchall()
        stats = {"compacted": 0, "already_compact": 0, "changed": 0}
        for (key,) in keys:
            with closing(self._connect()) as db:
                row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            if row is None:
                stats["changed"] += 1
                continue
            original = row[0]
            value = json.loads(original)
            if isinstance(value, dict) and "review_snapshot" in value:
                stats["already_compact"] += 1
                continue
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                current = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
                if current is None or current[0] != original:
                    stats["changed"] += 1
                    continue
                reference = self._review_reference(db, value)
                changed = db.execute(
                    "UPDATE settings SET value=? WHERE key=? AND value=?",
                    (json.dumps(reference), key, original),
                ).rowcount
                stats["compacted"] += changed
        return stats

    def review_artifact_bytes(self, path: Path) -> bytes:
        """Read original checkpoint bytes, including their original hash/order."""
        raw = Path(path).read_bytes()
        if Path(path).suffix != ".json" or len(raw) > 4096:
            return raw
        try:
            descriptor = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return raw
        if not isinstance(descriptor, dict) or descriptor.get("format") != _ARTIFACT_FORMAT:
            return raw
        if (
            set(descriptor) != {"format", "review_snapshot", "original_sha256", "original_bytes"}
            or type(descriptor["original_bytes"]) is not int
            or not 0 <= descriptor["original_bytes"] <= CONTROL.review_snapshot_max_bytes
            or not isinstance(descriptor["original_sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", descriptor["original_sha256"])
        ):
            raise ReviewSnapshotError("Review checkpoint reference is invalid")
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            text = decode_review_artifact(
                ReviewSnapshotStore(db).get(descriptor["review_snapshot"])
            )
        original = text.encode("utf-8")
        if (
            len(original) != descriptor["original_bytes"]
            or hashlib.sha256(original).hexdigest() != descriptor["original_sha256"]
        ):
            raise ReviewSnapshotError("Review checkpoint integrity check failed")
        return original

    def read_review_artifact(self, path: Path) -> Any:
        return json.loads(self.review_artifact_bytes(path))

    def write_review_artifact(
        self, path: Path, text: str, *, expected_sha256: str | None = None
    ) -> bool:
        """Commit immutable content before atomically replacing a checkpoint."""
        path = Path(path).absolute()
        if path.suffix != ".json" or not isinstance(text, str):
            raise ReviewSnapshotError("Review checkpoint must be UTF-8 JSON")
        json.loads(text)
        raw = text.encode("utf-8")
        if len(raw) > CONTROL.review_snapshot_max_bytes:
            raise ReviewSnapshotError("Review checkpoint exceeds its storage limit")
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
            raise ReviewSnapshotError("Review checkpoint ownership is invalid")
        with (self.state_directory / "review-artifacts.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if expected_sha256 is not None and (
                not path.exists()
                or hashlib.sha256(self.review_artifact_bytes(path)).hexdigest() != expected_sha256
            ):
                return False
            digest = hashlib.sha256(raw).hexdigest()
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                reference = ReviewSnapshotStore(db).put(encode_review_artifact(text))
                db.execute(
                    "INSERT INTO review_artifacts VALUES (?,?,?,?) "
                    "ON CONFLICT(path) DO UPDATE SET reference=excluded.reference, "
                    "original_sha256=excluded.original_sha256, original_bytes=excluded.original_bytes",
                    (str(path), json.dumps(reference), digest, len(raw)),
                )
            descriptor = {
                "format": _ARTIFACT_FORMAT,
                "review_snapshot": reference,
                "original_sha256": digest,
                "original_bytes": len(raw),
            }
            atomic_write(path, (json.dumps(descriptor) + "\n").encode())
        return True

    @_retry_storage
    def compare_set_pause(self, expected: Any, value: Any) -> bool:
        """Acquire or release a pause only while its observed owner is unchanged."""
        if self._pending_pause and self._pending_pause != expected:
            return False
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
            current = json.loads(row[0]) if row else False
            if current != expected:
                return False
            db.execute(
                "INSERT INTO settings VALUES ('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (json.dumps(value),),
            )
        if self._pending_pause == expected:
            self._pending_pause = None
        self.record_diagnostic("paused" if value else "resumed")
        return True

    @_retry_storage
    def defer_for_rate_limit(self, job: BrowserJob | None, reason: str) -> None:
        """Hold all browser admission without changing a claim or its retry policy."""
        if not reason or not reason.strip():
            raise ValueError("A rate limit requires a diagnostic reason")
        limited_job = None
        try:
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                if job is not None:
                    row = db.execute(
                        "SELECT * FROM jobs WHERE id=? AND state='running' AND attempts=? AND started_at=?",
                        (job.id, job.attempts, job.started_at),
                    ).fetchone()
                    if row is None or job.state != "running":
                        return
                    limited_job = self._job(row)
                self._write_rate_limit_state(db, time.time())
        except sqlite3.Error:
            self._pending_rate_limit = True
            raise
        self._pending_rate_limit = False
        self.record_diagnostic("rate_limited", limited_job, reason=reason)

    @classmethod
    def _write_rate_limit_state(cls, db: sqlite3.Connection, now: float) -> None:
        deadline, backoff = cls._rate_limit_state(db)
        if backoff == 0:
            backoff = CONTROL.rate_limit_backoff_seconds
        elif now >= deadline:
            backoff = min(backoff * 2, CONTROL.rate_limit_max_backoff_seconds)
        deadline = max(deadline, now + backoff)
        db.executemany(
            "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [
                ("browser_rate_limit_until", json.dumps(deadline)),
                ("browser_rate_limit_backoff_seconds", json.dumps(backoff)),
            ],
        )

    @_retry_storage
    def is_rate_limited(self, now: float | None = None) -> bool:
        if self._pending_rate_limit:
            return True
        now = time.time() if now is None else now
        with closing(self._connect()) as db:
            return now < self._rate_limit_state(db)[0]

    @staticmethod
    def _rate_limit_state(db: sqlite3.Connection) -> tuple[float, float]:
        state: dict[str, float] = {
            "browser_rate_limit_until": 0,
            "browser_rate_limit_backoff_seconds": 0,
        }
        for row in db.execute("SELECT key,value FROM settings WHERE key IN (?,?)", tuple(state)):
            value = json.loads(row["value"])
            interval = row["key"] == "browser_rate_limit_backoff_seconds"
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or (
                    interval
                    and value != 0
                    and not CONTROL.rate_limit_backoff_seconds
                    <= value
                    <= CONTROL.rate_limit_max_backoff_seconds
                )
            ):
                name = "interval" if interval else "timestamp"
                raise ValueError(f"Browser rate limit {name} is invalid")
            state[row["key"]] = value
        return state["browser_rate_limit_until"], state["browser_rate_limit_backoff_seconds"]

    @classmethod
    def _claims_blocked(cls, db: sqlite3.Connection, now: float) -> bool:
        paused = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
        return bool(paused and json.loads(paused[0])) or now < cls._rate_limit_state(db)[0]

    def record_diagnostic(
        self, state: str, job: BrowserJob | None = None, *, reason: str | None = None
    ) -> None:
        """Persist allowlisted diagnostics locally without delaying browser work on HTTP."""
        try:
            self._write_diagnostic(state, job, reason=reason)
        except (OSError, sqlite3.Error):
            # Diagnostic durability is secondary to the job transition already committed.
            log.warning("Could not persist browser diagnostic (%s)", state)

    @_retry_storage
    def _write_diagnostic(
        self, state: str, job: BrowserJob | None = None, *, reason: str | None = None
    ) -> None:
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
                "reason": (
                    reason
                    if reason is not None
                    else job.error
                    if job
                    else self.get_setting("paused", False)
                ),
                "recorded_at": time.time(),
            },
        }
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO diagnostic_events VALUES (?,?,?)",
                (uuid.uuid4().hex, json.dumps(event), time.time()),
            )

    def _record_job_diagnostic(self, state: str, job_id: str) -> None:
        try:
            self.record_diagnostic(state, self.get(job_id))
        except (OSError, sqlite3.Error):
            log.warning("Could not read browser job for diagnostic (%s)", state)

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

    @_retry_storage
    def peek_account_username(self) -> str | None:
        """Choose a public bootstrap profile without claiming or switching an account."""
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT account_username FROM jobs WHERE state IN ('pending','running') "
                f"AND {_AVAILABLE_ACCOUNT_SQL} ORDER BY created_at,id LIMIT 1"
            ).fetchone()
        return row["account_username"] if row else None

    def enqueue_digest(
        self, recipient_id: str, account_username: str, cache_ent_id: str
    ) -> BrowserJob:
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
        ).id

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
        ).id

    @_retry_storage
    def _enqueue(
        self, kind: str, school: str, recipient_id: str, username: str, payload: dict[str, Any]
    ) -> BrowserJob:
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
                return self._job(
                    db.execute("SELECT * FROM jobs WHERE id=?", (existing["id"],)).fetchone()
                )
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
            submitted = self._job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
        self.record_diagnostic("queued", submitted)
        return submitted

    @_retry_storage
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
                    "started_at",
                    "error",
                    "attempts",
                )
            },
            payload=json.loads(row["payload"]),
            result=json.loads(row["result"]) if row["result"] else None,
        )

    @_retry_storage
    def claim_next(
        self, *, now: float | None = None, allow_engagement: bool = True
    ) -> BrowserJob | None:
        if self.storage_unavailable:
            return None
        now = time.time() if now is None else now
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if self._claims_blocked(db, now):
                return None
            self._expire_pending_digests(db, now)
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
    def _expire_pending_digests(db: sqlite3.Connection, now: float) -> None:
        db.execute(
            "UPDATE jobs SET state='cancelled',finished_at=?,error='Digest caller deadline expired' "
            "WHERE kind='digest' AND state='pending' AND created_at<=?",
            (now, now - CONTROL.result_timeout_seconds),
        )

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

    @_retry_storage
    def claim_companions(
        self, first: BrowserJob, *, limit: int, allow_engagement: bool = True
    ) -> list[BrowserJob]:
        """Atomically claim a compatible batch; never parallelize account switches."""
        if self.storage_unavailable or first.kind == "engagement" or limit <= 0:
            return []
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            now = time.time()
            if self._claims_blocked(db, now):
                return []
            self._expire_pending_digests(db, now)
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

    @_retry_storage
    def finish(
        self,
        claim: BrowserJob,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        requeue: bool = False,
        refund_rate_limit: bool = False,
    ) -> None:
        """Complete a claim or atomically schedule a safe read retry."""
        if not isinstance(claim, BrowserJob):
            raise ValueError("Browser completion requires its original job claim")
        if refund_rate_limit and (
            not requeue
            or not error
            or not error.strip()
            or result is not None
            or claim.kind not in {"digest", "retrieval"}
            or claim.state != "running"
            or claim.started_at is None
            or claim.attempts <= 0
        ):
            raise ValueError(
                "A rate-limited claim refund requires a failed running safe read retry"
            )
        state = (
            "pending"
            if requeue
            else "failed"
            if error
            else "unsupported"
            if result and result.get("status") == "unsupported"
            else "succeeded"
        )
        retry_job: BrowserJob | None = None
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (claim.id,)).fetchone()
            stored_job = self._job(row) if row else None
            if (
                stored_job is None
                or stored_job.state != "running"
                or claim.state != "running"
                or stored_job.attempts != claim.attempts
                or stored_job.started_at != claim.started_at
            ):
                return
            if requeue:
                retry_job = stored_job
                if retry_job and retry_job.kind == "engagement":
                    raise ValueError("Engagement cannot be automatically requeued")
            now = time.time()
            refund = refund_rate_limit
            changed = db.execute(
                "UPDATE jobs SET state=?,result=?,error=?,finished_at=?,"
                "started_at=CASE WHEN ? THEN NULL ELSE started_at END,"
                "created_at=CASE WHEN ? AND kind!='digest' THEN ? ELSE created_at END,"
                "attempts=attempts-? "
                "WHERE id=? AND state='running' AND attempts=? AND started_at=?",
                (
                    state,
                    json.dumps(result) if result and not requeue else None,
                    error if not requeue else None,
                    None if requeue else now,
                    requeue,
                    requeue,
                    now,
                    refund,
                    claim.id,
                    claim.attempts,
                    claim.started_at,
                ),
            ).rowcount
            if (
                changed
                and state == "succeeded"
                and stored_job is not None
                and (
                    stored_job.kind in {"digest", "retrieval"}
                    or (stored_job.kind == "engagement" and not stored_job.payload.get("dry_run"))
                )
            ):
                deadline, backoff = self._rate_limit_state(db)
                recovered_at = deadline + CONTROL.rate_limit_recovery_seconds
                # One healthy route does not prove a recently limited route recovered.
                # Keep escalation until a fresh verified job follows a quiet recovery window.
                if (
                    backoff
                    and stored_job.started_at is not None
                    and recovered_at <= stored_job.started_at <= now
                ):
                    db.execute(
                        "INSERT INTO settings VALUES ('browser_rate_limit_backoff_seconds','0') "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
                    )
        if changed and retry_job is not None:
            self.record_diagnostic(
                "retrying", replace(retry_job, state="pending", result=None, error=error)
            )

    @_retry_storage
    def recover_interrupted(self) -> None:
        """Called only after obtaining the singleton worker and exclusive browser locks."""
        newly_paused = False
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if self._pending_pause:
                db.execute(
                    "INSERT INTO settings VALUES ('paused',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (json.dumps(self._pending_pause),),
                )
            if self._pending_rate_limit:
                self._write_rate_limit_state(db, time.time())
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
        self._pending_pause = None
        self._pending_rate_limit = False
        self.storage_unavailable = False
        if newly_paused:
            self.record_diagnostic("paused")

    @_retry_storage
    def retry(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND state IN ('failed','unsupported','cancelled')",
                (time.time(), job_id),
            ).rowcount
        if not changed:
            raise ValueError("Only failed, unsupported, or cancelled jobs may be retried")
        self._record_job_diagnostic("queued", job_id)

    @_retry_storage
    def retry_failed_notification_retrievals(self) -> int:
        """Retry delivered notification reads locally without another cloud backlog scan."""
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,"
                "started_at=NULL,finished_at=NULL WHERE kind='retrieval' "
                "AND state='failed' AND attempts<? "
                "AND id IN (SELECT json_extract(value,'$') FROM settings "
                "WHERE key GLOB 'notification_delivery:*') "
                f"AND {_AVAILABLE_ACCOUNT_SQL} RETURNING id",
                (time.time(), CONTROL.ingestion_retry_limit),
            ).fetchall()
        for row in changed:
            job_id = row["id"]
            self._record_job_diagnostic("queued", job_id)
        return len(changed)

    @_retry_storage
    def cancel(self, job_id: str) -> None:
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND state='pending'",
                (time.time(), job_id),
            )

    @_retry_storage
    def cancel_pending_digest(self, expected: BrowserJob) -> bool:
        """A timed-out caller cannot cancel a newer submission of the same digest."""
        if expected.kind != "digest":
            raise ValueError("Caller cancellation requires its original digest submission")
        with closing(self._connect()) as db, db:
            changed = db.execute(
                "UPDATE jobs SET state='cancelled',finished_at=? WHERE id=? AND kind='digest' "
                "AND state='pending' AND created_at=?",
                (
                    time.time(),
                    expected.id,
                    expected.created_at,
                ),
            ).rowcount
        return bool(changed)

    @_retry_storage
    def reset_retrieval_import(self, job_id: str, *, import_setting_keys: list[str]) -> None:
        """Refresh an idle target and reset only its explicit import markers atomically."""
        allowed_manual = {f"manual_imported:{job_id}", f"manual_import_attempts:{job_id}"}
        if any(
            key not in allowed_manual
            and not re.fullmatch(r"notification_import_attempts:[a-f0-9-]{36}", key)
            for key in import_setting_keys
        ):
            raise ValueError("Only matching retrieval import markers may be reset")
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            changed = self._refresh_retrieval_state(db, job_id, allow_pending=True)
            if not changed:
                raise ValueError("Only an idle retrieval job may be retried")
            db.executemany(
                "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [
                    (key, json.dumps(False if key.startswith("manual_imported:") else 0))
                    for key in import_setting_keys
                ],
            )
        self._record_job_diagnostic("queued", job_id)

    @_retry_storage
    def refresh_retrieval(self, job_id: str) -> None:
        """Refresh expired public media fields without touching engagement history."""
        with closing(self._connect()) as db, db:
            changed = self._refresh_retrieval_state(db, job_id, allow_pending=False)
        if not changed:
            raise ValueError("Only completed retrieval jobs may be refreshed")
        self._record_job_diagnostic("queued", job_id)

    @staticmethod
    def _refresh_retrieval_state(
        db: sqlite3.Connection, job_id: str, *, allow_pending: bool
    ) -> bool:
        return bool(
            db.execute(
                "UPDATE jobs SET state='pending',created_at=?,result=NULL,error=NULL,"
                "started_at=NULL,finished_at=NULL,attempts=0 WHERE id=? AND kind='retrieval' "
                "AND (state IN ('succeeded','failed','cancelled') OR (? AND state='pending'))",
                (time.time(), job_id, allow_pending),
            ).rowcount
        )

    @_retry_storage
    def retrieval_results(self, *, succeeded_only: bool = True) -> list[BrowserJob]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT * FROM jobs WHERE kind='retrieval' "
                + ("AND state='succeeded' " if succeeded_only else "")
                + "ORDER BY created_at,id"
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
        rate_limit_until = self.get_setting("browser_rate_limit_until", 0)
        return {
            "queues": groups,
            "recent_failures": recent,
            "worker": self.get_setting("worker"),
            "paused": self.get_setting("paused", False),
            "rate_limit": {
                "retry_at": rate_limit_until or None,
                "remaining_seconds": max(0, rate_limit_until - time.time()),
                "backoff_seconds": self.get_setting("browser_rate_limit_backoff_seconds", 0),
            },
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
            submitted = self.queue.enqueue_digest(
                intended_recipient_id, account_username, cache_ent_id
            )
        except (ValueError, sqlite3.Error) as exc:
            raise BrowserDigestError("Could not enqueue Instagram digest") from exc
        job_id = submitted.id
        # All waiters share the admission's expiry, matching claim_next. A late
        # duplicate caller cannot extend a pending digest's lifetime for others.
        remaining = min(
            CONTROL.result_timeout_seconds,
            max(0, submitted.created_at + CONTROL.result_timeout_seconds - time.time()),
        )
        deadline = time.monotonic() + remaining
        while True:
            job = self.queue.get(job_id)
            if job and job.state == "succeeded" and job.result:
                return DigestResolution(
                    account_username=job.result["account_username"],
                    media_ids=tuple(job.result["media_ids"]),
                    page_count=job.result["page_count"],
                )
            if job and job.state in {"failed", "cancelled"}:
                raise BrowserDigestError(job.error or "Instagram digest job was cancelled")
            if time.monotonic() >= deadline:
                break
            worker = self.queue.get_setting("worker", {})
            paused = self.queue.get_setting("paused", False)
            if paused != WORKER_INSTALLATION_PAUSE and (
                paused
                or not worker.get("running")
                or time.time() - worker.get("heartbeat", 0)
                > CONTROL.job_timeout_seconds + CONTROL.request_timeout_seconds
            ):
                self.queue.cancel_pending_digest(submitted)
                reason = (
                    f"Instagram browser worker is paused: {paused}"
                    if isinstance(paused, str) and paused
                    else "Instagram browser worker is unavailable or paused; inspect it on the Mac mini"
                )
                raise BrowserDigestError(reason)
            time.sleep(CONTROL.worker_poll_interval_seconds)
        self.queue.cancel_pending_digest(submitted)
        raise BrowserDigestError("Instagram digest queue timed out; notification can be retried")
