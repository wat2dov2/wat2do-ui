"""Going selections read for recommendation batches.

Going selections are written and served by the Rust API (``rust/src/api/events/going.rs``).
"""

from uuid import UUID

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import USER_GOING_EVENTS
from schemas.going_event import UserEventPair


def get_all_user_goings() -> list[UserEventPair]:
    """Return distinct (user_id, event_id) inputs for recommendation batches."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("user_id,event_id")
                .order("going_at")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        ),
    )
    pairs = {(UUID(str(row["user_id"])), int(row["event_id"])) for row in rows}
    return [
        UserEventPair(user_id=user_id, event_id=event_id)
        for user_id, event_id in sorted(pairs, key=lambda pair: (str(pair[0]), pair[1]))
    ]
