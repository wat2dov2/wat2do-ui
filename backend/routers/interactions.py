import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from postgrest.exceptions import APIError

from fastapi.security import HTTPAuthorizationCredentials

from core.auth import get_optional_user, resolve_db_user, _resolve_user
from core.constants import MAX_INTERACTION_BATCH_SIZE
from core.errors import BATCH_TOO_LARGE, USER_ID_MISMATCH
from core.rate_limit import RateLimiter, anon_interaction_rate_limiter
from schemas.interaction import InteractionBatch
from services import interaction_service, user_service

# Rate limiter for authenticated interaction submissions.
# More generous than the AI limiter: 30 batch requests per 60 seconds.
_interaction_limiter = RateLimiter(max_requests=30, window_seconds=60)

router = APIRouter(prefix="/interactions", tags=["interactions"])
log = logging.getLogger(__name__)


def _resolve_user_from_body_token(token: str | None) -> str | None:
    """Resolve a DB user ID from a Supabase auth token sent in the request body.

    This exists for ``sendBeacon`` compatibility — the browser API cannot set
    custom headers, so the token is sent in the JSON payload instead.
    Returns None on failure (invalid / expired token, missing DB user).
    """
    if not token:
        return None
    try:
        cred = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        auth_user = _resolve_user(cred)
        db_user = user_service.get_user_by_supabase_id(auth_user["id"])
        if db_user:
            return str(db_user.id)
    except Exception as e:
        log.warning("Body-token user resolution failed: %s", e)
    return None


@router.post("/batch", status_code=status.HTTP_202_ACCEPTED)
def record_interactions(
    data: InteractionBatch,
    request: Request,
    auth_user: dict | None = Depends(get_optional_user),
):
    """
    Record a batch of user-event interactions.

    Supports two auth mechanisms:
    1. **Bearer header** (preferred) — standard ``Authorization: Bearer <token>``
    2. **Body token** (sendBeacon fallback) — ``token`` field in the JSON payload,
       because ``navigator.sendBeacon`` cannot set custom headers.

    When a user is authenticated (via either mechanism):
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
    # Prefer Bearer header auth; fall back to body token for sendBeacon.
    user_id: str | None = None
    if auth_user is not None:
        db_user = resolve_db_user(auth_user)
        user_id = str(db_user.id)
    elif data.token:
        user_id = _resolve_user_from_body_token(data.token)

    # ── Rate limit ───────────────────────────────────────────────────
    # Authenticated users: keyed by user ID (existing behavior).
    # Anonymous requests: keyed by client IP to prevent automated flooding.
    if user_id is not None:
        _interaction_limiter._check(user_id)
    else:
        client_ip = request.client.host if request.client else "unknown"
        anon_interaction_rate_limiter._check(client_ip)

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
