"""Persist hiring positions extracted from Instagram posts."""

from __future__ import annotations

import logging

from postgrest.exceptions import APIError

from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_SOURCE_URL_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.database import get_sb
from core.sanitize import remove_surrogates
from core.tables import POSITIONS
from services import school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.scraper.org_resolve import ResolvedClub

log = logging.getLogger(__name__)


def write_position(
    position: dict,
    *,
    ig_handle: str,
    source_url: str,
    resolved_org: ResolvedClub,
) -> str:
    """Insert one extracted position, returning ``inserted`` or ``skipped``."""
    title = (position.get("title") or "").strip()
    description = (position.get("description") or "").strip()
    school_slug = (position.get("school") or "").strip()
    school = school_service.get_school(school_slug)

    if not title or not description or not source_url:
        log.warning(
            "[%s] dropping position - missing title, description, or source URL",
            ig_handle,
        )
        return "skipped"
    if school is None:
        log.warning("[%s] dropping position %r - school is not registered", ig_handle, title)
        return "skipped"
    if not isinstance(resolved_org.club_id, int):
        log.warning("[%s] dropping position %r - club was not resolved", ig_handle, title)
        return "skipped"

    requirements: list[str] = []
    for requirement in position.get("requirements") or []:
        cleaned_requirement = _clean_optional(requirement, MAX_POSITION_REQUIREMENT_LENGTH)
        if cleaned_requirement:
            requirements.append(cleaned_requirement)
        if len(requirements) >= MAX_POSITION_REQUIREMENT_COUNT:
            break
    row = {
        "club_id": resolved_org.club_id,
        "school_id": school.id,
        "title": title[:MAX_POSITION_TITLE_LENGTH],
        "description": description[:MAX_POSITION_DESCRIPTION_LENGTH],
        "position_type": position.get("position_type"),
        "requirements": requirements,
        "commitment": _clean_optional(position.get("commitment"), MAX_POSITION_DETAIL_LENGTH),
        "compensation": _clean_optional(position.get("compensation"), MAX_POSITION_DETAIL_LENGTH),
        "is_paid": position.get("is_paid"),
        "location": _clean_optional(position.get("location"), MAX_POSITION_DETAIL_LENGTH),
        "contact_email": _clean_optional(position.get("contact_email"), 320),
        "deadline_date": position.get("deadline_date"),
        "deadline_at": position.get("deadline_at"),
        "source_url": remove_surrogates(source_url[:MAX_POSITION_SOURCE_URL_LENGTH]),
        "source_image_url": _clean_optional(
            position.get("source_image_url"), MAX_POSITION_SOURCE_URL_LENGTH
        ),
        "ingestion_source": "instagram_scraper",
    }

    try:
        inserted = get_sb().table(POSITIONS).insert(row).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505":
            log.info("[%s] skipping duplicate position %r", ig_handle, title)
            return "skipped"
        raise

    if not inserted.data:
        log.error("[%s] positions insert returned no row for %r", ig_handle, title)
        return "skipped"

    log.info(
        "[%s] inserted position id=%s for %r",
        ig_handle,
        inserted.data[0].get("id"),
        title,
    )
    event_feed_revalidation_service.revalidate_school(school.slug)
    return "inserted"


def _clean_optional(value: object, max_length: int) -> str | None:
    cleaned = remove_surrogates(str(value).strip()) if value is not None else None
    return cleaned[:max_length] if cleaned else None
