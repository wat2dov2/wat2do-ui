"""Organization category constants (WUSA directory taxonomy)."""

ORGANIZATION_CATEGORIES = (
    "Business and Entrepreneurial",
    "Charitable, Community Service & International Development",
    "Creative Arts, Dance and Music",
    "Environmental and Sustainability",
    "Games, Recreational and Social",
    "Health Promotion",
    "Media, Publications and Web Development",
    "Political and Social Awareness",
    "Religious and Spiritual",
)

_CANONICAL_SET = frozenset(ORGANIZATION_CATEGORIES)

# Legacy free-form tags (and event-category bleed-through) mapped to canonical values.
LEGACY_ORGANIZATION_CATEGORY_ALIASES: dict[str, str] = {
    "Academic": "Political and Social Awareness",
    "Academics": "Political and Social Awareness",
    "Advocacy": "Political and Social Awareness",
    "Studying": "Political and Social Awareness",
    "Technology": "Media, Publications and Web Development",
    "Social & Games": "Games, Recreational and Social",
    "Social and Games": "Games, Recreational and Social",
    "Cultural": "Creative Arts, Dance and Music",
    "Culture": "Creative Arts, Dance and Music",
    "Art": "Creative Arts, Dance and Music",
    "Dance": "Creative Arts, Dance and Music",
    "Music": "Creative Arts, Dance and Music",
    "Design": "Creative Arts, Dance and Music",
    "Sports": "Health Promotion",
    "Athletics": "Health Promotion",
    "Games": "Games, Recreational and Social",
    "Partying": "Games, Recreational and Social",
    "Religious": "Religious and Spiritual",
    "Religion": "Religious and Spiritual",
    "Entrepreneurship": "Business and Entrepreneurial",
    "Networking": "Business and Entrepreneurial",
    "Career": "Business and Entrepreneurial",
    "Health": "Health Promotion",
    "Wellness": "Health Promotion",
    "Mental Health": "Health Promotion",
    "Food": "Health Promotion",
    "Volunteering": "Charitable, Community Service & International Development",
    "Environmental": "Environmental and Sustainability",
}


def canonicalize_organization_category(raw: str) -> str | None:
    """Map a raw tag to a canonical organization category, if possible."""
    value = (raw or "").strip()
    if not value:
        return None
    if value in _CANONICAL_SET:
        return value
    return LEGACY_ORGANIZATION_CATEGORY_ALIASES.get(value)


def canonicalize_organization_categories(raw: list[str] | None) -> list[str] | None:
    """Normalize a category list, deduplicating while preserving first-seen order."""
    if raw is None:
        return None
    normalized: list[str] = []
    for item in raw:
        category = canonicalize_organization_category(item)
        if category and category not in normalized:
            normalized.append(category)
    return normalized
