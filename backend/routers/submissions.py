import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import get_current_user, get_admin_user, resolve_db_user
from core.constants import MAX_STATUS_FILTER_LENGTH
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.submission import SubmissionCreate, SubmissionUpdate, SubmissionResponse
from core.errors import SUBMISSION_NOT_FOUND
from services import submission_service

router = APIRouter(prefix="/submissions", tags=["submissions"])
log = logging.getLogger(__name__)


@router.post("/", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_submission(data: SubmissionCreate, auth_user: dict = Depends(get_current_user)):
    user = resolve_db_user(auth_user)
    return submission_service.create_submission(str(user.id), data.event_data)


@router.get("/", response_model=PaginatedResponse[SubmissionResponse])
def list_submissions(
    submission_status: str | None = Query(default=None, max_length=MAX_STATUS_FILTER_LENGTH),
    pagination: PaginationParams = Depends(),
    _: dict = Depends(get_admin_user),
):
    items, total = submission_service.get_submissions(
        status=submission_status,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(submission_id: str, _: dict = Depends(get_admin_user)):
    row = submission_service.get_submission_by_id(submission_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SUBMISSION_NOT_FOUND)
    return row


@router.patch("/{submission_id}", response_model=SubmissionResponse)
def update_submission(
    submission_id: str,
    data: SubmissionUpdate,
    _: dict = Depends(get_admin_user),
):
    row = submission_service.update_submission(
        submission_id, data.status, data.rejection_reason,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SUBMISSION_NOT_FOUND)
    return row


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(submission_id: str, _: dict = Depends(get_admin_user)):
    if not submission_service.delete_submission(submission_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SUBMISSION_NOT_FOUND)
