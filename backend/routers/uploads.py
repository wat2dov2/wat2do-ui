import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from core.auth import get_current_user, get_db_user, require_owner_or_admin
from core.constants import (
    BUCKET_EVENT_IMAGES,
    BUCKET_AVATARS,
    BUCKET_CLUB_LOGOS,
    BUCKET_QR_ASSETS,
)
from core.errors import CLUB_NOT_FOUND, EVENT_NOT_FOUND
from core.svg_sanitize import looks_like_svg, sanitize_svg
from schemas.club import ClubUpdate
from schemas.event import EventUpdate
from schemas.user import UserUpdate
from services.storage_service import storage
from services import user_service, event_service, club_service

router = APIRouter(prefix="/uploads", tags=["uploads"])


async def _validated_upload(file: UploadFile, bucket: str) -> tuple[bytes, str]:
    if not file.content_type:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing content type")
    allowed = storage.get_allowed_mime_types(bucket)
    if file.content_type not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File type {file.content_type} not allowed. Accepted: {', '.join(allowed)}",
        )
    data = await file.read()
    limit = storage.get_file_size_limit(bucket)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File too large. Max {limit // (1024*1024)} MB.",
        )

    # SVG detection: inspect actual file bytes, not the client-declared
    # Content-Type.  An attacker could upload a malicious SVG as
    # "image/png" to skip sanitization entirely — so we check the
    # content regardless.
    is_svg = looks_like_svg(data)

    if is_svg:
        if "image/svg+xml" not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "SVG content detected but SVG uploads are not allowed for this resource.",
            )
        try:
            data = sanitize_svg(data)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Invalid SVG file: {exc}",
            )
        # Correct the content type to match the actual content so storage
        # serves the file with the right MIME type.
        return data, "image/svg+xml"

    # Client claims SVG but content is not actually SVG — reject the
    # malformed upload rather than storing arbitrary bytes as "SVG".
    if file.content_type == "image/svg+xml":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File declared as SVG but content is not valid SVG.",
        )

    return data, file.content_type


async def _replace_image(file: UploadFile, bucket: str, old_url: str | None, update_fn) -> str:
    """Validate file, delete old image if present, upload new, and update the resource.

    *update_fn* receives the new URL and persists it (e.g. via service.update_*).
    Returns the new public URL.
    """
    data, content_type = await _validated_upload(file, bucket)
    if old_url:
        old_path = storage.path_from_url(old_url, bucket)
        if old_path:
            await asyncio.to_thread(storage.delete_file, bucket, old_path)
    url = await asyncio.to_thread(
        storage.upload_file, bucket, data, file.filename or "upload", content_type,
    )
    await asyncio.to_thread(update_fn, url)
    return url


@router.post("/event-image/{event_id}")
async def upload_event_image(
    event_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    event = await asyncio.to_thread(event_service.get_event, event_id)
    if not event:
        raise HTTPException(status.HTTP_404_NOT_FOUND, EVENT_NOT_FOUND)
    require_owner_or_admin(user, event.created_by)
    url = await _replace_image(
        file, BUCKET_EVENT_IMAGES, event.source_image_url,
        lambda u: event_service.update_event(event_id, EventUpdate(source_image_url=u)),
    )
    return {"url": url}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db_user=Depends(get_db_user),
):
    url = await _replace_image(
        file, BUCKET_AVATARS, db_user.avatar_url,
        lambda u: user_service.update_user(db_user.id, UserUpdate(avatar_url=u)),
    )
    return {"url": url}


@router.post("/club-logo/{club_id}")
async def upload_club_logo(
    club_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    club = await asyncio.to_thread(club_service.get_club, club_id)
    if not club:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLUB_NOT_FOUND)
    require_owner_or_admin(user, club.created_by)
    url = await _replace_image(
        file, BUCKET_CLUB_LOGOS, club.logo_url,
        lambda u: club_service.update_club(club_id, ClubUpdate(logo_url=u)),
    )
    return {"url": url}


@router.post("/qr-asset")
async def upload_qr_asset(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    data, content_type = await _validated_upload(file, BUCKET_QR_ASSETS)
    url = await asyncio.to_thread(
        storage.upload_file, BUCKET_QR_ASSETS, data, file.filename or "asset", content_type,
    )
    return {"url": url}
