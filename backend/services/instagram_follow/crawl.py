"""Find school clubs a school account should follow, through the clubs it already follows.

A crawl reads the school account's own Following list first: every public account the
school follows is one of its clubs, and each is a seed. It then reads each seed's whole
Following list. An account the school does not follow and has no row for becomes a
pending candidate when its handle or name carries one of the school's names
(``school_names``), or once ``crawl_mutual_follow_threshold`` of the school's followed
clubs follow it. Those sightings are kept in local state across crawls, so a club two
seeds follow is found even when no single crawl reaches both. A candidate is read in
turn by a later crawl, once the school follows it. A seed is productive when it turns
up an account the school has no row for yet, so an account an admin rejected is never
offered again. The crawl ends once ``crawl_miss_streak`` seeds in a row turn up nothing
new, or when no seed is left.

Crawling never stops. A crawl under way goes first, then schools never crawled, then
the school whose last crawl finished longest ago (``last_crawl_finished``), so a school
whose crawl ends is crawled again once the schools that finished before it have had
their turn. Each crawl starts over from the school's own Following list, so it also
reads the clubs the school followed since and finds accounts created since, and takes
the seeds in a new random order, so a crawl the miss streak ends early still reaches
clubs the last one never did.

The lists are read through the Mac's Brave worker (``wat2do-browser following``), one
page per job, as whichever account Brave shows: the worker paces the reads and holds
only them after a 429 or a login wall, and a hold or a pause simply keeps the crawl
waiting. The crawl keeps one read outstanding, keeps its place in local state, and
checks on the read every ``crawl_poll_seconds`` from its own thread of the emulator
worker's process (``run_forever``). A page that fails to read is tried again, up to
``crawl_seed_attempts`` times, and never counts as a miss; ``failures_before_rest``
failures in a row rest that school's crawl.
"""

from __future__ import annotations

import json
import logging
import random
import sqlite3
import subprocess
import time
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.constants import FOLLOW_SOURCE_CRAWL
from core.controlbox import controlbox
from core.database import get_sb
from core.launch_agents import INSTAGRAM_BROWSER_BINARY, atomic_write
from core.tables import INSTAGRAM_FOLLOW_CRAWLS
from services import school_service
from services.instagram_accounts import is_wat2do_account, school_account_username
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_follow import candidates

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_follow
STATE_DIRECTORY = Path.home() / ".local/state/wat2do/instagram-follow-crawl"
# Accounts seen in the school's clubs' lists that are not candidates yet, and which
# clubs follow them. Kept across crawls; an account leaves once it becomes a candidate.
SIGHTINGS_FILE = "sightings.sqlite3"

CRAWL_FINISHED = "finished"
_WAITING = ("pending", "running")
_BROWSER_TIMEOUT_SECONDS = 60
_MISSING_JOB = "job does not exist"

# A school whose reads keep failing waits until then (time.monotonic) before its next.
_rested_until: dict[str, float] = {}
# Each school's handles with a row, read again whenever a seed's list starts.
_known: dict[int, set[str]] = {}


class BrowserQueueError(RuntimeError):
    """The Brave worker's queue refused a request."""


def search_terms(school: str) -> list[str]:
    return [school, *CONTROL.school_names.get(school, [])]


def crawl_running(school: str) -> bool:
    """Whether the school has a crawl under way, kept in local state between reads."""
    return _state_path(school).exists()


def last_crawl_finished(school: str) -> datetime | None:
    """When the school's newest finished crawl ended, or None when none has finished yet."""
    latest = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CRAWLS)
        .select("finished_at")
        .eq("school_id", _school_id(school))
        .eq("status", CRAWL_FINISHED)
        .order("finished_at", desc=True)
        .limit(1)
        .execute()
    ).data
    return datetime.fromisoformat(latest[0]["finished_at"]) if latest else None


def run_forever(on_found: Callable[[], None]) -> None:
    """Keep crawling, one Brave read at a time; ``on_found`` runs after new candidates."""
    while True:
        try:
            found = advance()
        except Exception:
            log.exception("Follow crawl step failed")
            time.sleep(CONTROL.rest_seconds)
            continue
        if found:
            on_found()
        time.sleep(CONTROL.crawl_poll_seconds)


def advance() -> int:
    """Collect the outstanding read of the crawl whose turn it is and queue its next.

    Returns how many candidates the collected page added.
    """
    school = next_school()
    if school is None:
        return 0
    return _Crawl(school, _load(school)).step()


def next_school() -> str | None:
    """A crawl already under way first, so one finishes before the next starts, then
    schools never crawled, then the one whose last crawl finished longest ago. A crawl
    resting after failures waits its turn."""
    now = time.monotonic()
    ready = [
        school for school in EMULATOR.android_user_by_school if _rested_until.get(school, 0) <= now
    ]
    running = [school for school in ready if crawl_running(school)]
    if running:
        return running[0]
    never = datetime.min.replace(tzinfo=timezone.utc)
    ordered = sorted(ready, key=lambda school: last_crawl_finished(school) or never)
    return ordered[0] if ordered else None


