"""Map external school-directory category labels to canonical organization categories.

Used when normalizing scraped/imported club rows (e.g. the all-schools master
spreadsheet). This is import normalization — not runtime backward compatibility.
"""

from __future__ import annotations

import re

from core.constants.organizations import ORGANIZATION_CATEGORIES

_BUSINESS = "Business and Entrepreneurial"
_CHARITABLE = "Charitable, Community Service & International Development"
_ARTS = "Creative Arts, Dance and Music"
_ENVIRONMENT = "Environmental and Sustainability"
_GAMES = "Games, Recreational and Social"
_HEALTH = "Health Promotion"
_MEDIA = "Media, Publications and Web Development"
_POLITICAL = "Political and Social Awareness"
_RELIGIOUS = "Religious and Spiritual"

_CANONICAL_SET = frozenset(ORGANIZATION_CATEGORIES)

# Tokens that are directory metadata, placeholders, or otherwise not mappable.
_UNMAPPABLE_EXACT = frozenset(
    {
        "",
        "unknown",
        "administrative",
        "administrative , academic",
        "sfl organization",
        "undergrad independent (eo) org",
        "undergrad university (it) org",
        "grad/professional university (it) org",
        "grad/professional independent (eo) org",
        "x1",
        "x2",
        "x3",
        "x4",
        "x5",
    }
)

# Exact token -> one or more canonical categories (keys are normalized).
_TOKEN_TO_CANONICAL: dict[str, tuple[str, ...]] = {
    "academic": (_POLITICAL,),
    "academics": (_POLITICAL,),
    "advocacy": (_POLITICAL,),
    "political": (_POLITICAL,),
    "politics & advocacy": (_POLITICAL,),
    "politics and advocacy": (_POLITICAL,),
    "professional development": (_BUSINESS,),
    "science & technology": (_MEDIA,),
    "science and technology": (_MEDIA,),
    "technology": (_MEDIA,),
    "media & publication": (_MEDIA,),
    "media and publication": (_MEDIA,),
    "language-publications": (_MEDIA,),
    "culture & identity-based": (_ARTS,),
    "cultural": (_ARTS,),
    "culture": (_ARTS,),
    "arts": (_ARTS,),
    "art": (_ARTS,),
    "performance & arts": (_ARTS,),
    "performance and arts": (_ARTS,),
    "dance": (_ARTS,),
    "music": (_ARTS,),
    "design": (_ARTS,),
    "performing-finearts-clubs": (_ARTS,),
    "community engagement & service": (_CHARITABLE,),
    "community development": (_CHARITABLE,),
    "community-outreach-and-volunteering-clubs": (_CHARITABLE,),
    "charity-environment-clubs": (_CHARITABLE, _ENVIRONMENT),
    "volunteering": (_CHARITABLE,),
    "social": (_GAMES,),
    "games": (_GAMES,),
    "sports & games": (_GAMES,),
    "sports and games": (_GAMES,),
    "social & games": (_GAMES,),
    "social and games": (_GAMES,),
    "partying": (_GAMES,),
    "fraternity & sorority life": (_GAMES,),
    "general interest": (_GAMES,),
    "general interests": (_GAMES,),
    "hobby-leisure-clubs": (_GAMES,),
    "athletics-recreation-clubs": (_GAMES,),
    "religion & spirituality": (_RELIGIOUS,),
    "religious/faith": (_RELIGIOUS,),
    "religious": (_RELIGIOUS,),
    "religion": (_RELIGIOUS,),
    "religion-culture-clubs": (_RELIGIOUS, _ARTS),
    "health professions & clinical interests": (_HEALTH,),
    "well-being": (_HEALTH,),
    "wellness": (_HEALTH,),
    "health": (_HEALTH,),
    "mental health": (_HEALTH,),
    "food": (_HEALTH,),
    "health-wellness-clubs": (_HEALTH,),
    "sports": (_HEALTH,),
    "athletics": (_HEALTH,),
    "sustainability": (_ENVIRONMENT,),
    "environmental": (_ENVIRONMENT,),
    "networking-and-leadership-development-clubs": (_BUSINESS,),
    "entrepreneurship": (_BUSINESS,),
    "networking": (_BUSINESS,),
    "career": (_BUSINESS,),
    "political-socialactivism-clubs": (_POLITICAL,),
    "studying": (_POLITICAL,),
}

# Slug / substring heuristics applied when no exact token match exists.
_SUBSTRING_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("religion", (_RELIGIOUS,)),
    ("spiritual", (_RELIGIOUS,)),
    ("faith", (_RELIGIOUS,)),
    ("politic", (_POLITICAL,)),
    ("advocacy", (_POLITICAL,)),
    ("academic", (_POLITICAL,)),
    ("media", (_MEDIA,)),
    ("publication", (_MEDIA,)),
    ("technology", (_MEDIA,)),
    ("tech", (_MEDIA,)),
    ("network", (_BUSINESS,)),
    ("entrepreneur", (_BUSINESS,)),
    ("business", (_BUSINESS,)),
    ("charity", (_CHARITABLE,)),
    ("volunteer", (_CHARITABLE,)),
    ("community", (_CHARITABLE,)),
    ("service", (_CHARITABLE,)),
    ("environment", (_ENVIRONMENT,)),
    ("sustainab", (_ENVIRONMENT,)),
    ("health", (_HEALTH,)),
    ("wellness", (_HEALTH,)),
    ("well-being", (_HEALTH,)),
    ("athletic", (_GAMES,)),
    ("recreation", (_GAMES,)),
    ("sport", (_HEALTH,)),
    ("game", (_GAMES,)),
    ("social", (_GAMES,)),
    ("hobby", (_GAMES,)),
    ("leisure", (_GAMES,)),
    ("fraternity", (_GAMES,)),
    ("sorority", (_GAMES,)),
    ("art", (_ARTS,)),
    ("music", (_ARTS,)),
    ("dance", (_ARTS,)),
    ("perform", (_ARTS,)),
    ("culture", (_ARTS,)),
    ("identity", (_ARTS,)),
)


def _normalize_token(token: str) -> str:
    return " ".join(token.strip().lower().split())


def _map_token(token: str) -> list[str]:
    normalized = _normalize_token(token)
    if not normalized or normalized in _UNMAPPABLE_EXACT:
        return []
    if normalized in _CANONICAL_SET:
        return [normalized]
    if normalized in _TOKEN_TO_CANONICAL:
        return list(_TOKEN_TO_CANONICAL[normalized])
    for needle, categories in _SUBSTRING_RULES:
        if needle in normalized:
            return list(categories)
    return []


def _split_directory_input(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,;]", text) if part.strip()]


def map_directory_category_list(raw: str | None) -> list[str]:
    """Return canonical categories for a directory category cell."""
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []

    normalized_full = _normalize_token(text)
    if normalized_full in _UNMAPPABLE_EXACT:
        return []

    canonical: list[str] = []
    for part in _split_directory_input(text):
        for category in _map_token(part):
            if category not in canonical:
                canonical.append(category)
    return canonical


def map_directory_category_field(raw: str | None) -> str:
    """Return comma-separated canonical categories for a directory category cell."""
    return ", ".join(map_directory_category_list(raw))
