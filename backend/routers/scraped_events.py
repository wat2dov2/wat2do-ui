import logging

from fastapi import APIRouter, Depends, status

from core.auth import get_admin_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.scraped_event import ScrapedEventCreate, ScrapedEventResponse
from services import scraped_event_service

router = APIRouter(prefix="/scraped-events", tags=["scraped-events"])
log = logging.getLogger(__name__)


@router.get("/", response_model=PaginatedResponse[ScrapedEventResponse])
def list_scraped_events(
    pagination: PaginationParams = Depends(),
    _: dict = Depends(get_admin_user),
):
    items, total = scraped_event_service.get_scraped_events(
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.post("/", response_model=ScrapedEventResponse, status_code=status.HTTP_201_CREATED)
def create_scraped_event(
    data: ScrapedEventCreate,
    _: dict = Depends(get_admin_user),
):
    return scraped_event_service.create_scraped_event(
        event_id=data.event_id,
        source=data.source,
        raw_data=data.raw_data,
    )
