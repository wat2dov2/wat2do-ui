"""Club category constants."""

from typing import Final

from core.constants.events import EVENT_CATEGORIES

CLUB_CATEGORIES = EVENT_CATEGORIES

CLUB_CATEGORY_IMPORT_ALIASES: dict[str, str] = {}

# Stored when a club has no school-specific club type.
CLUB_TYPE_INDEPENDENT: Final = "independent"
