"""Calendar feed endpoints.

- ``GET /calendar/token`` — returns the user's feed token (auto-
  generates on first call).  Auth required.
- ``POST /calendar/token/regenerate`` — rotates the token, breaking
  any existing subscriptions.  Auth required.
- ``GET /calendar/feed/{token}.ics`` — public endpoint that returns
  the user's saved-event VCALENDAR.  Rate-limited per token.
"""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from core.auth import get_db_user
from core.constants import (
    CALENDAR_FEED_RATE_LIMIT_MAX_REQUESTS,
    CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS,
)
from core.errors import CALENDAR_FEED_NOT_FOUND
from core.exceptions import NotFoundError
from core.rate_limit import RateLimiter
from schemas.calendar import CalendarTokenResponse
from schemas.user import UserResponse
from services import calendar_service

router = APIRouter(prefix="/calendar", tags=["calendar"])

# Keyed by token so one misbehaving calendar client cannot affect
# others.  Google/Apple poll on the scale of hours, not seconds —
# 60/hour is generous headroom even for multi-device sync.
_feed_rate_limiter = RateLimiter(
    max_requests=CALENDAR_FEED_RATE_LIMIT_MAX_REQUESTS,
    window_seconds=CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS,
)


def _feed_url_for(request: Request, token: str) -> str:
    return str(request.url_for("get_calendar_feed", token=token))


@router.get("/token", response_model=CalendarTokenResponse)
def get_calendar_token(
    request: Request,
    db_user: UserResponse = Depends(get_db_user),
):
    """Return the user's feed token, generating one on first call."""
    token = calendar_service.get_or_create_token(str(db_user.id))
    return CalendarTokenResponse(token=token, feed_url=_feed_url_for(request, token))


@router.post("/token/regenerate", response_model=CalendarTokenResponse)
def regenerate_calendar_token(
    request: Request,
    db_user: UserResponse = Depends(get_db_user),
):
    """Rotate the user's feed token; existing subscriptions break."""
    token = calendar_service.regenerate_token(str(db_user.id))
    return CalendarTokenResponse(token=token, feed_url=_feed_url_for(request, token))


@router.get(
    "/feed/{token}.ics",
    name="get_calendar_feed",
    response_class=Response,
)
def get_calendar_feed(token: str):
    """Public: return the VCALENDAR for the token's owner.

    Calendar clients (Google, Apple, Outlook) poll this URL and render
    each VEVENT as a calendar entry.  Rate-limited per token.
    """
    _feed_rate_limiter.check(token)
    user_id = calendar_service.get_user_id_by_token(token)
    if user_id is None:
        raise NotFoundError(CALENDAR_FEED_NOT_FOUND)
    body = calendar_service.build_ics_for_user(user_id)
    return Response(content=body, media_type="text/calendar; charset=utf-8")
