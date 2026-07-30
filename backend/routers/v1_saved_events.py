from fastapi import APIRouter, Depends, status

from core.auth import get_db_user
from core.errors import EVENT_NOT_FOUND
from core.exceptions import NotFoundError
from schemas.v1_saved_event import V1SavedEventStatusResponse
from services import event_service, v1_saved_event_service

router = APIRouter(prefix="/v1/saved-events", tags=["v1-saved-events"])


@router.get("/", response_model=list[int])
def list_saved_events(user=Depends(get_db_user)):
    return v1_saved_event_service.get_saved_event_ids(str(user.id))


@router.put(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=V1SavedEventStatusResponse,
)
def save_event(event_id: int, user=Depends(get_db_user)):
    if event_service.get_event(event_id) is None:
        raise NotFoundError(EVENT_NOT_FOUND)
    v1_saved_event_service.save_event(str(user.id), event_id)
    return {"status": "saved"}


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_200_OK,
    response_model=V1SavedEventStatusResponse,
)
def unsave_event(event_id: int, user=Depends(get_db_user)):
    v1_saved_event_service.unsave_event(str(user.id), event_id)
    return {"status": "unsaved"}
