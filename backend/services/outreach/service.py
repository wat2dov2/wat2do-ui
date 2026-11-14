"""Store the unclaimed clubs the daily sweep finds emails for.

Every lead is one club. Claude's pitch (``pitch.py``) judges the club and writes its
video script and email; the admin page (``rust/src/api/routes/outreach``) fills in each
lead's claim link when it reads the lead.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import OUTREACH_LEADS
from schemas.outreach import EmailFoundBy, FoundClubEmail, Pitch
from services.outreach.formality import ClubFacts


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
    """Leads whose club has since been claimed move to claimed; returns how many moved."""
    return get_sb().rpc("outreach_mark_claimed", {}).execute().data or 0


def unpitched(
    schools: list[str], limit: int, *, recheck_before: datetime, event_limit: int
) -> list[dict[str, Any]]:
    """Leads at ``schools`` to judge: never judged, or judged not a fit before ``recheck_before``.

    Each comes with its club and the club's newest ``event_limit`` events.
    """
    if limit == 0:
        return []
    return (
        get_sb()
        .rpc(
            "outreach_unpitched",
            {
                "p_schools": schools,
                "p_limit": limit,
                "p_recheck_before": recheck_before.isoformat(),
                "p_event_limit": event_limit,
            },
        )
        .execute()
        .data
        or []
    )


def save_pitch(lead_id: str, pitch: Pitch) -> None:
    """Store Claude's verdict, and for a fit the script and email (else none)."""
    written = pitch.fit
    get_sb().table(OUTREACH_LEADS).update(
        {
            "pitch_fit": pitch.fit,
            "pitch_reason": pitch.reason,
            "pitch_script": pitch.script if written else None,
            "pitch_email_subject": pitch.email_subject if written else None,
            "pitch_email_body": pitch.email_body if written else None,
            "pitched_at": datetime.now(UTC).isoformat(),
        }
    ).eq("id", lead_id).execute()


def _email_columns(found: FoundClubEmail | None, found_by: EmailFoundBy) -> dict[str, Any]:
    if found is None:
        return {}
    return {
        "email": found.email,
        "email_source_url": found.source_url,
        "email_found_by": found_by,
        "found_at": datetime.now(UTC).isoformat(),
    }
