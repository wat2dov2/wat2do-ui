import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from core.auth import get_current_user, get_db_user, require_owner_or_admin
from core.constants import (
    BUCKET_AVATARS,
    BUCKET_CLUB_LOGOS,
    BUCKET_EVENT_IMAGES,
    BUCKET_QR_ASSETS,
)
from core.errors import CLUB_NOT_FOUND, EVENT_NOT_FOUND
from core.exceptions import ValidationError, get_or_404
from core.rate_limit import RateLimiter
from schemas.club import ClubUpdate
from schemas.event import EventUpdate
from schemas.upload import UploadResponse
from schemas.user import UserUpdate
from services import club_service, event_service, user_service
from services.storage_service import storage

router = APIRouter(prefix="/uploads", tags=["uploads"])

# Per-user rate limit: 30 uploads per hour.  Sized for normal usage
# (a user editing multiple events / clubs in one session) while
# preventing storage-flooding attacks where a single account uploads
# thousands of orphaned assets (audit U6 / U12).
_upload_rate_limiter = RateLimiter(max_requests=30, window_seconds=3600)


def _upload_rate_key(user: dict = Depends(get_current_user)) -> str:
    """Key the upload rate limiter by the authenticated user's ID."""
    return f"uploads:{user['id']}"


_rate_limit_dep = _upload_rate_limiter.dependency(key_func=_upload_rate_key)


def _enforce_content_length(bucket: str):
    """Return a FastAPI dependency that rejects oversized requests by header.

    Runs *before* ``UploadFile = File(...)`` parses the multipart body,
    so a 1 GiB POST is rejected before any allocation.  The multipart
    boundary / form framing adds a handful of bytes of overhead, so we
    compare ``Content-Length`` against ``bucket_limit + _MULTIPART_SLACK``
    — lenient enough that a legitimate upload of an at-limit file still
    succeeds.
    """
    # Multipart encoding adds framing (boundary lines, headers per part,
    # terminator).  A few KiB of slack on top of the raw file size lets
    # a payload exactly at the bucket limit pass without triggering 413
    # solely on multipart overhead.
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

    Callers must pair this with the ``_enforce_content_length(bucket)``
    dependency on the route so oversized bodies are rejected *before*
    FastAPI parses the multipart form (audit U6).  validate_and_prepare
    re-checks the actual decoded size as a defensive lower bound.
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
    """Validate file, delete old image if present, upload new, and update the resource.

    *update_fn* receives the new URL and persists it (e.g. via service.update_*).
    Returns the new public URL.
    """
    data, content_type = await _validated_upload(file, bucket)
    if old_url:
        # path_from_url returns None for URLs outside our bucket prefix
        # or with traversal sequences — those are silently ignored (we
        # don't want to delete an unrelated object on another user's
        # behalf).  See StorageService.path_from_url (audit U10).
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
        lambda u: event_service.update_event(event_id, EventUpdate(source_image_url=u)),
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


@router.post("/club-logo/{club_id}", response_model=UploadResponse)
async def upload_club_logo(
    club_id: int,
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_CLUB_LOGOS)),
):
    club = get_or_404(await asyncio.to_thread(club_service.get_club, club_id), CLUB_NOT_FOUND)
    require_owner_or_admin(db_user, club.created_by)
    url = await _replace_image(
        file,
        BUCKET_CLUB_LOGOS,
        club.logo_url,
        lambda u: club_service.update_club(club_id, ClubUpdate(logo_url=u)),
    )
    return {"url": url}


@router.post("/qr-asset", response_model=UploadResponse)
async def upload_qr_asset(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    _rl: None = Depends(_rate_limit_dep),
    _cl: None = Depends(_enforce_content_length(BUCKET_QR_ASSETS)),
):
    # TODO(audit U12): track qr-asset ownership + lifecycle so previously
    # uploaded orphaned assets can be reaped when a poster's image_url
    # changes.  Today there is no replace-logic here, so every upload
    # accumulates in the public bucket.
    data, content_type = await _validated_upload(file, BUCKET_QR_ASSETS)
    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_QR_ASSETS,
        data,
        content_type,
    )
    return {"url": url}
