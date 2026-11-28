"""Whether a school account may be logged in on the emulator again, and the hold that
keeps an account Instagram checkpointed out of it.

Only a person or an agent following the add-account recipe logs an account in on the
emulator; the code never does it on its own. A login into an account Instagram still
holds behind a checkpoint lands straight back on it, and since the app then starts on
that account every time, every other account on its Android user is cut off
(2026-11-27: an agent re-added wat2do.sfu with its password while the checkpoint from
11-26 was still open and its account-guard breaker still open, and Android user 11's
nine other accounts lost their notifications, DMs and stories for hours). So every such
login asks ``login_blocked`` first
(``scripts/instagram_emulator.py may-log-in --account <account>``), and the worker opens
the breaker of any account it logs out from behind a checkpoint (``hold_for_person``).
The breaker stays open until a person has cleared the checkpoint and runs
``wat2do-browser account-guard --account <account> --reset``.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from core.launch_agents import INSTAGRAM_BROWSER_BINARY
from services.instagram_accounts import school_for_account

log = logging.getLogger(__name__)

BROWSER_STATE = Path.home() / ".local/state/wat2do/instagram-browser"
_GUARD_TIMEOUT_SECONDS = 30


def login_blocked(account: str) -> str | None:
    """Why the account must not be logged in on the emulator now, or None when it may.

    It may not while its account-guard breaker is open (a checkpoint, a login wall or a
    Brave login held for a person) or while its notification handling rests after an
    Instagram challenge. A guard that cannot be read blocks too: one wrong login costs a
    whole Android user.
    """
    try:
        tripped = breaker(account)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return f"its account guard could not be read ({type(exc).__name__})"
    if tripped:
        return f"its account-guard breaker is open: {tripped}"
    school = school_for_account(account)
    if school is not None:
        # The notification agent imports the emulator's device, which imports this.
        from services.instagram_sessions import notification

        until = notification.paused_until(school)
        if until is not None:
            return f"its notification handling rests until {until} after an Instagram challenge"
    return None


def breaker(account: str) -> str | None:
    """Why the account's breaker is open, or None while it is closed."""
    entry = _guard("--account", account).get(account) or {}
    tripped = entry.get("tripped")
    return str(tripped) if tripped else None


def hold_for_person(account: str, reason: str) -> None:
    """Open the account's breaker, so no login or automated traffic touches it until a
    person has cleared Instagram's checkpoint and reset it. Best effort: the log out
    that follows matters more than the record."""
    try:
        _guard("--account", account, "--trip", reason)
    except (OSError, subprocess.SubprocessError, ValueError):
        log.exception("Could not open the account guard's breaker for %s", account)


def _guard(*arguments: str) -> dict[str, Any]:
    completed = subprocess.run(
        [
            str(INSTAGRAM_BROWSER_BINARY),
            "account-guard",
            "--state-directory",
            str(BROWSER_STATE),
            *arguments,
        ],
        capture_output=True,
        text=True,
        timeout=_GUARD_TIMEOUT_SECONDS,
        check=True,
    )
    guards = json.loads(completed.stdout)
    if not isinstance(guards, dict):
        raise ValueError("account-guard did not answer with an object")
    return guards
