"""Recommendation-specific interaction scoring.

Aggregates raw interaction rows into scored vectors for collaborative
filtering and popularity ranking.  These functions depend on recommender
config (weights, caps, look-back window) and belong in the recommender
package, not in the general-purpose interaction_service.

The general CRUD/dedup operations remain in interaction_service.
"""

import logging
from datetime import datetime, timedelta, timezone

from core.constants import DEFAULT_INTERACTION_LIMIT
from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import USER_INTERACTIONS
from recommender.config import (
    CF_MAX_USER_EVENT_SCORE,
    INTERACTION_LOOKBACK_DAYS,
    INTERACTION_WEIGHTS,
    POP_MAX_USER_CONTRIBUTION,
)
from schemas.interaction import EventPopularity, InteractionMatrixRow

log = logging.getLogger(__name__)


def get_user_event_scores(user_id: str) -> dict[int, float]:
    """Fetch weighted interaction scores for a single user from the DB."""
    scores: dict[int, float] = {}
    for row in iter_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("event_id, interaction_type")
                .eq("user_id", user_id)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    ):
        eid = row["event_id"]
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        scores[eid] = scores.get(eid, 0) + weight
    return scores


def get_interaction_matrix() -> list[InteractionMatrixRow]:
    """
    Return user-event interaction scores as typed rows.
    Used by collaborative filtering to build the user-item matrix.

    Time-windowed to INTERACTION_LOOKBACK_DAYS.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=INTERACTION_LOOKBACK_DAYS)).isoformat()

    agg: dict[tuple[str, int], float] = {}
    for row in iter_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, event_id, interaction_type")
                .not_.is_("user_id", "null")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    ):
        key = (row["user_id"], row["event_id"])
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        agg[key] = agg.get(key, 0) + weight

    return [
        InteractionMatrixRow(
            user_id=uid,
            event_id=eid,
            score=min(score, CF_MAX_USER_EVENT_SCORE),
        )
        for (uid, eid), score in agg.items()
        if score > 0
    ]


def get_event_popularity(limit: int = DEFAULT_INTERACTION_LIMIT) -> list[EventPopularity]:
    """
    Return events ranked by weighted interaction count.
    Returns typed rows sorted descending.

    Time-windowed to INTERACTION_LOOKBACK_DAYS.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=INTERACTION_LOOKBACK_DAYS)).isoformat()

    # Aggregate per (actor, event) first so we can cap each actor's
    # contribution before summing across users. This prevents a small
    # number of bot accounts from dominating popularity scores.
    #
    # For anonymous rows (user_id IS NULL), bucket by session_id so
    # N distinct anonymous browsers are counted as N distinct actors.
    actor_event_scores: dict[tuple[str | None, str | None, int], float] = {}
    for row in iter_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id, session_id, event_id, interaction_type")
                .gte("created_at", cutoff)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    ):
        uid = row.get("user_id")
        sid = row["session_id"] if uid is None else None
        key = (uid, sid, row["event_id"])
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        actor_event_scores[key] = actor_event_scores.get(key, 0) + weight

    scores: dict[int, float] = {}
    for (_, _, eid), raw_score in actor_event_scores.items():
        capped = min(raw_score, POP_MAX_USER_CONTRIBUTION)
        scores[eid] = scores.get(eid, 0) + capped

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [EventPopularity(event_id=eid, score=score) for eid, score in ranked[:limit]]
