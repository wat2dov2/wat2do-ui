from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from core.auth import get_admin_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.instagram_publishing import (
    InstagramPublishBatchPublish,
    InstagramPublishBatchResponse,
    InstagramPublishBatchStatus,
    InstagramPublishBatchUpdate,
)
from schemas.user import UserResponse
from services import instagram_publishing

router = APIRouter(prefix="/instagram-publishing", tags=["instagram-publishing"])


@router.get("/batches/", response_model=PaginatedResponse[InstagramPublishBatchResponse])
def list_instagram_publish_batches(
    batch_status: InstagramPublishBatchStatus | None = Query(default=None, alias="status"),
    local_date: date | None = None,
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = instagram_publishing.list_batches(
        batch_status=batch_status,
        local_date=local_date,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.get("/batches/{batch_id}", response_model=InstagramPublishBatchResponse)
def get_instagram_publish_batch(
    batch_id: UUID,
    _: UserResponse = Depends(get_admin_user),
):
    return instagram_publishing.get_batch(batch_id)


@router.patch("/batches/{batch_id}", response_model=InstagramPublishBatchResponse)
def update_instagram_publish_batch(
    batch_id: UUID,
    data: InstagramPublishBatchUpdate,
    _: UserResponse = Depends(get_admin_user),
):
    return instagram_publishing.update_batch(batch_id, data)


@router.post("/batches/{batch_id}/publish", response_model=InstagramPublishBatchResponse)
def publish_instagram_batch(
    batch_id: UUID,
    data: InstagramPublishBatchPublish,
    _: UserResponse = Depends(get_admin_user),
):
    return instagram_publishing.publish_batch(batch_id, data)
