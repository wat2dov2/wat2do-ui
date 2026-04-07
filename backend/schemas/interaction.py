from pydantic import BaseModel, field_validator

from core.constants import INTERACTION_TYPES


class InteractionCreate(BaseModel):
    event_id: int
    interaction_type: str
    metadata: dict | None = None

    @field_validator("interaction_type")
    @classmethod
    def _interaction_type_allowed(cls, v: str) -> str:
        if v not in INTERACTION_TYPES:
            raise ValueError(
                f"interaction_type must be one of: {', '.join(INTERACTION_TYPES)}"
            )
        return v


class InteractionBatch(BaseModel):
    session_id: str
    token: str | None = None
    interactions: list[InteractionCreate]


class InteractionMatrixRow(BaseModel):
    """Aggregated (user, event) interaction score for collaborative filtering."""
    user_id: str
    event_id: int
    score: float


class EventPopularity(BaseModel):
    """Event ranked by weighted interaction count."""
    event_id: int
    score: float
