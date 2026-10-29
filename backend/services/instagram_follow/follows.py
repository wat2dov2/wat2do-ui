"""Follow the approved accounts in the queue, from the right school account.

The emulator worker asks ``follows_due`` from the database alone, then calls
``follow_due`` with the emulator already on the school's account and a small number to
follow this visit. Across the day a school account follows at most
``follows_per_account_per_day``. Each follow turns the account's post notifications to
All so ingestion hears about its posts; an account the school already follows is only
marked followed, after its bell is checked. Instagram's "Try again later" pauses the
account's follows for a day; a follow that fails otherwise stays approved for later.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from core.constants import FOLLOW_CANDIDATE_FOLLOWED
from core.controlbox import controlbox
from core.database import get_sb
from core.launch_agents import atomic_write
from core.tables import INSTAGRAM_FOLLOW_CANDIDATES
from services import school_service
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, EmulatorError
from services.instagram_emulator.following import ActionBlocked, FollowingReader
from services.instagram_follow import candidates

log = logging.getLogger(__name__)
CONTROL = controlbox.instagram_follow
BLOCKS_PATH = Path.home() / ".local/state/wat2do/instagram-follow/blocked.json"
BLOCK_HOURS = 24


@dataclass(frozen=True)
class FollowVisit:
    followed: int
    blocked: bool


def follows_due(school: str) -> bool:
    """Whether the school has approved accounts waiting and may follow more today."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return False
    return _allowance(school_id) > 0 and bool(candidates.approved(school_id, 1))


def follow_due(device: EmulatorDevice, school: str, limit: int) -> FollowVisit:
    """Follow up to ``limit`` of the school's approved accounts, within today's allowance."""
    school_id = school_service.get_school_id(school)
    if school_id is None or _blocked(school):
        return FollowVisit(0, _blocked(school))
    reader = FollowingReader(
        device,
        EMULATOR.android_user_by_school[school],
        profile_wait_seconds=CONTROL.crawl_profile_wait_seconds,
        max_scrolls=CONTROL.crawl_max_scrolls,
    )
    followed = 0
    for row in candidates.approved(school_id, min(limit, _allowance(school_id))):
        try:
            label = reader.follow(row["handle"])
        except ActionBlocked as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            _block(school)
            return FollowVisit(followed, True)
        except EmulatorError as exc:
            candidates.mark_follow_failed(row["id"], str(exc))
            continue
        if label is None:
            candidates.mark_follow_failed(row["id"], "Profile is gone or hidden")
            continue
        candidates.mark_followed(row["id"])
        followed += 1
    return FollowVisit(followed, False)


def _allowance(school_id: int) -> int:
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    response = (
        get_sb()
        .table(INSTAGRAM_FOLLOW_CANDIDATES)
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("status", FOLLOW_CANDIDATE_FOLLOWED)
        .gte("followed_at", midnight.isoformat())
        .limit(1)
        .execute()
    )
    return CONTROL.follows_per_account_per_day - (response.count or 0)


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
