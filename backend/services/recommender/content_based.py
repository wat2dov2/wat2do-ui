"""Content-based filtering: score events by metadata match to user profile."""

import logging
from datetime import datetime, timezone

from constants import INTEREST_TO_CATEGORIES
from core.database import get_sb
from schemas.event import EventResponse
from services import user_service, interaction_service

log = logging.getLogger(__name__)


def get_content_scores(
    user_id: str,
    candidate_events: list[EventResponse],
) -> dict[int, float]:
    """
    Score each candidate event based on how well it matches the user profile.
    Returns {event_id: score} with scores in [0, 1].
    """
    user = user_service.get_user(user_id)
    if not user:
        return {}

    interests = user.interests or []
    user_school = user.school or ""
    is_first_year = user.is_first_year or False

    # Map interests to event categories
    matched_categories: set[str] = set()
    for interest in interests:
        cats = INTEREST_TO_CATEGORIES.get(interest, [])
        matched_categories.update(cats)

    # Build org affinity from past interactions (graceful if table missing)
    try:
        user_scores = interaction_service.get_user_event_scores(user_id)
        org_affinity = _compute_org_affinity(user_scores, candidate_events)
    except Exception as e:
        log.warning("Failed to build org affinity for user %s: %s", user_id, e)
        user_scores = {}
        org_affinity = {}

    now = datetime.now(timezone.utc)
    scores: dict[int, float] = {}

    for event in candidate_events:
        eid = event.id
        score = 0.0

        # Category match (weight: 0.4)
        cat = event.category or ""
        if matched_categories and cat in matched_categories:
            score += 0.4
        elif not matched_categories:
            score += 0.2

        # School match (weight: 0.15)
        event_school = event.school or ""
        if user_school and event_school and user_school == event_school:
            score += 0.15

        # Org affinity (weight: 0.15)
        org = event.organization or ""
        if org in org_affinity:
            score += 0.15 * min(org_affinity[org], 1.0)

        # Temporal relevance (weight: 0.15)
        dtstart = event.dtstart_utc
        if dtstart:
            try:
                if isinstance(dtstart, str):
                    event_time = datetime.fromisoformat(dtstart.replace("Z", "+00:00"))
                else:
                    event_time = dtstart if dtstart.tzinfo else dtstart.replace(tzinfo=timezone.utc)
                hours_away = (event_time - now).total_seconds() / 3600
                if hours_away < 0:
                    score += 0.0
                elif hours_away < 24:
                    score += 0.15
                elif hours_away < 72:
                    score += 0.12
                elif hours_away < 168:
                    score += 0.08
                else:
                    score += 0.04
            except (ValueError, TypeError):
                score += 0.04

        # Price (weight: 0.05) — free events get a slight boost
        price = event.price
        if price is None or price == 0:
            score += 0.05

        # Food availability (weight: 0.05)
        food = event.food
        if food and len(food) > 0:
            score += 0.05

        # First-year boost (weight: 0.05)
        if is_first_year:
            first_year_cats = {"Academics", "Networking", "Culture", "Sports"}
            if cat in first_year_cats:
                score += 0.05

        scores[eid] = score

    # Normalize to [0, 1] for consistent blending with other scoring strategies
    if scores:
        max_score = max(scores.values())
        if max_score > 0:
            for eid in scores:
                scores[eid] /= max_score

    return scores


def _compute_org_affinity(
    user_scores: dict[int, float],
    candidate_events: list[EventResponse],
) -> dict[str, float]:
    """Build org affinity from user's past interactions."""
    if not user_scores:
        return {}

    id_to_org: dict[int, str] = {}
    for e in candidate_events:
        org = e.organization
        if org:
            id_to_org[e.id] = org

    # Also load past events the user interacted with
    interacted_ids = list(user_scores.keys())
    if interacted_ids:
        r = (
            get_sb()
            .table("events")
            .select("id, organization")
            .in_("id", interacted_ids)
            .execute()
        )
        for row in r.data or []:
            if row.get("organization"):
                id_to_org[row["id"]] = row["organization"]

    # Aggregate scores per org
    org_scores: dict[str, float] = {}
    total = 0.0
    for eid, score in user_scores.items():
        org = id_to_org.get(eid)
        if org and score > 0:
            org_scores[org] = org_scores.get(org, 0) + score
            total += score

    if total > 0:
        for org in org_scores:
            org_scores[org] /= total

    return org_scores
