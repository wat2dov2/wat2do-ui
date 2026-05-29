"""Offline evaluation: Precision@K and NDCG for recommendation quality."""

import logging
import math
import random

from recommender.interaction_scores import (
    get_interaction_matrix,
    get_user_event_scores,
)
from services import interaction_service, user_service

log = logging.getLogger(__name__)
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENTS
from recommender.collaborative import get_collaborative_scores
from recommender.config import (
    DEFAULT_LAMBDA,
    EVAL_K,
    EVAL_MAX_EVENTS,
    EVAL_MIN_INTERACTIONS,
    HOT_THRESHOLD,
    WARM_THRESHOLD,
)
from recommender.content_based import get_content_scores
from recommender.popularity import get_popularity_scores
from recommender.reranker import mmr_rerank
from recommender.scoring import blend_scores, select_weights
from schemas.event import EventResponse


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
    max_events: int = EVAL_MAX_EVENTS,
) -> dict:
    """
    Leave-one-out evaluation across all users with sufficient interactions.
    Holds out the highest-scored interaction per user and measures recovery.

    Uses dynamic weights and MMR re-ranking matching the production pipeline.

    Args:
        max_events: Cap on events loaded for evaluation (0 = no limit).
            When the catalog exceeds this cap, a random sample is used.
            Each user's held-out event is always included in the candidate
            set to preserve evaluation correctness.
    """
    matrix = get_interaction_matrix()

    # Group by user
    user_events: dict[str, list[tuple[int, float]]] = {}
    for row in matrix:
        uid = row.user_id
        if uid not in user_events:
            user_events[uid] = []
        user_events[uid].append((row.event_id, row.score))

    # Only evaluate users with 5+ interactions
    eligible = {
        uid: events for uid, events in user_events.items() if len(events) >= EVAL_MIN_INTERACTIONS
    }

    if not eligible:
        return {
            "num_users_evaluated": 0,
            "precision_at_k": 0.0,
            "ndcg_at_k": 0.0,
            "k": k,
        }

    all_events_data = _load_all_events(max_events=max_events)
    all_event_ids = [e.id for e in all_events_data]
    events_by_id = {e.id: e for e in all_events_data}

    # Collect held-out event IDs so we can ensure they are in the candidate set
    held_out_eids: set[int] = set()
    for events in eligible.values():
        events.sort(key=lambda x: x[1], reverse=True)
        held_out_eids.add(events[0][0])

    # Load any held-out events that fell outside the sampled set
    missing_eids = held_out_eids - set(events_by_id)
    if missing_eids:
        extra = _load_events(list(missing_eids))
        for e in extra:
            events_by_id[e.id] = e
            all_event_ids.append(e.id)
        log.info(
            "Loaded %d held-out events not in sampled set (%d total candidates)",
            len(extra),
            len(all_event_ids),
        )

    # --- Hoist user-independent and batch-fetchable work outside the loop ---

    # Popularity scores are identical for every user; compute once.
    pop = get_popularity_scores(all_event_ids)

    # Batch-fetch all user profiles and interaction counts (2 queries total
    # instead of 2*N sequential round-trips).
    eligible_uids = list(eligible.keys())
    users_by_id = user_service.get_users_by_ids(eligible_uids)
    interaction_counts = interaction_service.get_user_interaction_counts(eligible_uids)

    log.info(
        "Batch-loaded %d user profiles and %d interaction counts for evaluation",
        len(users_by_id),
        len(interaction_counts),
    )

    total_precision = 0.0
    total_ndcg = 0.0
    count = 0

    for uid, events in eligible.items():
        held_out_eid = events[0][0]
        relevant = {held_out_eid}

        try:
            # Dynamic weights matching production (_compute_live)
            interaction_count = interaction_counts.get(uid, 0)
            user = users_by_id.get(uid)
            has_profile = bool(user and user.interests)

            weights = select_weights(
                interaction_count,
                has_profile,
                hot_threshold=hot_threshold,
                warm_threshold=warm_threshold,
            )

            # Mirror the live pipeline: content scorer needs per-user
            # interaction scores to compute org affinity (worth up to
            # CB_ORG_AFFINITY of the content score). Without these, offline
            # metrics measure a weaker model than what production serves.
            try:
                user_scores = get_user_event_scores(uid)
            except Exception as e:
                log.warning("Failed to fetch user event scores for %s during eval: %s", uid, e)
                user_scores = {}

            # Pass pre-fetched user to avoid redundant DB lookup inside
            # get_content_scores.
            content = get_content_scores(
                uid,
                all_events_data,
                user=user,
                user_scores=user_scores,
            )
            collab = get_collaborative_scores(uid, all_event_ids)

            blended = blend_scores(
                all_event_ids,
                content,
                collab,
                pop,
                weights,
                exclude={held_out_eid},
            )

            # Apply MMR re-ranking matching production.
            # R18: explicit tie-break on event_id so ordering is reproducible.
            scored_list = sorted(blended.items(), key=lambda x: (-x[1], x[0]))
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


def _load_all_events(max_events: int = EVAL_MAX_EVENTS) -> list[EventResponse]:
    """Load events for evaluation, with a hard cap on rows fetched.

    Uses a DB-level limit to avoid pulling unbounded rows into memory.
    When the catalog is larger than *max_events*, a random offset is
    chosen so different evaluation runs cover different slices.
    """
    # Get total count first to decide whether sampling is needed.
    count_resp = get_sb().table(EVENTS).select("id", count="exact").limit(0).execute()
    total = count_resp.count or 0

    if max_events > 0 and total > max_events:
        log.info(
            "Sampling %d of %d events for evaluation (DB-level limit)",
            max_events,
            total,
        )
        # Random offset so each nightly run evaluates a different slice.
        max_offset = max(total - max_events, 0)
        offset = random.randint(0, max_offset) if max_offset > 0 else 0
        r = (
            get_sb()
            .table(EVENTS)
            .select("*")
            .order("id")
            .range(offset, offset + max_events - 1)
            .execute()
        )
        rows = r.data or []
    else:
        rows = fetch_all_pages(
            lambda offset, ps: (
                (
                    get_sb()
                    .table(EVENTS)
                    .select("*")
                    .order("id")
                    .range(offset, offset + ps - 1)
                    .execute()
                ).data
                or []
            ),
        )

    return [EventResponse.model_validate(row) for row in rows]


def _load_events(event_ids: list[int]) -> list[EventResponse]:
    """Load full event data for specific IDs."""
    if not event_ids:
        return []
    r = get_sb().table(EVENTS).select("*").in_("id", event_ids).execute()
    return [EventResponse.model_validate(row) for row in (r.data or [])]
