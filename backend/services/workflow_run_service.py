"""WorkflowRun CRUD via Supabase. Sync.

Internal/operational table - no public router exposes this. Used by the
services/scraper pipeline to track per-username scrape attempts and by
future admin tooling to surface failures.
"""

import logging
from datetime import datetime, timezone

from core.constants import (
    WORKFLOW_RUN_ERROR,
    WORKFLOW_RUN_NO_POSTS,
    WORKFLOW_RUN_RUNNING,
    WORKFLOW_RUN_SUCCESS,
)
from core.database import get_sb
from core.tables import WORKFLOW_RUNS
from schemas.workflow_run import WorkflowRunCreate, WorkflowRunResponse, WorkflowRunUpdate

log = logging.getLogger(__name__)


def create_workflow_run(data: WorkflowRunCreate) -> WorkflowRunResponse:
    payload = data.model_dump(mode="json")
    payload["status"] = WORKFLOW_RUN_RUNNING
    r = get_sb().table(WORKFLOW_RUNS).insert(payload).execute()
    return WorkflowRunResponse.model_validate(r.data[0])


def update_workflow_run(run_id: str, data: WorkflowRunUpdate) -> WorkflowRunResponse | None:
    payload = data.model_dump(mode="json", exclude_unset=True)
    if not payload:
        return get_workflow_run(run_id)
    r = get_sb().table(WORKFLOW_RUNS).update(payload).eq("id", run_id).execute()
    if not r.data:
        return None
    return WorkflowRunResponse.model_validate(r.data[0])


def get_workflow_run(run_id: str) -> WorkflowRunResponse | None:
    r = get_sb().table(WORKFLOW_RUNS).select("*").eq("id", run_id).limit(1).execute()
    if not r.data:
        return None
    return WorkflowRunResponse.model_validate(r.data[0])


def mark_finished(
    run_id: str,
    *,
    status: str,
    posts_fetched: int = 0,
    posts_new: int = 0,
    events_extracted: int = 0,
    events_saved: int = 0,
    pinned_post_warning: bool = False,
    error_message: str | None = None,
) -> WorkflowRunResponse | None:
    """Terminal-state update.

    Status must be one of WORKFLOW_RUN_SUCCESS / WORKFLOW_RUN_ERROR /
    WORKFLOW_RUN_NO_POSTS - RUNNING is the initial state and is never
    written here. Sets ``finished_at`` to ``now()``.
    """
    if status not in (WORKFLOW_RUN_SUCCESS, WORKFLOW_RUN_ERROR, WORKFLOW_RUN_NO_POSTS):
        # Defensive - every caller passes a constant, so this is a typo
        # check rather than a runtime branch users can hit.
        raise ValueError(f"invalid terminal status: {status!r}")

    update = WorkflowRunUpdate(
        status=status,  # type: ignore[arg-type]
        posts_fetched=posts_fetched,
        posts_new=posts_new,
        events_extracted=events_extracted,
        events_saved=events_saved,
        pinned_post_warning=pinned_post_warning,
        error_message=error_message,
        finished_at=datetime.now(timezone.utc),
    )
    return update_workflow_run(run_id, update)
