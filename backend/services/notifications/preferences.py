"""Notification preference CRUD and default resolution."""

from itertools import batched
from typing import Literal

from core.constants import NOTIFICATION_DEFAULT_ENABLED, NOTIFICATION_TYPES
from core.controlbox import controlbox
from core.database import get_sb
from core.tables import NOTIFICATION_PREFERENCES
from schemas.notification_preference import (
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
)


def get_preferences(user_id: str) -> list[NotificationPreferenceResponse]:
    """Return one resolved entry per notification type.

    Types with no row in ``notification_preferences`` fall back to
    ``NOTIFICATION_DEFAULT_ENABLED`` - absence means "never explicitly
    set", not "disabled". Callers render one toggle per entry.
    """
    rows = (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .select("notification_type, enabled, updated_at")
        .eq("user_id", user_id)
        .execute()
    ).data or []
    by_type = {row["notification_type"]: row for row in rows}

    prefs: list[NotificationPreferenceResponse] = []
    for t in NOTIFICATION_TYPES:
        if t in by_type:
            prefs.append(NotificationPreferenceResponse.model_validate(by_type[t]))
            continue
        prefs.append(
            NotificationPreferenceResponse(
                notification_type=t,
                enabled=NOTIFICATION_DEFAULT_ENABLED[t],
                updated_at=None,
            )
        )
    return prefs


def set_preferences(
    user_id: str,
    updates: list[NotificationPreferenceUpdate],
    *,
    source: Literal["settings", "unsubscribe"],
) -> None:
    """Commit preference choices and their consent evidence in one transaction."""
    if not updates:
        return
    (
        get_sb()
        .rpc(
            "set_notification_preferences",
            {
                "p_user_id": user_id,
                "p_updates": [update.model_dump() for update in updates],
                "p_source": source,
                "p_notice_version": controlbox.email_delivery.notification_consent_version,
            },
        )
        .execute()
    )


def is_enabled(user_id: str, notification_type: str) -> bool:
    """Resolve a user's current opt-in state for a notification type."""
    r = (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .select("enabled")
        .eq("user_id", user_id)
        .eq("notification_type", notification_type)
        .limit(1)
        .execute()
    )
    if r.data:
        return bool(r.data[0]["enabled"])
    return NOTIFICATION_DEFAULT_ENABLED.get(notification_type, False)


def get_enabled_user_ids(
    user_ids: list[str],
    notification_type: str,
) -> set[str]:
    """Resolve one notification preference for many users in chunked reads."""
    unique_ids = list(dict.fromkeys(user_ids))
    if not unique_ids:
        return set()

    explicit: dict[str, bool] = {}
    for chunk in batched(unique_ids, 500):
        rows = (
            get_sb()
            .table(NOTIFICATION_PREFERENCES)
            .select("user_id,enabled")
            .eq("notification_type", notification_type)
            .in_("user_id", chunk)
            .execute()
        ).data or []
        explicit.update({str(row["user_id"]): bool(row["enabled"]) for row in rows})

    default_enabled = NOTIFICATION_DEFAULT_ENABLED.get(notification_type, False)
    return {user_id for user_id in unique_ids if explicit.get(user_id, default_enabled)}
