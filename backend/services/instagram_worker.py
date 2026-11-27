"""The one loop that drives the Instagram app on the Mac's emulator.

Every emulator job is a step of a visit to one school account. The worker picks the
account with the most urgent work, switches the app to it once, and does everything
that account needs before moving on.

The most urgent work is a sitting (``services/instagram_sessions/sitting.py``): from the
morning start time, each school account's daily turn, in which a Claude session posts
its carousel and right away likes, reposts, sets the song, tags and shares the story
for it, then drafts its DM replies; and any carousel an admin posted outside a sitting.
While a sitting is due, unfollows and follows stop between profiles for it, for a
notification run waiting for the emulator (``instagram_sessions/notification.py``), and
for the daily reclaim, which restarts the emulator before the morning's sittings.
Follows happen only during the control box's follow hours. The emulator's lock is held
for one visit at a time, and one failing step never stops the others. An account the
app cannot switch to rests while the others go on, and so do an account's follows once
its profiles keep failing; switches failing in a row restart the emulator, whose
Android stalls after long uptimes. A visit that fails outright, such as while the
emulator restarts, is tried again after a short wait, so the worker itself never stops.

The same process runs the follow crawl in its own thread (``crawl.run_forever``). It
never touches the emulator: the Brave worker reads the Following lists, and the
accounts it finds are scored in the background, one scoring run at a time.
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
from services.instagram_emulator.device import (
    CONTROL,
    AccountNotSwitched,
    EmulatorDevice,
    EmulatorError,
    exclusive,
    log_restart,
    reclaim_due,
)
from services.instagram_follow import candidates, crawl, follows, scoring
from services.instagram_sessions import notification, sitting

log = logging.getLogger(__name__)
FOLLOW = controlbox.instagram_follow

# Clubs added to the database since the last sync join the follow queue this often.
_CLUB_SYNC_INTERVAL = timedelta(hours=1)


def run_forever() -> None:
    threading.Thread(target=_crawl_forever, name="instagram-follow-crawl", daemon=True).start()
    device = EmulatorDevice()
    synced_at: datetime | None = None
    while True:
        now = datetime.now(timezone.utc)
        if synced_at is None or now - synced_at >= _CLUB_SYNC_INTERVAL:
            _step("club sync", candidates.sync_club_targets)
            synced_at = now
        if not _step("visit", lambda: visit_next(device)):
            time.sleep(CONTROL.idle_seconds)


def _crawl_forever() -> None:
    """The follow crawl's thread: a crawl that stops for any reason is logged and
    started again after a rest, so it never dies quietly."""
    while True:
        try:
            crawl.run_forever(_score_in_background)
        except Exception:
            log.exception("The follow crawl stopped; starting it again")
        time.sleep(FOLLOW.rest_seconds)


def visit_next(device: EmulatorDevice, now: datetime | None = None) -> bool:
    """Visit the account with the most urgent work; False when nothing is due anywhere.

    Each kind of work is looked up only when nothing more urgent is due, so a song
    never waits on the database questions about follows.
    """
    moment = (now or datetime.now(timezone.utc)).astimezone()
    following = following_hours(moment)
    order = [
        school
        for school in _visit_order(_current_user(device))
        if _switch_rested_until.get(school, moment) <= moment
    ]

    tiers: list[Callable[[], list[str]]] = [lambda: _sittings_due(moment)]
    if following:
        tiers.append(
            lambda: [
                school
                for school in order
                if _follows_rested_until.get(school, moment) <= moment
                and (follows.unfollows_due(school) or follows.follows_due(school))
            ]
        )
    for due in tiers:
        schools = due()
        if schools:
            visit(device, schools[0], following=following, now=moment)
            return True
    return False


def visit(
    device: EmulatorDevice,
    school: str,
    *,
    following: bool,
    now: datetime,
) -> None:
    """Switch to the school's account once and do everything it needs."""
    with exclusive():
        device.wake()
        device.reclaim_data()
        if not _switched(device, school, now):
            return
        sittings = _sittings_due(now)
        if school in sittings:
            _step(f"sitting {school}", lambda: sitting.run(device, school, now))
            return
        # Another account's sitting comes before anything else here.
        if sittings:
            return
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
            if visits and not interrupt.seen and _follows_stuck(visits):
                # The next try waits instead of looping here.
                _follows_rested_until[school] = now + timedelta(seconds=FOLLOW.rest_seconds)


