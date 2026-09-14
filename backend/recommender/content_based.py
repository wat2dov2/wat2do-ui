"""Content-based filtering: score events by metadata match to user profile."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from schemas.user import UserResponse

from core.constants import INTEREST_TO_CATEGORIES
from core.database import get_sb
from core.tables import EVENTS
from recommender.config import (
    CB_CATEGORY_MATCH,
    CB_CATEGORY_NO_PROFILE,
    CB_FIRST_YEAR,
    CB_FREE_EVENT,
    CB_HAS_FOOD,
    CB_ORG_AFFINITY,
    CB_SCHOOL_MATCH,
    CB_TEMPORAL_FALLBACK,
    CB_TEMPORAL_TIERS,
    FIRST_YEAR_CATEGORIES,
)
from recommender.utils import normalize_scores
from schemas.event import EventResponse

log = logging.getLogger(__name__)


def get_content_scores(
    candidate_events: list[EventResponse],
    *,
    user: UserResponse | None = None,
    user_scores: dict[int, float] | None = None,
) -> dict[int, float]:
    """Score candidates against a supplied profile and optional interaction scores."""
    if user_scores is None:
        user_scores = {}

    if not user:
        return {}

    interests = user.interests or []
    user_school = user.school or ""
    is_first_year = user.is_first_year or False

    matched_categories: set[str] = set()
    for interest in interests:
        cats = INTEREST_TO_CATEGORIES.get(interest, [])
        matched_categories.update(cats)

    org_affinity = _compute_org_affinity(user_scores, candidate_events)

    now = datetime.now(timezone.utc)
    scores: dict[int, float] = {}

    for event in candidate_events:
        eid = event.id
        score = 0.0

        cat = event.category or ""
        if matched_categories and cat in matched_categories:
            score += CB_CATEGORY_MATCH
        elif not matched_categories:
            score += CB_CATEGORY_NO_PROFILE

        event_school = event.school or ""
        if user_school and event_school and user_school == event_school:
            score += CB_SCHOOL_MATCH

        org = event.club or ""
        if org in org_affinity:
            score += CB_ORG_AFFINITY * min(org_affinity[org], 1.0)

        dtstart = None
        if event.occurrences:
            future_occs = [
                o
                for o in event.occurrences
                if (
                    o.dtstart_utc
                    if o.dtstart_utc.tzinfo
                    else o.dtstart_utc.replace(tzinfo=timezone.utc)
                )
                >= now
            ]
            pool = future_occs or list(event.occurrences)
            pool.sort(key=lambda o: o.dtstart_utc)
            dtstart = pool[0].dtstart_utc

        if dtstart:
            try:
                event_time = dtstart if dtstart.tzinfo else dtstart.replace(tzinfo=timezone.utc)
                hours_away = (event_time - now).total_seconds() / 3600
                if hours_away >= 0:
                    for max_hours, weight in CB_TEMPORAL_TIERS:
                        if hours_away < max_hours:
                            score += weight
                            break
                    else:
                        score += CB_TEMPORAL_FALLBACK
            except (ValueError, TypeError) as e:
                log.warning("Bad dtstart for event %s, using fallback: %s", eid, e)
                score += CB_TEMPORAL_FALLBACK

        price = event.price
        if price is None or price == 0:
            score += CB_FREE_EVENT

        food = event.food
        if food:
            score += CB_HAS_FOOD

        if is_first_year and cat in FIRST_YEAR_CATEGORIES:
            score += CB_FIRST_YEAR

        scores[eid] = score

    return normalize_scores(scores)


def _compute_org_affinity(
    user_scores: dict[int, float],
    candidate_events: list[EventResponse],
) -> dict[str, float]:
    """Build org affinity from user's past interactions."""
    if not user_scores:
        return {}

    id_to_org: dict[int, str] = {}
    for e in candidate_events:
        org = e.club
        if org:
            id_to_org[e.id] = org

    # Load org data only for interacted events not already in the candidate set.
    missing_ids = [eid for eid in user_scores if eid not in id_to_org]
    if missing_ids:
        try:
            r = get_sb().table(EVENTS).select("id, club").in_("id", missing_ids).execute()
            for row in r.data or []:
                if row.get("club"):
                    id_to_org[row["id"]] = row["club"]
        except Exception as e:
            log.warning("Failed to load org data for interacted events: %s", e)

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
