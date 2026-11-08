"""The one loop that drives the Instagram app on the Mac's emulator.

Every emulator job is a step of a visit to one school account. The worker picks the
account with the most urgent work, switches the app to it once, and does everything
that account needs before moving on: the song, like and repost for its new carousels,
its DMs, its unfollows and follows, and, when no other account is waiting, a slice of
its crawl.

A new carousel gets its song as soon as possible, at any hour: while any account's
carousel waits, visits do nothing but songs, and unfollows, follows and crawl slices
stop between profiles for one, or for the daily reclaim, which restarts the emulator
before the morning's carousels publish.
Replies happen only during the control box's action hours, follows only during its
follow hours. The emulator's lock is held for one visit at a time, and one failing
step never stops the others. An account the app cannot switch to rests while the
others go on, and switches failing in a row restart the emulator, whose Android
stalls after long uptimes.
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
from services.instagram_accounts import school_account_username
from services.instagram_dms import sweep
from services.instagram_emulator.device import (
    CONTROL,
    EmulatorDevice,
    EmulatorError,
    exclusive,
    reclaim_due,
)
from services.instagram_follow import candidates, crawl, follows, scoring
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
    following = following_hours(moment)
    order = [
        school
        for school in _visit_order(_current_user(device))
        if _switch_rested_until.get(school, moment) <= moment
    ]
    waiting = _songs_waiting(moment)
    tiers: list[tuple[list[str], bool]] = [
        ([school for school in order if school in waiting], False)
    ]
    if acting:
        tiers.append(([school for school in order if sweep.due(school, moment)], False))
    if following:
        tiers.append(
            (
                [
                    school
                    for school in order
                    if _follows_rested_until.get(school, moment) <= moment
                    and (follows.unfollows_due(school) or follows.follows_due(school))
                ],
                False,
            )
        )
    crawls = (_crawl_order(order, moment), True)
    # The crawl runs around the clock: it takes every other visit while follows,
    # unfollows or DMs are also waiting, rather than only when nothing else is due.
    if _last_visit_crawled:
        tiers.append(crawls)
    else:
        tiers.insert(1, crawls)
    for schools, crawling in tiers:
        if schools:
            visit(
                device,
                schools[0],
                acting=acting,
                following=following,
                crawl_slice=crawling,
                now=moment,
            )
            return True
    return False


_last_visit_crawled = False


def visit(
    device: EmulatorDevice,
    school: str,
    *,
    acting: bool,
    following: bool,
    crawl_slice: bool,
    now: datetime,
) -> None:
    """Switch to the school's account once and do everything it needs."""
    global _last_visit_crawled
    _last_visit_crawled = crawl_slice
    crawled = False
    with exclusive():
        device.wake()
        device.reclaim_data()
        if not _switched(device, school, now):
            return
        waiting = _songs_waiting(now)
        if school in waiting:
            _step(f"music {school}", lambda: music.finish_due(device, school, now))
        # Other accounts' carousels waiting for their songs come before anything else here.
        if waiting - {school}:
            return
        if acting and sweep.due(school, now):
            _step(f"dms {school}", lambda: sweep.answer(device, school))
        interrupt = _Interrupt()
        if following and _follows_rested_until.get(school, now) <= now:
            limit = CONTROL.follows_per_visit
            visits = []
            if follows.unfollows_due(school):
                visits.append(
                    _step(
                        f"unfollows {school}",
                        lambda: follows.unfollow_due(device, school, limit, stop=interrupt),
                    )
                )
            if not interrupt.seen and follows.follows_due(school):
                visits.append(
                    _step(
                        f"follows {school}",
                        lambda: follows.follow_due(device, school, limit, stop=interrupt),
                    )
                )
            if (
                visits
                and not interrupt.seen
                and not any(
                    isinstance(done, follows.FollowVisit) and (done.followed or done.confirmed)
                    for done in visits
                )
            ):
                # Nothing went through, so the next try waits instead of looping here.
                _follows_rested_until[school] = now + timedelta(seconds=FOLLOW.crawl_rest_seconds)
        if crawl_slice and not interrupt.seen:
            deadline = time.monotonic() + CONTROL.crawl_slice_minutes * 60
            outcome = _step(
                f"crawl {school}",
                lambda: crawl.crawl_slice(device, school, deadline, stop=interrupt),
            )
            if (
                outcome != crawl.CRAWL_FINISHED
                and time.monotonic() < deadline
                and not interrupt.seen
            ):
                # The slice gave up early, usually because profiles kept failing to load.
                _crawl_rested_until[school] = now + timedelta(seconds=FOLLOW.crawl_rest_seconds)
            crawled = True
    if crawled:
        _score_in_background()


def _songs_waiting(now: datetime) -> set[str]:
    """Schools whose new carousel waits for its song, leaving out any account the app
    could not switch to, so one unreachable account never holds up the others' work."""
    return {
        school for school in music.schools_due(now) if _switch_rested_until.get(school, now) <= now
    }


class _Interrupt:
    """True once the emulator is needed for something more urgent than the visit's long
    steps: a carousel waiting for its song, or the daily reclaim and restart. Unfollows,
    follows and crawl slices ask it between profiles and stop for it."""

    def __init__(self) -> None:
        self.seen = False

    def __call__(self) -> bool:
        try:
            self.seen = bool(_songs_waiting(datetime.now(timezone.utc))) or reclaim_due()
        except Exception:
            log.exception("Could not check for carousels waiting for a song")
        return self.seen


def _crawl_order(order: list[str], now: datetime) -> list[str]:
    """Schools whose crawl is due, a crawl already under way first so one finishes
    before the next starts; a crawl resting after failures waits its turn."""
    due = [
        school
        for school in order
        if _crawl_rested_until.get(school, now) <= now and crawl.crawl_due(school, now)
    ]
    running = [school for school in due if crawl.crawl_running(school)]
    if running:
        return running
    # Never-crawled schools first, then the one crawled longest ago.
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(due, key=lambda school: crawl.last_crawl_started(school) or oldest)


def acting_hours(moment: datetime) -> bool:
    return CONTROL.action_start_hour <= moment.hour < CONTROL.action_end_hour


def following_hours(moment: datetime) -> bool:
    return CONTROL.follow_start_hour <= moment.hour < CONTROL.follow_end_hour


_scoring = threading.Lock()
# A step that made no progress on an account waits this long before the worker tries
# it there again, so one stuck account never keeps the worker to itself.
_crawl_rested_until: dict[str, datetime] = {}
_follows_rested_until: dict[str, datetime] = {}
_switch_rested_until: dict[str, datetime] = {}
_switch_failures = 0


def _switched(device: EmulatorDevice, school: str, now: datetime) -> bool:
    """Switch the app to the school's account, or rest the account when that fails.

    Failed switches in a row restart the emulator: by then Android itself has
    usually stalled ("Process system isn't responding") and no account can be reached.
    """
    global _switch_failures
    user = CONTROL.android_user_by_school[school]
    try:
        device.use_android_user(user)
        device.use_account(user, school_account_username(school))
    except EmulatorError:
        log.exception("Could not switch the emulator to %s", school)
        _switch_rested_until[school] = now + timedelta(seconds=CONTROL.switch_rest_seconds)
        _switch_failures += 1
        if _switch_failures >= CONTROL.switch_failures_before_restart:
            _switch_failures = 0
            _step("emulator restart", device.restart)
        return False
    _switch_failures = 0
    return True


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
