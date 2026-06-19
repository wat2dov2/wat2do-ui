"""Collaborative filtering: user-based and item-based with cosine similarity."""

import logging
import math

from core.cache import TTLCache
from recommender.config import (
    CACHE_TTL_SECONDS,
    CF_BLEND_WEIGHT,
    CF_MAX_USER_EVENT_SCORE,
    CF_MIN_INTERACTIONS,
    CF_NEIGHBOR_K,
    CF_SAVE_WEIGHT,
)
from recommender.interaction_scores import get_interaction_matrix
from recommender.utils import normalize_scores
from services import saved_event_service

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cached CF matrices: rebuilding user vectors {user_id: {event_id: score}}
# and item vectors {event_id: {user_id: score}} from the raw interaction
# matrix + saves is O(rows) and identical for every caller within the same
# cache window.  Cache both so the work is done once per TTL period instead
# of once per live-fallback request.
# ---------------------------------------------------------------------------
_cf_cache = TTLCache(default_ttl=CACHE_TTL_SECONDS)


def _build_cf_matrices() -> (
    tuple[
        dict[str, dict[int, float]], dict[str, float], dict[int, dict[str, float]], dict[int, float]
    ]
):
    """Build (user_vectors, user_magnitudes, item_vectors, item_magnitudes) from interaction matrix and saves."""
    matrix = get_interaction_matrix()
    saves = saved_event_service.get_all_user_saves()

    user_vectors: dict[str, dict[int, float]] = {}
    for row in matrix:
        uid = row.user_id
        if uid not in user_vectors:
            user_vectors[uid] = {}
        user_vectors[uid][row.event_id] = row.score

    for s in saves:
        uid, eid = s.user_id, s.event_id
        if uid not in user_vectors:
            user_vectors[uid] = {}
        user_vectors[uid][eid] = min(
            user_vectors[uid].get(eid, 0) + CF_SAVE_WEIGHT,
            CF_MAX_USER_EVENT_SCORE,
        )

    # Transpose: item_vectors[event_id][user_id] = score
    item_vectors: dict[int, dict[str, float]] = {}
    for uid, vec in user_vectors.items():
        for eid, score in vec.items():
            if eid not in item_vectors:
                item_vectors[eid] = {}
            item_vectors[eid][uid] = score

    # Precompute vector magnitudes
    user_magnitudes: dict[str, float] = {}
    for uid, vec in user_vectors.items():
        user_magnitudes[uid] = math.sqrt(sum(v**2 for v in vec.values()))

    item_magnitudes: dict[int, float] = {}
    for eid, item_vec in item_vectors.items():
        item_magnitudes[eid] = math.sqrt(sum(v**2 for v in item_vec.values()))

    log.info(
        "Rebuilt CF matrices: %d users, %d items, %d entries",
        len(user_vectors),
        len(item_vectors),
        sum(len(v) for v in user_vectors.values()),
    )
    return user_vectors, user_magnitudes, item_vectors, item_magnitudes


def _get_cf_matrices() -> (
    tuple[
        dict[str, dict[int, float]], dict[str, float], dict[int, dict[str, float]], dict[int, float]
    ]
):
    """Return (user_vectors, user_magnitudes, item_vectors, item_magnitudes), rebuilding if the TTL has expired."""
    return _cf_cache.get_or_compute("cf_matrices", _build_cf_matrices)


def get_collaborative_scores(
    user_id: str,
    candidate_event_ids: list[int],
) -> dict[int, float]:
    """
    Blend of user-based and item-based CF.
    Returns {event_id: score} for candidate events.
    Returns empty dict if user has too few interactions (cold start).
    """
    user_vectors, user_magnitudes, item_vectors, item_magnitudes = _get_cf_matrices()

    target_vec = user_vectors.get(user_id, {})
    if len(target_vec) < CF_MIN_INTERACTIONS:
        return {}

    candidate_set = set(candidate_event_ids)
    unseen = candidate_set - set(target_vec.keys())
    if not unseen:
        return {}

    # Target user magnitude
    target_mag = user_magnitudes.get(user_id) or math.sqrt(sum(v**2 for v in target_vec.values()))

    # User-based CF
    user_scores = _user_based_cf(
        user_id,
        target_vec,
        target_mag,
        user_vectors,
        user_magnitudes,
        unseen,
    )

    # Item-based CF
    item_scores = _item_based_cf(target_vec, item_vectors, item_magnitudes, unseen)

    # Blend user-based and item-based CF
    all_eids = set(user_scores.keys()) | set(item_scores.keys())
    blended: dict[int, float] = {}
    for eid in all_eids:
        u = user_scores.get(eid, 0)
        i = item_scores.get(eid, 0)
        blended[eid] = CF_BLEND_WEIGHT * u + (1 - CF_BLEND_WEIGHT) * i

    return normalize_scores(blended)


