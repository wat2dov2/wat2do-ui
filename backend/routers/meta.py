"""Public ``/meta/constants`` - shared domain enums for the frontend."""

from fastapi import APIRouter, Response

from core.constants import (
    CLUB_CATEGORIES,
    EVENT_CATEGORIES,
    INTEREST_TO_CATEGORIES,
    REPORT_STATUSES,
)
from schemas.meta import AppConstantsResponse

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/constants", response_model=AppConstantsResponse)
def get_constants(response: Response):
    """Return shared domain constants for frontend consumption.

    Public and cacheable. ``Cache-Control: public, max-age=60`` so repeat
    scrapes hit CDN/browser cache; 60 s keeps category/interest deploys
    visible within a minute.
    """
    response.headers["Cache-Control"] = "public, max-age=60"
    return AppConstantsResponse(
        event_categories=list(EVENT_CATEGORIES),
        club_categories=list(CLUB_CATEGORIES),
        interests=list(INTEREST_TO_CATEGORIES.keys()),
        interest_to_categories=INTEREST_TO_CATEGORIES,
        report_statuses=list(REPORT_STATUSES),
    )
