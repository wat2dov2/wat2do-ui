"""Store the unclaimed clubs the daily sweep finds emails for and serve them to the admin page.

Every lead is one club. Its email, follow-up and claim link are written from the club
when the page reads it, so the copy always matches the club's current page.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.database import get_sb
from core.errors import OUTREACH_LEAD_NOT_FOUND
from core.exceptions import NotFoundError
from core.pagination import fetch_all_pages
from core.sanitize import sanitize_postgrest_value
from core.tables import OUTREACH_LEADS
from schemas.outreach import (
    EmailFoundBy,
    FoundClubEmail,
    LeadSort,
    OutreachLeadResponse,
    OutreachLeadUpdate,
)
from services import school_service
from services.outreach.formality import ClubFacts

CONTROL = controlbox.outreach
_LEAD_COLUMNS = "*,club:clubs!inner(club_name,school_id,school:schools(slug,name))"
_SECTIONS = re.compile(r"^## (.+)$", re.MULTILINE)


def _load_template() -> dict[str, str]:
    """claim_email.md's sections by heading: Subject, Body and Follow-up."""
    parts = _SECTIONS.split((Path(__file__).with_name("claim_email.md")).read_text())
    return {heading: text.strip() for heading, text in zip(parts[1::2], parts[2::2], strict=True)}


_TEMPLATE = _load_template()


def list_leads(
    *,
    sort: LeadSort,
    status: str | None,
    school: str | None,
    search: str | None,
    offset: int,
    limit: int,
) -> tuple[list[OutreachLeadResponse], int]:
    """Clubs with an email, newest or most formal first."""
    query = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select(_LEAD_COLUMNS, count="exact")
        .not_.is_("email", "null")
    )
    if status:
        query = query.eq("status", status)
    if school:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            return [], 0
        query = query.eq("club.school_id", school_id)
    if search and search.strip():
        term = sanitize_postgrest_value(search.strip())
        query = (
            query.ilike("email", f"%{term}%")
            if "@" in term
            else query.ilike("club.club_name", f"%{term}%")
        )
    if sort == "formality":
        query = query.order("formality", desc=True, nullsfirst=False)
    result = (
        query.order("found_at", desc=True).order("id").range(offset, offset + limit - 1).execute()
    )
    return _leads(result.data or []), result.count or 0


def update_lead(lead_id: str, data: OutreachLeadUpdate) -> OutreachLeadResponse:
    changes = data.model_dump(exclude_none=True)
    if changes:
        updated = get_sb().table(OUTREACH_LEADS).update(changes).eq("id", lead_id).execute()
        if not updated.data:
            raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select(_LEAD_COLUMNS)
        .eq("id", lead_id)
        .not_.is_("email", "null")
        .execute()
    )
    if not result.data:
        raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)
    return _leads(result.data)[0]


def new_clubs(limit: int) -> list[dict[str, Any]]:
    """Unclaimed clubs with listings and no lead yet, busiest first."""
    return get_sb().rpc("outreach_new_clubs", {"p_limit": limit}).execute().data or []


def clubs_to_research(limit: int, *, searched_before: datetime) -> list[dict[str, Any]]:
    """Clubs whose page showed no email and no agent has searched for lately, never searched first."""
    if limit == 0:
        return []
    result = (
        get_sb()
        .table(OUTREACH_LEADS)
        .select("club_id,club:clubs!inner(club_name,club_page,school:schools(slug,name))")
        .is_("email", "null")
        .or_(f"researched_at.is.null,researched_at.lt.{searched_before.isoformat()}")
        .order("researched_at", nullsfirst=True)
        .order("searched_at")
        .limit(limit)
        .execute()
    )
    return [
        {
            "club_id": row["club_id"],
            "club_name": row["club"]["club_name"],
            "club_page": row["club"]["club_page"],
            "school_name": row["club"]["school"]["name"],
        }
        for row in result.data or []
    ]


def emails_in_use() -> set[str]:
    """Every email already given to a club, so one is never handed to a second club."""
    rows = fetch_all_pages(
        lambda offset, limit: (
            (
                get_sb()
                .table(OUTREACH_LEADS)
                .select("email")
                .not_.is_("email", "null")
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
            ).data
            or []
        )
    )
    return {row["email"] for row in rows}


