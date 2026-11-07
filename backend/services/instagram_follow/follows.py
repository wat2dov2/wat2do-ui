"""Follow the approved accounts in the queue, from the right school account.

The emulator worker asks ``follows_due`` from the database alone, then calls
``follow_due`` with the emulator already on the school's account and a small number to
follow this visit. Across the day a school account follows at most
``follows_per_account_per_day``. Each follow turns the account's post notifications to
All so ingestion hears about its posts; an account the school already follows is only
marked followed, after its bell is checked. Instagram's "Try again later" pauses the
account's follows for a day, and so do three Follow taps in a row that never stick
(Instagram's silent limit); a follow that fails otherwise stays approved for later.

Accounts waiting in ``unfollow`` (rejected, but still followed) are unfollowed the
same way, from the same daily allowance, before any new follow.
"""

from __future__ import annotations

import json
import logging
import time
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


def follows_due(school: str) -> bool:
    """Whether the school has approved accounts waiting and may follow more today."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return False
    return _allowance(school_id) > 0 and bool(candidates.approved(school_id, 1))


def unfollows_due(school: str) -> bool:
    """Whether the school has accounts to unfollow and may act on more today."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return False
    return _allowance(school_id) > 0 and bool(candidates.to_unfollow(school_id, 1))


def unfollow_due(device: EmulatorDevice, school: str, limit: int) -> FollowVisit:
    """Unfollow up to ``limit`` of the school's rejected accounts, within today's allowance."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return FollowVisit(0, 0, _blocked(school))
    reader = _reader(device, school)
    allowed = min(limit, _allowance(school_id))
    unfollowed = confirmed = 0
    for row in candidates.to_unfollow(school_id, allowed * PROFILES_PER_FOLLOW):
        if unfollowed >= allowed:
            break
        try:
            tapped = reader.unfollow(row["handle"])
        except ActionBlocked as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            _block(school)
            return FollowVisit(unfollowed, confirmed, True)
        except EmulatorError as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            continue
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
        profile_wait_seconds=CONTROL.crawl_profile_wait_seconds,
        max_scrolls=CONTROL.crawl_max_scrolls,
    )


def follow_due(device: EmulatorDevice, school: str, limit: int) -> FollowVisit:
    """Follow up to ``limit`` of the school's approved accounts, within today's allowance."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return FollowVisit(0, 0, _blocked(school))
    reader = _reader(device, school)
    # Only a real follow counts toward the visit's limit and today's allowance.
    allowed = min(limit, _allowance(school_id))
    followed = confirmed = unconfirmed = 0
    for row in candidates.approved(school_id, allowed * PROFILES_PER_FOLLOW):
        if followed >= allowed:
            break
        try:
            outcome = reader.follow(row["handle"])
        except FollowedWithoutBell as exc:
            # Counted now; it stays approved so a later visit sets its bell.
            candidates.mark_follow_failed(row["id"], str(exc), tapped=True)
            followed += 1
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
            continue
        if outcome is None:
            candidates.mark_follow_failed(row["id"], "Profile is gone or hidden")
            continue
        candidates.mark_followed(row["id"], tapped=outcome.tapped)
        unconfirmed = 0
        if outcome.tapped:
            followed += 1
        else:
            confirmed += 1
    return FollowVisit(followed, confirmed, False)


def _allowance(school_id: int) -> int:
    """Follows and unfollows share the day's allowance."""
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    used = 0
    for column in ("followed_at", "unfollowed_at"):
        response = (
            get_sb()
            .table(INSTAGRAM_FOLLOW_CANDIDATES)
            .select("id", count="exact")
            .eq("school_id", school_id)
            .gte(column, midnight.isoformat())
            .limit(1)
            .execute()
        )
        used += response.count or 0
    return CONTROL.follows_per_account_per_day - used


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
