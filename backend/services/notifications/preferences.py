"""Who receives a notification type: a user's choice, else the type's default.

The settings page and unsubscribe links change choices through the API
(``rust/src/api/routes/notification_preferences.rs``)."""

from itertools import batched

from core.constants import NOTIFICATION_DEFAULT_ENABLED
from core.database import get_sb
from core.tables import NOTIFICATION_PREFERENCES


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
