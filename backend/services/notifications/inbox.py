"""The notification inbox under the top bar's bell (``public.user_notifications``).

Every notification email a user is sent also leaves one notification there,
recorded where that email is sent. The event change alerts sent from here
record theirs with ``record``; the Rust services record the rest
(``rust/src/notifications/inbox.rs``). A notification keeps only what its words
need, and the site writes them in the reader's language.
"""

import logging
from typing import Any

from core.controlbox import controlbox
from core.database import get_sb

log = logging.getLogger(__name__)


def record(
    *,
    user_id: str,
    kind: str,
    event_id: int | None,
    details: dict[str, Any],
    link: str | None,
) -> None:
    """Add one notification to the user's inbox, logging (never raising) a failure.

    The email it repeats has already gone, so an inbox can never undo it.
    """
    try:
        get_sb().rpc(
            "record_user_notification",
            {
                "p_user_id": user_id,
                "p_kind": kind,
                "p_event_id": event_id,
                "p_details": details,
                "p_link": link,
                "p_retention_days": controlbox.notification_inbox.retention_days,
            },
        ).execute()
    except Exception:
        log.warning(
            "Could not add a %s notification to user=%s's inbox", kind, user_id, exc_info=True
        )
