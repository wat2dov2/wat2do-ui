from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.constants import MAX_SCHOOL_LENGTH
from core.controlbox import controlbox
from schemas.contact import ContactCreate
from schemas.submission import SubmissionStatus


class SponsorSubmissionCreate(ContactCreate):
    school: str = Field(min_length=1, max_length=MAX_SCHOOL_LENGTH)
    business_name: str = Field(
        min_length=1, max_length=controlbox.contact.business_support.business_name
    )

    @field_validator("school", "business_name")
    @classmethod
    def strip_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value cannot be blank")
        return value


class SponsorSubmissionReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["approved", "rejected"]


class SponsorSubmissionResponse(SponsorSubmissionCreate):
    id: str
    status: SubmissionStatus
    submitted_at: datetime
    reviewed_at: datetime | None = None
