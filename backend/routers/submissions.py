import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import get_current_user, get_admin_user
from schemas.submission import SubmissionCreate, SubmissionUpdate, SubmissionResponse
from services import submission_service, user_service

router = APIRouter(prefix="/submissions", tags=["submissions"])
log = logging.getLogger(__name__)


def _resolve_db_user(auth_user: dict):
    db_user = user_service.get_user_by_supabase_id(auth_user["id"])
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@router.post("/", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def create_submission(data: SubmissionCreate, auth_user: dict = Depends(get_current_user)):
    user = _resolve_db_user(auth_user)
    row = submission_service.create_submission(str(user.id), data.event_data)
    return SubmissionResponse(**row)


@router.get("/", response_model=list[SubmissionResponse])
def list_submissions(
    submission_status: str | None = None,
    _: dict = Depends(get_admin_user),
):
    rows = submission_service.get_submissions(status=submission_status)
    return [SubmissionResponse(**row) for row in rows]


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(submission_id: str, _: dict = Depends(get_admin_user)):
    row = submission_service.get_submission_by_id(submission_id)
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    return SubmissionResponse(**row)


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
        raise HTTPException(status_code=404, detail="Submission not found")
    return SubmissionResponse(**row)


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(submission_id: str, _: dict = Depends(get_admin_user)):
    if not submission_service.delete_submission(submission_id):
        raise HTTPException(status_code=404, detail="Submission not found")
