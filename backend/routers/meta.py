"""Public metadata endpoint — serves shared domain constants.

The frontend fetches /meta/constants once on app init so that
categories, interest mappings, and status enums always come from
one source of truth (the backend).
"""

from fastapi import APIRouter, Response

from core.constants import (
    EVENT_CATEGORIES,
    INTEREST_TO_CATEGORIES,
    REPORT_STATUSES,
    SUBMISSION_STATUSES,
)
from schemas.meta import AppConstantsResponse

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/constants", response_model=AppConstantsResponse)
def get_constants(response: Response):
    """Return shared domain constants for frontend consumption.

    This endpoint is public (no auth required) and highly cacheable.
    Sets an explicit ``Cache-Control: public, max-age=60`` header so
    cheap repeat scrapes hit the CDN / browser cache rather than the
    application process (audit M13).  The cache window is deliberately
    short (60 s) so that category / interest changes deployed via a
    backend-only restart propagate within a minute.
    """
    response.headers["Cache-Control"] = "public, max-age=60"
    return AppConstantsResponse(
        event_categories=list(EVENT_CATEGORIES),
        interests=list(INTEREST_TO_CATEGORIES.keys()),
        interest_to_categories=INTEREST_TO_CATEGORIES,
        submission_statuses=list(SUBMISSION_STATUSES),
        report_statuses=list(REPORT_STATUSES),
    )
