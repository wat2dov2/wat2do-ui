import logging

from fastapi import APIRouter, Depends

from core.auth import get_admin_user
from schemas.scraped_event import ScrapedEventCreate, ScrapedEventResponse
from services import scraped_event_service

router = APIRouter(prefix="/scraped-events", tags=["scraped-events"])
log = logging.getLogger(__name__)


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