def _user_based_cf(
    target_uid: str,
    target_vec: dict[int, float],
    target_mag: float,
    user_vectors: dict[str, dict[int, float]],
    user_magnitudes: dict[str, float],
    unseen_eids: set[int],
    k: int = CF_NEIGHBOR_K,
) -> dict[int, float]:
    """Find K most similar users, predict scores for unseen events."""
    similarities: list[tuple[str, float]] = []
    for uid, vec in user_vectors.items():
        if uid == target_uid:
            continue
        sim = _cosine_similarity(
            target_vec,
            vec,
            target_mag,
            user_magnitudes.get(uid, 0.0),
        )
        if sim > 0:
            similarities.append((uid, sim))

    similarities.sort(key=lambda x: x[1], reverse=True)
    top_k = similarities[:k]

    if not top_k:
        return {}

    scores: dict[int, float] = {}
    for eid in unseen_eids:
        num = 0.0
        denom = 0.0
        for uid, sim in top_k:
            rating = user_vectors[uid].get(eid, 0)
            if rating > 0:
                num += sim * rating
                denom += sim
        if denom > 0:
            scores[eid] = num / denom

    return scores


def _item_based_cf(
    target_vec: dict[int, float],
    item_vectors: dict[int, dict[str, float]],
    item_magnitudes: dict[int, float],
    unseen_eids: set[int],
) -> dict[int, float]:
    """Score unseen events by similarity to events the user has interacted with."""
    scores: dict[int, float] = {}

    # Precalculate magnitudes of user's interacted events to avoid recalculations in inner loops
    user_event_mags = {
        user_eid: item_magnitudes.get(user_eid)
        or math.sqrt(sum(v**2 for v in item_vectors.get(user_eid, {}).values()))
        for user_eid in target_vec.keys()
        if target_vec[user_eid] > 0
    }

    for candidate_eid in unseen_eids:
        candidate_vec = item_vectors.get(candidate_eid, {})
        if not candidate_vec:
            continue
        candidate_mag = item_magnitudes.get(candidate_eid) or math.sqrt(
            sum(v**2 for v in candidate_vec.values())
        )

        score = 0.0
        for user_eid, user_rating in target_vec.items():
            if user_rating <= 0:
                continue
            item_vec = item_vectors.get(user_eid, {})
            if not item_vec:
                continue
            sim = _cosine_similarity_generic(
                candidate_vec,
                item_vec,
                candidate_mag,
                user_event_mags.get(user_eid, 0.0),
            )
            if sim > 0:
                score += sim * user_rating

        if score > 0:
            scores[candidate_eid] = score

    return scores


def _cosine_similarity(
    a: dict[int, float],
    b: dict[int, float],
    mag_a: float,
    mag_b: float,
) -> float:
    """
    Cosine similarity between two sparse vectors keyed by event_id.
    Dot product is computed over events both users have rated (a[i] > 0 && b[i] > 0),
    but magnitudes use the precomputed values.
    """
    common = {k for k in a.keys() & b.keys() if a[k] > 0 and b[k] > 0}
    if not common:
        return 0.0
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    dot = sum(a[k] * b[k] for k in common)
    return dot / (mag_a * mag_b)


def _cosine_similarity_generic(
    a: dict[str, float],
    b: dict[str, float],
    mag_a: float,
    mag_b: float,
) -> float:
    """Cosine similarity between two sparse vectors keyed by string.

    Dot product is over common keys; magnitudes are precalculated values.
    """
    common = set(a.keys()) & set(b.keys())
    if not common:
        return 0.0
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    dot = sum(a[k] * b[k] for k in common)
    return dot / (mag_a * mag_b)
