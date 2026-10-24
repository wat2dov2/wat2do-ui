#!/usr/bin/env python3
"""Generate deterministic school marketing posters from the configured database.

The database is the content source of truth. This script reads schools,
clubs, events, and event occurrences, derives one JSON manifest, then
passes that manifest to the React/Satori renderer in ``frontend/scripts``.

Examples:
    cd backend
    .venv/bin/python scripts/generate_school_posters.py --school columbia
    .venv/bin/python scripts/generate_school_posters.py --all-schools
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from core.database import get_sb  # noqa: E402
from core.pagination import fetch_all_pages  # noqa: E402
from core.tables import CLUBS, EVENT_DATES, EVENTS, SCHOOLS  # noqa: E402
from schemas.school import SchoolRecord  # noqa: E402
from services import school_service  # noqa: E402

DEFAULT_OUTPUT_ROOT = REPOSITORY_ROOT / "assets" / "generated-school-posters"
RENDERER_PATH = (
    REPOSITORY_ROOT / "frontend" / "scripts" / "school-posters" / "render-school-posters.mjs"
)
_EVENT_COLUMNS = (
    "id,title,description,club,club_id,category,food,source_image_url,added_at,cancelled,ig_handle"
)
_CLUB_COLUMNS = "id,club_name,logo_url,ig,status"
_EVENT_ID_CHUNK_SIZE = 500
_BACKGROUND_IMAGE_LIMIT = 48
_GENERIC_FOOD_LABELS = frozenset(
    {
        "food",
        "free food",
        "free snacks",
        "refreshments",
        "snacks",
        "yes",
        "yes!",
    }
)
_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _event_ids_in_term(occurrences: list[dict[str, Any]]) -> set[int]:
    return {int(row["event_id"]) for row in occurrences if row.get("event_id") is not None}


def _normalize_handle(value: object, fallback: str) -> str:
    raw = str(value or "").strip().rstrip("/")
    if "instagram.com/" in raw.lower():
        raw = raw.split("instagram.com/", 1)[-1]
    raw = raw.lstrip("@").split("?", 1)[0]
    if raw:
        return raw
    slug = re.sub(r"[^a-z0-9]+", "", fallback.casefold())
    return slug or "campus-club"


def _normalize_food_label(value: object) -> str | None:
    label = re.sub(r"\s+", " ", str(value or "").strip().casefold())
    label = re.sub(r"^free\s+", "", label)
    label = label.strip(" .,!;:-")
    if not label or label in _GENERIC_FOOD_LABELS:
        return None
    return label


def _food_labels(event: dict[str, Any]) -> set[str]:
    food = event.get("food")
    if not isinstance(food, list):
        return set()
    return {label for item in food if (label := _normalize_food_label(item)) is not None}


def _club_key(event: dict[str, Any]) -> str | None:
    club_id = event.get("club_id")
    if club_id is not None:
        return f"id:{int(club_id)}"
    raw_identity = event.get("ig_handle") or event.get("club")
    handle = _normalize_handle(raw_identity, "")
    return f"handle:{handle}" if handle != "campus-club" else None


def _award(
    *,
    title: str,
    club: dict[str, Any] | None,
    description: str,
) -> dict[str, Any]:
    if club is None:
        return {
            "title": title,
            "club": "Not enough data yet",
            "handle": "",
            "description": description,
            "logo_url": "",
        }
    return {
        "title": title,
        "club": club["club_name"],
        "handle": _normalize_handle(
            club.get("ig"),
            str(club["club_name"]),
        ),
        "description": description,
        "logo_url": str(club.get("logo_url") or ""),
    }


def _rank_club_counts(
    counts: Counter[str], clubs_by_key: dict[str, dict[str, Any]]
) -> list[tuple[str, int]]:
    return sorted(
        ((club_key, count) for club_key, count in counts.items() if count > 0),
        key=lambda item: (
            -item[1],
            str(clubs_by_key.get(item[0], {}).get("club_name") or "").casefold(),
            item[0],
        ),
    )


def _term_name(start: date) -> str:
    if start.month <= 4:
        return "WINTER"
    if start.month <= 8:
        return "SPRING"
    return "FALL"


def resolve_recap_term(school: SchoolRecord, *, as_of: date | None = None) -> SchoolRecord:
    """Return the school record carrying the recap range active at generation time.

    School rows are sometimes advanced to the next semester before the active
    poster season ends. Keep the authoritative school dates when they belong to
    the same four-month academic season as ``as_of``; otherwise derive the
    active Winter (Jan-Apr), Spring (May-Aug), or Fall (Sep-Dec) boundary.
    """
    if school.semester_start is None or school.semester_end is None:
        raise ValueError(f"School {school.slug} has no semester date range")
    generation_date = as_of or date.today()
    active_start_month = ((generation_date.month - 1) // 4) * 4 + 1
    school_start_month = ((school.semester_start.month - 1) // 4) * 4 + 1
    if (
        school.semester_start.year == generation_date.year
        and school_start_month == active_start_month
    ):
        return school

    active_end_month = active_start_month + 3
    active_start = date(generation_date.year, active_start_month, 1)
    active_end = date(
        generation_date.year,
        active_end_month,
        calendar.monthrange(generation_date.year, active_end_month)[1],
    )
    return school.model_copy(update={"semester_start": active_start, "semester_end": active_end})


def _human_duration(hours: float) -> str:
    if hours < 48:
        rounded_hours = max(1, round(hours))
        return f"{rounded_hours} hour{'s' if rounded_hours != 1 else ''}"
    days = max(1, round(hours / 24))
    return f"{days} day{'s' if days != 1 else ''}"


def build_poster_data(
    *,
    school: SchoolRecord,
    clubs: list[dict[str, Any]],
    term_events: list[dict[str, Any]],
    occurrences: list[dict[str, Any]],
    total_event_count: int,
    observed_club_count: int,
    background_images: list[str],
    site_url: str,
) -> dict[str, Any]:
    """Build the canonical renderer payload from already-loaded database rows."""
    if school.semester_start is None or school.semester_end is None:
        raise ValueError(f"School {school.slug} has no semester date range")

    timezone_info = ZoneInfo(school.timezone)
    clubs_by_key = {f"id:{int(row['id'])}": row for row in clubs if row.get("id") is not None}
    events_by_id = {
        int(row["id"]): row
        for row in term_events
        if row.get("id") is not None and not row.get("cancelled", False)
    }

    first_occurrence_by_event: dict[int, datetime] = {}
    daily_counts: Counter[str] = Counter()
    weekday_counts: Counter[int] = Counter()
    for row in occurrences:
        event_id = int(row["event_id"])
        if event_id not in events_by_id:
            continue
        start_utc = _parse_datetime(row.get("dtstart_utc"))
        if start_utc is None:
            continue
        local_start = start_utc.astimezone(timezone_info)
        previous = first_occurrence_by_event.get(event_id)
        if previous is None or local_start < previous:
            first_occurrence_by_event[event_id] = local_start
        local_day = local_start.date().isoformat()
        daily_counts[local_day] += 1
        weekday_counts[local_start.weekday()] += 1

    event_counts: Counter[str] = Counter()
    category_sets: defaultdict[str, set[str]] = defaultdict(set)
    food_event_counts: Counter[str] = Counter()
    food_mentions: Counter[str] = Counter()
    lead_times: list[tuple[float, str, int]] = []
    food_events: list[dict[str, Any]] = []

    for event in sorted(events_by_id.values(), key=lambda row: int(row["id"])):
        club_key = _club_key(event)
        if club_key is None or club_key in clubs_by_key:
            continue
        raw_name = str(event.get("club") or event.get("ig_handle") or "Campus club")
        clubs_by_key[club_key] = {
            "club_name": raw_name.strip().lstrip("@") or "Campus club",
            "ig": event.get("ig_handle") or event.get("club"),
            "logo_url": event.get("source_image_url") or "",
        }

    for event_id, event in events_by_id.items():
        club_key = _club_key(event)
        if club_key is None or club_key not in clubs_by_key:
            continue
        event_counts[club_key] += 1
        category = str(event.get("category") or "").strip()
        if category:
            category_sets[club_key].add(category)

        labels = _food_labels(event)
        if labels:
            food_event_counts[club_key] += 1
            food_mentions.update(labels)
            food_events.append({**event, "food_label_count": len(labels)})

        first_occurrence = first_occurrence_by_event.get(event_id)
        added_at = _parse_datetime(event.get("added_at"))
        if first_occurrence is not None and added_at is not None:
            gap_hours = (
                first_occurrence.astimezone(timezone.utc) - added_at
            ).total_seconds() / 3600
            if gap_hours >= 0:
                lead_times.append((gap_hours, club_key, event_id))

    ranked_clubs = _rank_club_counts(event_counts, clubs_by_key)
    top_clubs = []
    for club_key, count in ranked_clubs[:5]:
        club = clubs_by_key[club_key]
        top_clubs.append(
            {
                "name": club["club_name"],
                "handle": _normalize_handle(club.get("ig"), str(club["club_name"])),
                "logo_url": str(club.get("logo_url") or ""),
                "event_count": count,
            }
        )

    ranked_food = _rank_club_counts(food_event_counts, clubs_by_key)
    ranked_categories = sorted(
        (
            (club_key, len(categories))
            for club_key, categories in category_sets.items()
            if categories
        ),
        key=lambda item: (
            -item[1],
            str(clubs_by_key[item[0]]["club_name"]).casefold(),
            item[0],
        ),
    )
    lead_times.sort(key=lambda item: (item[0], item[1], item[2]))

    procrastinator = lead_times[0] if lead_times else None
    early_planner = min(lead_times, key=lambda item: (-item[0], item[1], item[2]), default=None)
    food_winner = ranked_food[0] if ranked_food else None
    category_winner = ranked_categories[0] if ranked_categories else None

    busiest_day = max(
        daily_counts.items(),
        key=lambda item: (item[1], item[0]),
        default=(school.semester_start.isoformat(), 0),
    )
    busiest_date = date.fromisoformat(busiest_day[0])
    busiest_weekday = max(range(7), key=lambda index: (weekday_counts[index], -index))
    quietest_weekday = min(range(7), key=lambda index: (weekday_counts[index], index))

    heatmap = []
    current_day = school.semester_start
    while current_day <= school.semester_end:
        heatmap.append(
            {
                "date": current_day.isoformat(),
                "count": daily_counts[current_day.isoformat()],
            }
        )
        current_day += timedelta(days=1)

    food_examples = sorted(
        (event for event in food_events if event.get("source_image_url")),
        key=lambda event: (
            -int(event["food_label_count"]),
            first_occurrence_by_event.get(
                int(event["id"]), datetime.max.replace(tzinfo=timezone_info)
            ),
            int(event["id"]),
        ),
    )[:2]

    term_label = f"{_term_name(school.semester_start)} '{str(school.semester_start.year)[-2:]}"
    top_food_mentions = [
        {"label": label, "count": count}
        for label, count in sorted(food_mentions.items(), key=lambda item: (-item[1], item[0]))[:3]
    ]

    return {
        "schema_version": 1,
        "school": {
            "slug": school.slug,
            "name": school.name,
            "primary_color": school.primary_color,
            "secondary_color": school.secondary_color,
            "timezone": school.timezone,
            "site_url": site_url,
        },
        "term": {
            "label": term_label,
            "start": school.semester_start.isoformat(),
            "end": school.semester_end.isoformat(),
        },
        "claims": {
            "observed_club_count": observed_club_count,
            "all_time_event_count": total_event_count,
        },
        "background_images": background_images,
        "recap": {
            "event_count": len(events_by_id),
            "top_clubs": top_clubs,
            "food_linked_event_count": len(food_events),
            "food_mentions": top_food_mentions,
            "food_examples": [
                {
                    "title": str(event.get("title") or "Campus event"),
                    "image_url": str(event["source_image_url"]),
                }
                for event in food_examples
            ],
            "busiest_date": {
                "date": busiest_date.isoformat(),
                "label": busiest_date.strftime("%B %-d"),
                "count": busiest_day[1],
            },
            "busiest_weekday": _WEEKDAY_NAMES[busiest_weekday],
            "quietest_weekday": _WEEKDAY_NAMES[quietest_weekday],
            "heatmap": heatmap,
            "awards": [
                _award(
                    title="Procrastinator Award",
                    club=(clubs_by_key[procrastinator[1]] if procrastinator else None),
                    description=(
                        f"Announced with {_human_duration(procrastinator[0])} to spare."
                        if procrastinator
                        else "No qualifying announcement gap yet."
                    ),
                ),
                _award(
                    title="Feed the Campus Award",
                    club=(clubs_by_key[food_winner[0]] if food_winner else None),
                    description=(
                        f"Hosted the most food-linked events ({food_winner[1]})."
                        if food_winner
                        else "No structured food-linked events yet."
                    ),
                ),
                _award(
                    title="Swiss Army Club",
                    club=(clubs_by_key[category_winner[0]] if category_winner else None),
                    description=(
                        f"Showed up across {category_winner[1]} event categories."
                        if category_winner
                        else "No categorized events yet."
                    ),
                ),
                _award(
                    title="Early Planners Award",
                    club=(clubs_by_key[early_planner[1]] if early_planner else None),
                    description=(
                        f"Longest post-to-event gap: {_human_duration(early_planner[0])}."
                        if early_planner
                        else "No qualifying announcement gap yet."
                    ),
                ),
            ],
        },
    }


def _load_clubs(school_id: int) -> list[dict[str, Any]]:
    return fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(CLUBS)
            .select(_CLUB_COLUMNS)
            .eq("school_id", school_id)
            .eq("status", "approved")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )


def _load_term_occurrences(school: SchoolRecord) -> list[dict[str, Any]]:
    if school.semester_start is None or school.semester_end is None:
        raise ValueError(f"School {school.slug} has no semester date range")
    timezone_info = ZoneInfo(school.timezone)
    range_start = datetime.combine(school.semester_start, time.min, timezone_info).astimezone(
        timezone.utc
    )
    range_end = datetime.combine(
        school.semester_end + timedelta(days=1), time.min, timezone_info
    ).astimezone(timezone.utc)
    return fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(EVENT_DATES)
            .select("id,event_id,dtstart_utc")
            .gte("dtstart_utc", range_start.isoformat())
            .lt("dtstart_utc", range_end.isoformat())
            .order("dtstart_utc")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )


def _load_term_events(school_id: int, event_ids: set[int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    ordered_ids = sorted(event_ids)
    for start in range(0, len(ordered_ids), _EVENT_ID_CHUNK_SIZE):
        chunk = ordered_ids[start : start + _EVENT_ID_CHUNK_SIZE]
        response = (
            get_sb()
            .table(EVENTS)
            .select(_EVENT_COLUMNS)
            .eq("school_id", school_id)
            .eq("cancelled", False)
            .in_("id", chunk)
            .order("id")
            .execute()
        )
        rows.extend(response.data or [])
    return rows


def _load_total_event_count(school_id: int) -> int:
    response = (
        get_sb()
        .table(EVENTS)
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("cancelled", False)
        .limit(0)
        .execute()
    )
    return int(response.count or 0)


def _load_observed_club_count(school_id: int, clubs: list[dict[str, Any]]) -> int:
    identities = {f"id:{int(club['id'])}" for club in clubs if club.get("id") is not None}
    event_rows = fetch_all_pages(
        lambda offset, page_size: (
            get_sb()
            .table(EVENTS)
            .select("id,club,club_id,ig_handle")
            .eq("school_id", school_id)
            .eq("cancelled", False)
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
    )
    identities.update(
        identity for event in event_rows if (identity := _club_key(event)) is not None
    )
    return len(identities)


def _load_background_images(school_id: int) -> list[str]:
    response = (
        get_sb()
        .table(EVENTS)
        .select("id,source_image_url,added_at")
        .eq("school_id", school_id)
        .eq("cancelled", False)
        .not_.is_("source_image_url", "null")
        .order("added_at", desc=True)
        .order("id", desc=True)
        .range(0, _BACKGROUND_IMAGE_LIMIT - 1)
        .execute()
    )
    return [
        str(row["source_image_url"]) for row in (response.data or []) if row.get("source_image_url")
    ]


def load_school_poster_data(school_slug: str) -> dict[str, Any]:
    school = school_service.get_school(school_slug)
    if school is None:
        raise ValueError(f"Unknown school: {school_slug}")
    recap_school = resolve_recap_term(school)
    clubs = _load_clubs(school.id)
    occurrences = _load_term_occurrences(recap_school)
    term_events = _load_term_events(school.id, _event_ids_in_term(occurrences))
    return build_poster_data(
        school=recap_school,
        clubs=clubs,
        term_events=term_events,
        occurrences=occurrences,
        total_event_count=_load_total_event_count(school.id),
        observed_club_count=_load_observed_club_count(school.id, clubs),
        background_images=_load_background_images(school.id),
        site_url=f"https://{school.slug}.wat2do.io",
    )


def _school_slugs() -> list[str]:
    response = get_sb().table(SCHOOLS).select("slug").order("slug").execute()
    return [str(row["slug"]) for row in (response.data or []) if row.get("slug")]


def generate_school_posters(school_slug: str, output_root: Path) -> Path:
    payload = load_school_poster_data(school_slug)
    term = payload["term"]
    output_directory = output_root / school_slug / f"{term['start']}-to-{term['end']}"
    output_directory.mkdir(parents=True, exist_ok=True)
    manifest_path = output_directory / "poster-data.json"
    manifest_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    subprocess.run(
        [
            "node",
            str(RENDERER_PATH),
            "--input",
            str(manifest_path),
            "--output-dir",
            str(output_directory),
        ],
        cwd=REPOSITORY_ROOT / "frontend",
        check=True,
    )
    return output_directory


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--school", help="School slug, for example columbia")
    target.add_argument(
        "--all-schools", action="store_true", help="Generate posters for every school"
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help=f"Generated asset root (default: {DEFAULT_OUTPUT_ROOT})",
    )
    args = parser.parse_args()

    school_slugs = _school_slugs() if args.all_schools else [args.school]
    for school_slug in school_slugs:
        output_directory = generate_school_posters(school_slug, args.output_root.resolve())
        print(f"Generated {school_slug}: {output_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
