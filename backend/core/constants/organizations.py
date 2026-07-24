"""Organization category constants."""

from typing import Final

from core.constants.events import EVENT_CATEGORIES

ORGANIZATION_CATEGORIES = EVENT_CATEGORIES

ORGANIZATION_CATEGORY_IMPORT_ALIASES: dict[str, str] = {}

# Stored when an organization has no school-specific organization type.
ORGANIZATION_TYPE_INDEPENDENT: Final = "independent"
