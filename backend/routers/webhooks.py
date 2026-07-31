import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from core.auth import get_admin_user
from core.config import settings
from services.automate_log_service import create_automate_log, get_automate_logs as fetch_logs
from services import school_service

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/webhooks",
    tags=["webhooks"],
)

security = HTTPBearer()

def verify_automate_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    if not settings.automate_webhook_key:
        raise HTTPException(status_code=500, detail="Webhook key not configured")
    if credentials.credentials != settings.automate_webhook_key:
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials


class AutomateLogPayload(BaseModel):
    event: str
    sender: str | None = None
    school: str | None = None
    ig_account: str | None = None
    post_url: str | None = None
    payload: dict[str, Any] | None = None


@router.post("/automate")
async def receive_automate_log(
    payload: AutomateLogPayload,
    _: str = Depends(verify_automate_token),
):
    resolved_school = payload.school
    if not resolved_school and payload.sender:
        school_record = school_service.get_school_by_recipient_id(payload.sender)
        if school_record:
            resolved_school = school_record.slug

    create_automate_log(
        event=payload.event,
        sender_id=payload.sender,
        school=resolved_school,
        ig_account=payload.ig_account,
        post_url=payload.post_url,
        payload=payload.payload or payload.model_dump(),
    )

    return {"status": "ok"}


@router.get("/automate/logs")
async def get_automate_logs(
    limit: int = 50,
    _: dict = Depends(get_admin_user),
):
    try:
        return fetch_logs(limit=limit)
    except Exception as e:
        log.error("Failed to fetch automate logs: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch logs")

