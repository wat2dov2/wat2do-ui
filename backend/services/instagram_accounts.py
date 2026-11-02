"""School Instagram account names, and the failures the emulator worker reports.

The Brave notification worker that defined these is Rust (``rust/src/instagram_notifications``),
which keeps its own copy of the account rules; the emulator worker and its DM sweep use these
until they are ported too.
"""

from __future__ import annotations

import re

_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_WAT2DO_ACCOUNT_PATTERN = re.compile(
    r"^(?:wat2do[.][a-z0-9_]+|[a-z0-9._]+[.]wat2do[.]io|(?:[a-z0-9._]+[.])?wat2do[.]ca)$"
)


class BrowserSessionError(RuntimeError):
    """A sanitized failure in a school account's Instagram session."""


class BrowserEngagementUncertain(BrowserSessionError):
    """A native action may have executed without verified completion."""


def school_account_username(school_slug: str) -> str:
    """Resolve the current account name from its immutable school mapping."""
    username = f"wat2do.{school_slug}".strip().casefold()
    if not _USERNAME_PATTERN.fullmatch(username) or not _WAT2DO_ACCOUNT_PATTERN.fullmatch(username):
        raise ValueError("Instagram browser account username is invalid")
    return username
