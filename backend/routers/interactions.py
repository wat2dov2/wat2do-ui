import logging

from fastapi import APIRouter, Depends, Request, status

from core.auth import get_optional_user, resolve_db_user
from core.client_ip import get_client_ip
from core.rate_limit import RateLimiter, anon_interaction_rate_limiter
from schemas.interaction import InteractionBatch, RecordInteractionsResponse
from services import interaction_service

# Rate limiter for authenticated interaction tracking requests.
# More generous than the AI limiter: 30 batch requests per 60 seconds.
_interaction_limiter = RateLimiter(max_requests=30, window_seconds=60)

router = APIRouter(prefix="/interactions", tags=["interactions"])
log = logging.getLogger(__name__)


@router.post(
    "/batch",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=RecordInteractionsResponse,
)
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
    authenticated analytics or personalization signals.
    Anonymous requests are IP-rate-limited to prevent abuse.
    """
    # ── Resolve user identity ─────────────────────────────────────────
    user_id: str | None = None
    if auth_user is not None:
        db_user = resolve_db_user(auth_user)
        user_id = str(db_user.id)

    # ── Rate limit (FastAPI concern — stays in router) ────────────────
    if user_id is not None:
        _interaction_limiter.check(user_id)
    else:
        anon_interaction_rate_limiter.check(get_client_ip(request))

    # ── Delegate business logic to service ────────────────────────────
    # ``data.user_id`` is a UUID (or None) after Pydantic parsing; the
    # service compares it to ``user_id: str | None`` from the auth layer,
    # so stringify here.  See audit S11 for the rationale behind typing
    # the payload field as UUID rather than str.
    payload_user_id = str(data.user_id) if data.user_id is not None else None
    count = interaction_service.record_interactions_batch(
        user_id=user_id,
        payload_user_id=payload_user_id,
        session_id=data.session_id,
        interactions=data.interactions,
    )
    return {"recorded": count}
