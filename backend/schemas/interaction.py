import json
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import (
    INTERACTION_TYPES,
    MAX_INTERACTION_BATCH_SIZE,
    MAX_INTERACTION_METADATA_BYTES,
    MAX_SESSION_ID_LENGTH,
)


class InteractionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    """Batch of interactions submitted from a single browser session.

    **Trust boundary note on ``user_id``**: this field models the client's
    *claim* of which user the batch belongs to.  The server verifies the
    claim against the authenticated identity in ``interaction_service._validate_batch``
    and 403s on mismatch (see S11).  The field is **advisory / diagnostic** —
    never trust it for authorization or identity resolution in new code;
    use the value resolved from the Bearer token instead.

    Typed as ``UUID | None`` so the Pydantic boundary rejects arbitrary
    opaque strings (e.g. ``"admin"``) at parse time — if the router-side
    ownership check is ever removed during a refactor, impersonation
    still cannot succeed because the payload won't even deserialise.
    """

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=1, max_length=MAX_SESSION_ID_LENGTH)
    user_id: UUID | None = None
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


class RecordInteractionsResponse(BaseModel):
    """Response for ``POST /interactions/batch`` — number of rows recorded.

    Typed explicitly (audit S7) so future additions to the dict do not
    silently leak internals to the client.
    """

    recorded: int
