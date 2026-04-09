import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from postgrest.exceptions import APIError

from core.auth import get_optional_user, resolve_db_user
from core.client_ip import get_client_ip
from core.constants import MAX_INTERACTION_BATCH_SIZE
from core.errors import BATCH_TOO_LARGE, USER_ID_MISMATCH
from core.rate_limit import RateLimiter, anon_interaction_rate_limiter
from schemas.interaction import InteractionBatch
from services import interaction_service

# Rate limiter for authenticated interaction submissions.
# More generous than the AI limiter: 30 batch requests per 60 seconds.
_interaction_limiter = RateLimiter(max_requests=30, window_seconds=60)

router = APIRouter(prefix="/interactions", tags=["interactions"])
log = logging.getLogger(__name__)


@router.post("/batch", status_code=status.HTTP_202_ACCEPTED)
def record_interactions(
    data: InteractionBatch,
    request: Request,
    auth_user: dict | None = Depends(get_optional_user),
):
    """
    Record a batch of user-event interactions.

    Auth is via the standard ``Authorization: Bearer <token>`` header.
    The frontend uses ``fetch()`` with ``keepalive: true`` (instead of
    ``sendBeacon``) so it can set this header even during page unload.

    When a user is authenticated:
    - Batch size is capped at ``MAX_INTERACTION_BATCH_SIZE``.
    - Duplicate interactions are deduplicated within a sliding time window.

    When ``user_id`` is present in the payload it MUST match the authenticated
    user — submitting interactions on behalf of another user is rejected.

    Anonymous requests (no auth at all) are still allowed for basic
    view/impression tracking, but without a ``user_id`` they cannot influence
    personalised recommendations or collaborative filtering scores.
    Anonymous requests are IP-rate-limited to prevent abuse.
    """
    # ── Batch size guard (always enforced) ────────────────────────────
    if len(data.interactions) > MAX_INTERACTION_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=BATCH_TOO_LARGE.format(limit=MAX_INTERACTION_BATCH_SIZE),
        )

    # ── Resolve user identity ─────────────────────────────────────────
    user_id: str | None = None
    if auth_user is not None:
        db_user = resolve_db_user(auth_user)
        user_id = str(db_user.id)

    # ── Rate limit ───────────────────────────────────────────────────
    # Authenticated users: keyed by user ID (existing behavior).
    # Anonymous requests: keyed by client IP to prevent automated flooding.
    if user_id is not None:
        _interaction_limiter._check(user_id)
    else:
        anon_interaction_rate_limiter._check(get_client_ip(request))

    # ── User-ID ownership check ───────────────────────────────────────
    # If the client sends a user_id in the payload it MUST match.
    if data.user_id is not None:
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=USER_ID_MISMATCH,
            )
        if data.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=USER_ID_MISMATCH,
            )

    # ── Deduplication (authenticated users only) ──────────────────────
    interactions = data.interactions
    if user_id is not None:
        interactions = interaction_service.check_duplicate_interactions(
            user_id=user_id,
            interactions=interactions,
        )
        if not interactions:
            return {"recorded": 0}

    # ── Persist ───────────────────────────────────────────────────────
    try:
        count = interaction_service.record_interactions(
            user_id=user_id,
            session_id=data.session_id,
            interactions=interactions,
        )
        return {"recorded": count}
    except APIError as e:
        log.warning("interactions table unavailable: %s", e)
        return {"recorded": 0}
