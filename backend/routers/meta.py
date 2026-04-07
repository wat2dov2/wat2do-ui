"""Public metadata endpoint — serves shared domain constants.

The frontend fetches /meta/constants once on app init so that
categories, interest mappings, and status enums always come from
one source of truth (the backend).
"""

from typing import get_args

from fastapi import APIRouter

from constants import EVENT_CATEGORIES, INTEREST_TO_CATEGORIES
from schemas.meta import AppConstantsResponse
from schemas.submission import SubmissionStatus
from schemas.report import ReportStatus

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/constants", response_model=AppConstantsResponse)
def get_constants():
    """Return shared domain constants for frontend consumption.

    This endpoint is public (no auth required) and highly cacheable.
    """
    return AppConstantsResponse(
        event_categories=list(EVENT_CATEGORIES),
        interest_to_categories=INTEREST_TO_CATEGORIES,
        submission_statuses=list(get_args(SubmissionStatus)),
        report_statuses=list(get_args(ReportStatus)),
    )
