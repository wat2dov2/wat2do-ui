import json

from pydantic import BaseModel, Field, field_validator

from core.constants import (
    INTERACTION_TYPES,
    MAX_INTERACTION_BATCH_SIZE,
    MAX_INTERACTION_METADATA_BYTES,
    MAX_SESSION_ID_LENGTH,
)


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

    @field_validator("metadata")
    @classmethod
    def _metadata_size_limit(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        size = len(json.dumps(v, separators=(",", ":")))
        if size > MAX_INTERACTION_METADATA_BYTES:
            raise ValueError(
                f"metadata exceeds maximum size ({size} bytes, limit {MAX_INTERACTION_METADATA_BYTES})"
            )
        return v


class InteractionBatch(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=MAX_SESSION_ID_LENGTH)
    user_id: str | None = Field(default=None, max_length=MAX_SESSION_ID_LENGTH)
    interactions: list[InteractionCreate] = Field(..., max_length=MAX_INTERACTION_BATCH_SIZE)


class InteractionMatrixRow(BaseModel):
    """Aggregated (user, event) interaction score for collaborative filtering."""
    user_id: str
    event_id: int
    score: float


class EventPopularity(BaseModel):
    """Event ranked by weighted interaction count."""
    event_id: int
    score: float
