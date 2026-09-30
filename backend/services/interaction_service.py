"""User-event interaction tracking and aggregation.

This module is a thin CRUD/dedup layer.  Recommendation-specific scoring
(get_user_event_scores, get_interaction_matrix, get_event_popularity, and
cache infrastructure) lives in recommender.interaction_scores so
that this service has no dependency on recommender config.
"""

import logging
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone

from core.constants import (
    DEDUP_WINDOW_MINUTES,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_GOING,
    INTERACTION_SHARE,
    MAX_DUPLICATE_INTERACTIONS,
    MAX_INTERACTION_BATCH_SIZE,
    MAX_USER_INTERACTIONS_PER_WINDOW,
)
from core.database import get_sb
from core.exceptions import AuthenticationError, AuthorizationError, ValidationError
from core.pagination import fetch_all_pages, iter_all_pages
from core.tables import POSITION_INTERACTIONS, USER_INTERACTIONS
from schemas.interaction import InteractionCreate

log = logging.getLogger(__name__)


# Anonymous callers may record ``click``/``ungoing``. ``going``, ``share``,
# and ``detail_view`` are blocked: they feed popularity and CF scores, so
# unauthenticated rotating-IP traffic could inflate rankings.
_ANON_DISALLOWED_INTERACTION_TYPES: frozenset[str] = frozenset(
    {
        INTERACTION_GOING,
        INTERACTION_SHARE,
        INTERACTION_DETAIL_VIEW,
    }
)


def get_click_counts_for_events(event_ids: list[int]) -> dict[int, int]:
    return _get_click_counts(event_ids, "event")


def get_click_counts_for_positions(position_ids: list[int]) -> dict[int, int]:
    return _get_click_counts(position_ids, "position")


def _get_click_counts(item_ids: list[int], resource: str) -> dict[int, int]:
    unique_ids = sorted(set(item_ids))
    if not unique_ids:
        return {}
    try:
        rows = (
            get_sb()
            .rpc(f"get_{resource}_click_counts", {f"p_{resource}_ids": unique_ids})
            .execute()
            .data
            or []
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


def record_interactions(
    user_id: str | None,
    session_id: str,
    interactions: list[InteractionCreate],
) -> int:
    """Batch-insert interactions. Returns count inserted."""
    if not interactions:
        return 0
    rows_by_table: dict[str, list[dict]] = {}
    for item in interactions:
        table = POSITION_INTERACTIONS if item.position_id is not None else USER_INTERACTIONS
        target_field = "position_id" if item.position_id is not None else "event_id"
        rows = rows_by_table.setdefault(table, [])
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "session_id": session_id,
                target_field: item.position_id if item.position_id is not None else item.event_id,
                "interaction_type": item.interaction_type,
                "metadata": item.metadata,
            }
        )
    return sum(
        len(get_sb().table(table).insert(rows).execute().data or [])
        for table, rows in rows_by_table.items()
    )


def _validate_batch(
    user_id: str | None,
    payload_user_id: str | None,
    interactions: list[InteractionCreate],
) -> None:
    """Validate batch size and user-ID ownership.

    Raises ``ValidationError``, ``AuthenticationError``, or
    ``AuthorizationError`` on failure.
    """
    if len(interactions) > MAX_INTERACTION_BATCH_SIZE:
        raise ValidationError(
            f"Batch exceeds maximum size of {MAX_INTERACTION_BATCH_SIZE} interactions",
        )
    if payload_user_id is not None:
        if user_id is None:
            raise AuthenticationError(
                "Cannot submit interactions on behalf of another user",
            )
        if payload_user_id != user_id:
            raise AuthorizationError(
                "Cannot submit interactions on behalf of another user",
            )


