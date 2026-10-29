"""The one loop that drives the Instagram app on the Mac's emulator.

Every emulator job is a step of a visit to one school account. The worker picks the
account with the most urgent work, switches the app to it once, and does everything
that account needs before moving on: the song, like and repost for its new carousels,
its DMs, its follows, and, when no other account is waiting, a slice of its crawl.

Replies, follows and post edits happen only during the control box's action hours;
outside them the worker only reads, crawling Following lists. The emulator's lock is
held for one visit at a time, and one failing step never stops the others.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from itertools import groupby

from core.controlbox import controlbox
from services.instagram_dms import sweep
from services.instagram_emulator.device import CONTROL, EmulatorDevice, exclusive
from services.instagram_follow import candidates, crawl, follows, scoring
from services.instagram_notifications.browser_session import school_account_username
from services.instagram_publishing import music

log = logging.getLogger(__name__)
FOLLOW = controlbox.instagram_follow

# Clubs added to the database since the last sync join the follow queue this often.
_CLUB_SYNC_INTERVAL = timedelta(hours=1)


def run_forever() -> None:
    device = EmulatorDevice()
    synced_at: datetime | None = None
    while True:
        now = datetime.now(timezone.utc)
        if synced_at is None or now - synced_at >= _CLUB_SYNC_INTERVAL:
            _step("club sync", candidates.sync_club_targets)
            synced_at = now
        if not visit_next(device):
            time.sleep(CONTROL.idle_seconds)


def visit_next(device: EmulatorDevice, now: datetime | None = None) -> bool:
    """Visit the account with the most urgent work; False when nothing is due anywhere."""
    moment = (now or datetime.now(timezone.utc)).astimezone()
    acting = acting_hours(moment)
    order = _visit_order(_current_user(device))
    tiers: list[tuple[list[str], bool]] = []
    if acting:
        due_music = set(music.schools_due(moment))
        tiers += [
            ([school for school in order if school in due_music], False),
            ([school for school in order if sweep.due(school, moment)], False),
            (
                [
                    school
                    for school in order
                    if _follows_rested_until.get(school, moment) <= moment
                    and follows.follows_due(school)
                ],
                False,
            ),
        ]
    tiers.append((_crawl_order(order, moment), True))
    for schools, crawling in tiers:
        if schools:
            visit(device, schools[0], acting=acting, crawl_slice=crawling, now=moment)
            return True
    return False


def visit(
    device: EmulatorDevice,
    school: str,
    *,
    acting: bool,
    crawl_slice: bool,
    now: datetime,
) -> None:
    """Switch to the school's account once and do everything it needs."""
    user = CONTROL.android_user_by_school[school]
    crawled = False
    with exclusive():
        device.wake()
        device.reclaim_data()
        device.use_android_user(user)
        device.use_account(user, school_account_username(school))
        if acting:
            if school in music.schools_due(now):
                _step(f"music {school}", lambda: music.finish_due(device, school, now))
            if sweep.due(school, now):
                _step(f"dms {school}", lambda: sweep.answer(device, school))
            if _follows_rested_until.get(school, now) <= now and follows.follows_due(school):
                followed = _step(
                    f"follows {school}",
                    lambda: follows.follow_due(device, school, CONTROL.follows_per_visit),
                )
                if not isinstance(followed, follows.FollowVisit) or not (
                    followed.followed or followed.confirmed
                ):
                    # Nothing went through, so the next try waits instead of looping here.
                    _follows_rested_until[school] = now + timedelta(
                        seconds=FOLLOW.crawl_rest_seconds
                    )
        if crawl_slice:
            deadline = time.monotonic() + CONTROL.crawl_slice_minutes * 60
            outcome = _step(f"crawl {school}", lambda: crawl.crawl_slice(device, school, deadline))
            if outcome != crawl.CRAWL_FINISHED and time.monotonic() < deadline:
                # The slice gave up early, usually because profiles kept failing to load.
                _crawl_rested_until[school] = now + timedelta(seconds=FOLLOW.crawl_rest_seconds)
            crawled = True
    if crawled:
        _score_in_background()


def _crawl_order(order: list[str], now: datetime) -> list[str]:
    """Schools whose crawl is due, a crawl already under way first so one finishes
    before the next starts; a crawl resting after failures waits its turn."""
    due = [
        school
        for school in order
        if _crawl_rested_until.get(school, now) <= now and crawl.crawl_due(school, now)
    ]
    return sorted(due, key=lambda school: not crawl.crawl_running(school))


def acting_hours(moment: datetime) -> bool:
    return CONTROL.action_start_hour <= moment.hour < CONTROL.action_end_hour


_scoring = threading.Lock()
# A step that made no progress on an account waits this long before the worker tries
# it there again, so one stuck account never keeps the worker to itself.
_crawl_rested_until: dict[str, datetime] = {}
_follows_rested_until: dict[str, datetime] = {}


def _score_in_background() -> None:
    """Score newly found accounts without holding up the emulator; one run at a time."""
    if not _scoring.acquire(blocking=False):
        return

    def run() -> None:
        try:
            _step("scoring", scoring.score_pending)
        finally:
            _scoring.release()

    threading.Thread(target=run, name="instagram-follow-scoring", daemon=True).start()


def _step(name: str, action: Callable[[], object]) -> object:
    try:
        return action()
    except Exception:
        log.exception("Emulator worker step failed: %s", name)
        return None


def _current_user(device: EmulatorDevice) -> int | None:
    try:
        return int(device.adb("shell", "am", "get-current-user").strip())
    except Exception:
        return None


def _visit_order(current_user: int | None) -> list[str]:
    """Accounts grouped by Android user, since switching users is slow: the current user's
    accounts first, then the other users' groups in random order, each group shuffled."""
    schools = list(CONTROL.android_user_by_school)
    random.shuffle(schools)
    schools.sort(key=CONTROL.android_user_by_school.__getitem__)
    groups = [list(group) for _, group in groupby(schools, CONTROL.android_user_by_school.get)]
    random.shuffle(groups)
    groups.sort(key=lambda group: CONTROL.android_user_by_school[group[0]] != current_user)
    return [school for group in groups for school in group]
