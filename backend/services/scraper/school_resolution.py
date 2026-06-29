"""Resolve the canonical school name for a scrape run."""

from __future__ import annotations

import logging
import os

from core.constants.recipient_mappings import RECIPIENT_ID_TO_SCHOOL

log = logging.getLogger(__name__)

DEFAULT_SCRAPE_SCHOOL = "University of Waterloo"


def resolve_scrape_school(*, explicit_school: str | None = None) -> str:
    """Pick the school for extraction and event inserts.

    Priority:
        1. ``explicit_school`` (CLI ``--school``)
        2. ``SCHOOL`` or ``TARGET_SCHOOL`` env var
        3. ``INTENDED_RECIPIENT_ID`` env var via ``RECIPIENT_ID_TO_SCHOOL``
        4. ``DEFAULT_SCRAPE_SCHOOL``
    """
    school = (explicit_school or os.getenv("SCHOOL") or os.getenv("TARGET_SCHOOL") or "").strip()
    if school:
        return school

    recipient_id = (os.getenv("INTENDED_RECIPIENT_ID") or "").strip()
    if recipient_id:
        mapped = RECIPIENT_ID_TO_SCHOOL.get(recipient_id)
        if mapped:
            log.info(
                "Resolved school=%r from intended_recipient_id=%s",
                mapped,
                recipient_id,
            )
            return mapped
        log.warning("No school mapping for intended_recipient_id=%s", recipient_id)

    return DEFAULT_SCRAPE_SCHOOL
