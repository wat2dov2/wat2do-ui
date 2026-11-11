"""Find school clubs a school account should follow, through the clubs it already follows.

A crawl reads the school account's own Following list first: every public account the
school follows is one of its clubs, and each is a seed. It then reads each seed's whole
Following list. A public account the school does not follow and has no row for becomes
a pending candidate when its handle or name carries one of the school's names as a word
(``names_school``), or once ``crawl_mutual_follow_threshold`` of the school's followed
clubs follow it. Those sightings are kept in local state across crawls, so a club
several seeds follow is found even when no single crawl reaches them all; a sighting
not seen again for ``crawl_sighting_retention_days`` is forgotten. A private account is
never a candidate: it is almost always a member, and the scorer cannot read it. A
candidate is read in turn by a later crawl, once the school follows it. A seed is
productive when it turns up an account the school has no row for yet, so an account an
admin rejected is never offered again. The crawl ends once ``crawl_miss_streak`` seeds
in a row turn up nothing new, or when no seed is left.

Crawling never stops. A crawl under way goes first, then schools never crawled, then
the school whose last crawl finished longest ago (``last_crawl_finished``), so a school
whose crawl ends is crawled again once the schools that finished before it have had
their turn. Each crawl starts over from the school's own Following list, so it also
reads the clubs the school followed since and finds accounts created since, and takes
the seeds in a new random order, so a crawl the miss streak ends early still reaches
clubs the last one never did.

The lists are read through the Mac's Brave worker (``wat2do-browser following``), one
page per job, as whichever account Brave shows: the worker paces the reads, holds only
them after a 429, a login wall or any other refusal, and stops them alone while
``wat2do-browser pause-following`` is in force; a hold or a pause simply keeps the
crawl waiting. The crawl keeps one read outstanding per school, keeps its place in
local state, and checks on a waiting read from ``crawl_poll_seconds`` apart up to
``crawl_poll_max_seconds`` apart, from its own thread of the emulator worker's process
(``run_forever``). A page that fails to read is tried again, up to
``crawl_seed_attempts`` times, and never counts as a miss; ``failures_before_rest``
failures in a row rest that school's crawl, and so does a read still waiting after
``crawl_read_timeout_seconds`` while Brave holds nothing, so one stuck school never
stalls the others. A resting crawl's outstanding read is still collected. A read an
operator cancelled stays cancelled: its seed is given up.
"""

from __future__ import annotations

import json
import logging
import random
import re
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
# Accounts seen in the school's clubs' lists that are not candidates yet, which clubs
# follow them and when each was last seen. An account leaves once it becomes a candidate.
SIGHTINGS_FILE = "sightings.sqlite3"

CRAWL_FINISHED = "finished"
_WAITING = ("pending", "running")
_BROWSER_TIMEOUT_SECONDS = 60
_MISSING_JOB = "job does not exist"
# Letters only: handles and names split on dots, underscores, hyphens, spaces and digits.
_WORD = re.compile(r"[^\W\d_]+")
# A school name this long is distinctive enough to start or end a run-together word.
_WORD_EDGE_LETTERS = 6
# Every key a crawl's local state holds; state without them is from an older crawler.
_STATE_KEYS = frozenset(
    {
        "crawl_id",
        "school_id",
        "seeded",
        "followed",
        "queue",
        "done",
        "failures",
        "failed_in_a_row",
        "streak",
        "visited",
        "found",
        "reading",
        "job",
        "job_queued_at",
    }
)

# A school whose reads keep failing or stay stuck waits until then (time.monotonic).
_rested_until: dict[str, float] = {}
# Each school's handles with a row, read again whenever a seed's list starts.
_known: dict[int, set[str]] = {}
# When each waiting read is next checked, and the gap after that (time.monotonic).
_next_check: dict[str, tuple[float, float]] = {}


class BrowserQueueError(RuntimeError):
    """The Brave worker's queue refused a request."""


def search_terms(school: str) -> list[str]:
    return [school, *CONTROL.school_names.get(school, [])]


