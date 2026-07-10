import logging

from fastapi import APIRouter, Depends, Request, status

from core.auth import get_optional_user, resolve_db_user
from core.client_ip import get_client_ip
from core.rate_limit import RateLimiter, anon_interaction_rate_limiter
from schemas.interaction import InteractionBatch, RecordInteractionsResponse
from services import interaction_service

# Authenticated interaction batches: 30 requests / 60 s (more generous than AI).
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
    """Record a batch of user-event interactions.

    Auth via ``Authorization: Bearer`` (frontend uses ``fetch`` + ``keepalive``
    so the header works on unload). Authenticated batches are size-capped and
    deduped; payload ``user_id`` must match the authenticated user.
    Anonymous requests are allowed for basic view/click tracking and are
    IP-rate-limited; without ``user_id`` they cannot drive personalized signals.
    """
    user_id: str | None = None
    if auth_user is not None:
        db_user = resolve_db_user(auth_user)
        user_id = str(db_user.id)

    if user_id is not None:
        _interaction_limiter.check(user_id)
    else:
        anon_interaction_rate_limiter.check(get_client_ip(request))

    # Payload user_id is UUID; auth layer uses str - stringify here.
    payload_user_id = str(data.user_id) if data.user_id is not None else None
    count = interaction_service.record_interactions_batch(
        user_id=user_id,
        payload_user_id=payload_user_id,
        session_id=data.session_id,
        interactions=data.interactions,
    )
    return {"recorded": count}
