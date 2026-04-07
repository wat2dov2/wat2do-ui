"""Offline evaluation: Precision@K and NDCG for recommendation quality."""

import logging
import math

from services import interaction_service, user_service

log = logging.getLogger(__name__)
from schemas.event import EventResponse
from services.recommender.content_based import get_content_scores
from services.recommender.collaborative import get_collaborative_scores
from services.recommender.popularity import get_popularity_scores
from services.recommender.reranker import mmr_rerank
from services.recommender.config import (
    EVAL_K,
    HOT_THRESHOLD,
    WARM_THRESHOLD,
    DEFAULT_LAMBDA,
    EVAL_MIN_INTERACTIONS,
    WEIGHTS_HOT,
    WEIGHTS_WARM,
    WEIGHTS_WARM_NO_COLLAB,
    WEIGHTS_COLD,
)
from core.database import get_sb
from core.tables import EVENTS


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

    dcg = 0.0
    for i, eid in enumerate(top_k):
        rel = 1.0 if eid in relevant_ids else 0.0
        dcg += rel / math.log2(i + 2)

    ideal_hits = min(len(relevant_ids), k)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))

    return dcg / idcg if idcg > 0 else 0.0


def evaluate_all_users(
    k: int = EVAL_K,
    hot_threshold: int = HOT_THRESHOLD,
    warm_threshold: int = WARM_THRESHOLD,
    lambda_param: float = DEFAULT_LAMBDA,
) -> dict:
    """
    Leave-one-out evaluation across all users with sufficient interactions.
    Holds out the highest-scored interaction per user and measures recovery.

    Uses dynamic weights and MMR re-ranking matching the production pipeline.
    """
    matrix = interaction_service.get_interaction_matrix()

    # Group by user
    user_events: dict[str, list[tuple[int, float]]] = {}
    for row in matrix:
        uid = row.user_id
        if uid not in user_events:
            user_events[uid] = []
        user_events[uid].append((row.event_id, row.score))

    # Only evaluate users with 5+ interactions
    eligible = {
        uid: events
        for uid, events in user_events.items()
        if len(events) >= EVAL_MIN_INTERACTIONS
    }

    if not eligible:
        return {
            "num_users_evaluated": 0,
            "precision_at_k": 0.0,
            "ndcg_at_k": 0.0,
            "k": k,
        }

    all_events_data = _load_all_events()
    all_event_ids = [e.id for e in all_events_data]
    events_by_id = {e.id: e for e in all_events_data}

    total_precision = 0.0
    total_ndcg = 0.0
    count = 0

    for uid, events in eligible.items():
        events.sort(key=lambda x: x[1], reverse=True)
        held_out_eid = events[0][0]
        relevant = {held_out_eid}

        try:
            # Dynamic weights matching production (_compute_live)
            interaction_count = interaction_service.get_user_interaction_count(uid)
            user = user_service.get_user(uid)
            has_profile = bool(user and user.interests)

            if interaction_count >= hot_threshold:
                weights = WEIGHTS_HOT
            elif interaction_count >= warm_threshold:
                weights = WEIGHTS_WARM
            elif has_profile:
                weights = WEIGHTS_WARM_NO_COLLAB
            else:
                weights = WEIGHTS_COLD

            w_content, w_collab, w_pop = weights

            content = get_content_scores(uid, all_events_data)
            collab = get_collaborative_scores(uid, all_event_ids)
            pop = get_popularity_scores(all_event_ids)

            blended = {}
            for eid in all_event_ids:
                if eid == held_out_eid:
                    continue
                score = (
                    w_content * content.get(eid, 0)
                    + w_collab * collab.get(eid, 0)
                    + w_pop * pop.get(eid, 0)
                )
                if score > 0:
                    blended[eid] = score

            # Apply MMR re-ranking matching production
            scored_list = sorted(blended.items(), key=lambda x: x[1], reverse=True)
            recommended = mmr_rerank(
                scored_events=scored_list,
                events_metadata=events_by_id,
                lambda_param=lambda_param,
                k=k,
            )

            total_precision += precision_at_k(recommended, relevant, k)
            total_ndcg += ndcg_at_k(recommended, relevant, k)
            count += 1
        except Exception as e:
            log.warning("Evaluation failed for user %s: %s", uid, e)
            continue

    return {
        "num_users_evaluated": count,
        "precision_at_k": round(total_precision / max(count, 1), 4),
        "ndcg_at_k": round(total_ndcg / max(count, 1), 4),
        "k": k,
    }


def _load_all_events() -> list[EventResponse]:
    """Load all events with full metadata for evaluation."""
    r = get_sb().table(EVENTS).select("*").execute()
    return [EventResponse.model_validate(row) for row in (r.data or [])]


def _load_events(event_ids: list[int]) -> list[EventResponse]:
    """Load full event data for content scoring."""
    r = get_sb().table(EVENTS).select("*").in_("id", event_ids).execute()
    return [EventResponse.model_validate(row) for row in (r.data or [])]
