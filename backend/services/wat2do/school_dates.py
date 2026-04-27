"""School-aware date helpers for the scraping pipeline.

Wraps the timezone resolver in calendar_service and adds the
semester-end lookup the OpenAI extractor needs as prompt context.

Why not in core/?  ``core/`` is for cross-cutting primitives with no
domain logic — semester math is domain logic specific to scraping.
The constants themselves (``SCHOOL_TIMEZONES``, ``SCHOOL_SEMESTER_ENDS``)
do live in ``core/constants.py`` so they remain a single source of truth.
"""

from datetime import datetime

from core.constants import SCHOOL_ALIASES, SCHOOL_SEMESTER_ENDS
from services.calendar_service import resolve_school_timezone

__all__ = ["resolve_school_timezone", "current_semester_end"]


def current_semester_end(school: str | None, *, now: datetime | None = None) -> str | None:
    """Return the UTC end timestamp of the semester containing ``now``.

    Format mirrors v1: ``YYYYMMDDTHHMMSSZ``. Returns ``None`` for unknown
    schools so the caller can choose to either skip the semester anchor
    in the prompt or inject a default. The OpenAI extractor falls back
    to "no semester anchor" when the helper returns None.

    Semester windows:
        Jan-Apr -> winter/spring index
        May-Aug -> summer index
        Sep-Dec -> fall index
    """
    if not school:
        return None

    key = school.strip().lower()
    canonical = SCHOOL_ALIASES.get(key, key)
    ends = SCHOOL_SEMESTER_ENDS.get(canonical)
    if ends is None:
        return None

    month = (now or datetime.utcnow()).month
    if 1 <= month <= 4:
        return ends[1]
    if 5 <= month <= 8:
        return ends[2]
    return ends[0]
