"""Pydantic models for the workflow_runs table.

Used by services.workflow_run_service and the services/scraper pipeline.
The table is admin/internal - there is no public-facing router, so only
the create/update/response shapes are exposed here.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from core.constants import (
    WORKFLOW_RUN_ERROR,
    WORKFLOW_RUN_NO_POSTS,
    WORKFLOW_RUN_RUNNING,
    WORKFLOW_RUN_SUCCESS,
)

WorkflowRunStatus = Literal[
    WORKFLOW_RUN_RUNNING,
    WORKFLOW_RUN_SUCCESS,
    WORKFLOW_RUN_ERROR,
    WORKFLOW_RUN_NO_POSTS,
]

# Single-source-of-truth limits for the workflow_runs textual columns.
_MAX_USERNAME_LENGTH = 100
_MAX_GITHUB_RUN_ID_LENGTH = 50
_MAX_ERROR_MESSAGE_LENGTH = 4000


class WorkflowRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ig_username: str = Field(..., min_length=1, max_length=_MAX_USERNAME_LENGTH)
    github_run_id: str | None = Field(default=None, max_length=_MAX_GITHUB_RUN_ID_LENGTH)


class WorkflowRunUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: WorkflowRunStatus | None = None
    posts_fetched: int | None = Field(default=None, ge=0)
    posts_new: int | None = Field(default=None, ge=0)
    events_extracted: int | None = Field(default=None, ge=0)
    events_saved: int | None = Field(default=None, ge=0)
    pinned_post_warning: bool | None = None
    error_message: str | None = Field(default=None, max_length=_MAX_ERROR_MESSAGE_LENGTH)
    finished_at: datetime | None = None


class WorkflowRunResponse(BaseModel):
    id: str
    ig_username: str
    github_run_id: str | None = None
    status: WorkflowRunStatus
    posts_fetched: int = 0
    posts_new: int = 0
    events_extracted: int = 0
    events_saved: int = 0
    pinned_post_warning: bool = False
    error_message: str | None = None
    started_at: datetime
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}