def names_school(school: str, handle: str, name: str | None) -> bool:
    """Whether the handle or name carries one of the school's names as a word.

    Handles and names split into words at dots, underscores, hyphens, spaces,
    apostrophes and digits, so a short name such as "mac" or "dal" matches only a word
    of its own, and a name written as several words ("Ted Rogers") matches one written
    as one ("tedrogers"). The school's slug, and any name of at least
    ``_WORD_EDGE_LETTERS`` letters, may also start or end a word, since handles run words
    together (``utmmsa``, ``laurieritalianclub``).
    """
    words = _WORD.findall(f"{handle} {name or ''}".casefold())
    for term in search_terms(school):
        compact = "".join(_WORD.findall(term.casefold()))
        if any(_words_spell(words[index:], compact) for index in range(len(words))):
            return True
        edge = term == school or len(compact) >= _WORD_EDGE_LETTERS
        if edge and any(word.startswith(compact) or word.endswith(compact) for word in words):
            return True
    return False


def _words_spell(words: list[str], term: str) -> bool:
    """Whether the first words, run together, spell exactly the term."""
    spelled = ""
    for word in words:
        spelled += word
        if len(spelled) >= len(term):
            return spelled == term
    return False


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
    """Keep crawling; ``on_found`` runs after new candidates. A failing step rests."""
    while True:
        try:
            if advance():
                on_found()
        except Exception:
            log.exception("Follow crawl step failed")
            time.sleep(CONTROL.rest_seconds)
            continue
        time.sleep(CONTROL.crawl_poll_seconds)


def advance() -> int:
    """Collect what resting crawls' reads returned, then take the next step of the crawl
    whose turn it is. Returns how many candidates were added."""
    now = time.monotonic()
    found = 0
    for school in EMULATOR.android_user_by_school:
        if _rested_until.get(school, 0) > now and crawl_running(school):
            found += _Crawl(school, _load(school)).step(request=False)
    school = next_school()
    if school is not None:
        found += _Crawl(school, _load(school)).step()
    return found


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

    def step(self, *, request: bool = True) -> int:
        """Collect the outstanding read if it finished, then (with ``request``) queue the
        next. Returns how many candidates the collected page added."""
        state = self.state
        found = 0
        if state["job"] is not None:
            if not _check_due(state["job"]):
                return 0
            job = _job(state["job"])
            if job is not None and job["state"] in _WAITING:
                self._waiting()
                return 0
            _next_check.pop(state["job"], None)
            state["job"] = None
            result = (job or {}).get("result") or {}
            if job is not None and job["state"] == "succeeded" and not result.get("hidden"):
                found = self._absorb(result)
            elif job is not None and job["state"] == "cancelled":
                self._cancelled()
            else:
                self._failed(job)
            _save(self.school, state)
        if request and _rested_until.get(self.school, 0) <= time.monotonic():
            self._request_next()
        return found

    def _waiting(self) -> None:
        """A read that waits too long while Brave holds nothing rests this school."""
        waited = time.time() - self.state["job_queued_at"]
        if waited > CONTROL.crawl_read_timeout_seconds and not _brave_holding():
            log.warning("Follow crawl %s rests: its read has waited %d s", self.school, int(waited))
            _rested_until[self.school] = time.monotonic() + CONTROL.rest_seconds

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
        state["job_queued_at"] = time.time()
        _save(self.school, state)

    def _absorb(self, page: dict[str, Any]) -> int:
        """Take one read page in; returns how many candidates it added."""
        state = self.state
        reading = state["reading"]
        reading["user_id"] = page["user_id"]
        reading["pages"] += 1
        state["failed_in_a_row"] = 0
        if page["invalid"]:
            log.warning(
                "Follow crawl %s dropped %d unreadable accounts listed by %s",
                self.school,
                page["invalid"],
                reading["seed"],
            )
        if state["seeded"]:
            new = self._judge(reading["seed"], page["users"])
            reading["new"] += new
        else:
            new = 0
            self._take_clubs(page["users"])
        # The school's own list is read to its end: every club on it is a seed.
        deeper = not state["seeded"] or reading["pages"] < CONTROL.crawl_list_page_limit
        if page["next_max_id"] and deeper:
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
        """Record the public accounts a club follows that the school does not; returns
        how many became candidates."""
        state = self.state
        school_id = state["school_id"]
        if state["reading"]["pages"] == 1 or school_id not in _known:
            _known[school_id] = candidates.known_handles(school_id)
        known = _known[school_id]
        followed = set(state["followed"])
        now = time.time()
        new = 0
        with closing(_sightings()) as db, db:
            for user in users:
                handle = user["username"]
                if (
                    user["is_private"]
                    or handle in followed
                    or handle in known
                    or is_wat2do_account(handle)
                ):
                    continue
                db.execute(
                    "INSERT INTO sightings VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE "
                    "SET last_seen = excluded.last_seen",
                    (school_id, handle, seed, now),
                )
                vias = _vias(db, school_id, handle)
                named = names_school(self.school, handle, user["full_name"])
                if not named and len(vias) < CONTROL.crawl_mutual_follow_threshold:
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

    def _cancelled(self) -> None:
        """An operator cancelled the read: its seed is given up, and the school's own
        list rests the crawl until it is read again."""
        state = self.state
        reading = state["reading"]
        log.warning("Follow crawl %s: the read of %s was cancelled", self.school, reading["seed"])
        if state["seeded"]:
            self._give_up()
        else:
            _rested_until[self.school] = time.monotonic() + CONTROL.rest_seconds

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
            self._give_up()
        if state["failed_in_a_row"] >= CONTROL.failures_before_rest:
            # A run of failures usually means Instagram is refusing these reads for now.
            _rested_until[self.school] = time.monotonic() + CONTROL.rest_seconds

    def _give_up(self) -> None:
        """Leave the seed unvisited: neither a visit nor a miss."""
        state = self.state
        state["found"] += state["reading"]["new"]
        state["reading"] = None


