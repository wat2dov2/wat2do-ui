"""Resolve organization ownership before scrape dedup / write.

Same-org identity is ``organization_id``. IG scrapes may auto-create a stub;
directory scrapes only link an existing school+name match (no invent).
"""

from __future__ import annotations

from dataclasses import dataclass

from services import organization_service
from services.scraper import event_writer as event_writer_mod


@dataclass(frozen=True)
class ResolvedOrganization:
    """Ownership context passed from resolve → dedup → write."""

    organization_id: int | None
    organization_name: str | None
    ig_handle: str | None


def resolve_organization_for_scrape(
    *,
    ig_handle: str | list[str] | None = None,
    school: str | None,
    organization_name: str | None,
    create_stub_if_missing: bool = True,
) -> ResolvedOrganization:
    """Resolve org before ``find_candidates`` / ``write_event``.

    Order:
      1. IG handles → lookup all. If any matches `school`, use it.
      2. If none match `school`, use the fallback handle (and optionally auto-create stub).
      3. Else school + normalized display name → exact match only.
    """
    school_slug = (school or "").strip() or None
    preferred_name = (organization_name or "").strip() or None

    raw_handles = [ig_handle] if isinstance(ig_handle, str) else (ig_handle or [])

    cleaned_handles = []
    for h in raw_handles:
        c = (h or "").strip().lstrip("@")
        if c and c not in cleaned_handles:
            cleaned_handles.append(c)

    # 1. Try to find an existing org that matches the target school
    # We cache the lookups so we don't query the DB twice for the fallback logic.
    org_cache = {}
    for cleaned in cleaned_handles:
        org = event_writer_mod._lookup_organization_by_ig(cleaned)
        org_cache[cleaned] = org

        if org is not None:
            # Check if this org actually belongs to our target school
            org_school = org.get("schools")
            if isinstance(org_school, dict) and org_school.get("slug") == school_slug:
                return ResolvedOrganization(
                    organization_id=org.get("id"),
                    organization_name=(org.get("organization_name") or "").strip()
                    or preferred_name,
                    ig_handle=cleaned,
                )

    # 2. Fallback to the first handle that does NOT conflict with another school
    # (i.e. it doesn't exist in the database yet, so we can safely create a stub for it).
    fallback_handle = None
    for cleaned in cleaned_handles:
        if org_cache[cleaned] is None:
            fallback_handle = cleaned
            break

    if fallback_handle:
        if create_stub_if_missing:
            org = event_writer_mod._ensure_organization_by_ig(
                fallback_handle,
                school=school_slug,
                preferred_name=preferred_name,
            )
        else:
            org = event_writer_mod._lookup_organization_by_ig(fallback_handle)

        if org is not None:
            return ResolvedOrganization(
                organization_id=org.get("id"),
                organization_name=(org.get("organization_name") or "").strip() or preferred_name,
                ig_handle=fallback_handle,
            )
        return ResolvedOrganization(
            organization_id=None,
            organization_name=preferred_name,
            ig_handle=fallback_handle,
        )

    if school_slug and preferred_name:
        org = organization_service.lookup_organization_by_school_and_name(
            school_slug, preferred_name
        )
        if org is not None:
            org_ig = (org.get("ig") or "").strip().lstrip("@") or None
            return ResolvedOrganization(
                organization_id=org.get("id"),
                organization_name=(org.get("organization_name") or "").strip() or preferred_name,
                ig_handle=org_ig,
            )

    return ResolvedOrganization(
        organization_id=None,
        organization_name=preferred_name,
        ig_handle=None,
    )
