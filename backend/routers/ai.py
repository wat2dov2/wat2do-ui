import logging

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import get_current_user
from core.errors import AI_EMPTY_RESPONSE, AI_INVALID_JSON, AI_NOT_CONFIGURED
from core.rate_limit import ai_rate_limiter

# Key function for per-user rate limiting: extracts user ID from the auth token.
def _user_id_key(user: dict = Depends(get_current_user)) -> str:
    return user["id"]
from schemas.ai import AIPromptRequest, FilterStateResponse, EventFormDataResponse
from services.ai_service import (
    AIServiceError,
    get_openai_client,
    generate_filters as svc_generate_filters,
    generate_event as svc_generate_event,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# Thin wrapper kept as a monkeypatch seam for tests.
# All logic lives in ai_service.get_openai_client().
_get_openai_client = get_openai_client


def _handle_ai_error(exc: AIServiceError) -> None:
    """Map AIServiceError to the appropriate HTTP response."""
    if exc.is_config_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=AI_NOT_CONFIGURED,
        )
    detail = str(exc)
    if "invalid JSON" in detail:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=AI_INVALID_JSON)
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=AI_EMPTY_RESPONSE)


@router.post("/generate-filters", response_model=FilterStateResponse)
def generate_filters(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    try:
        result = svc_generate_filters(body.prompt, client=client)
    except AIServiceError as exc:
        _handle_ai_error(exc)
    return FilterStateResponse(**result)


@router.post("/generate-event", response_model=EventFormDataResponse)
def generate_event(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    try:
        result = svc_generate_event(body.prompt, client=client)
    except AIServiceError as exc:
        _handle_ai_error(exc)
    return EventFormDataResponse(**result)
