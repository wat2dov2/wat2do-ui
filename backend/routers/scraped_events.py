import logging

from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user, get_admin_user
from schemas.scraped_event import ScrapedEventCreate, ScrapedEventResponse
from services import scraped_event_service, user_service

router = APIRouter(prefix="/scraped-events", tags=["scraped-events"])
log = logging.getLogger(__name__)


def _resolve_db_user(auth_user: dict):
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@router.get("/", response_model=list[ScrapedEventResponse])
def list_scraped_events(_: dict = Depends(get_admin_user)):
    return scraped_event_service.get_scraped_events()


@router.post("/", response_model=ScrapedEventResponse, status_code=201)
def create_scraped_event(
    data: ScrapedEventCreate,
    _: dict = Depends(get_admin_user),
):
    return scraped_event_service.create_scraped_event(
        event_id=data.event_id,
        source=data.source,
        raw_data=data.raw_data,
    )