def record_interactions_batch(
    user_id: str | None,
    payload_user_id: str | None,
    session_id: str,
    interactions: list[InteractionCreate],
) -> int:
    """Validate ownership, restrict anonymous signals, deduplicate, and persist.

    Database insert errors propagate so failed writes cannot appear successful.
    """
    _validate_batch(user_id, payload_user_id, interactions)

    # Drop anonymous interactions in ``_ANON_DISALLOWED_INTERACTION_TYPES`` (I18).
    if user_id is None:
        filtered = [
            item
            for item in interactions
            if item.interaction_type not in _ANON_DISALLOWED_INTERACTION_TYPES
        ]
        dropped = len(interactions) - len(filtered)
        if dropped:
            log.warning(
                "Dropped %d anonymous interactions of restricted types (session=%s)",
                dropped,
                session_id,
            )
        interactions = filtered
        if not interactions:
            return 0
        interactions = [
            item
            for position in (False, True)
            for item in check_duplicate_interactions_for_session(
                session_id=session_id,
                interactions=[
                    item for item in interactions if (item.position_id is not None) == position
                ],
                position=position,
            )
        ]
    else:
        interactions = [
            item
            for position in (False, True)
            for item in check_duplicate_interactions(
                user_id=user_id,
                interactions=[
                    item for item in interactions if (item.position_id is not None) == position
                ],
                position=position,
            )
        ]
    if not interactions:
        return 0

    return record_interactions(
        user_id=user_id,
        session_id=session_id,
        interactions=interactions,
    )


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


def _filter_duplicate_interactions(
    existing: list[dict],
    interactions: list[InteractionCreate],
    *,
    actor: str,
    position: bool = False,
) -> list[InteractionCreate]:
    """Apply per-event/type and global caps, including accepted items in this batch."""
    target_field = "position_id" if position else "event_id"
    counts = Counter((row[target_field], row["interaction_type"]) for row in existing)
    total_in_window = len(existing)
    filtered: list[InteractionCreate] = []
    for item in interactions:
        if total_in_window >= MAX_USER_INTERACTIONS_PER_WINDOW:
            log.warning(
                "Dropping interaction %s event=%s type=%s - global cap reached (%d/%d)",
                actor,
                item.event_id,
                item.interaction_type,
                total_in_window,
                MAX_USER_INTERACTIONS_PER_WINDOW,
            )
            continue

        key = (item.position_id if position else item.event_id, item.interaction_type)
        if counts[key] >= MAX_DUPLICATE_INTERACTIONS:
            log.warning(
                "Dropping duplicate interaction %s event=%s type=%s (count=%d)",
                actor,
                item.event_id,
                item.interaction_type,
                counts[key],
            )
            continue

        counts[key] += 1
        total_in_window += 1
        filtered.append(item)
    return filtered


def check_duplicate_interactions(
    user_id: str,
    interactions: list[InteractionCreate],
    *,
    position: bool = False,
) -> list[InteractionCreate]:
    """Apply per-event/type and total interaction caps within the dedup window.

    The total cap prevents spreading interactions across many events.
    """
    if not interactions:
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)).isoformat()

    # Read every page so PostgREST's row limit cannot bypass interaction caps.
    try:
        existing = fetch_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(POSITION_INTERACTIONS if position else USER_INTERACTIONS)
                    .select(
                        "position_id, interaction_type"
                        if position
                        else "event_id, interaction_type"
                    )
                    .eq("user_id", user_id)
                    .gte("created_at", cutoff)
                    .order("created_at")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
    except Exception as e:
        log.error("Dedup check failed, rejecting batch to prevent gaming: %s", e)
        return []

    return _filter_duplicate_interactions(
        existing, interactions, actor=f"user={user_id}", position=position
    )


def check_duplicate_interactions_for_session(
    session_id: str,
    interactions: list[InteractionCreate],
    *,
    position: bool = False,
) -> list[InteractionCreate]:
    """Filter anonymous session interactions that exceed dedup thresholds."""
    if not interactions:
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)).isoformat()

    try:
        existing = fetch_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(POSITION_INTERACTIONS if position else USER_INTERACTIONS)
                    .select(
                        "position_id, interaction_type"
                        if position
                        else "event_id, interaction_type"
                    )
                    .eq("session_id", session_id)
                    .is_("user_id", "null")
                    .gte("created_at", cutoff)
                    .order("created_at")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )
    except Exception as e:
        log.error("Anonymous dedup check failed, rejecting batch: %s", e)
        return []

    return _filter_duplicate_interactions(
        existing, interactions, actor=f"anonymous session={session_id}", position=position
    )
