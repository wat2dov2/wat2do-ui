import logging

from fastapi import APIRouter
from postgrest.exceptions import APIError

from core.database import supabase
from schemas.interaction import InteractionBatch
from services import interaction_service, user_service

router = APIRouter(prefix="/interactions", tags=["interactions"])
log = logging.getLogger(__name__)


def _resolve_user_from_token(token: str | None) -> str | None:
    """Resolve a DB user ID from a Supabase auth token. Returns None on failure."""
    if not token:
        return None
    try:
        res = supabase.auth.get_user(token)
        if res and res.user:
            db_user = user_service.get_user_by_supabase_id(res.user.id)
            if db_user:
                return str(db_user.id)
    except Exception:
        pass
    return None


@router.post("/batch", status_code=202)
def record_interactions(data: InteractionBatch):
    """
    Record a batch of user-event interactions.
    Auth is optional — token is passed in the body (for sendBeacon compat).
    Anonymous users tracked by session_id only.
    """
    user_id = _resolve_user_from_token(data.token)

    try:
        count = interaction_service.record_interactions(
            user_id=user_id,
            session_id=data.session_id,
            interactions=data.interactions,
        )
        return {"recorded": count}
    except APIError as e:
        log.warning("interactions table unavailable: %s", e)
        return {"recorded": 0}
