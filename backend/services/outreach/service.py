"""Store outreach campaigns and the organizers the research sweep finds for them."""

from __future__ import annotations

from typing import Any

from core.controlbox import controlbox
from core.database import get_sb
from core.errors import (
    OUTREACH_CAMPAIGN_NOT_FOUND,
    OUTREACH_LEAD_NOT_FOUND,
    OUTREACH_LEAD_TYPE_UNKNOWN,
    OUTREACH_SCHOOL_UNKNOWN,
)
from core.exceptions import NotFoundError, ValidationError
from core.pagination import fetch_all_pages
from core.sanitize import sanitize_postgrest_value
from core.tables import OUTREACH_CAMPAIGNS, OUTREACH_LEADS, SCHOOLS
from schemas.outreach import (
    FoundOutreachLead,
    OutreachCampaignCreate,
    OutreachCampaignResponse,
    OutreachCampaignUpdate,
    OutreachLeadResponse,
    OutreachLeadUpdate,
)
from services import school_service

_LEAD_COLUMNS = "*,school_record:schools(slug,name)"


def list_campaigns() -> list[OutreachCampaignResponse]:
    result = get_sb().table(OUTREACH_CAMPAIGNS).select("*").order("created_at", desc=True).execute()
    return [OutreachCampaignResponse.model_validate(row) for row in result.data or []]


def create_campaign(data: OutreachCampaignCreate) -> OutreachCampaignResponse:
    if data.lead_type not in controlbox.outreach.lead_types:
        raise ValidationError(OUTREACH_LEAD_TYPE_UNKNOWN)
    known = {school["slug"] for school in schools()}
    if any(slug not in known for slug in data.school_slugs):
        raise ValidationError(OUTREACH_SCHOOL_UNKNOWN)
    result = get_sb().table(OUTREACH_CAMPAIGNS).insert(data.model_dump(mode="json")).execute()
    return OutreachCampaignResponse.model_validate(result.data[0])


def update_campaign(campaign_id: str, data: OutreachCampaignUpdate) -> OutreachCampaignResponse:
    changes = data.model_dump(exclude_none=True)
    query = get_sb().table(OUTREACH_CAMPAIGNS)
    result = (
        query.update(changes).eq("id", campaign_id).execute()
        if changes
        else query.select("*").eq("id", campaign_id).execute()
    )
    if not result.data:
        raise NotFoundError(OUTREACH_CAMPAIGN_NOT_FOUND)
    return OutreachCampaignResponse.model_validate(result.data[0])


def active_campaigns() -> list[OutreachCampaignResponse]:
    return [campaign for campaign in list_campaigns() if campaign.status == "active"]


def list_leads(
    *,
    campaign_id: str | None,
    status: str | None,
    school: str | None,
    search: str | None,
    offset: int,
    limit: int,
) -> tuple[list[OutreachLeadResponse], int]:
    query = get_sb().table(OUTREACH_LEADS).select(_LEAD_COLUMNS, count="exact")
    if campaign_id:
        query = query.eq("campaign_id", campaign_id)
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
    table = get_sb().table(OUTREACH_LEADS)
    if changes:
        updated = table.update(changes).eq("id", lead_id).execute()
        if not updated.data:
            raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    result = get_sb().table(OUTREACH_LEADS).select(_LEAD_COLUMNS).eq("id", lead_id).execute()
    if not result.data:
        raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    return _lead(result.data[0])


def known_emails(campaign_id: str, limit: int) -> list[str]:
    """Organizers this campaign already has, newest first, so the agent looks past them."""
    if limit == 0:
        return []
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select("email")
        .eq("campaign_id", campaign_id)
        .order("found_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [row["email"] for row in result.data or []]


def save_leads(campaign_id: str, school_id: int, leads: list[FoundOutreachLead]) -> int:
    """Insert new organizers; one already in the campaign keeps its row and status."""
    if not leads:
        return 0
    rows = [
        {**lead.model_dump(mode="json"), "campaign_id": campaign_id, "school_id": school_id}
        for lead in leads
    ]
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .upsert(rows, on_conflict="campaign_id,email", ignore_duplicates=True)
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