def save_page_search(club_id: int, found: FoundClubEmail | None) -> None:
    """A new club's lead, with the email its own page shows, if any."""
    get_sb().table(OUTREACH_LEADS).upsert(
        {"club_id": club_id, **_email_columns(found, "club_page")},
        on_conflict="club_id",
        ignore_duplicates=True,
    ).execute()


def save_research(club_id: int, found: FoundClubEmail | None) -> None:
    """What the research agent found for a club, or that it found nothing this time.

    A found email changes the club's formality, so the next scoring pass rescores it.
    """
    changes = {"researched_at": datetime.now(UTC).isoformat(), **_email_columns(found, "research")}
    if found is not None:
        changes["formality"] = None
    get_sb().table(OUTREACH_LEADS).update(changes).eq("club_id", club_id).is_(
        "email", "null"
    ).execute()


def unscored(limit: int) -> list[tuple[str, int, ClubFacts]]:
    """Leads without a formality score yet: each lead's id, club id and what to score."""
    rows = get_sb().rpc("outreach_unscored", {"p_limit": limit}).execute().data or []
    return [
        (
            row["lead_id"],
            row["club_id"],
            ClubFacts(
                club_name=row["club_name"],
                ig=row["ig"],
                club_page=row["club_page"],
                email=row["email"],
                listings=row["listings"],
                page_host_clubs=row["page_host_clubs"],
                school_domains=row["school_domains"] or [],
            ),
        )
        for row in rows
    ]


def save_formality(scores: list[tuple[str, int, int, list[str]]]) -> None:
    """Store each lead's (id, club id, score, signals)."""
    if not scores:
        return
    get_sb().table(OUTREACH_LEADS).upsert(
        [
            {"id": lead_id, "club_id": club_id, "formality": value, "formality_signals": signals}
            for lead_id, club_id, value, signals in scores
        ],
        on_conflict="id",
    ).execute()


def mark_claimed() -> int:
    """Leads whose club has since been claimed move to claimed."""
    rows = fetch_all_pages(
        lambda offset, limit: (
            (
                get_sb()
                .table(OUTREACH_LEADS)
                .select("club_id")
                .neq("status", "claimed")
                .order("id")
                .range(offset, offset + limit - 1)
                .execute()
            ).data
            or []
        )
    )
    club_ids = [row["club_id"] for row in rows]
    if not club_ids:
        return 0
    unclaimed = set(
        get_sb().rpc("outreach_unclaimed", {"p_club_ids": club_ids}).execute().data or []
    )
    claimed = [club_id for club_id in club_ids if club_id not in unclaimed]
    if claimed:
        get_sb().table(OUTREACH_LEADS).update({"status": "claimed"}).in_(
            "club_id", claimed
        ).execute()
    return len(claimed)


def _email_columns(found: FoundClubEmail | None, found_by: EmailFoundBy) -> dict[str, Any]:
    if found is None:
        return {}
    return {
        "email": found.email,
        "email_source_url": found.source_url,
        "email_found_by": found_by,
        "found_at": datetime.now(UTC).isoformat(),
    }


def _leads(rows: list[dict[str, Any]]) -> list[OutreachLeadResponse]:
    club_ids = [row["club_id"] for row in rows]
    listings = (
        {
            row["club_id"]: row["listings"]
            for row in get_sb().rpc("club_listing_counts", {"p_club_ids": club_ids}).execute().data
            or []
        }
        if club_ids
        else {}
    )
    return [_lead(row, listings.get(row["club_id"], 0)) for row in rows]


def _lead(row: dict[str, Any], listings: int) -> OutreachLeadResponse:
    club = row.pop("club")
    school = club["school"]
    club_url = CONTROL.club_url_template.replace("{school}", school["slug"]).replace(
        "{club_id}", str(row["club_id"])
    )
    values = {
        "club_name": club["club_name"],
        "school_name": school["name"],
        "club_url": club_url,
        "sender_name": CONTROL.sender_name,
    }
    subject, body, follow_up = (
        _fill(_TEMPLATE[section], values) for section in ("Subject", "Body", "Follow-up")
    )
    return OutreachLeadResponse.model_validate(
        {
            **row,
            "club_name": club["club_name"],
            "club_url": club_url,
            "listings": listings,
            "school_slug": school["slug"],
            "school_name": school["name"],
            "email_subject": subject,
            "email_body": body,
            "follow_up": follow_up,
        }
    )


def _fill(text: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text
