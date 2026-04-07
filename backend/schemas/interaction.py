from pydantic import BaseModel


INTERACTION_TYPES = ("view", "click", "detail_view", "save", "unsave", "share")


class InteractionCreate(BaseModel):
    event_id: int
    interaction_type: str
    metadata: dict | None = None


class InteractionBatch(BaseModel):
    session_id: str
    token: str | None = None
    interactions: list[InteractionCreate]
