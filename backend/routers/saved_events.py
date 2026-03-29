from fastapi import APIRouter, Depends, status

from core.auth import get_current_user
from services import saved_event_service

router = APIRouter(prefix="/saved-events", tags=["saved-events"])


@router.get("/", response_model=list[int])
def list_saved_events(auth_user: dict = Depends(get_current_user)):
    """Return event IDs saved by the current user."""
    user = _resolve_db_user(auth_user)
    return saved_event_service.get_saved_event_ids(user["id"])


@router.put("/{event_id}", status_code=status.HTTP_200_OK)
def save_event(event_id: int, auth_user: dict = Depends(get_current_user)):
    """Save (bookmark) an event."""
    user = _resolve_db_user(auth_user)
    saved_event_service.save_event(user["id"], event_id)
    return {"status": "saved"}


@router.delete("/{event_id}", status_code=status.HTTP_200_OK)
def unsave_event(event_id: int, auth_user: dict = Depends(get_current_user)):
    """Remove a saved event."""
    user = _resolve_db_user(auth_user)
    saved_event_service.unsave_event(user["id"], event_id)
    return {"status": "unsaved"}


def _resolve_db_user(auth_user: dict) -> dict:
    """Look up DB user from Supabase auth user. Returns dict with 'id'."""
    from services import user_service

    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="User not found")
    return db_user
