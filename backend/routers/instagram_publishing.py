from datetime import date
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from core.auth import get_admin_user
from core.pagination import PaginatedResponse, PaginationParams, paginated_response
from schemas.instagram_publishing import (
    FollowCandidateDecisionsResponse,
    FollowCandidateDecisionsSubmit,
    FollowCandidateResponse,
    FollowCandidateStatus,
    InstagramAccountStatsResponse,
    InstagramPublishBatchPublish,
    InstagramPublishBatchResponse,
    InstagramPublishBatchStatus,
    InstagramPublishBatchSummaryResponse,
    InstagramPublishBatchUpdate,
    InstagramSongCreate,
    InstagramSongResponse,
)
from schemas.user import UserResponse
from services import instagram_publishing
from services.instagram_follow import candidates
from services.instagram_publishing import music, stats

router = APIRouter(prefix="/instagram-publishing", tags=["instagram-publishing"])


@router.get(
    "/batches/",
    response_model=PaginatedResponse[InstagramPublishBatchSummaryResponse],
)
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


@router.post(
    "/batches/{batch_id}/publish",
    response_model=InstagramPublishBatchResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def publish_instagram_batch(
    batch_id: UUID,
    data: InstagramPublishBatchPublish,
    background_tasks: BackgroundTasks,
    _: UserResponse = Depends(get_admin_user),
):
    batch = instagram_publishing.claim_batch_for_publishing(batch_id, data)
    background_tasks.add_task(instagram_publishing.publish_claimed_batch, batch)
    return batch


@router.get("/songs/", response_model=list[InstagramSongResponse])
def list_instagram_songs(_: UserResponse = Depends(get_admin_user)):
    return music.list_songs()


@router.post(
    "/songs/",
    response_model=InstagramSongResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_instagram_song(
    data: InstagramSongCreate,
    _: UserResponse = Depends(get_admin_user),
):
    return music.add_song(data.query, asian_campuses_only=data.asian_campuses_only)


@router.delete("/songs/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_instagram_song(
    song_id: UUID,
    _: UserResponse = Depends(get_admin_user),
):
    music.delete_song(song_id)


@router.get("/accounts/", response_model=list[InstagramAccountStatsResponse])
def list_instagram_account_stats(_: UserResponse = Depends(get_admin_user)):
    return stats.list_account_stats()


@router.get(
    "/follow-candidates/",
    response_model=PaginatedResponse[FollowCandidateResponse],
)
def list_follow_candidates(
    candidate_status: FollowCandidateStatus = Query(default="pending", alias="status"),
    school: str | None = None,
    pagination: PaginationParams = Depends(),
    _: UserResponse = Depends(get_admin_user),
):
    items, total = candidates.list_candidates(
        school=school,
        status=candidate_status,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return paginated_response(items, total, pagination)


@router.post("/follow-candidates/decisions", response_model=FollowCandidateDecisionsResponse)
def submit_follow_decisions(
    data: FollowCandidateDecisionsSubmit,
    admin: UserResponse = Depends(get_admin_user),
):
    return candidates.decide(
        [(decision.id, decision.status) for decision in data.decisions],
        decided_by=str(admin.id),
    )
