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
    association_affiliated: bool
    ig_handle: str | None


def resolve_organization_for_scrape(
    *,
    ig_handle: str | None,
    school: str | None,
    organization_name: str | None,
    create_stub_if_missing: bool = True,
) -> ResolvedOrganization:
    """Resolve org before ``find_candidates`` / ``write_event``.

    Order:
      1. IG handle → lookup (and optionally auto-create stub when school set).
      2. Else school + normalized display name → exact match only.
    """
    cleaned_handle = (ig_handle or "").strip().lstrip("@") or None
    school_slug = (school or "").strip() or None
    preferred_name = (organization_name or "").strip() or None

    if cleaned_handle:
        if create_stub_if_missing:
            org = event_writer_mod._ensure_organization_by_ig(
                cleaned_handle,
                school=school_slug,
                preferred_name=preferred_name,
            )
        else:
            org = event_writer_mod._lookup_organization_by_ig(cleaned_handle)
        if org is not None:
            return ResolvedOrganization(
                organization_id=org.get("id"),
                organization_name=(org.get("organization_name") or "").strip() or preferred_name,
                association_affiliated=bool(org.get("association_affiliated")),
                ig_handle=cleaned_handle,
            )
        return ResolvedOrganization(
            organization_id=None,
            organization_name=preferred_name,
            association_affiliated=False,
            ig_handle=cleaned_handle,
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
                association_affiliated=bool(org.get("association_affiliated")),
                ig_handle=org_ig,
            )

    return ResolvedOrganization(
        organization_id=None,
        organization_name=preferred_name,
        association_affiliated=False,
        ig_handle=None,
    )
