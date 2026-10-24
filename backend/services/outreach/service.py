"""Store the organizers the daily research sweep finds and serve them to the admin page."""

from __future__ import annotations

from typing import Any

from core.database import get_sb
from core.errors import OUTREACH_LEAD_NOT_FOUND
from core.exceptions import NotFoundError
from core.pagination import fetch_all_pages
from core.sanitize import sanitize_postgrest_value
from core.tables import OUTREACH_LEADS, SCHOOLS
from schemas.outreach import FoundOutreachLead, OutreachLeadResponse, OutreachLeadUpdate
from services import school_service

_LEAD_COLUMNS = "*,school_record:schools(slug,name)"


def list_leads(
    *,
    lead_type: str | None,
    status: str | None,
    school: str | None,
    search: str | None,
    offset: int,
    limit: int,
) -> tuple[list[OutreachLeadResponse], int]:
    query = get_sb().table(OUTREACH_LEADS).select(_LEAD_COLUMNS, count="exact")
    if lead_type:
        query = query.eq("lead_type", lead_type)
    if status:
        query = query.eq("status", status)
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("school_id", school_id)
    if search and search.strip():
        term = sanitize_postgrest_value(search.strip())
        query = query.or_(
            f"event_name.ilike.%{term}%,organization.ilike.%{term}%,"
            f"contact_name.ilike.%{term}%,email.ilike.%{term}%"
        )
    result = (
        query.order("found_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    )
    return [_lead(row) for row in result.data or []], result.count or 0


def update_lead(lead_id: str, data: OutreachLeadUpdate) -> OutreachLeadResponse:
    changes = data.model_dump(exclude_none=True)
    if changes:
        updated = get_sb().table(OUTREACH_LEADS).update(changes).eq("id", lead_id).execute()
        if not updated.data:
            raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    result = get_sb().table(OUTREACH_LEADS).select(_LEAD_COLUMNS).eq("id", lead_id).execute()
    if not result.data:
        raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    return _lead(result.data[0])


def known_emails(limit: int) -> list[str]:
    """Organizers already found, newest first, so the agents look past them."""
    if limit == 0:
        return []
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select("email")
        .order("found_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [row["email"] for row in result.data or []]


def save_leads(school_id: int, lead_type: str, leads: list[FoundOutreachLead]) -> int:
    """Insert new organizers; one already found keeps its row and status."""
    if not leads:
        return 0
    rows = [
        {**lead.model_dump(mode="json"), "school_id": school_id, "lead_type": lead_type}
        for lead in leads
    ]
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .upsert(rows, on_conflict="email", ignore_duplicates=True)
        .execute()
    )
    return len(result.data or [])


def schools() -> list[dict[str, Any]]:
    """Every registered school's id, slug and name."""
    return fetch_all_pages(
        lambda offset, limit: (
            (
                get_sb()
                .table(SCHOOLS)
                .select("id,slug,name")
                .order("slug")
                .range(offset, offset + limit - 1)
                .execute()
            ).data
            or []
        )
    )


def _lead(row: dict[str, Any]) -> OutreachLeadResponse:
    school = row.pop("school_record", None) or {}
    return OutreachLeadResponse.model_validate(
        {**row, "school_slug": school.get("slug", ""), "school_name": school.get("name", "")}
    )
