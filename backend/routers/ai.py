import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from core.auth import get_current_user
from core.constants import BUCKET_EVENT_IMAGES
from core.exceptions import ValidationError
from core.rate_limit import (
    ai_generate_event_rate_limiter,
    ai_generate_filters_rate_limiter,
    ai_parse_event_image_rate_limiter,
)


def _user_id_key(user: dict = Depends(get_current_user)) -> str:
    return user["id"]


from schemas.ai import AIPromptRequest, EventFormDataResponse, FilterStateResponse
from services.ai_service import (
    generate_event as svc_generate_event,
)
from services.ai_service import (
    generate_filters as svc_generate_filters,
)
from services.ai_service import (
    get_openai_client,
)
from services.ai_service import (
    parse_event_image as svc_parse_event_image,
)
from services.storage_service import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# Thin wrapper kept as a monkeypatch seam for tests.
# All logic lives in ai_service.get_openai_client().
_get_openai_client = get_openai_client


@router.post("/generate-filters", response_model=FilterStateResponse)
def generate_filters(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_generate_filters_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    result = svc_generate_filters(body.prompt, client=client)
    return FilterStateResponse(**result)


@router.post("/generate-event", response_model=EventFormDataResponse)
def generate_event(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_generate_event_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    result = svc_generate_event(body.prompt, client=client)
    return EventFormDataResponse(**result)


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

    client = _get_openai_client()
    result = svc_parse_event_image(
        validated_bytes,
        final_content_type,
        client=client,
    )

    url = await asyncio.to_thread(
        storage.upload_file,
        BUCKET_EVENT_IMAGES,
        validated_bytes,
        final_content_type,
    )
    result["source_image_url"] = url

    return EventFormDataResponse(**result)
