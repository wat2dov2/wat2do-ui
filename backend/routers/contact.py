from fastapi import APIRouter, BackgroundTasks, Depends, status

from core.controlbox import controlbox
from core.rate_limit import RateLimiter
from schemas.auth import MessageResponse
from schemas.contact import ContactCreate
from services import contact_service
from services.email_service import email_service

router = APIRouter(prefix="/contact", tags=["contact"])

_contact_limiter = RateLimiter(
    max_requests=controlbox.contact.rate_limit.maximum_requests,
    window_seconds=controlbox.contact.rate_limit.window_seconds,
)


@router.post("/", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def submit_contact_message(
    data: ContactCreate,
    background_tasks: BackgroundTasks,
    _rl: None = Depends(_contact_limiter.ip_dependency()),
):
    message = contact_service.build_contact_email(data)
    background_tasks.add_task(email_service.send_safely, message)
    return MessageResponse(message="Contact message accepted")
