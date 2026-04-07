"""User-event interaction tracking and aggregation."""

import uuid

from core.constants import (
    DEFAULT_INTERACTION_LIMIT,
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_SAVE,
    INTERACTION_SHARE,
    INTERACTION_UNSAVE,
    INTERACTION_VIEW,
)
from core.database import get_sb
from core.tables import USER_INTERACTIONS
from schemas.interaction import InteractionCreate, InteractionMatrixRow, EventPopularity

# Weights for computing interaction scores.
INTERACTION_WEIGHTS: dict[str, float] = {
    INTERACTION_VIEW: 1.0,
    INTERACTION_CLICK: 2.0,
    INTERACTION_DETAIL_VIEW: 3.0,
    INTERACTION_SAVE: 5.0,
    INTERACTION_UNSAVE: -3.0,
    INTERACTION_SHARE: 3.0,
}


def record_interactions(
    user_id: str | None,
    session_id: str,
    interactions: list[InteractionCreate],
) -> int:
    """Batch-insert interactions. Returns count inserted."""
    if not interactions:
        return 0
    rows = []
    for item in interactions:
        rows.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "session_id": session_id,
            "event_id": item.event_id,
            "interaction_type": item.interaction_type,
            "metadata": item.metadata,
        })
    r = get_sb().table(USER_INTERACTIONS).insert(rows).execute()
    return len(r.data) if r.data else 0


def get_user_event_scores(user_id: str) -> dict[int, float]:
    """Weighted interaction scores for a single user: {event_id: score}."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("event_id, interaction_type")
        .eq("user_id", user_id)
        .execute()
    )
    scores: dict[int, float] = {}
    for row in r.data or []:
        eid = row["event_id"]
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        scores[eid] = scores.get(eid, 0) + weight
    return scores


def get_interaction_matrix() -> list[InteractionMatrixRow]:
    """
    Return all user-event interaction scores as typed rows.
    Used by collaborative filtering to build the full matrix.
    """
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("user_id, event_id, interaction_type")
        .not_.is_("user_id", "null")
        .execute()
    )
    # Aggregate per (user, event)
    agg: dict[tuple[str, int], float] = {}
    for row in r.data or []:
        key = (row["user_id"], row["event_id"])
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        agg[key] = agg.get(key, 0) + weight
    return [
        InteractionMatrixRow(user_id=uid, event_id=eid, score=score)
        for (uid, eid), score in agg.items()
        if score > 0
    ]


def get_event_popularity(limit: int = DEFAULT_INTERACTION_LIMIT) -> list[EventPopularity]:
    """
    Return events ranked by weighted interaction count.
    Returns typed rows sorted descending.
    """
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("event_id, interaction_type")
        .execute()
    )
    scores: dict[int, float] = {}
    for row in r.data or []:
        eid = row["event_id"]
        weight = INTERACTION_WEIGHTS.get(row["interaction_type"], 0)
        scores[eid] = scores.get(eid, 0) + weight

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]
    return [EventPopularity(event_id=eid, score=score) for eid, score in ranked]


def get_user_interaction_count(user_id: str) -> int:
    """Count total interactions for a user. Used to determine user 'temperature'."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    return r.count or 0
