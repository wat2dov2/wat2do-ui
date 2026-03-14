from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import get_current_user
from core.database import get_db
from services import storage_service, user_service, event_service, club_service

router = APIRouter(prefix="/uploads", tags=["uploads"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


async def _validated_upload(file: UploadFile, bucket: str) -> tuple[bytes, str]:
    """Read, validate size, and validate MIME type."""
    if not file.content_type:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing content type")

    allowed = storage_service.BUCKETS.get(bucket, {}).get("allowed_mime_types", [])
    if file.content_type not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File type {file.content_type} not allowed. Accepted: {', '.join(allowed)}",
        )

    data = await file.read()
    limit = storage_service.BUCKETS.get(bucket, {}).get("file_size_limit", MAX_FILE_SIZE)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File too large. Max {limit // (1024*1024)} MB.",
        )

    return data, file.content_type


@router.post("/event-image/{event_id}")
async def upload_event_image(
    event_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    event = await event_service.get_event(db, event_id)
    if not event:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    data, content_type = await _validated_upload(file, "event-images")

    if event.source_image_url:
        old_path = storage_service.path_from_url(event.source_image_url, "event-images")
        if old_path:
            storage_service.delete_file("event-images", old_path)

    url = storage_service.upload_file("event-images", data, file.filename or "image", content_type)

    event.source_image_url = url
    await db.commit()
    await db.refresh(event)

    return {"url": url}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    db_user = await user_service.get_user_by_supabase_id(db, user["id"])
    if not db_user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    data, content_type = await _validated_upload(file, "avatars")

    if db_user.avatar_url:
        old_path = storage_service.path_from_url(db_user.avatar_url, "avatars")
        if old_path:
            storage_service.delete_file("avatars", old_path)

    url = storage_service.upload_file("avatars", data, file.filename or "avatar", content_type)

    db_user.avatar_url = url
    await db.commit()
    await db.refresh(db_user)

    return {"url": url}


@router.post("/club-logo/{club_id}")
async def upload_club_logo(
    club_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    club = await club_service.get_club(db, club_id)
    if not club:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Club not found")

    data, content_type = await _validated_upload(file, "club-logos")

    if club.logo_url:
        old_path = storage_service.path_from_url(club.logo_url, "club-logos")
        if old_path:
            storage_service.delete_file("club-logos", old_path)

    url = storage_service.upload_file("club-logos", data, file.filename or "logo", content_type)

    club.logo_url = url
    await db.commit()
    await db.refresh(club)

    return {"url": url}


@router.post("/qr-asset")
async def upload_qr_asset(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    data, content_type = await _validated_upload(file, "qr-assets")
    url = storage_service.upload_file("qr-assets", data, file.filename or "asset", content_type)
    return {"url": url}
