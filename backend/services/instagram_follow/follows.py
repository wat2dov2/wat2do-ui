"""Follow the approved accounts in the queue, from the right school account.

The emulator worker asks ``follows_due`` from the database alone, then calls
``follow_due`` with the emulator already on the school's account and a small number to
follow this visit; the visit stops early once the worker needs the emulator for a
carousel waiting for its song. A school account follows at most
``follows_per_account_per_day`` a day and ``follows_per_account_per_hour`` within any
hour. Each follow turns the account's post notifications to All so ingestion hears
about its posts; an account the school already follows is only marked followed, after
its bell is checked. Instagram's "Try again later" pauses the account's follows for a
day, and so do three Follow taps in a row that never stick (Instagram's silent limit);
a follow that fails otherwise stays approved for later, and ``failures_before_rest``
failing in a row end the visit so the worker rests the account's follows.

Accounts waiting in ``unfollow`` (rejected, but still followed) are unfollowed the
same way, from the same daily allowance, before any new follow.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.database import get_sb
from core.launch_agents import atomic_write
from core.tables import INSTAGRAM_FOLLOW_CANDIDATES
from services import school_service
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.following import (
    ActionBlocked,
    FollowedWithoutBell,
    FollowingReader,
    FollowNotConfirmed,
)
from services.instagram_follow import candidates

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_follow
BLOCKS_PATH = Path.home() / ".local/state/wat2do/instagram-follow/blocked.json"
BLOCK_HOURS = 24


# A visit opens at most this many profiles per follow it may make, so confirming
# accounts already followed never holds the emulator for long.
PROFILES_PER_FOLLOW = 4
# Instagram sometimes limits an account without saying so: Follow taps just stop
# sticking. This many in a row pause the account's follows like "Try again later".
SILENT_BLOCK_AFTER = 3


@dataclass(frozen=True)
class FollowVisit:
    followed: int
    # Accounts the school already followed: marked followed, their bells checked.
    confirmed: int
    blocked: bool
    # Profiles kept failing, so the visit stopped; the worker rests the account's follows.
    failing: bool = False


def follows_due(school: str) -> bool:
    """Whether the school has approved accounts waiting and room for a visit's follows."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return False
    return _room_for_a_visit(school_id) and bool(candidates.approved(school_id, 1))


def unfollows_due(school: str) -> bool:
    """Whether the school has accounts to unfollow and room for a visit's unfollows."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return False
    return _room_for_a_visit(school_id) and bool(candidates.to_unfollow(school_id, 1))


def unfollow_due(
    device: EmulatorDevice,
    school: str,
    limit: int,
    *,
    stop: Callable[[], bool] | None = None,
) -> FollowVisit:
    """Unfollow up to ``limit`` of the school's rejected accounts, within today's allowance,
    until ``stop()`` says the emulator is needed for something more urgent."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return FollowVisit(0, 0, _blocked(school))
    reader = _reader(device, school)
    allowed = min(limit, _allowance(school_id))
    unfollowed = confirmed = failed = 0
    for row in candidates.to_unfollow(school_id, allowed * PROFILES_PER_FOLLOW):
        if unfollowed >= allowed or (stop is not None and stop()):
            break
        try:
            tapped = reader.unfollow(row["handle"])
        except ActionBlocked as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            _block(school)
            return FollowVisit(unfollowed, confirmed, True)
        except EmulatorError as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            failed += 1
            if failed >= CONTROL.failures_before_rest:
                return _failing(school, unfollowed, confirmed)
            continue
        failed = 0
        # A profile that is gone or hidden needs no unfollow.
        candidates.mark_unfollowed(row["id"], tapped=bool(tapped))
        if tapped:
            unfollowed += 1
        else:
            confirmed += 1
    return FollowVisit(unfollowed, confirmed, False)


def _reader(device: EmulatorDevice, school: str) -> FollowingReader:
    return FollowingReader(
        device,
        EMULATOR.android_user_by_school[school],
        profile_wait_seconds=CONTROL.profile_wait_seconds,
    )


