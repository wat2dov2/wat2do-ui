import logging
import secrets
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from core.auth import get_admin_user
from core.config import settings
from services import school_service, stripe_gateway, ticketing_service
from services.automate_log_service import create_automate_log
from services.automate_log_service import get_automate_logs as fetch_logs
from services.notifications import event_change

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/webhooks",
    tags=["webhooks"],
)

security = HTTPBearer()


def _require_bearer(credentials: HTTPAuthorizationCredentials, key: str) -> str:
    if not key:
        raise HTTPException(status_code=500, detail="Webhook key not configured")
    if not secrets.compare_digest(credentials.credentials, key):
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials


def verify_automate_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    return _require_bearer(credentials, settings.automate_webhook_key)


def verify_event_change_alerts_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    return _require_bearer(credentials, settings.event_change_alerts_key)


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


@router.post("/event-change-alerts")
def send_event_change_alerts(_: str = Depends(verify_event_change_alerts_token)):
    """Called every minute by Supabase pg_cron while event changes are pending."""
    return {"sent": event_change.send_due_alerts()}


@router.post("/stripe")
async def receive_stripe_event(request: Request, background_tasks: BackgroundTasks):
    """Stripe Connect events for club ticket sales, trusted only with a valid signature.

    Stripe waits for this answer, so the receipt email runs after it is sent.
    """
    event = stripe_gateway.verified_event(
        await request.body(), request.headers.get("stripe-signature")
    )
    after_response = await run_in_threadpool(ticketing_service.handle_stripe_event, event)
    if after_response is not None:
        background_tasks.add_task(after_response)
    return {"received": True}


@router.get("/automate/logs")
async def get_automate_logs(
    limit: int = 50,
    sender_id: str | None = None,
    _: dict = Depends(get_admin_user),
):
    try:
        return fetch_logs(limit=limit, sender_id=sender_id)
    except Exception as e:
        log.error("Failed to fetch automate logs: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch logs")