class _Crawl:
    def __init__(self, school: str, state: dict[str, Any]) -> None:
        self.school = school
        self.state = state
        self.terms = search_terms(school)

    def step(self) -> int:
        state = self.state
        found = 0
        if state["job"] is not None:
            job = _job(state["job"])
            if job is not None and job["state"] in _WAITING:
                return 0
            state["job"] = None
            result = (job or {}).get("result") or {}
            if job is not None and job["state"] == "succeeded" and not result.get("hidden"):
                found = self._absorb(result)
            else:
                self._failed(job)
            _save(self.school, state)
        if _rested_until.get(self.school, 0) <= time.monotonic():
            self._request_next()
        return found

    def _request_next(self) -> None:
        state = self.state
        if state["reading"] is None:
            if not state["seeded"]:
                school = school_service.get_school_by_id(state["school_id"])
                own_id = school.recipient_id if school is not None else None
                state["reading"] = _reading(school_account_username(self.school), own_id)
            elif state["queue"] and state["streak"] < CONTROL.crawl_miss_streak:
                username, user_id = state["queue"].pop(0)
                state["reading"] = _reading(username, user_id)
            else:
                _finish(self.school, state)
                return
        reading = state["reading"]
        arguments = [
            "following",
            f"--school={self.school}",
            f"--crawl={state['crawl_id']}",
            f"--username={reading['seed']}",
        ]
        if reading["user_id"]:
            arguments.append(f"--user-id={reading['user_id']}")
        if reading["max_id"]:
            arguments.append(f"--max-id={reading['max_id']}")
        state["job"] = _browser(*arguments)["job_id"]
        _save(self.school, state)

    def _absorb(self, page: dict[str, Any]) -> int:
        """Take one read page in; returns how many candidates it added."""
        state = self.state
        reading = state["reading"]
        reading["user_id"] = page["user_id"]
        reading["pages"] += 1
        state["failed_in_a_row"] = 0
        if state["seeded"]:
            new = self._judge(reading["seed"], page["users"])
            reading["new"] += new
        else:
            new = 0
            self._take_clubs(page["users"])
        if page["next_max_id"] and reading["pages"] < CONTROL.crawl_list_page_limit:
            reading["max_id"] = page["next_max_id"]
            return new
        state["reading"] = None
        if not state["seeded"]:
            # A new order each crawl, so the miss streak never ends every crawl at the
            # same clubs.
            random.shuffle(state["queue"])
            state["seeded"] = True
            return new
        state["done"].append(reading["seed"])
        state["visited"] += 1
        state["found"] += reading["new"]
        state["streak"] = 0 if reading["new"] else state["streak"] + 1
        _record_progress(state)
        return new

    def _take_clubs(self, users: list[dict[str, Any]]) -> None:
        """The school's own list: whom it follows, and its public clubs as seeds."""
        state = self.state
        followed = set(state["followed"])
        for user in users:
            if user["username"] in followed:
                continue
            followed.add(user["username"])
            state["followed"].append(user["username"])
            if not user["is_private"] and not is_wat2do_account(user["username"]):
                state["queue"].append([user["username"], user["pk"]])

    def _judge(self, seed: str, users: list[dict[str, Any]]) -> int:
        """Record the accounts a club follows that the school does not; returns how many
        became candidates."""
        state = self.state
        school_id = state["school_id"]
        if state["reading"]["pages"] == 1 or school_id not in _known:
            _known[school_id] = candidates.known_handles(school_id)
        known = _known[school_id]
        followed = set(state["followed"])
        new = 0
        with closing(_sightings()) as db, db:
            for user in users:
                handle = user["username"]
                if handle in followed or handle in known or is_wat2do_account(handle):
                    continue
                if self._names_school(handle, user["full_name"]):
                    vias = _vias(db, school_id, handle) | {seed}
                elif not user["is_private"]:
                    # Private accounts are members, not clubs: the scorer cannot read them.
                    db.execute(
                        "INSERT OR IGNORE INTO sightings VALUES (?, ?, ?)",
                        (school_id, handle, seed),
                    )
                    vias = _vias(db, school_id, handle)
                    if len(vias) < CONTROL.crawl_mutual_follow_threshold:
                        continue
                else:
                    continue
                candidates.add_candidate(
                    school_id,
                    handle,
                    source=FOLLOW_SOURCE_CRAWL,
                    name=user["full_name"],
                    found_via=sorted(vias),
                )
                db.execute(
                    "DELETE FROM sightings WHERE school_id = ? AND handle = ?", (school_id, handle)
                )
                known.add(handle)
                new += 1
        return new

    def _names_school(self, username: str, name: str) -> bool:
        text = f"{username} {name}".casefold()
        return any(term in text for term in self.terms)

    def _failed(self, job: dict[str, Any] | None) -> None:
        """A page that could not be read is tried again; it is never a miss."""
        state = self.state
        reading = state["reading"]
        seed = reading["seed"]
        if job is None:
            why = "its read is gone"
        elif job["state"] == "succeeded":
            why = "Instagram does not show it"
        else:
            why = job.get("error") or job["state"]
        log.warning("Follow crawl %s could not read %s: %s", self.school, seed, why)
        state["failed_in_a_row"] += 1
        failures = state["failures"]
        failures[seed] = failures.get(seed, 0) + 1
        if state["seeded"] and failures[seed] >= CONTROL.crawl_seed_attempts:
            # The school's own list is needed to crawl at all, so only a seed gives up.
            state["found"] += reading["new"]
            state["reading"] = None
        if state["failed_in_a_row"] >= CONTROL.failures_before_rest:
            # A run of failures usually means Instagram is refusing these reads for now.
            _rested_until[self.school] = time.monotonic() + CONTROL.rest_seconds