def follow_due(
    device: EmulatorDevice,
    school: str,
    limit: int,
    *,
    stop: Callable[[], bool] | None = None,
) -> FollowVisit:
    """Follow up to ``limit`` of the school's approved accounts, within today's allowance,
    until ``stop()`` says the emulator is needed for something more urgent.

    Confirming accounts the school already follows opens a profile each, so a visit
    can run long; ``stop`` is asked before every profile.
    """
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return FollowVisit(0, 0, _blocked(school))
    reader = _reader(device, school)
    # Only a real follow counts toward the visit's limit and the allowance.
    allowed = min(limit, _allowance(school_id))
    followed = confirmed = unconfirmed = failed = 0
    for row in candidates.approved(school_id, allowed * PROFILES_PER_FOLLOW):
        if followed >= allowed or (stop is not None and stop()):
            break
        try:
            outcome = reader.follow(row["handle"])
        except FollowedWithoutBell as exc:
            # Counted now; it stays approved so a later visit sets its bell.
            candidates.mark_follow_failed(row["id"], str(exc), tapped=True)
            followed += 1
            failed = 0
            if isinstance(exc.__cause__, ActionBlocked):
                _block(school)
                return FollowVisit(followed, confirmed, True)
            continue
        except ActionBlocked as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            _block(school)
            return FollowVisit(followed, confirmed, True)
        except FollowNotConfirmed as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            unconfirmed += 1
            if unconfirmed >= SILENT_BLOCK_AFTER:
                log.warning("Follows from %s stopped sticking; pausing them", school)
                _block(school)
                return FollowVisit(followed, confirmed, True)
            continue
        except EmulatorError as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            failed += 1
            if failed >= CONTROL.failures_before_rest:
                return _failing(school, followed, confirmed)
            continue
        failed = 0
        if outcome is None:
            candidates.reject_gone(row["id"])
            continue
        candidates.mark_followed(row["id"], tapped=outcome.tapped)
        unconfirmed = 0
        if outcome.tapped:
            followed += 1
        else:
            confirmed += 1
    return FollowVisit(followed, confirmed, False)


def _failing(school: str, followed: int, confirmed: int) -> FollowVisit:
    log.warning("Profiles kept failing for %s; its follows rest", school)
    return FollowVisit(followed, confirmed, False, failing=True)


def _allowance(school_id: int) -> int:
    """Follows and unfollows share the allowance: what is left of today's, and of the
    last hour's, whichever is smaller."""
    return min(_left(school_id))


def _room_for_a_visit(school_id: int) -> bool:
    """Whether the last hour leaves room for a whole visit's follows, or for all that is
    left of today's, so the worker never switches accounts for a follow or two while
    the hour's allowance frees up one follow at a time."""
    today, hour = _left(school_id)
    whole_visit = min(EMULATOR.follows_per_visit, CONTROL.follows_per_account_per_hour, today)
    return today > 0 and hour >= whole_visit


def _left(school_id: int) -> tuple[int, int]:
    """How many follows and unfollows are left today, and within the last hour."""
    now = datetime.now().astimezone()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)
    since = min(midnight, hour_ago).isoformat()
    rows = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select("followed_at,unfollowed_at")
        .eq("school_id", school_id)
        .or_(f'followed_at.gte."{since}",unfollowed_at.gte."{since}"')
        .execute()
    ).data or []
    done = [
        datetime.fromisoformat(stamp)
        for row in rows
        for stamp in (row["followed_at"], row["unfollowed_at"])
        if stamp
    ]
    today = sum(1 for at in done if at >= midnight)
    last_hour = sum(1 for at in done if at >= hour_ago)
    return (
        CONTROL.follows_per_account_per_day - today,
        CONTROL.follows_per_account_per_hour - last_hour,
    )


def _blocks() -> dict[str, Any]:
    try:
        return json.loads(BLOCKS_PATH.read_text())
    except FileNotFoundError:
        return {}


def _blocked(school: str) -> bool:
    return time.time() < _blocks().get(school, 0)


def _block(school: str) -> None:
    blocks = _blocks()
    blocks[school] = (datetime.now() + timedelta(hours=BLOCK_HOURS)).timestamp()
    BLOCKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(BLOCKS_PATH, json.dumps(blocks).encode())
    log.warning("Instagram blocked follows from %s; pausing it for %s hours", school, BLOCK_HOURS)
