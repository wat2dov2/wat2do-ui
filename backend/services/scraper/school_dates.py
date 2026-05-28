"""Compatibility facade for wat2do school-aware date helpers.

The canonical implementation lives in ``services.school_context`` so calendar,
notifications, and scraping share one school/time policy.
"""

from services.school_context import current_semester_end, resolve_school_timezone

__all__ = ["current_semester_end", "resolve_school_timezone"]
