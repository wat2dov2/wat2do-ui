from datetime import date

from pydantic import BaseModel, ConfigDict


class School(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
    timezone: str
    recipient_id: str | None = None
    semester_start: date | None = None
    semester_end: date | None = None


class SchoolSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    slug: str
    name: str
