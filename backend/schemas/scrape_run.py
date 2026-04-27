"""Pydantic models for the scrape_runs table.

Used by services/scrape_run_service and the services/wat2do pipeline.
The table is admin/internal — there is no public-facing router, so only
the create/update/response shapes are exposed here.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from core.constants import (
    SCRAPE_RUN_ERROR,
    SCRAPE_RUN_NO_POSTS,
    SCRAPE_RUN_RUNNING,
    SCRAPE_RUN_SUCCESS,
)

ScrapeRunStatus = Literal[
    SCRAPE_RUN_RUNNING,
    SCRAPE_RUN_SUCCESS,
    SCRAPE_RUN_ERROR,
    SCRAPE_RUN_NO_POSTS,
]

# Single-source-of-truth limits for the textual columns. Mirror the
# VARCHAR widths v1 used so we keep parity if anyone backfills from v1.
_MAX_USERNAME_LENGTH = 100
_MAX_GITHUB_RUN_ID_LENGTH = 50
_MAX_ERROR_MESSAGE_LENGTH = 4000


class ScrapeRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ig_username: str = Field(..., min_length=1, max_length=_MAX_USERNAME_LENGTH)
    github_run_id: str | None = Field(default=None, max_length=_MAX_GITHUB_RUN_ID_LENGTH)


class ScrapeRunUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ScrapeRunStatus | None = None
    posts_fetched: int | None = Field(default=None, ge=0)
    posts_new: int | None = Field(default=None, ge=0)
    events_extracted: int | None = Field(default=None, ge=0)
    events_saved: int | None = Field(default=None, ge=0)
    pinned_post_warning: bool | None = None
    error_message: str | None = Field(default=None, max_length=_MAX_ERROR_MESSAGE_LENGTH)
    finished_at: datetime | None = None


class ScrapeRunResponse(BaseModel):
    id: str
    ig_username: str
    github_run_id: str | None = None
    status: ScrapeRunStatus
    posts_fetched: int = 0
    posts_new: int = 0
    events_extracted: int = 0
    events_saved: int = 0
    pinned_post_warning: bool = False
    error_message: str | None = None
    started_at: datetime
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}
