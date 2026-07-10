"""Notification preference CRUD and default resolution."""

from datetime import datetime, timezone

from core.constants import NOTIFICATION_DEFAULT_ENABLED, NOTIFICATION_TYPES
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


def set_preferences(user_id: str, updates: list[NotificationPreferenceUpdate]) -> None:
    """Upsert one row per (user, type) pair from ``updates``."""
    if not updates:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "user_id": user_id,
            "notification_type": u.notification_type,
            "enabled": u.enabled,
            "updated_at": now_iso,
        }
        for u in updates
    ]
    (
        get_sb()
        .table(NOTIFICATION_PREFERENCES)
        .upsert(payload, on_conflict="user_id,notification_type")
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