def _reading(seed: str, user_id: str | None) -> dict[str, Any]:
    return {"seed": seed, "user_id": user_id, "max_id": None, "pages": 0, "new": 0}


def _check_due(job_id: str) -> bool:
    """Whether a waiting read is due another check; each check while it waits doubles
    the gap before the next, from ``crawl_poll_seconds`` to ``crawl_poll_max_seconds``."""
    now = time.monotonic()
    due, gap = _next_check.get(job_id, (now, CONTROL.crawl_poll_seconds))
    if now < due:
        return False
    _next_check[job_id] = (now + gap, min(gap * 2, CONTROL.crawl_poll_max_seconds))
    return True


def _brave_holding() -> bool:
    """Whether the Brave worker is holding Following reads for now: stopped, paused,
    held after a refusal, or not running at all."""
    status = _browser("status")
    following = status.get("following") or {}
    held_until = following.get("held_until") or 0
    return bool(
        status.get("paused")
        or following.get("paused")
        or held_until > time.time()
        or not (status.get("worker") or {}).get("running")
    )


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
        "last_seen REAL NOT NULL, PRIMARY KEY (school_id, handle, via)) WITHOUT ROWID"
    )
    return db


def _forget_old_sightings() -> None:
    oldest = time.time() - CONTROL.crawl_sighting_retention_days * 86_400
    with closing(_sightings()) as db, db:
        db.execute("DELETE FROM sightings WHERE last_seen < ?", (oldest,))


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
        state = json.loads(path.read_text())
        if _STATE_KEYS <= state.keys():
            return state
        # A crawl an older crawler started: record what it did and start afresh.
        log.warning("Follow crawl %s: finishing a crawl kept in an older form", school)
        _finish(school, state)
    # Each new crawl first forgets sightings no crawl has seen again for long.
    _forget_old_sightings()
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
        # The list being read, page by page, and the Brave read waited for, queued then.
        "reading": None,
        "job": None,
        "job_queued_at": None,
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
