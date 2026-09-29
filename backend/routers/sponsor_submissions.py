from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from core.auth import get_admin_user
from core.constants import MAX_SCHOOL_LENGTH, MAX_SEARCH_QUERY_LENGTH
from core.controlbox import controlbox
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import RateLimiter
from schemas.auth import MessageResponse
from schemas.sponsor_submission import (
    SponsorSubmissionCreate,
    SponsorSubmissionResponse,
    SponsorSubmissionReview,
)
from schemas.submission import SubmissionStatus
from schemas.user import UserResponse
from services import contact_service, sponsor_submission_service
from services.email_service import email_service

router = APIRouter(prefix="/sponsor-submissions", tags=["sponsor-submissions"])
_limiter = RateLimiter(
    max_requests=controlbox.contact.rate_limit.maximum_requests,
    window_seconds=controlbox.contact.rate_limit.window_seconds,
)


@router.post("/", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def create_submission(
    data: SponsorSubmissionCreate,
    background_tasks: BackgroundTasks,
    _rl: None = Depends(_limiter.ip_dependency()),
):
    sponsor_submission_service.create_submission(data)
    background_tasks.add_task(email_service.send_safely, contact_service.build_contact_email(data))
    return MessageResponse(message="Sponsor submission received")


@router.get("/", response_model=PaginatedResponse[SponsorSubmissionResponse])
def list_submissions(
    submission_status: SubmissionStatus | None = Query(default=None),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = sponsor_submission_service.list_submissions(
        status=submission_status,
        school=school,
        search=search,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.patch("/{submission_id}", response_model=SponsorSubmissionResponse)
def review_submission(
    submission_id: UUID,
    data: SponsorSubmissionReview,
    admin: UserResponse = Depends(get_admin_user),
):
    return sponsor_submission_service.review_submission(
        str(submission_id), data.status, str(admin.id)
    )
