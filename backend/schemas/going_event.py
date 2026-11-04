from uuid import UUID

from pydantic import BaseModel


class UserEventPair(BaseModel):
    """Minimal (user_id, event_id) pair used by collaborative filtering."""

    user_id: UUID
    event_id: int
