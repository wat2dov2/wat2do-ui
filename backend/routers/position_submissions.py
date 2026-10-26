from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from core.auth import get_admin_user, get_optional_user, resolve_db_user
from core.constants import (
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    SUBMISSION_APPROVED,
    SUBMISSION_RATE_LIMIT_MAX_REQUESTS,
    SUBMISSION_RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import SUBMISSION_NOT_FOUND
from core.exceptions import get_or_404
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from core.rate_limit import RateLimiter
from schemas.submission import (
    PositionSubmissionCreate,
    PositionSubmissionResponse,
    SubmissionStatus,
    SubmissionUpdate,
)
from schemas.user import UserResponse
from services import club_service, submission_service

router = APIRouter(prefix="/position-submissions", tags=["position-submissions"])
_limiter = RateLimiter(
    max_requests=SUBMISSION_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=SUBMISSION_RATE_LIMIT_WINDOW_SECONDS,
)


@router.post("/", response_model=PositionSubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_submission(
    data: PositionSubmissionCreate,
    auth_user: dict | None = Depends(get_optional_user),
    _rl: None = Depends(_limiter.dependency()),
):
    user = resolve_db_user(auth_user) if auth_user else None
    submission = submission_service.create_submission(
        str(user.id) if user else None,
        data.position_data,
        submitted_by_email=str(data.submitted_by_email),
        kind="position",
    )
    # The club's own management team publishes straight away, as with events.
    club = club_service.get_club(data.position_data.club_id) if user else None
    if club and club_service.publish_refusal(club, user) is None:
        return submission_service.review_position_submission(
            str(submission.id),
            SUBMISSION_APPROVED,
            None,
            reviewed_by=str(user.id),
            notify_submitter=False,
        )
    return submission


@router.get("/", response_model=PaginatedResponse[PositionSubmissionResponse])
def list_submissions(
    submission_status: SubmissionStatus | None = Query(default=None),
    school: str | None = Query(default=None, max_length=MAX_SCHOOL_LENGTH),
    search: str | None = Query(default=None, max_length=MAX_SEARCH_QUERY_LENGTH),
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = submission_service.get_submissions(
        status=submission_status,
        school=school,
        offset=pagination.offset,
        limit=pagination.page_size,
        kind="position",
        search=search,
    )
    return paginated_response(items, total, pagination)


@router.patch("/{submission_id}", response_model=PositionSubmissionResponse)
def review_submission(
    submission_id: UUID, data: SubmissionUpdate, admin: UserResponse = Depends(get_admin_user)
):
    return get_or_404(
        submission_service.review_position_submission(
            str(submission_id), data.status, data.rejection_reason, reviewed_by=str(admin.id)
        ),
        SUBMISSION_NOT_FOUND,
    )
