"""Recommendation orchestrator: blends strategies, applies MMR, returns results."""

from datetime import datetime, timezone

from core.database import get_sb
from services import user_service, interaction_service
from services.recommender.content_based import get_content_scores
from services.recommender.collaborative import get_collaborative_scores
from services.recommender.popularity import get_popularity_scores
from services.recommender.reranker import mmr_rerank


# User temperature thresholds.
HOT_THRESHOLD = 10
WARM_THRESHOLD = 3


def get_recommendations(
    user_id: str,
    limit: int = 20,
    lambda_param: float = 0.7,
) -> list[dict]:
    """
    Generate personalized event recommendations.

    Returns list of {event_id, score, reason} dicts.
    Gracefully degrades: collab → content → popularity → empty.
    """
    # 1. Get candidate events (future events only)
    candidates = _get_candidate_events()
    if not candidates:
        return []

    candidate_ids = [e["id"] for e in candidates]
    events_by_id = {e["id"]: e for e in candidates}

    # 2. Determine user temperature
    user = user_service.get_user(user_id)
    interaction_count = interaction_service.get_user_interaction_count(user_id)
    has_profile = bool(user and (user.get("interests") or []))

    # 3. Get scores from each strategy
    content_scores: dict[int, float] = {}
    collab_scores: dict[int, float] = {}
    pop_scores: dict[int, float] = {}

    try:
        pop_scores = get_popularity_scores(candidate_ids)
    except Exception:
        pass

    if has_profile:
        try:
            content_scores = get_content_scores(user_id, candidates)
        except Exception:
            pass

    if interaction_count >= WARM_THRESHOLD:
        try:
            collab_scores = get_collaborative_scores(user_id, candidate_ids)
        except Exception:
            pass

    # 4. Blend based on temperature
    if interaction_count >= HOT_THRESHOLD:
        weights = (0.3, 0.5, 0.2)  # content, collab, popularity
    elif interaction_count >= WARM_THRESHOLD:
        weights = (0.5, 0.2, 0.3)
    elif has_profile:
        weights = (0.7, 0.0, 0.3)
    else:
        weights = (0.0, 0.0, 1.0)

    w_content, w_collab, w_pop = weights
    blended: dict[int, float] = {}
    for eid in candidate_ids:
        score = (
            w_content * content_scores.get(eid, 0)
            + w_collab * collab_scores.get(eid, 0)
            + w_pop * pop_scores.get(eid, 0)
        )
        if score > 0:
            blended[eid] = score

    if not blended:
        # Ultimate fallback: return most recent events
        return [
            {"event_id": e["id"], "score": 0.0, "reason": "Recently added"}
            for e in candidates[:limit]
        ]

    # 5. Apply MMR re-ranker
    scored_list = sorted(blended.items(), key=lambda x: x[1], reverse=True)
    reranked_ids = mmr_rerank(
        scored_events=scored_list,
        events_metadata=events_by_id,
        lambda_param=lambda_param,
        k=limit,
    )

    # 6. Generate reason strings
    results = []
    for eid in reranked_ids:
        reason = _generate_reason(
            eid, content_scores, collab_scores, pop_scores, events_by_id, weights
        )
        results.append({
            "event_id": eid,
            "score": round(blended.get(eid, 0), 4),
            "reason": reason,
        })

    return results


def _get_candidate_events() -> list[dict]:
    """Load future events as recommendation candidates."""
    now = datetime.now(timezone.utc).isoformat()
    r = (
        get_sb()
        .table("events")
        .select("*")
        .gte("dtstart_utc", now)
        .order("dtstart_utc", desc=False)
        .limit(200)
        .execute()
    )
    return r.data or []


def _generate_reason(
    eid: int,
    content_scores: dict[int, float],
    collab_scores: dict[int, float],
    pop_scores: dict[int, float],
    events_by_id: dict[int, dict],
    weights: tuple[float, float, float],
) -> str:
    """Generate a human-readable reason for the recommendation."""
    c_score = content_scores.get(eid, 0) * weights[0]
    cf_score = collab_scores.get(eid, 0) * weights[1]
    p_score = pop_scores.get(eid, 0) * weights[2]

    event = events_by_id.get(eid, {})
    category = event.get("category", "")

    # Pick the dominant signal
    if cf_score >= c_score and cf_score >= p_score and cf_score > 0:
        return "Similar to events you've enjoyed"
    elif c_score >= p_score and c_score > 0:
        if category:
            return f"Matches your interest in {category}"
        return "Based on your profile"
    elif p_score > 0:
        return "Popular on campus"
    return "Recommended for you"
