from pydantic import BaseModel


class InteractionMatrixRow(BaseModel):
    """Aggregated (user, event) interaction score for collaborative filtering."""

    user_id: str
    event_id: int
    score: float


class EventPopularity(BaseModel):
    """Event ranked by weighted interaction count."""

    event_id: int
    score: float
