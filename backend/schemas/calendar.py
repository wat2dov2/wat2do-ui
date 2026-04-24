"""Calendar-feed schemas: the response returned by the token endpoints."""

from pydantic import BaseModel


class CalendarTokenResponse(BaseModel):
    """Returned by GET /calendar/token and POST /calendar/token/regenerate."""

    token: str
    feed_url: str
