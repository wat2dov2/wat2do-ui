#!/usr/bin/env python3
"""
Infer missing event categories from existing event metadata.

Usage (from backend/):
  python scripts/infer_event_categories.py           # dry-run
  python scripts/infer_event_categories.py --apply   # update rows

This script only updates empty/default categories unless --overwrite is passed.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.constants import EVENT_CATEGORIES
from core.database import get_sb
from core.pagination import iter_all_pages
from core.tables import EVENTS

log = logging.getLogger(__name__)

DEFAULTISH_CATEGORIES = {None, "", "Events", "All Events", "Event"}

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Technology": (
        "ai",
        "artificial intelligence",
        "coding",
        "computer science",
        "cybersecurity",
        "data science",
        "developer",
        "figma",
        "hackathon",
        "machine learning",
        "programming",
        "software",
        "tech",
        "ux",
        "web dev",
    ),
    "Entrepreneurship": (
        "entrepreneur",
        "founder",
        "pitch",
        "startup",
        "venture",
    ),
    "Career": (
        "alumni",
        "career",
        "coffee chat",
        "co-op",
        "employer",
        "hiring",
        "industry",
        "internship",
        "interview",
        "linkedin",
        "recruit",
        "resume",
    ),
    "Networking": (
        "meet and greet",
        "mixer",
        "networking",
        "social & info",
    ),
    "Food": (
        "bake sale",
        "bbq",
        "brunch",
        "cheese",
        "coffee",
        "cook",
        "dinner",
        "food",
        "lunch",
        "pancake",
        "pizza",
        "potluck",
        "restaurant",
        "snack",
        "tea",
    ),
    "Music": (
        "band",
        "choir",
        "concert",
        "guitar",
        "jam session",
        "karaoke",
        "music",
        "open mic",
        "orchestra",
        "singing",
    ),
    "Dance": (
        "ballroom",
        "bollyhop",
        "dance",
        "dancing",
        "hip hop",
        "salsa",
    ),
    "Art": (
        "art",
        "bracelet",
        "craft",
        "crochet",
        "drawing",
        "keychain",
        "knitting",
        "paint",
        "painting",
        "photography",
        "pottery",
        "sewing",
        "sketch",
    ),
    "Design": (
        "accessibility design",
        "design",
        "figma workshop",
        "graphic",
        "ux design",
    ),
    "Culture": (
        "arab",
        "asian",
        "balkan",
        "black history",
        "caribbean",
        "cultural",
        "culture",
        "diwali",
        "international",
        "language",
        "latin",
        "palestine",
        "sahroona",
    ),
    "Religion": (
        "bible",
        "christian",
        "church",
        "faith",
        "hindu",
        "istikhara",
        "muslim",
        "prayer",
        "praise",
        "religion",
        "sikh",
    ),
    "Advocacy": (
        "accessibility",
        "advocacy",
        "awareness",
        "booth",
        "equity",
        "fundraiser",
        "genocide",
        "justice",
        "raise",
    ),
    "Volunteering": (
        "charity",
        "community service",
        "fundraising",
        "volunteer",
        "volunteering",
    ),
    "Athletics": (
        "athletics",
        "badminton",
        "basketball",
        "bowling",
        "climbing",
        "fitness",
        "hike",
        "hockey",
        "karate",
        "martial",
        "run club",
        "soccer",
        "sport",
        "swim",
        "tournament",
        "volleyball",
        "yoga",
    ),
    "Sports": (
        "blue jays",
        "raptors",
        "sports",
        "watch party",
        "world series",
    ),
    "Health": (
        "health",
        "nutrition",
        "therapy",
    ),
    "Wellness": (
        "meditation",
        "self care",
        "wellness",
    ),
    "Mental Health": (
        "burnout",
        "mental health",
        "stress",
    ),
    "Games": (
        "board game",
        "chess",
        "dnd",
        "dungeons",
        "family feud",
        "game night",
        "games",
        "gaming",
        "mahjong",
        "movie night",
        "poker",
        "trivia",
    ),
    "Partying": (
        "afterparty",
        "bonfire",
        "formal",
        "gala",
        "night out",
        "party",
        "pub night",
        "retro night",
        "social night",
    ),
    "Academics": (
        "academic",
        "conference",
        "election",
        "grad school",
        "lab tour",
        "lecture",
        "meet the prof",
        "professor",
        "research",
        "seminar",
        "society meeting",
        "tutorial",
    ),
    "Studying": (
        "exam",
        "finals",
        "midterm",
        "study",
        "studying",
    ),
}

CATEGORY_PRIORITY = (
    "Technology",
    "Design",
    "Entrepreneurship",
    "Career",
    "Networking",
    "Volunteering",
    "Advocacy",
    "Religion",
    "Culture",
    "Music",
    "Dance",
    "Art",
    "Athletics",
    "Sports",
    "Health",
    "Mental Health",
    "Wellness",
    "Food",
    "Games",
    "Partying",
    "Studying",
    "Academics",
)

CLUB_TYPE_FALLBACK = {
    "Athletics": "Athletics",
    "Student Society": "Academics",
    "WUSA": "Games",
}

WORD_RE = re.compile(r"[a-z0-9]+")


def _normalize_text(value: object) -> str:
    return " ".join(WORD_RE.findall(str(value or "").lower()))


def _keyword_matches(haystack: str, phrase: str) -> bool:
    normalized = _normalize_text(phrase)
    if not normalized:
        return False
    return f" {normalized} " in f" {haystack} "


def infer_category(row: dict) -> str:
    title = _normalize_text(row.get("title"))
    organization = _normalize_text(row.get("organization"))
    description = _normalize_text(row.get("description"))

    scores: Counter[str] = Counter()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if _keyword_matches(title, keyword):
                scores[category] += 3
            elif _keyword_matches(organization, keyword):
                scores[category] += 2
            elif _keyword_matches(description, keyword):
                scores[category] += 1

    food = row.get("food") or []
    if isinstance(food, list) and food:
        scores["Food"] += 2

    if scores:
        return max(CATEGORY_PRIORITY, key=lambda cat: (scores[cat], -CATEGORY_PRIORITY.index(cat)))

    club_type = (row.get("club_type") or "").strip()
    return CLUB_TYPE_FALLBACK.get(club_type, "Academics")


def _should_update(row: dict, *, overwrite: bool) -> bool:
    category = row.get("category")
    return overwrite or category in DEFAULTISH_CATEGORIES


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write inferred categories to the DB.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Also replace existing non-default categories.",
    )
    args = parser.parse_args()

    allowed = set(EVENT_CATEGORIES)
    classifier_categories = (
        set(CATEGORY_KEYWORDS) | set(CATEGORY_PRIORITY) | set(CLUB_TYPE_FALLBACK.values())
    )
    invalid = sorted(classifier_categories - allowed)
    if invalid:
        raise RuntimeError(f"Classifier contains non-canonical categories: {invalid}")

    sb = get_sb()

    def _fetch(offset: int, ps: int) -> list[dict]:
        result = (
            sb.table(EVENTS)
            .select("id,title,description,organization,club_type,category,food")
            .order("id")
            .range(offset, offset + ps - 1)
            .execute()
        )
        return result.data or []

    planned: list[tuple[int, str | None, str]] = []
    inferred_counts: Counter[str] = Counter()
    skipped_counts: Counter[str] = Counter()

    for row in iter_all_pages(_fetch):
        if not _should_update(row, overwrite=args.overwrite):
            skipped_counts[row.get("category") or "<empty>"] += 1
            continue

        inferred = infer_category(row)
        inferred_counts[inferred] += 1
        if row.get("category") != inferred:
            planned.append((row["id"], row.get("category"), inferred))

    log.info("Plan: %d updates.", len(planned))
    log.info("Inferred category distribution:")
    for category, count in inferred_counts.most_common():
        log.info("  %s: %d", category, count)
    if skipped_counts:
        log.info("Skipped existing categories:")
        for category, count in skipped_counts.most_common():
            log.info("  %s: %d", category, count)

    for event_id, old, new in planned[:50]:
        log.info("id=%s %r -> %r", event_id, old, new)
    if len(planned) > 50:
        log.info("... %d more updates omitted from preview", len(planned) - 50)

    if not args.apply:
        log.info("Dry-run complete. Re-run with --apply to execute updates.")
        return

    updated = 0
    for event_id, _old, new in planned:
        sb.table(EVENTS).update({"category": new}).eq("id", event_id).execute()
        updated += 1

    log.info("Applied %d updates.", updated)


if __name__ == "__main__":
    main()
