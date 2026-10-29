"""Find school clubs a school account should follow, through the clubs it already follows.

A crawl searches the school account's own Following list for the school's names; the
clubs it finds are the first seeds. For each seed it searches that seed's Following
list for the same names: an account we don't follow is a candidate, and every match,
followed or not, joins the queue. A seed is productive when it turns up an account
the school has no row for yet, so an account an admin rejected is never offered
again. The crawl stops once ``crawl_miss_streak`` seeds in a row turn up nothing new.

Crawls take hours, so the emulator worker advances them in slices between its other
jobs: ``crawl_slice`` works until a deadline and keeps its place in local state.
A profile that fails to load says nothing about the seed, so it is retried later and
never counts as a miss.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.constants import FOLLOW_SOURCE_CRAWL
from core.controlbox import controlbox
from core.database import get_sb
from core.launch_agents import atomic_write
from core.tables import INSTAGRAM_FOLLOW_CRAWLS
from services import school_service
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.following import FollowingReader
from services.instagram_follow import candidates

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_follow
STATE_DIRECTORY = Path.home() / ".local/state/wat2do/instagram-follow-crawl"

CRAWL_RUNNING = "running"
CRAWL_FINISHED = "finished"


def search_terms(school: str) -> list[str]:
    return [school, *CONTROL.school_names.get(school, [])]


def crawl_due(school: str, now: datetime | None = None) -> bool:
    """Whether the school has a crawl under way, or none started within the interval."""
    if _state_path(school).exists():
        return True
    school_id = _school_id(school)
    latest = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CRAWLS)
        .select("started_at")
        .eq("school_id", school_id)
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    ).data
    if not latest:
        return True
    started = datetime.fromisoformat(latest[0]["started_at"])
    now = now or datetime.now(timezone.utc)
    return now - started >= timedelta(days=CONTROL.crawl_interval_days)


def crawl_slice(device: EmulatorDevice, school: str, deadline: float) -> str:
    """Advance the school's crawl until ``deadline`` (``time.monotonic``) or its end.

    The caller has switched the emulator to the school's account and holds its lock.
    Returns ``running`` when the deadline came first, ``finished`` when the crawl ended.
    New candidates are recorded as they are found; scoring them is the caller's next step.
    """
    state = _load(school)
    reader = FollowingReader(
        device,
        EMULATOR.android_user_by_school[school],
        profile_wait_seconds=CONTROL.crawl_profile_wait_seconds,
        max_scrolls=CONTROL.crawl_max_scrolls,
    )
    crawler = _Crawler(school, state, reader)
    if not state["seeded"]:
        crawler.visit(f"wat2do.{school}")
        state["seeded"] = True
        _save(school, state)
    failed_in_a_row = 0
    while state["queue"] and state["streak"] < CONTROL.crawl_miss_streak:
        if time.monotonic() >= deadline:
            return CRAWL_RUNNING
        seed = state["queue"].pop(0)
        try:
            new = crawler.visit(seed)
        except EmulatorError as exc:
            failed_in_a_row += 1
            failures = state["failures"]
            failures[seed] = failures.get(seed, 0) + 1
            if failures[seed] < CONTROL.crawl_seed_attempts:
                state["queue"].append(seed)
            log.warning("Follow crawl %s could not read %s: %s", school, seed, exc)
            _save(school, state)
            if failed_in_a_row >= CONTROL.crawl_failures_before_rest:
                # A run of failures usually means Instagram is slow for this account.
                return CRAWL_RUNNING
            continue
        failed_in_a_row = 0
        state["visited"] += 1
        state["found"] += new
        state["streak"] = 0 if new else state["streak"] + 1
        _save(school, state)
        _record_progress(state)
    _finish(school, state)
    return CRAWL_FINISHED


class _Crawler:
    def __init__(self, school: str, state: dict[str, Any], reader: FollowingReader) -> None:
        self.school = school
        self.school_id = state["school_id"]
        self.state = state
        self.reader = reader
        self.terms = search_terms(school)
        self.known = candidates.known_handles(self.school_id)

    def visit(self, seed: str) -> int:
        """Search one profile's Following list; returns how many new accounts it found."""
        rows = self.reader.search_following(seed, self.terms)
        if rows is None:
            return 0
        state = self.state
        queued = set(state["queue"]) | set(state["done"])
        state["done"].append(seed)
        new = 0
        for row in rows:
            if row.username == f"wat2do.{self.school}" or not self._matches(row.username, row.name):
                continue
            if not row.followed and row.username not in self.known:
                candidates.add_candidate(
                    self.school_id,
                    row.username,
                    source=FOLLOW_SOURCE_CRAWL,
                    name=row.name,
                    found_via=[seed],
                )
                self.known.add(row.username)
                new += 1
            if row.username not in queued:
                state["queue"].append(row.username)
                queued.add(row.username)
        return new

    def _matches(self, username: str, name: str) -> bool:
        text = f"{username} {name}".casefold()
        return any(term in text for term in self.terms)


def _school_id(school: str) -> int:
    school_id = school_service.get_school_id(school)
    if school_id is None:
        raise EmulatorError(f"School {school} is not registered")
    return school_id


def _state_path(school: str) -> Path:
    return STATE_DIRECTORY / f"{school}.json"


def _load(school: str) -> dict[str, Any]:
    path = _state_path(school)
    if path.exists():
        return json.loads(path.read_text())
    school_id = _school_id(school)
    crawl = (
        get_sb().table(INSTAGRAM_FOLLOW_CRAWLS).insert({"school_id": school_id}).execute().data[0]
    )
    state = {
        "crawl_id": crawl["id"],
        "school_id": school_id,
        "seeded": False,
        "queue": [],
        "done": [],
        "failures": {},
        "streak": 0,
        "visited": 0,
        "found": 0,
    }
    _save(school, state)
    return state


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