def _reading(seed: str, user_id: str | None) -> dict[str, Any]:
    return {"seed": seed, "user_id": user_id, "max_id": None, "pages": 0, "new": 0}


def _vias(db: sqlite3.Connection, school_id: int, handle: str) -> set[str]:
    rows = db.execute(
        "SELECT via FROM sightings WHERE school_id = ? AND handle = ?", (school_id, handle)
    )
    return {row[0] for row in rows}


def _sightings() -> sqlite3.Connection:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(STATE_DIRECTORY / SIGHTINGS_FILE)
    db.execute(
        "CREATE TABLE IF NOT EXISTS sightings ("
        "school_id INTEGER NOT NULL, handle TEXT NOT NULL, via TEXT NOT NULL, "
        "PRIMARY KEY (school_id, handle, via)) WITHOUT ROWID"
    )
    return db


def _browser(*arguments: str) -> dict[str, Any]:
    """Ask the Brave worker's queue through its installed binary; its JSON answer."""
    completed = subprocess.run(
        [str(INSTAGRAM_BROWSER_BINARY), *arguments],
        capture_output=True,
        text=True,
        timeout=_BROWSER_TIMEOUT_SECONDS,
    )
    if completed.returncode:
        raise BrowserQueueError(completed.stderr.strip() or f"exit {completed.returncode}")
    return json.loads(completed.stdout)


def _job(job_id: str) -> dict[str, Any] | None:
    """The queued read, or None once the queue no longer has it."""
    try:
        return _browser("status", f"--job-id={job_id}")
    except BrowserQueueError as exc:
        if _MISSING_JOB in str(exc):
            return None
        raise


def _school_id(school: str) -> int:
    school_id = school_service.get_school_id(school)
    if school_id is None:
        raise ValueError(f"School {school} is not registered")
    return school_id


def _state_path(school: str) -> Path:
    return STATE_DIRECTORY / f"{school}.json"


def _load(school: str) -> dict[str, Any]:
    path = _state_path(school)
    if path.exists():
        return json.loads(path.read_text())
    school_id = _school_id(school)
    state = {
        "crawl_id": _start_crawl(school_id),
        "school_id": school_id,
        "seeded": False,
        # Everyone the school's own list shows it follows.
        "followed": [],
        # Seeds still to read, as [username, Instagram ID].
        "queue": [],
        "done": [],
        "failures": {},
        "failed_in_a_row": 0,
        "streak": 0,
        "visited": 0,
        "found": 0,
        # The list being read, page by page, and the Brave read waited for.
        "reading": None,
        "job": None,
    }
    _save(school, state)
    return state


def _start_crawl(school_id: int) -> str:
    """Record a new crawl of the school; its ID."""
    crawl = (
        get_sb().table(INSTAGRAM_FOLLOW_CRAWLS).insert({"school_id": school_id}).execute().data[0]
    )
    return str(crawl["id"])


def _save(school: str, state: dict[str, Any]) -> None:
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    atomic_write(_state_path(school), json.dumps(state).encode())


def _record_progress(state: dict[str, Any], **extra: Any) -> None:
    get_sb().table(INSTAGRAM_FOLLOW_CRAWLS).update(
        {"visited_count": state["visited"], "found_count": state["found"], **extra}
    ).eq("id", state["crawl_id"]).execute()


def _finish(school: str, state: dict[str, Any]) -> None:
    _record_progress(
        state, status=CRAWL_FINISHED, finished_at=datetime.now(timezone.utc).isoformat()
    )
    _state_path(school).unlink(missing_ok=True)
