from fastapi import APIRouter, Request

from schemas.interaction import InteractionBatch
from services import interaction_service

router = APIRouter(prefix="/interactions", tags=["interactions"])


@router.post("/batch", status_code=202)
def record_interactions(
    data: InteractionBatch,
    request: Request,
):
    """
    Record a batch of user-event interactions.
    Auth is optional — anonymous users tracked by session_id only.
    """
    user_id: str | None = None
    try:
        # Try to extract auth user if token is present
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            from core.database import supabase

            token = auth_header.split(" ", 1)[1]
            res = supabase.auth.get_user(token)
            if res and res.user:
                from services import user_service

                db_user = user_service.get_user_by_supabase_id(res.user.id)
                if db_user:
                    user_id = db_user["id"]
    except Exception:
        pass  # Anonymous tracking is fine

    count = interaction_service.record_interactions(
        user_id=user_id,
        session_id=data.session_id,
        interactions=[i.model_dump() for i in data.interactions],
    )
    return {"recorded": count}
