import logging

from fastapi import APIRouter, Depends

from core.auth import get_current_user
from core.rate_limit import (
    ai_generate_event_rate_limiter,
    ai_generate_filters_rate_limiter,
)


# Key function for per-user rate limiting: extracts user ID from the auth token.
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

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# Thin wrapper kept as a monkeypatch seam for tests.
# All logic lives in ai_service.get_openai_client().
_get_openai_client = get_openai_client


@router.post("/generate-filters", response_model=FilterStateResponse)
def generate_filters(
    body: AIPromptRequest,
    user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_generate_filters_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    # Pass user_id so the service can enforce the daily per-user AI budget
    # (M8) on top of the per-minute sliding-window limit.
    result = svc_generate_filters(body.prompt, client=client, user_id=user["id"])
    return FilterStateResponse(**result)


@router.post("/generate-event", response_model=EventFormDataResponse)
def generate_event(
    body: AIPromptRequest,
    user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_generate_event_rate_limiter.dependency(key_func=_user_id_key)),
):
    client = _get_openai_client()
    result = svc_generate_event(body.prompt, client=client, user_id=user["id"])
    return EventFormDataResponse(**result)
