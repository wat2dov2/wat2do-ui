"""Collaborative filtering: user-based and item-based with cosine similarity."""

import math

from services import interaction_service, saved_event_service


# Minimum interactions required for CF to be meaningful.
MIN_INTERACTIONS = 3


def get_collaborative_scores(
    user_id: str,
    candidate_event_ids: list[int],
) -> dict[int, float]:
    """
    Blend of user-based and item-based CF.
    Returns {event_id: score} for candidate events.
    Returns empty dict if user has too few interactions (cold start).
    """
    matrix = interaction_service.get_interaction_matrix()
    saves = saved_event_service.get_all_user_saves()

    # Build user vectors: {user_id: {event_id: score}}
    user_vectors: dict[str, dict[int, float]] = {}
    for row in matrix:
        uid = row["user_id"]
        if uid not in user_vectors:
            user_vectors[uid] = {}
        user_vectors[uid][row["event_id"]] = row["score"]

    # Merge saves into matrix (save = weight 5)
    for s in saves:
        uid, eid = s["user_id"], s["event_id"]
        if uid not in user_vectors:
            user_vectors[uid] = {}
        user_vectors[uid][eid] = user_vectors[uid].get(eid, 0) + 5.0

    target_vec = user_vectors.get(user_id, {})
    if len(target_vec) < MIN_INTERACTIONS:
        return {}

    candidate_set = set(candidate_event_ids)
    unseen = candidate_set - set(target_vec.keys())
    if not unseen:
        return {}

    # User-based CF
    user_scores = _user_based_cf(user_id, target_vec, user_vectors, unseen)

    # Item-based CF
    item_scores = _item_based_cf(target_vec, user_vectors, unseen)

    # Blend 50/50
    all_eids = set(user_scores.keys()) | set(item_scores.keys())
    blended: dict[int, float] = {}
    for eid in all_eids:
        u = user_scores.get(eid, 0)
        i = item_scores.get(eid, 0)
        blended[eid] = 0.5 * u + 0.5 * i

    # Normalize to [0, 1]
    if blended:
        max_score = max(blended.values())
        if max_score > 0:
            for eid in blended:
                blended[eid] /= max_score

    return blended


def _user_based_cf(
    target_uid: str,
    target_vec: dict[int, float],
    user_vectors: dict[str, dict[int, float]],
    unseen_eids: set[int],
    k: int = 20,
) -> dict[int, float]:
    """Find K most similar users, predict scores for unseen events."""
    similarities: list[tuple[str, float]] = []
    for uid, vec in user_vectors.items():
        if uid == target_uid:
            continue
        sim = _cosine_similarity(target_vec, vec)
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
    user_vectors: dict[str, dict[int, float]],
    unseen_eids: set[int],
) -> dict[int, float]:
    """Score unseen events by similarity to events the user has interacted with."""
    # Build item vectors: {event_id: {user_id: score}}
    item_vectors: dict[int, dict[str, float]] = {}
    for uid, vec in user_vectors.items():
        for eid, score in vec.items():
            if eid not in item_vectors:
                item_vectors[eid] = {}
            item_vectors[eid][uid] = score

    scores: dict[int, float] = {}
    for candidate_eid in unseen_eids:
        candidate_vec = item_vectors.get(candidate_eid, {})
        if not candidate_vec:
            continue

        score = 0.0
        for user_eid, user_rating in target_vec.items():
            if user_rating <= 0:
                continue
            item_vec = item_vectors.get(user_eid, {})
            if not item_vec:
                continue
            sim = _cosine_similarity_generic(candidate_vec, item_vec)
            if sim > 0:
                score += sim * user_rating

        if score > 0:
            scores[candidate_eid] = score

    return scores


def _cosine_similarity(a: dict[int, float], b: dict[int, float]) -> float:
    """
    Cosine similarity between two sparse vectors keyed by event_id.
    Only computes over events both users have rated (a[i] > 0 && b[i] > 0).
    """
    common = {k for k in a.keys() & b.keys() if a[k] > 0 and b[k] > 0}
    if not common:
        return 0.0
    dot = sum(a[k] * b[k] for k in common)
    mag_a = math.sqrt(sum(a[k] ** 2 for k in common))
    mag_b = math.sqrt(sum(b[k] ** 2 for k in common))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _cosine_similarity_generic(a: dict[str, float], b: dict[str, float]) -> float:
    """Cosine similarity between two sparse vectors keyed by string.

    Magnitudes are computed over common keys only (matching _cosine_similarity)
    so that user-based and item-based CF produce comparable score scales.
    """
    common = set(a.keys()) & set(b.keys())
    if not common:
        return 0.0
    dot = sum(a[k] * b[k] for k in common)
    mag_a = math.sqrt(sum(a[k] ** 2 for k in common))
    mag_b = math.sqrt(sum(b[k] ** 2 for k in common))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
