"""Popularity-based fallback: score events by weighted interaction count + time decay."""

import math
from datetime import datetime, timezone

from core.database import get_sb
from services import interaction_service


# Exponential decay half-life in days.
HALF_LIFE_DAYS = 7.0


def get_popularity_scores(candidate_event_ids: list[int]) -> dict[int, float]:
    """
    Score events by popularity (interaction count) with time-decay.
    Events with zero interactions fall back to recency of added_at.
    Returns {event_id: score} normalized to [0, 1].
    """
    # Get raw popularity from interactions
    popular = interaction_service.get_event_popularity(limit=500)
    pop_map = {item["event_id"]: item["score"] for item in popular}

    # Load candidate events for added_at fallback
    candidate_set = set(candidate_event_ids)
    events_meta = _load_events_meta(candidate_event_ids)

    now = datetime.now(timezone.utc)
    scores: dict[int, float] = {}

    for eid in candidate_set:
        raw_pop = pop_map.get(eid, 0)
        meta = events_meta.get(eid, {})

        # Apply time decay based on event start time or added_at
        dt_str = meta.get("dtstart_utc") or meta.get("added_at")
        decay = 1.0
        if dt_str:
            try:
                dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                days_ago = (now - dt).total_seconds() / 86400
                if days_ago > 0:
                    decay = math.pow(0.5, days_ago / HALF_LIFE_DAYS)
            except (ValueError, TypeError):
                pass

        if raw_pop > 0:
            scores[eid] = raw_pop * decay
        else:
            # No interactions: use recency as proxy (small base score)
            scores[eid] = 0.1 * decay

    # Normalize to [0, 1]
    if scores:
        max_score = max(scores.values())
        if max_score > 0:
            for eid in scores:
                scores[eid] /= max_score

    return scores


def _load_events_meta(event_ids: list[int]) -> dict[int, dict]:
    """Load minimal event metadata for decay calculation."""
    if not event_ids:
        return {}
    r = (
        get_sb()
        .table("events")
        .select("id, dtstart_utc, added_at")
        .in_("id", event_ids)
        .execute()
    )
    return {row["id"]: row for row in (r.data or [])}
