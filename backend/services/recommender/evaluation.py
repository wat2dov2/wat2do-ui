"""Offline evaluation: Precision@K and NDCG for recommendation quality."""

import math

from services import interaction_service
from services.recommender.content_based import get_content_scores
from services.recommender.collaborative import get_collaborative_scores
from services.recommender.popularity import get_popularity_scores
from core.database import get_sb


def precision_at_k(recommended_ids: list[int], relevant_ids: set[int], k: int) -> float:
    """Fraction of top-K recommendations that are relevant."""
    top_k = recommended_ids[:k]
    if not top_k:
        return 0.0
    hits = sum(1 for eid in top_k if eid in relevant_ids)
    return hits / len(top_k)


def ndcg_at_k(recommended_ids: list[int], relevant_ids: set[int], k: int) -> float:
    """Normalized Discounted Cumulative Gain at K."""
    top_k = recommended_ids[:k]
    if not top_k or not relevant_ids:
        return 0.0

    # DCG
    dcg = 0.0
    for i, eid in enumerate(top_k):
        rel = 1.0 if eid in relevant_ids else 0.0
        dcg += rel / math.log2(i + 2)  # i+2 because log2(1) = 0

    # Ideal DCG
    ideal_hits = min(len(relevant_ids), k)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))

    return dcg / idcg if idcg > 0 else 0.0


def evaluate_all_users(k: int = 10) -> dict:
    """
    Leave-one-out evaluation across all users with sufficient interactions.
    For each user, hold out the most recent interaction and measure if
    the recommendation system recovers it in top-K.

    Returns aggregate metrics.
    """
    matrix = interaction_service.get_interaction_matrix()

    # Group by user
    user_events: dict[str, list[tuple[int, float]]] = {}
    for row in matrix:
        uid = row["user_id"]
        if uid not in user_events:
            user_events[uid] = []
        user_events[uid].append((row["event_id"], row["score"]))

    # Only evaluate users with 5+ interactions
    eligible = {
        uid: events
        for uid, events in user_events.items()
        if len(events) >= 5
    }

    if not eligible:
        return {
            "num_users_evaluated": 0,
            "precision_at_k": 0.0,
            "ndcg_at_k": 0.0,
            "k": k,
        }

    # Load all future events as candidates
    all_events = get_sb().table("events").select("id").execute()
    all_event_ids = [e["id"] for e in (all_events.data or [])]

    total_precision = 0.0
    total_ndcg = 0.0
    count = 0

    for uid, events in eligible.items():
        # Sort by score descending, hold out the top-scored event
        events.sort(key=lambda x: x[1], reverse=True)
        held_out_eid = events[0][0]
        relevant = {held_out_eid}

        # Get recommendations (using all strategies)
        try:
            content = get_content_scores(uid, _load_events(all_event_ids))
            collab = get_collaborative_scores(uid, all_event_ids)
            pop = get_popularity_scores(all_event_ids)

            # Blend (warm user weights)
            blended = {}
            for eid in all_event_ids:
                if eid == held_out_eid:
                    continue
                score = (
                    0.5 * content.get(eid, 0)
                    + 0.2 * collab.get(eid, 0)
                    + 0.3 * pop.get(eid, 0)
                )
                if score > 0:
                    blended[eid] = score

            recommended = sorted(blended.keys(), key=lambda e: blended[e], reverse=True)

            total_precision += precision_at_k(recommended, relevant, k)
            total_ndcg += ndcg_at_k(recommended, relevant, k)
            count += 1
        except Exception:
            continue

    return {
        "num_users_evaluated": count,
        "precision_at_k": round(total_precision / max(count, 1), 4),
        "ndcg_at_k": round(total_ndcg / max(count, 1), 4),
        "k": k,
    }


def _load_events(event_ids: list[int]) -> list[dict]:
    """Load full event data for content scoring."""
    r = get_sb().table("events").select("*").in_("id", event_ids).execute()
    return r.data or []