def _follows_stuck(visits: list[object]) -> bool:
    """Whether the visit's unfollows and follows stopped on profiles that kept failing,
    or got nothing through at all."""
    done = [visit for visit in visits if isinstance(visit, follows.FollowVisit)]
    return any(visit.failing for visit in done) or not any(
        visit.followed or visit.confirmed for visit in done
    )


def _sittings_due(now: datetime) -> list[str]:
    """Schools whose sitting is due, leaving out any account the app could not switch
    to, so one unreachable account never holds up the others' work."""
    return [school for school in sitting.due(now) if _switch_rested_until.get(school, now) <= now]


class _Interrupt:
    """True once the emulator is needed for something more urgent than the visit's long
    steps: a sitting that is due, a notification run waiting for the emulator, or the
    daily reclaim and restart. Unfollows and follows ask it between profiles and stop
    for it."""

    def __init__(self) -> None:
        self.seen = False

    def __call__(self) -> bool:
        try:
            self.seen = (
                bool(_sittings_due(datetime.now(timezone.utc)))
                or notification.waiting()
                or reclaim_due()
            )
        except Exception:
            log.exception("Could not check for a sitting that is due")
        return self.seen


def following_hours(moment: datetime) -> bool:
    return CONTROL.follow_start_hour <= moment.hour < CONTROL.follow_end_hour


_scoring = threading.Lock()
# A step that made no progress on an account waits this long before the worker tries
# it there again, so one stuck account never keeps the worker to itself.
_follows_rested_until: dict[str, datetime] = {}
_switch_rested_until: dict[str, datetime] = {}
_switch_failures = 0
# Why each failed switch in the current run of failures failed, for the restart log.
_switch_errors: list[str] = []


def _switched(device: EmulatorDevice, school: str, now: datetime) -> bool:
    """Switch the app to the school's account, or rest the account when that fails.

    Failed switches in a row restart the emulator: by then Android itself has
    usually stalled ("Process system isn't responding") and no account can be reached.
    A switch the app answered but that never reached the account only rests it.
    """
    global _switch_failures
    user = CONTROL.android_user_by_school[school]
    try:
        device.use_android_user(user)
        device.use_account(user, school_account_username(school))
    except EmulatorError as exc:
        if not device.system_ready():
            # Android is still starting: no switch can work yet, the account is not to
            # blame, and a restart would only start the wait over.
            log.warning("Android is still starting; %s waits", school)
            time.sleep(CONTROL.screen_wait_seconds)
            return False
        log.exception("Could not switch the emulator to %s", school)
        _switch_rested_until[school] = now + timedelta(seconds=CONTROL.switch_rest_seconds)
        if isinstance(exc, AccountNotSwitched):
            # The emulator answered every step; restarting it cannot bring the account back.
            return False
        if device.on_challenge(user):
            # Instagram holds the account the app is on behind a checkpoint that comes
            # back on every start; only a person can clear it, so a restart never helps.
            log.warning(
                "Instagram shows a challenge on Android user %s; %s waits for a person",
                user,
                school,
            )
            return False
        _switch_failures += 1
        _switch_errors.append(f"{school} (Android user {user}): {exc}")
        if _switch_failures >= CONTROL.switch_failures_before_restart and _restart_helps(device):
            _switch_failures = 0
            log_restart(" | ".join(_switch_errors))
            _switch_errors.clear()
            _step("emulator restart", device.restart)
        return False
    _switch_failures = 0
    _switch_errors.clear()
    return True


def _restart_helps(device: EmulatorDevice) -> bool:
    """Whether Android has been up long enough that failed switches mean it stalled.

    For a while after a boot Android is still starting and its own process can stop
    answering for minutes, and a restart then only starts that over (2026-11-23, after
    the Mac restarted: the emulator restarted every 5 to 15 minutes for three hours).
    """
    try:
        return device.uptime_seconds() >= CONTROL.restart_min_uptime_seconds
    except EmulatorError:
        # Android answers no command at all: a restart is the one thing left to try.
        return True


def _score_in_background() -> None:
    """Score newly found accounts without holding up the crawl; one run at a time."""
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
