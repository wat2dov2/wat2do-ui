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
from collections.abc import Callable, Sequence
from contextlib import closing, nullcontext
from dataclasses import dataclass, replace
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, ParamSpec, TextIO, TypeVar, cast

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
            # Existing databases enable this during stopped, backed-up compaction.
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                db.execute("PRAGMA auto_vacuum=INCREMENTAL")
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
                    original_sha256 TEXT NOT NULL, original_bytes INTEGER NOT NULL,
                    published_reference TEXT
                );
                CREATE TABLE IF NOT EXISTS review_completions (
                    media_row_id TEXT PRIMARY KEY, receipt TEXT NOT NULL,
                    review_sha256 TEXT NOT NULL, completed_at REAL NOT NULL,
                    batch TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS review_artifact_retention (
                    path TEXT PRIMARY KEY, media_row_ids TEXT NOT NULL,
                    original_sha256 TEXT NOT NULL, batch TEXT NOT NULL,
                    sealed_at REAL NOT NULL, retired_at REAL
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
            if "published_reference" not in {
                r["name"] for r in db.execute("PRAGMA table_info(review_artifacts)")
            }:
                db.execute("ALTER TABLE review_artifacts ADD COLUMN published_reference TEXT")
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
            if key.startswith("notification_delivery:"):
                db.execute("BEGIN IMMEDIATE")
                rid = key.removeprefix("notification_delivery:")
                if db.execute(
                    "SELECT 1 FROM review_completions WHERE media_row_id=?", (rid,)
                ).fetchone():
                    db.execute(
                        "INSERT INTO settings VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'",
                        ("notification_review_reopened:" + rid,),
                    )
            if key.startswith(_REVIEW_PREFIX) and isinstance(value, dict):
                db.execute("BEGIN IMMEDIATE")
                if "review_snapshot" in value:
                    value = ReviewSnapshotStore(db).get(value["review_snapshot"])
                value = self._review_reference(db, value)
                rid = key.removeprefix(_REVIEW_PREFIX)
                completion = db.execute(
                    "SELECT receipt FROM review_completions WHERE media_row_id=?", (rid,)
                ).fetchone()
                if completion and value["review_snapshot"]["sha256"] != json.loads(
                    completion[0]
                ).get("review_snapshot_sha256"):
                    db.execute(
                        "INSERT INTO settings VALUES (?, 'true') ON CONFLICT(key) DO UPDATE SET value='true'",
                        ("notification_review_reopened:" + rid,),
                    )
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
        # Pin the physical descriptor until the SQLite read snapshot is acquired.
        with (self.state_directory / "review-artifacts.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            return self._review_artifact_bytes_locked(path)

    @staticmethod
    def _review_artifact_descriptor(raw: bytes) -> dict[str, Any] | None:
        if len(raw) > 4096:
            return None
        try:
            descriptor = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(descriptor, dict) or descriptor.get("format") != _ARTIFACT_FORMAT:
            return None
        if (
            set(descriptor) != {"format", "review_snapshot", "original_sha256", "original_bytes"}
            or type(descriptor["original_bytes"]) is not int
            or not 0 <= descriptor["original_bytes"] <= CONTROL.review_snapshot_max_bytes
            or not isinstance(descriptor["original_sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", descriptor["original_sha256"])
        ):
            raise ReviewSnapshotError("Review checkpoint reference is invalid")
        return descriptor

    @staticmethod
    def _completed_artifact_receipt(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
        owners = json.loads(row["media_row_ids"])
        receipts = []
        for rid in owners:
            receipt = db.execute(
                "SELECT receipt FROM review_completions WHERE media_row_id=?", (rid,)
            ).fetchone()
            if receipt is None:
                raise ReviewSnapshotError("Completed review receipt is missing")
            receipts.append(json.loads(receipt[0]))
        return {
            "format": "wat2do-completed-review-v1",
            "batch": row["batch"],
            "original_sha256": row["original_sha256"],
            "completed_media": receipts,
        }

    def _review_artifact_bytes_locked(self, path: Path) -> bytes:
        raw = Path(path).read_bytes()
        descriptor = self._review_artifact_descriptor(raw) if Path(path).suffix == ".json" else None
        if descriptor is None:
            return raw
        with closing(self._connect()) as db:
            db.execute("BEGIN")
            row = db.execute(
                "SELECT published_reference FROM review_artifacts WHERE path=?",
                (str(Path(path).absolute()),),
            ).fetchone()
            published = json.loads(row[0]) if row and row[0] is not None else None
            if (
                isinstance(published, dict)
                and published.get("descriptor") == descriptor
                and "completed_review_receipt" in published
            ):
                return (json.dumps(published["completed_review_receipt"]) + "\n").encode()
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
            return self._write_review_artifact_locked(path, text, expected_sha256=expected_sha256)

    def _write_review_artifact_locked(
        self, path: Path, text: str, *, expected_sha256: str | None = None
    ) -> bool:
        raw = text.encode("utf-8")
        if expected_sha256 is not None and (
            not path.exists()
            or hashlib.sha256(self._review_artifact_bytes_locked(path)).hexdigest()
            != expected_sha256
        ):
            return False
        digest = hashlib.sha256(raw).hexdigest()
        # Foreground artifact writers have folder access. Capture the physical
        # generation before taking SQLite's writer, including failed publications.
        published = None
        if path.exists():
            with path.open("rb") as handle:
                published = self._review_artifact_descriptor(handle.read(4097))
        with closing(self._connect()) as db:
            previous = db.execute(
                "SELECT published_reference FROM review_artifacts WHERE path=?", (str(path),)
            ).fetchone()
            previous_publication = (
                json.loads(previous[0]) if previous and previous[0] is not None else None
            )
            if (
                isinstance(previous_publication, dict)
                and previous_publication.get("descriptor") == published
                and "completed_review_receipt" in previous_publication
            ):
                published = previous_publication
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            reference = ReviewSnapshotStore(db).put(encode_review_artifact(text))
            db.execute(
                "INSERT INTO review_artifacts VALUES (?,?,?,?,?) "
                "ON CONFLICT(path) DO UPDATE SET reference=excluded.reference, "
                "original_sha256=excluded.original_sha256, original_bytes=excluded.original_bytes, published_reference=excluded.published_reference",
                (str(path), json.dumps(reference), digest, len(raw), json.dumps(published)),
            )
            db.execute("DELETE FROM review_artifact_retention WHERE path=?", (str(path),))
        descriptor = {
            "format": _ARTIFACT_FORMAT,
            "review_snapshot": reference,
            "original_sha256": digest,
            "original_bytes": len(raw),
        }
        atomic_write(path, (json.dumps(descriptor) + "\n").encode())
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE review_artifacts SET published_reference=? WHERE path=? AND reference=?",
                (json.dumps(descriptor), str(path), json.dumps(reference)),
            )
        return True

    def inventory_review_artifacts(self) -> dict[str, int]:
        """Capture physical generations during foreground, stopped maintenance.

        The background worker never opens external review folders. Unknown legacy
        generations remain pinned until this explicit, backed-up inventory runs.
        """
        with (self.state_directory / "review-artifacts.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with closing(self._connect()) as db:
                rows = db.execute(
                    "SELECT path,reference,published_reference FROM review_artifacts"
                ).fetchall()
            captured = []
            for row in rows:
                path = Path(row["path"])
                if path.is_symlink() or any(p.is_symlink() for p in path.parents):
                    raise ReviewSnapshotError("Review checkpoint ownership is invalid")
                with path.open("rb") as handle:
                    descriptor = self._review_artifact_descriptor(handle.read(4097))
                previous = (
                    json.loads(row["published_reference"])
                    if row["published_reference"] is not None
                    else None
                )
                if (
                    isinstance(previous, dict)
                    and previous.get("descriptor") == descriptor
                    and "completed_review_receipt" in previous
                ):
                    descriptor = previous
                captured.append((json.dumps(descriptor), row["path"], row["reference"]))
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                for publication_json, path_text, reference in captured:
                    if (
                        db.execute(
                            "UPDATE review_artifacts SET published_reference=? WHERE path=? AND reference=?",
                            (publication_json, path_text, reference),
                        ).rowcount
                        != 1
                    ):
                        raise ReviewSnapshotError("Review inventory changed concurrently")
            return {"inventoried": len(captured)}

    @staticmethod
    def _review_hash(value: Any) -> str:
        return hashlib.sha256(
            json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def record_review_completion(
        self,
        qa_path: Path,
        *,
        input_paths: dict[str, Path],
        artifact_paths: Sequence[Path],
    ) -> dict[str, int]:
        """Seal verified native outcomes, never infer completion from retrieval success.

        The independent verifier supplies its SHA-bound complete packet, claim
        journal and actual production readbacks. Mixed packets remain pinned.
        This only records retention eligibility; maintenance applies the grace.
        """
        qa_path = Path(qa_path).absolute()
        with (
            (self.state_directory / "ingestion.lock").open("a+") as ingestion,
            (self.state_directory / "review-artifacts.lock").open("a+") as artifacts,
        ):
            fcntl.flock(ingestion, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(artifacts, fcntl.LOCK_EX)
            raw = self._review_artifact_bytes_locked(qa_path)
            qa = json.loads(raw)
            required = {"approved", "held", "packet", "journal", "claims", "full", "freeze"}
            terminals = qa.get("parent_reported_actual_terminal_success", {})
            if (
                qa.get("reviewer") != "Codex independent read-only terminal QA"
                or qa.get(
                    "all_packet_ledgers_school_source_recipient_exact_tokens_and_held_pending_verified"
                )
                is not True
                or qa.get("review_or_native_inconsistencies") != []
                or terminals.get("native_exit_code") != 0
                or terminals.get("full_exit_code") != 0
                or type(terminals.get("native_exit_code")) is not int
                or type(terminals.get("full_exit_code")) is not int
                or type(terminals.get("native_session")) is not int
                or type(terminals.get("full_session")) is not int
                or set(input_paths) != required
                or set(qa.get("input_sha256", {})) != required
            ):
                raise ReviewSnapshotError("Review completion lacks independent terminal proof")
            checked = datetime.fromisoformat(qa["checked_at"].replace("Z", "+00:00"))
            age = time.time() - checked.timestamp()
            if checked.tzinfo is None or not 0 <= age <= CONTROL.completed_review_retention_seconds:
                raise ReviewSnapshotError(
                    "Review completion proof must be fresh and timezone-aware"
                )
            batch = "drain" + str(qa["drain"])
            if type(qa["drain"]) is not int or qa["drain"] < 1:
                raise ReviewSnapshotError("Review completion batch identity is invalid")
            inputs = {}
            hashes = {str(qa_path): hashlib.sha256(raw).hexdigest()}
            for key, path in input_paths.items():
                path = Path(path).absolute()
                data = self._review_artifact_bytes_locked(path)
                digest = hashlib.sha256(data).hexdigest()
                if digest != qa["input_sha256"][key]:
                    raise ReviewSnapshotError("Review completion input changed after verification")
                inputs[key] = json.loads(data)
                hashes[str(path)] = digest
            targets = inputs["approved"] + inputs["held"]
            by_id = {target["row"]["id"]: target for target in targets}
            readbacks = {item["media_row_id"]: item for item in qa["per_source_readback"]}
            if (
                not targets
                or len(by_id) != len(targets)
                or len(readbacks) != len(qa["per_source_readback"])
                or set(by_id) != set(readbacks)
                or set(by_id) != {t["row"]["id"] for t in inputs["packet"]["targets"]}
                or len(inputs["packet"]["targets"]) != len(targets)
                or len(inputs["full"]) != len(targets)
                or set(by_id) != {t["ledger"]["id"] for t in inputs["full"]}
            ):
                raise ReviewSnapshotError("Review completion does not cover the exact full packet")
            claims: dict[str, str] = {}
            for entry in inputs["claims"]:
                if (
                    entry.get("operation") == "mark_media_succeeded"
                    and entry.get("state") == "existing_service_returned"
                    and entry.get("result") is True
                ):
                    claim = entry["claim"]
                    if claim["media_row_id"] in claims:
                        raise ReviewSnapshotError("Review completion has duplicate finalizations")
                    claims[claim["media_row_id"]] = claim["claim_token"]
            approved_ids = {t["row"]["id"] for t in inputs["approved"]}
            if set(claims) != approved_ids:
                raise ReviewSnapshotError(
                    "Review completion finalizations do not cover approved sources"
                )
            if len(qa["native_effect_bindings"]) != len(inputs["journal"]["writes"]) or any(
                e["media_row_id"] not in approved_ids for e in qa["native_effect_bindings"]
            ):
                raise ReviewSnapshotError(
                    "Review completion effects do not cover the approved journal"
                )
            paths = {qa_path} | {Path(p).absolute() for p in input_paths.values()}
            freeze = inputs["freeze"]
            if freeze.get("batch") != batch:
                raise ReviewSnapshotError("Review completion has the wrong frozen batch")
            frozen_ids = []
            for item in freeze["reviews"]:
                path = (qa_path.parent.parent / item["path"]).absolute()
                data = self._review_artifact_bytes_locked(path)
                if (
                    item.get("frozen") is not True
                    or item.get("final_handshake") is not True
                    or hashlib.sha256(data).hexdigest() != item.get("sha256")
                ):
                    raise ReviewSnapshotError("Review completion lacks unchanged frozen reviews")
                original = json.loads(data)
                for target in original if isinstance(original, list) else [original]:
                    rid = target["row"]["id"]
                    if rid not in by_id or any(
                        by_id[rid].get(key) != value for key, value in target.items()
                    ):
                        raise ReviewSnapshotError(
                            "Review completion changed an original frozen field"
                        )
                    frozen_ids.append(rid)
                paths.add(path)
            if len(frozen_ids) != len(set(frozen_ids)) or set(frozen_ids) != set(by_id):
                raise ReviewSnapshotError(
                    "Review completion frozen sources do not cover the packet"
                )
            if not {Path(p).absolute() for p in artifact_paths} <= paths:
                raise ReviewSnapshotError("Unknown checkpoint ownership must remain pinned")
            for path in paths:
                if (
                    path.suffix != ".json"
                    or path.is_symlink()
                    or any(p.is_symlink() for p in path.parents)
                    or not ({batch, batch + "apply"} & set(path.stem.split("-")))
                ):
                    raise ReviewSnapshotError(
                        "Only explicit owned batch checkpoints may be retired"
                    )
                hashes[str(path)] = hashlib.sha256(
                    self._review_artifact_bytes_locked(path)
                ).hexdigest()
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                claim_row = db.execute(
                    "SELECT value FROM settings WHERE key='notification_browser_import_claim'"
                ).fetchone()
                if claim_row and json.loads(claim_row[0]):
                    raise ReviewSnapshotError(
                        "Review completion must wait for the active import claim"
                    )
                for rid in approved_ids:
                    target, readback = by_id[rid], readbacks[rid]
                    review, ledger = target["codex_review"], readback["native_ledger"]
                    recipient = readback["recipient_readback"]
                    full = next(item for item in inputs["full"] if item["ledger"]["id"] == rid)
                    job = db.execute(
                        "SELECT * FROM jobs WHERE id=?", (target["job_id"],)
                    ).fetchone()
                    marker = db.execute(
                        "SELECT value FROM settings WHERE key=?", (_REVIEW_PREFIX + rid,)
                    ).fetchone()
                    stored = json.loads(marker[0]) if marker else None
                    if isinstance(stored, dict) and "review_snapshot" in stored:
                        stored = ReviewSnapshotStore(db).get(stored["review_snapshot"])
                    if (
                        review.get("decision") != "import"
                        or not isinstance(review.get("reviewer"), str)
                        or not review["reviewer"].startswith("Codex")
                        or not review.get("source_decision")
                        or review.get("source_decision") != readback["source_decision"]
                        or ledger.get("id") != rid
                        or ledger.get("status") != "succeeded"
                        or ledger.get("claim_token") != claims[rid]
                        or not ledger.get("succeeded_at")
                        or ledger.get("source_url") != target["row"]["source_url"]
                        or review.get("source_url") != ledger["source_url"]
                        or recipient.get("id") != ledger.get("notification_id")
                        or (
                            "school_id" in target["row"]["notification"]
                            and recipient.get("school_id")
                            != target["row"]["notification"]["school_id"]
                        )
                        or recipient.get("intended_recipient_id")
                        != target["row"]["notification"]["intended_recipient_id"]
                        or readback.get("school") != target["school"]
                        or full.get("school") != target["school"]
                        or full.get("decision") != review.get("source_decision")
                        or any(
                            ledger.get(key) != full["ledger"].get(key)
                            for key in (
                                "id",
                                "status",
                                "claim_token",
                                "notification_id",
                                "source_url",
                                "succeeded_at",
                            )
                        )
                        or full.get("recipient", {}).get("school_id") != recipient.get("school_id")
                        or full.get("events") != readback["events"]
                        or full.get("positions") != readback["positions"]
                        or review.get("school") != target["school"]
                        or readback.get("global_source_baseline_preserved") is not True
                        or job is None
                        or job["kind"] != "retrieval"
                        or job["state"] != "succeeded"
                        or job["school"] != target["school"]
                        or job["recipient_id"] != recipient["intended_recipient_id"]
                        or json.loads(job["payload"]).get("url") != ledger["source_url"]
                        or not job["result"]
                        or json.loads(job["result"]).get("posts") != target.get("posts")
                        or json.dumps(stored, ensure_ascii=False)
                        != json.dumps(target, ensure_ascii=False)
                    ):
                        raise ReviewSnapshotError(
                            "Review completion source, claim or routing is invalid"
                        )
                    matching = [
                        entry
                        for entry in inputs["claims"]
                        if (
                            entry.get("operation") == "claim_pending_browser_media"
                            and entry.get("state") == "existing_service_returned"
                            and entry.get("result") is True
                            and entry.get("claim", {}).get("media_row_id") == rid
                            and entry["claim"].get("claim_token") == claims[rid]
                        )
                    ]
                    if len(matching) != 1:
                        raise ReviewSnapshotError(
                            "Review completion lacks its exact successful claim"
                        )
                    effects = [e for e in qa["native_effect_bindings"] if e["media_row_id"] == rid]
                    listings = []
                    for kind, rows in (
                        ("event", readback["events"]),
                        ("position", readback["positions"]),
                    ):
                        for row in rows:
                            digest = self._review_hash(row)
                            bound = [
                                e
                                for e in effects
                                if e["kind"] == kind
                                and e["native_id"] == row["id"]
                                and e["full_native_row_sha256"] == digest
                            ]
                            if (
                                len(bound) != 1
                                or type(row["id"]) is not int
                                or row["id"] < 1
                                or row.get("school_id") != recipient.get("school_id")
                            ):
                                raise ReviewSnapshotError(
                                    "Review completion listing readback is unbound"
                                )
                            effect = bound[0]
                            writes = [
                                w
                                for w in inputs["journal"]["writes"]
                                if w["media_row_id"] == rid and w["kind"] == kind
                            ]
                            index = effect.get("approved_index")
                            if type(index) is not int or not 0 <= index < len(writes):
                                raise ReviewSnapshotError(
                                    "Review completion lacks the exact native write index"
                                )
                            write = writes[index]
                            if (
                                effect.get("native_outcome") != write.get("outcome")
                                or effect.get("native_payload_sha256")
                                != self._review_hash(write[kind])
                                or effect.get("host_id") != row.get("club_id")
                                or write.get("club", {}).get("id") != row.get("club_id")
                                or write.get("club", {}).get("school_id") != recipient["school_id"]
                                or effect.get("source_url") != row.get("source_url")
                                or sorted(effect.get("cohost_ids", []))
                                != sorted(row.get("cohost_club_ids") or [])
                                or (
                                    kind == "position" and write.get("verified_position_row") != row
                                )
                            ):
                                raise ReviewSnapshotError(
                                    "Review completion native payload or ownership changed"
                                )
                            listings.append(
                                {
                                    "kind": kind,
                                    "id": row["id"],
                                    "sha256": digest,
                                    "action": bound[0]["action"],
                                }
                            )
                    if len(listings) != len(effects):
                        raise ReviewSnapshotError(
                            "Review completion has unverified listing effects"
                        )
                    receipt = {
                        "version": 1,
                        "batch": batch,
                        "media_row_id": rid,
                        "school": target["school"],
                        "school_id": recipient["school_id"],
                        "recipient_id": job["recipient_id"],
                        "source_url": ledger["source_url"],
                        "job_id": job["id"],
                        "job_attempts": job["attempts"],
                        "job_started_at": job["started_at"],
                        "job_result_sha256": hashlib.sha256(job["result"].encode()).hexdigest(),
                        "claim_token": claims[rid],
                        "succeeded_at": ledger["succeeded_at"],
                        "decision": review["source_decision"],
                        "listings": listings,
                        "review_sha256": self._review_hash(target),
                        "review_snapshot_sha256": json.loads(marker[0])
                        .get("review_snapshot", {})
                        .get("sha256"),
                        "qa_sha256": hashes[str(qa_path)],
                        "input_sha256": qa["input_sha256"],
                        "verified_at": checked.timestamp(),
                    }
                    db.execute(
                        "INSERT INTO review_completions VALUES (?,?,?,?,?) ON CONFLICT(media_row_id) DO UPDATE SET receipt=excluded.receipt, review_sha256=excluded.review_sha256, completed_at=excluded.completed_at, batch=excluded.batch",
                        (
                            rid,
                            json.dumps(receipt),
                            receipt["review_sha256"],
                            checked.timestamp(),
                            batch,
                        ),
                    )
                    db.execute(
                        "DELETE FROM settings WHERE key=?", ("notification_review_reopened:" + rid,)
                    )
                for path in paths:
                    db.execute(
                        "INSERT INTO review_artifact_retention VALUES (?,?,?,?,?,NULL) ON CONFLICT(path) DO UPDATE SET media_row_ids=excluded.media_row_ids, original_sha256=excluded.original_sha256, batch=excluded.batch, sealed_at=excluded.sealed_at, retired_at=NULL",
                        (
                            str(path),
                            json.dumps(sorted(by_id)),
                            hashes[str(path)],
                            batch,
                            checked.timestamp(),
                        ),
                    )
            return {
                "completed": len(approved_ids),
                "held": len(inputs["held"]),
                "artifacts": len(paths),
            }

    def _collect_review_snapshots_locked(self, deadline: float) -> int:
        """Trace settings and both published/registered artifacts under the artifact lock."""
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            roots = []
            for row in db.execute(
                "SELECT value FROM settings WHERE key GLOB ?", (_REVIEW_PREFIX + "*",)
            ):
                value = json.loads(row[0])
                if isinstance(value, dict) and "review_snapshot" in value:
                    roots.append(value["review_snapshot"])
            for row in db.execute(
                "SELECT a.*,r.retired_at,r.original_sha256 AS retirement_sha FROM review_artifacts a LEFT JOIN review_artifact_retention r ON r.path=a.path"
            ):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Review storage maintenance deadline exceeded")
                if row["published_reference"] is None:
                    raise ReviewSnapshotError(
                        "Review artifact inventory is required before collection"
                    )
                reference = json.loads(row["reference"])
                published = json.loads(row["published_reference"])
                expected = {
                    "format": _ARTIFACT_FORMAT,
                    "review_snapshot": reference,
                    "original_sha256": row["original_sha256"],
                    "original_bytes": row["original_bytes"],
                }
                retired = isinstance(published, dict) and set(published) == {
                    "descriptor",
                    "completed_review_receipt",
                }
                if retired:
                    if (
                        published["completed_review_receipt"].get("format")
                        != "wat2do-completed-review-v1"
                    ):
                        raise ReviewSnapshotError("Review completion publication is invalid")
                if not (
                    retired
                    and row["retired_at"] is not None
                    and row["retirement_sha"] == row["original_sha256"]
                    and published["descriptor"] == expected
                ):
                    roots.append(reference)
                if published is not None and not retired:
                    descriptor = self._review_artifact_descriptor(json.dumps(published).encode())
                    if descriptor is None:
                        raise ReviewSnapshotError("Review publication reference is invalid")
                    roots.append(descriptor["review_snapshot"])
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 100)
            deleted = ReviewSnapshotStore(db).collect(roots)
            db.set_progress_handler(None, 0)
        return deleted

    def maintain_review_storage(
        self, *, force: bool = False, _ingestion_lock: TextIO | None = None
    ) -> dict[str, Any]:
        """Bounded automatic retention and mark/sweep; no browser or cloud operations."""
        now = time.time()
        status = self.get_setting("review_storage_status", {})
        if (
            not force
            and now - status.get("checked_at", 0) < CONTROL.review_maintenance_interval_seconds
        ):
            return {"deferred": "interval"}
        deadline = time.monotonic() + CONTROL.review_maintenance_timeout_seconds
        stats: dict[str, Any] = {
            "retired_targets": 0,
            "retired_artifacts": 0,
            "collected_snapshots": 0,
        }
        with (
            (
                nullcontext(_ingestion_lock)
                if _ingestion_lock is not None
                else (self.state_directory / "ingestion.lock").open("a+")
            ) as ingestion,
            (self.state_directory / "review-artifacts.lock").open("a+") as artifacts,
        ):
            try:
                fcntl.flock(ingestion, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(artifacts, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {"deferred": "active writer"}
            if self.get_setting("notification_browser_import_claim"):
                return {"deferred": "active import claim"}
            with closing(self._connect()) as db:
                if db.execute(
                    "SELECT 1 FROM review_artifacts WHERE published_reference IS NULL LIMIT 1"
                ).fetchone():
                    return {"deferred": "artifact inventory required"}
            stats["collected_snapshots"] += self._collect_review_snapshots_locked(deadline)
            cutoff = now - CONTROL.completed_review_retention_seconds
            with closing(self._connect()) as db, db:
                db.execute("BEGIN IMMEDIATE")
                latest = db.execute(
                    "SELECT a.batch FROM review_artifact_retention a WHERE NOT EXISTS "
                    "(SELECT 1 FROM json_each(a.media_row_ids) owner LEFT JOIN review_completions c ON c.media_row_id=owner.value "
                    "WHERE c.media_row_id IS NULL OR EXISTS (SELECT 1 FROM settings WHERE key='notification_review_reopened:'||owner.value AND value='true')) "
                    "ORDER BY a.sealed_at DESC,a.batch DESC LIMIT 1"
                ).fetchone()
                latest_batch = latest[0] if latest else ""
                completed = {
                    row["media_row_id"]: row
                    for row in db.execute("SELECT * FROM review_completions")
                }
                eligible = {
                    rid: row
                    for rid, row in completed.items()
                    if row["completed_at"] <= cutoff
                    and row["batch"] != latest_batch
                    and not db.execute(
                        "SELECT 1 FROM settings WHERE key=? AND value='true'",
                        ("notification_review_reopened:" + rid,),
                    ).fetchone()
                }
                # A later review or reopening revokes old retirement permission.
                # Compare immutable root identities without expanding every baseline.
                for rid, row in list(eligible.items()):
                    marker = db.execute(
                        "SELECT value FROM settings WHERE key=?", (_REVIEW_PREFIX + rid,)
                    ).fetchone()
                    value = json.loads(marker[0]) if marker else {}
                    receipt = json.loads(row["receipt"])
                    job = db.execute(
                        "SELECT state,attempts,started_at,result FROM jobs WHERE id=?",
                        (receipt["job_id"],),
                    ).fetchone()
                    same = (
                        value.get("review_snapshot", {}).get("sha256")
                        == receipt.get("review_snapshot_sha256")
                        if "review_snapshot" in value
                        else value.get("completed_review_receipt") == receipt
                    )
                    if (
                        not same
                        or value.get("codex_review", {}).get("decision") != "import"
                        or job is None
                        or job["state"] != "succeeded"
                        or job["attempts"] != receipt["job_attempts"]
                        or job["started_at"] != receipt["job_started_at"]
                        or not job["result"]
                        or hashlib.sha256(job["result"].encode()).hexdigest()
                        != receipt["job_result_sha256"]
                    ):
                        del eligible[rid]
                for rid, row in eligible.items():
                    if stats["retired_targets"] >= CONTROL.review_maintenance_batch_size:
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Review storage maintenance deadline exceeded")
                    marker = db.execute(
                        "SELECT value FROM settings WHERE key=?", (_REVIEW_PREFIX + rid,)
                    ).fetchone()
                    value = json.loads(marker[0]) if marker else None
                    if not isinstance(value, dict) or "review_snapshot" not in value:
                        continue
                    restored = ReviewSnapshotStore(db).get(value["review_snapshot"])
                    if self._review_hash(restored) != row["review_sha256"]:
                        continue
                    compact = {
                        "codex_review": value["codex_review"],
                        "completed_review_receipt": json.loads(row["receipt"]),
                    }
                    db.execute(
                        "UPDATE settings SET value=? WHERE key=? AND value=?",
                        (json.dumps(compact), _REVIEW_PREFIX + rid, marker[0]),
                    )
                    stats["retired_targets"] += 1
                candidates = db.execute(
                    "SELECT * FROM review_artifact_retention a WHERE retired_at IS NULL AND sealed_at<=? AND batch!=? "
                    "AND NOT EXISTS (SELECT 1 FROM json_each(a.media_row_ids) owner LEFT JOIN review_completions c ON c.media_row_id=owner.value "
                    "WHERE c.media_row_id IS NULL OR c.completed_at>? OR c.batch=? OR EXISTS "
                    "(SELECT 1 FROM settings WHERE key='notification_review_reopened:'||owner.value AND value='true')) "
                    "ORDER BY sealed_at,path LIMIT ?",
                    (
                        cutoff,
                        latest_batch,
                        cutoff,
                        latest_batch,
                        max(0, CONTROL.review_maintenance_batch_size - stats["retired_targets"]),
                    ),
                ).fetchall()
            for row in candidates:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Review storage maintenance deadline exceeded")
                owners = json.loads(row["media_row_ids"])
                if not owners or any(rid not in eligible for rid in owners):
                    continue
                with closing(self._connect()) as db, db:
                    db.execute("BEGIN IMMEDIATE")
                    artifact = db.execute(
                        "SELECT * FROM review_artifacts WHERE path=?", (row["path"],)
                    ).fetchone()
                    if artifact is None or artifact["original_sha256"] != row["original_sha256"]:
                        db.execute(
                            "DELETE FROM review_artifact_retention WHERE path=? AND original_sha256=?",
                            (row["path"], row["original_sha256"]),
                        )
                        continue
                    descriptor = {
                        "format": _ARTIFACT_FORMAT,
                        "review_snapshot": json.loads(artifact["reference"]),
                        "original_sha256": artifact["original_sha256"],
                        "original_bytes": artifact["original_bytes"],
                    }
                    if json.loads(artifact["published_reference"]) != descriptor:
                        continue  # An unfinished publication must keep both generations.
                    # Physical descriptors stay tiny and unchanged. Canonical readers
                    # resolve this exact retired generation to its durable receipt.
                    # No external folder access can hold the queue writer.
                    published = {
                        "descriptor": descriptor,
                        "completed_review_receipt": self._completed_artifact_receipt(db, row),
                    }
                    db.execute(
                        "UPDATE review_artifacts SET published_reference=? WHERE path=?",
                        (json.dumps(published), row["path"]),
                    )
                    db.execute(
                        "UPDATE review_artifact_retention SET retired_at=? WHERE path=? AND original_sha256=?",
                        (now, row["path"], row["original_sha256"]),
                    )
                    stats["retired_artifacts"] += 1
            stats["collected_snapshots"] += self._collect_review_snapshots_locked(deadline)
            with closing(self._connect()) as db:
                db.execute("PRAGMA incremental_vacuum(1000)").fetchall()
                db.execute("PRAGMA wal_checkpoint(PASSIVE)")
                stats["snapshot_bytes"] = db.execute(
                    "SELECT COALESCE(SUM(length(payload)),0) FROM review_snapshots"
                ).fetchone()[0]
                stats["free_pages"] = db.execute("PRAGMA freelist_count").fetchone()[0]
            self.set_setting("review_storage_status", {"checked_at": now, "result": stats})
        return stats

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
