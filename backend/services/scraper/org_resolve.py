"""Resolve club ownership before scrape dedup / write.

Same-org identity is ``club_id``. IG scrapes may auto-create a stub;
directory scrapes only link an existing school+name match (no invent).
"""

from __future__ import annotations

from dataclasses import dataclass

from services import club_service
from services.scraper import event_writer as event_writer_mod


@dataclass(frozen=True)
class ResolvedClub:
    """Ownership context passed from resolve → dedup → write."""

    club_id: int | None
    club_name: str | None
    ig_handle: str | None
    cohost_club_ids: tuple[int, ...] = ()


def resolve_club_for_scrape(
    *,
    ig_handle: str | list[str] | None = None,
    school: str | None,
    club_name: str | None,
    create_stub_if_missing: bool = True,
) -> ResolvedClub:
    """Resolve org before ``find_candidates`` / ``write_event``.

    Order:
      1. IG handles → lookup all. If any matches `school`, use it.
      2. When creation is disabled, school + display name → existing exact match.
      3. A single unknown handle may create a stub when explicitly permitted.
         Multiple account identities never create clubs.
    """
    school_slug = (school or "").strip() or None
    preferred_name = (club_name or "").strip() or None

    raw_handles = [ig_handle] if isinstance(ig_handle, str) else (ig_handle or [])

    cleaned_handles = []
    for h in raw_handles:
        c = (h or "").strip().lstrip("@").lower()
        if c and c not in cleaned_handles:
            cleaned_handles.append(c)

    create_stub_if_missing = create_stub_if_missing and len(cleaned_handles) == 1

    # Coauthors link only to registered clubs at the target school.
    matches = []
    for cleaned in cleaned_handles:
        org = event_writer_mod._lookup_club_by_ig(cleaned)
        if org is not None and (org.get("schools") or {}).get("slug") == school_slug:
            if not any(existing[1]["id"] == org["id"] for existing in matches):
                matches.append((cleaned, org))
    if matches:
        cleaned, org = matches[0]
        return ResolvedClub(
            club_id=org["id"],
            club_name=(org.get("club_name") or "").strip() or preferred_name,
            ig_handle=cleaned,
            cohost_club_ids=tuple(candidate["id"] for _, candidate in matches[1:]),
        )

    # Retain an unknown source handle without borrowing another school's club.
    fallback_handle = None
    for cleaned in cleaned_handles:
        if event_writer_mod._lookup_club_by_ig(cleaned) is None:
            fallback_handle = cleaned
            break

    if school_slug and preferred_name and (not create_stub_if_missing or fallback_handle is None):
        org = club_service.lookup_club_by_school_and_name(school_slug, preferred_name)
        if org is not None:
            org_ig = (org.get("ig") or "").strip().lstrip("@") or None
            return ResolvedClub(
                club_id=org.get("id"),
                club_name=(org.get("club_name") or "").strip() or preferred_name,
                ig_handle=org_ig,
            )

    if fallback_handle:
        if create_stub_if_missing:
            org = event_writer_mod._ensure_club_by_ig(
                fallback_handle,
                school=school_slug,
                preferred_name=preferred_name,
            )
        else:
            org = event_writer_mod._lookup_club_by_ig(fallback_handle)

        if org is not None:
            return ResolvedClub(
                club_id=org.get("id"),
                club_name=(org.get("club_name") or "").strip() or preferred_name,
                ig_handle=fallback_handle,
            )
        return ResolvedClub(
            club_id=None,
            club_name=preferred_name,
            ig_handle=fallback_handle,
        )

    return ResolvedClub(
        club_id=None,
        club_name=preferred_name,
        ig_handle=None,
    )
