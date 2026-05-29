"""User-event interaction tracking and aggregation.

This module is a thin CRUD/dedup layer.  Recommendation-specific scoring
(get_user_event_scores, get_interaction_matrix, get_event_popularity, and
cache infrastructure) lives in recommender.interaction_scores so
that this service has no dependency on recommender config.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from core.constants import (
    DEDUP_WINDOW_MINUTES,
    INTERACTION_CLICK,
    INTERACTION_DETAIL_VIEW,
    INTERACTION_SAVE,
    INTERACTION_SHARE,
    MAX_DUPLICATE_INTERACTIONS,
    MAX_INTERACTION_BATCH_SIZE,
    MAX_USER_INTERACTIONS_PER_WINDOW,
)
from core.database import get_sb
from core.exceptions import AuthenticationError, AuthorizationError, ValidationError
from core.pagination import iter_all_pages
from core.tables import USER_INTERACTIONS
from schemas.interaction import InteractionCreate

log = logging.getLogger(__name__)


# Anonymous interactions are accepted only for the low-signal ``view``
# (and ``unsave``) types.  High-signal types (save/click/share/detail_view)
# feed popularity + collaborative-filtering scoring and would otherwise let
# a rotating-IP attacker inflate any event's ranking for free (audit I18).
_ANON_DISALLOWED_INTERACTION_TYPES: frozenset[str] = frozenset(
    {
        INTERACTION_SAVE,
        INTERACTION_CLICK,
        INTERACTION_SHARE,
        INTERACTION_DETAIL_VIEW,
    }
)

_AB_CLICK_INTERACTION_TYPES: frozenset[str] = frozenset(
    {INTERACTION_CLICK, INTERACTION_DETAIL_VIEW}
)


def _record_ab_click_events(user_id: str | None, interactions: list[InteractionCreate]) -> None:
    """Mirror authenticated click/detail interactions into A/B CTR events."""
    if user_id is None:
        return
    event_ids = sorted(
        {
            item.event_id
            for item in interactions
            if item.interaction_type in _AB_CLICK_INTERACTION_TYPES
        }
    )
    if not event_ids:
        return

    try:
        from services.ab_test_service import ab_test

        variant = ab_test.get_user_variant(user_id)
        for event_id in event_ids:
            ab_test.record_click(user_id, event_id, variant)
    except Exception as e:
        log.warning("A/B click tracking failed for user=%s events=%s: %s", user_id, event_ids, e)


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
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "session_id": session_id,
                "event_id": item.event_id,
                "interaction_type": item.interaction_type,
                "metadata": item.metadata,
            }
        )
    r = get_sb().table(USER_INTERACTIONS).insert(rows).execute()
    return len(r.data) if r.data else 0


def _validate_batch(
    user_id: str | None,
    payload_user_id: str | None,
    interactions: list[InteractionCreate],
) -> None:
    """Validate batch size and user-ID ownership.

    Raises ``ValidationError``, ``AuthenticationError``, or
    ``AuthorizationError`` on failure.
    """
    if len(interactions) > MAX_INTERACTION_BATCH_SIZE:
        raise ValidationError(
            f"Batch exceeds maximum size of {MAX_INTERACTION_BATCH_SIZE} interactions",
        )
    if payload_user_id is not None:
        if user_id is None:
            raise AuthenticationError(
                "Cannot submit interactions on behalf of another user",
            )
        if payload_user_id != user_id:
            raise AuthorizationError(
                "Cannot submit interactions on behalf of another user",
            )


def record_interactions_batch(
    user_id: str | None,
    payload_user_id: str | None,
    session_id: str,
    interactions: list[InteractionCreate],
) -> int:
    """Orchestrate a batch interaction request: validate, dedup, persist.

    Business rules:
    - Batch size is capped at ``MAX_INTERACTION_BATCH_SIZE``.
    - If the payload contains a ``user_id`` it must match the authenticated
      user.  Unauthenticated requests may not send a ``user_id``.
    - Authenticated users get deduplication; anonymous users do not.
    - DB errors propagate — the global APIError handler returns 502 so
      clients can retry rather than silently receiving ``{"recorded": 0}``
      (which is indistinguishable from "successfully deduped to empty").
      See audit finding D11.

    Raises ``ValidationError``, ``AuthenticationError``, or
    ``AuthorizationError`` on validation/auth failures.
    Returns the number of interactions recorded.
    """
    _validate_batch(user_id, payload_user_id, interactions)

    # ── Anonymous: filter out high-signal interaction types (audit I18) ──
    # Anonymous callers can still record ``view`` impressions for basic
    # telemetry, but ``save``/``click``/``share``/``detail_view`` feed
    # popularity + collaborative-filtering scores; letting them through
    # unauthenticated would allow a rotating-IP attacker to inflate any
    # event's ranking.  Dedup is also skipped for anonymous users, so the
    # only defensible posture is to reject these types outright.
    if user_id is None:
        filtered = [
            item
            for item in interactions
            if item.interaction_type not in _ANON_DISALLOWED_INTERACTION_TYPES
        ]
        dropped = len(interactions) - len(filtered)
        if dropped:
            log.warning(
                "Dropped %d anonymous interactions of restricted types (session=%s)",
                dropped,
                session_id,
            )
        interactions = filtered
        if not interactions:
            return 0

    # ── Deduplication (authenticated users only) ─────────────────────
    if user_id is not None:
        interactions = check_duplicate_interactions(
            user_id=user_id,
            interactions=interactions,
        )
        if not interactions:
            return 0

    # ── Persist ──────────────────────────────────────────────────────
    # D11: do NOT swallow APIError here.  A transient table/RLS/network
    # failure used to return 0 (identical to a successful empty-after-dedup
    # batch) so the frontend thought tracking was healthy while interactions
    # silently dropped on the floor.  Propagating lets the global handler
    # map the error to 502 with a clear logline for observability.
    recorded = record_interactions(
        user_id=user_id,
        session_id=session_id,
        interactions=interactions,
    )
    if recorded:
        _record_ab_click_events(user_id, interactions)
    return recorded


def get_user_interaction_count(user_id: str) -> int:
    """Count total interactions for a user. Used to determine user 'temperature'."""
    r = (
        get_sb()
        .table(USER_INTERACTIONS)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return r.count or 0


def get_user_interaction_counts(user_ids: list[str]) -> dict[str, int]:
    """Batch-fetch interaction counts for multiple users.

    Returns {user_id: count} for the given user IDs. Users with zero
    interactions are omitted from the result (callers should use
    ``counts.get(uid, 0)``).

    This avoids N sequential DB round-trips when evaluating many users.
    """
    if not user_ids:
        return {}

    counts: dict[str, int] = {}
    for row in iter_all_pages(
        lambda offset, ps: (
            (
                get_sb()
                .table(USER_INTERACTIONS)
                .select("user_id")
                .in_("user_id", user_ids)
                .order("created_at")
                .range(offset, offset + ps - 1)
                .execute()
            ).data
            or []
        ),
    ):
        uid = row["user_id"]
        counts[uid] = counts.get(uid, 0) + 1

    return counts


def check_duplicate_interactions(
    user_id: str,
    interactions: list[InteractionCreate],
) -> list[InteractionCreate]:
    """Filter out interactions that exceed deduplication or global rate thresholds.

    Two limits are enforced within the sliding dedup window:

    1. **Per-(event, type) cap** -- ``MAX_DUPLICATE_INTERACTIONS`` identical
       interactions per event per type.  Prevents hammering the same event.
    2. **Global per-user cap** -- ``MAX_USER_INTERACTIONS_PER_WINDOW`` total
       interactions across all events/types.  Prevents bots from spreading
       interactions across many events to game popularity scores.

    Returns the filtered list.
    """
    if not interactions:
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=DEDUP_WINDOW_MINUTES)).isoformat()

    # Fetch recent interactions for this user within the window.
    # R14: pagination via iter_all_pages so heavy users (> 1000 interactions
    # within the dedup window) aren't silently truncated by PostgREST's
    # default max-rows limit, which would cause the per-event and global
    # caps to stop firing.
    try:
        existing: list[dict] = list(
            iter_all_pages(
                lambda offset, ps: (
                    (
                        get_sb()
                        .table(USER_INTERACTIONS)
                        .select("event_id, interaction_type")
                        .eq("user_id", user_id)
                        .gte("created_at", cutoff)
                        .order("created_at")
                        .range(offset, offset + ps - 1)
                        .execute()
                    ).data
                    or []
                ),
            )
        )
    except Exception as e:
        log.error("Dedup check failed, rejecting batch to prevent gaming: %s", e)
        return []

    # Count existing (event_id, type) pairs and total interactions
    counts: dict[tuple[int, str], int] = {}
    total_in_window = len(existing)
    for row in existing:
        key = (row["event_id"], row["interaction_type"])
        counts[key] = counts.get(key, 0) + 1

    filtered: list[InteractionCreate] = []
    for item in interactions:
        # Global per-user cap across all events/types
        if total_in_window >= MAX_USER_INTERACTIONS_PER_WINDOW:
            log.warning(
                "Dropping interaction user=%s event=%s type=%s — global cap reached (%d/%d)",
                user_id,
                item.event_id,
                item.interaction_type,
                total_in_window,
                MAX_USER_INTERACTIONS_PER_WINDOW,
            )
            continue

        # Per-(event, type) cap
        key = (item.event_id, item.interaction_type)
        current = counts.get(key, 0)
        if current >= MAX_DUPLICATE_INTERACTIONS:
            log.warning(
                "Dropping duplicate interaction user=%s event=%s type=%s (count=%d)",
                user_id,
                item.event_id,
                item.interaction_type,
                current,
            )
            continue

        # Track in-batch duplicates and global count
        counts[key] = current + 1
        total_in_window += 1
        filtered.append(item)

    return filtered
