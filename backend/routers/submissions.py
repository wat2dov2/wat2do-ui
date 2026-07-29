import logging

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_optional_user, resolve_db_user
from core.constants import (
    MAX_SCHOOL_LENGTH,
    MAX_STATUS_FILTER_LENGTH,
    SUBMISSION_RATE_LIMIT_MAX_REQUESTS,
    SUBMISSION_RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import SUBMISSION_NOT_FOUND
from core.exceptions import get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import RateLimiter
from schemas.submission import SubmissionCreate, SubmissionResponse, SubmissionUpdate
from schemas.user import UserResponse
from services import submission_service

router = APIRouter(prefix="/submissions", tags=["submissions"])
log = logging.getLogger(__name__)

_submission_create_limiter = RateLimiter(
    max_requests=SUBMISSION_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=SUBMISSION_RATE_LIMIT_WINDOW_SECONDS,
)


@router.post("/", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_submission(
    data: SubmissionCreate,
    auth_user: dict | None = Depends(get_optional_user),
    _rl: None = Depends(_submission_create_limiter.dependency()),
):
    user: UserResponse | None = resolve_db_user(auth_user) if auth_user else None
    return submission_service.create_submission(str(user.id) if user else None, data.event_data)


@router.get("/", response_model=PaginatedResponse[SubmissionResponse])
def list_submissions(
    submission_status: str | None = Query(default=None, max_length=MAX_STATUS_FILTER_LENGTH),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    if school == "all":
        school = None
    items, total = submission_service.get_submissions(
        status=submission_status,
        school=school,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(
    submission_id: str,
    _: UserResponse = Depends(get_admin_user),
):
    return get_or_404(submission_service.get_submission_by_id(submission_id), SUBMISSION_NOT_FOUND)


@router.patch("/{submission_id}", response_model=SubmissionResponse)
def update_submission(
    submission_id: str,
    data: SubmissionUpdate,
    admin_user: UserResponse = Depends(get_admin_user),
):
    return get_or_404(
        submission_service.update_submission(
            submission_id,
            data.status,
            data.rejection_reason,
            reviewed_by=str(admin_user.id),
        ),
        SUBMISSION_NOT_FOUND,
    )


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(
    submission_id: str,
    _: UserResponse = Depends(get_admin_user),
):
    get_or_404(submission_service.delete_submission(submission_id), SUBMISSION_NOT_FOUND)
