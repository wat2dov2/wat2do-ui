"""School Instagram account names, and the failures the emulator worker reports.

The Brave notification worker that defined these is Rust (``rust/src/instagram_notifications``),
which keeps its own copy of the account rules; the emulator worker, its DM sweep and the
follow crawl use these until they are ported too.
"""

from __future__ import annotations

import re

from core.controlbox import controlbox

_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_WAT2DO_ACCOUNT_PATTERN = re.compile(
    r"^(?:wat2do[.][a-z0-9_]+|[a-z0-9._]+[.]wat2do[.]io|(?:[a-z0-9._]+[.])?wat2do[.]ca)$"
)


class BrowserSessionError(RuntimeError):
    """A sanitized failure in a school account's Instagram session."""


class BrowserEngagementUncertain(BrowserSessionError):
    """A native action may have executed without verified completion."""


def is_wat2do_account(username: str) -> bool:
    """Whether the Instagram username is one of our own accounts."""
    return bool(_WAT2DO_ACCOUNT_PATTERN.fullmatch(username.casefold()))


def school_account_username(school_slug: str) -> str:
    """Resolve the current account name from its immutable school mapping: a hidden
    school's test account, else ``wat2do.<school>``."""
    hidden = controlbox.instagram_emulator.hidden_school_accounts.get(school_slug)
    if hidden is not None:
        return hidden.username
    username = f"wat2do.{school_slug}".strip().casefold()
    if not _USERNAME_PATTERN.fullmatch(username) or not _WAT2DO_ACCOUNT_PATTERN.fullmatch(username):
        raise ValueError("Instagram browser account username is invalid")
    return username


def school_for_account(username: str) -> str | None:
    """The school whose emulator account this is (a hidden school's test account too),
    or None when no school's account has this name."""
    emulator = controlbox.instagram_emulator
    for slug, account in emulator.hidden_school_accounts.items():
        if account.username == username:
            return slug
    slug = username.removeprefix("wat2do.")
    if username.startswith("wat2do.") and slug in emulator.android_user_by_school:
        return slug
    return None


def android_user(school_slug: str) -> int:
    """The emulator's Android user that holds the school's account."""
    emulator = controlbox.instagram_emulator
    hidden = emulator.hidden_school_accounts.get(school_slug)
    return (
        hidden.android_user if hidden is not None else emulator.android_user_by_school[school_slug]
    )
