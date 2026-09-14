import asyncio
import logging
from functools import partial

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from core.auth import get_db_user
from core.constants import BUCKET_EVENT_IMAGES, MAX_SCHOOL_LENGTH
from core.exceptions import ValidationError
from core.rate_limit import ai_parse_event_image_rate_limiter
from schemas.ai import EventFormDataResponse, PositionImageResponse
from schemas.user import UserResponse
from services import school_service
from services.ai_service import (
    parse_event_image as svc_parse_event_image,
)
from services.ai_service import (
    parse_position_image as svc_parse_position_image,
)
from services.storage_service import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/parse-event-image", response_model=EventFormDataResponse)
async def parse_event_image(
    file: UploadFile = File(...),
    school: str = Query(min_length=1, max_length=MAX_SCHOOL_LENGTH),
    _rl: None = Depends(ai_parse_event_image_rate_limiter.ip_dependency()),
):
    if school_service.get_school(school) is None:
        raise ValidationError("School is not registered")
    return EventFormDataResponse(
        **await _parse_uploaded_image(file, partial(svc_parse_event_image, user_school=school))
    )


@router.post("/parse-position-image", response_model=PositionImageResponse)
async def parse_position_image(
    file: UploadFile = File(...),
    school: str = Query(min_length=1, max_length=MAX_SCHOOL_LENGTH),
    _: UserResponse = Depends(get_db_user),
    _rl: None = Depends(ai_parse_event_image_rate_limiter.ip_dependency()),
):
    if school_service.get_school(school) is None:
        raise ValidationError("School is not registered")
    return PositionImageResponse(
        **await _parse_uploaded_image(file, partial(svc_parse_position_image, user_school=school))
    )


async def _parse_uploaded_image(file: UploadFile, parser):
    contents = await file.read()
    try:
        validated_bytes, final_content_type = await asyncio.to_thread(
            storage.validate_and_prepare,
            BUCKET_EVENT_IMAGES,
            contents,
            file.content_type or "image/jpeg",
        )
    except ValidationError as exc:
        http_status = (
            status.HTTP_413_CONTENT_TOO_LARGE
            if exc.code == "file_too_large"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=http_status, detail=exc.detail) from exc

    result = await asyncio.to_thread(
        parser,
        validated_bytes,
        final_content_type,
    )

    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_EVENT_IMAGES,
        validated_bytes,
        final_content_type,
    )
    result["source_image_url"] = url

    return result
