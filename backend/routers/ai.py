import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from core.constants import BUCKET_EVENT_IMAGES
from core.exceptions import ValidationError
from core.rate_limit import ai_parse_event_image_rate_limiter
from schemas.ai import EventFormDataResponse
from services.ai_service import (
    parse_event_image as svc_parse_event_image,
)
from services.storage_service import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/parse-event-image", response_model=EventFormDataResponse)
async def parse_event_image(
    file: UploadFile = File(...),
    _rl: None = Depends(ai_parse_event_image_rate_limiter.ip_dependency()),
):
    contents = await file.read()
    try:
        validated_bytes, final_content_type = storage.validate_and_prepare(
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

    result = svc_parse_event_image(
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

    return EventFormDataResponse(**result)
