"""User-event interaction aggregation.

Interactions are recorded by the Rust API (``rust/src/api/events/interactions.rs``);
this module keeps the reads Python still makes.  Recommendation-specific scoring
(get_user_event_scores, get_interaction_matrix, get_event_popularity, and
cache infrastructure) lives in recommender.interaction_scores so
that this service has no dependency on recommender config.
"""

import logging

from core.database import get_sb
from core.pagination import fetch_all_pages, iter_all_pages
from core.tables import USER_INTERACTIONS

log = logging.getLogger(__name__)


def get_click_counts_for_positions(position_ids: list[int]) -> dict[int, int]:
    return _get_click_counts(position_ids, "position")


def _get_click_counts(item_ids: list[int], resource: str) -> dict[int, int]:
    unique_ids = sorted(set(item_ids))
    if not unique_ids:
        return {}
    try:
        rows = fetch_all_pages(
            lambda offset, page_size: (
                get_sb()
                .rpc(f"get_{resource}_click_counts", {f"p_{resource}_ids": unique_ids})
                .order(f"{resource}_id")
                .range(offset, offset + page_size - 1)
                .execute()
                .data
                or []
            )
        )
    except Exception as exc:
        log.warning("Failed to fetch %s click counts: %s", resource, exc)
        return {}
    counts: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            counts[int(row[f"{resource}_id"])] = int(row["click_count"])
        except (KeyError, TypeError, ValueError):
            continue
    return counts


def get_user_interaction_count(user_id: str) -> int:
    """Count total interactions for a user. Used to determine user 'temperature'."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def get_user_interaction_counts(user_ids: list[str]) -> dict[str, int]:
    """Batch-fetch interaction counts for multiple users.

    Returns {user_id: count} for the given user IDs. Users with zero
    interactions are omitted from the result (callers should use
    ``counts.get(uid, 0)``).

    This avoids N sequential DB round-trips when evaluating many users.
    """
    if not user_ids:
        return {}

    counts: dict[str, int] = {}
    for row in iter_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id")
                .in_("user_id", user_ids)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    ):
        uid = row["user_id"]
        counts[uid] = counts.get(uid, 0) + 1

    return counts
