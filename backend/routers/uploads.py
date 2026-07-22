import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from core.auth import get_current_user, get_db_user, require_owner_or_admin
from core.constants import (
    BUCKET_AVATARS,
    BUCKET_CLAIM_PROOFS,
    BUCKET_EVENT_IMAGES,
    BUCKET_ORGANIZATION_LOGOS,
    BUCKET_QR_ASSETS,
)
from core.errors import EVENT_NOT_FOUND, ORGANIZATION_NOT_FOUND
from core.exceptions import ValidationError, get_or_404
from core.rate_limit import RateLimiter
from schemas.event import EventUpdate
from schemas.organization import OrganizationUpdate
from schemas.upload import UploadResponse
from schemas.user import UserUpdate
from services import event_service, organization_service, user_service
from services.storage_service import storage

router = APIRouter(prefix="/uploads", tags=["uploads"])

# Per-user rate limit: 30 uploads/hour. Sized for normal multi-edit sessions
# while blocking storage-flooding via orphaned assets.
_upload_rate_limiter = RateLimiter(max_requests=30, window_seconds=3600)


def _upload_rate_key(user: dict = Depends(get_current_user)) -> str:
    return f"uploads:{user['id']}"


_rate_limit_dep = _upload_rate_limiter.dependency(key_func=_upload_rate_key)


def _enforce_content_length(bucket: str):
    """Reject oversized requests by Content-Length before multipart parsing.

    Multipart framing adds a few KiB, so compare against
    ``bucket_limit + _MULTIPART_SLACK`` - lenient enough that an at-limit
    file still succeeds.
    """
    _MULTIPART_SLACK = 4 * 1024

    def _check(request: Request) -> None:
        limit = storage.get_file_size_limit(bucket)
        content_length_header = request.headers.get("content-length")
        if content_length_header is None:
            return
        try:
            content_length = int(content_length_header)
        except ValueError:
            return
        if content_length > limit + _MULTIPART_SLACK:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"File too large. Max {limit // (1024 * 1024)} MB.",
            )

    return _check


async def _validated_upload(file: UploadFile, bucket: str) -> tuple[bytes, str]:
    """Validate and read an upload, returning (cleaned_bytes, final_content_type).

    Pair with ``_enforce_content_length(bucket)`` so oversized bodies are
    rejected before FastAPI parses multipart. ``validate_and_prepare``
    re-checks decoded size as a defensive lower bound.
    """
    data = await file.read()
    try:
        return storage.validate_and_prepare(bucket, data, file.content_type)
    except ValidationError as exc:
        http_status = (
            status.HTTP_413_CONTENT_TOO_LARGE
            if exc.code == "file_too_large"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=http_status, detail=exc.detail) from exc


async def _replace_image(
    file: UploadFile,
    bucket: str,
    old_url: str | None,
    update_fn,
) -> str:
    """Validate, delete old image if present, upload new, and persist via *update_fn*."""
    data, content_type = await _validated_upload(file, bucket)
    if old_url:
        # path_from_url returns None for URLs outside our bucket prefix or
        # with traversal sequences - those are ignored so we never delete
        # an unrelated object. See StorageService.path_from_url.
        old_path = storage.path_from_url(old_url, bucket)
        if old_path:
            await asyncio.to_thread(storage.delete_file, bucket, old_path)
    url = await asyncio.to_thread(
        storage.upload_file,
        bucket,
        data,
        content_type,
    )
    await asyncio.to_thread(update_fn, url)
    return url


@router.post("/event-image", response_model=UploadResponse)
async def upload_event_image_unsigned(
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_EVENT_IMAGES)),
):
    data, content_type = await _validated_upload(file, BUCKET_EVENT_IMAGES)
    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_EVENT_IMAGES,
        data,
        content_type,
    )
    return {"url": url}


@router.post("/event-image/{event_id}", response_model=UploadResponse)
async def upload_event_image(
    event_id: int,
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_EVENT_IMAGES)),
):
    event = get_or_404(await asyncio.to_thread(event_service.get_event, event_id), EVENT_NOT_FOUND)
    require_owner_or_admin(db_user, event.created_by)
    url = await _replace_image(
        file,
        BUCKET_EVENT_IMAGES,
        event.source_image_url,
        lambda u: (
            result.event
            if (
                result := event_service.update_event(
                    event_id,
                    EventUpdate(source_image_url=u),
                )
            )
            else None
        ),
    )
    return {"url": url}


@router.post("/avatar", response_model=UploadResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_AVATARS)),
):
    url = await _replace_image(
        file,
        BUCKET_AVATARS,
        db_user.avatar_url,
        lambda u: user_service.update_user(db_user.id, UserUpdate(avatar_url=u)),
    )
    return {"url": url}


@router.post("/organization-logo/{organization_id}", response_model=UploadResponse)
async def upload_organization_logo(
    organization_id: int,
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_ORGANIZATION_LOGOS)),
):
    organization = get_or_404(
        await asyncio.to_thread(organization_service.get_organization, organization_id),
        ORGANIZATION_NOT_FOUND,
    )
    require_owner_or_admin(db_user, organization.created_by)
    url = await _replace_image(
        file,
        BUCKET_ORGANIZATION_LOGOS,
        organization.logo_url,
        lambda u: organization_service.update_organization(
            organization_id, OrganizationUpdate(logo_url=u)
        ),
    )
    return {"url": url}


@router.post("/qr-asset", response_model=UploadResponse)
async def upload_qr_asset(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_QR_ASSETS)),
):
    # TODO: track qr-asset ownership + lifecycle so orphaned assets can be
    # reaped when a poster's image_url changes. No replace-logic today, so
    # every upload accumulates in the public bucket.
    data, content_type = await _validated_upload(file, BUCKET_QR_ASSETS)
    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_QR_ASSETS,
        data,
        content_type,
    )
    return {"url": url}


@router.post("/claim-proof", response_model=UploadResponse)
async def upload_claim_proof(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_CLAIM_PROOFS)),
):
    data, content_type = await _validated_upload(file, BUCKET_CLAIM_PROOFS)
    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_CLAIM_PROOFS,
        data,
        content_type,
    )
    return {"url": url}
