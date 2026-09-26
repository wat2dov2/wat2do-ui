#!/usr/bin/env python3
"""Reconcile Instagram following exports into production clubs.

The first run creates an immutable JSON plan. The same plan is then reviewed
and passed back with ``--apply``. This freezes which rows existed before the
import, so a retry cannot accidentally reclassify a newly inserted independent
club as student-union affiliated.

Usage (from backend/):
  uv run python scripts/import_instagram_following_clubs.py \
    --archive utsg=/path/to/export.zip \
    --classification /tmp/utsg.jsonl \
    --plan /tmp/instagram-clubs.json

  uv run python scripts/import_instagram_following_clubs.py \
    --plan /tmp/instagram-clubs.json --apply --school utsg
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import zipfile
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.constants.clubs import CLUB_CATEGORIES  # noqa: E402
from core.database import get_sb  # noqa: E402
from core.tables import CLUBS, SCHOOLS  # noqa: E402
from scripts.import_master_clubs_xlsx import _read_xlsx_rows  # noqa: E402
from services.event_feed_revalidation import (  # noqa: E402
    event_feed_revalidation_service,
)

log = logging.getLogger(__name__)

FOLLOWING_HTML = "connections/followers_and_following/following.html"
CLUB_NAME_MAX = 500
UNION_TYPES = {
    "utsg": "utsu",
    "utsc": "scsu",
    "usask": "ussu",
    "queensu": "ams",
    "ubc": "ams",
    "guelph": "csa",
    "uwo": "usc",
    "ocadu": "ocadsu",
    "tmu": "tmsu",
}


def normalize_handle(value: object) -> str:
    return str(value or "").strip().lstrip("@").casefold()


def normalize_name(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


class _FollowingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_heading = False
        self.handles: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "h2":
            self._in_heading = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "h2":
            self._in_heading = False

    def handle_data(self, data: str) -> None:
        if self._in_heading and (handle := normalize_handle(data)):
            self.handles.add(handle)


def read_following_handles(path: Path) -> set[str]:
    with zipfile.ZipFile(path) as archive:
        parser = _FollowingParser()
        parser.feed(archive.read(FOLLOWING_HTML).decode("utf-8"))
    return parser.handles


def parse_archive_args(values: list[str]) -> dict[str, Path]:
    archives: dict[str, Path] = {}
    for value in values:
        school, separator, raw_path = value.partition("=")
        if not separator or school not in UNION_TYPES or not raw_path:
            raise ValueError(f"Invalid --archive {value!r}; expected supported-school=/path.zip")
        if school in archives:
            raise ValueError(f"Duplicate --archive school: {school}")
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file():
            raise ValueError(f"Archive does not exist: {path}")
        archives[school] = path
    return archives


def read_classifications(paths: list[Path]) -> dict[tuple[str, str], dict[str, Any]]:
    classifications: dict[tuple[str, str], dict[str, Any]] = {}
    for path in paths:
        for line_number, line in enumerate(path.read_text().splitlines(), start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            key = (str(row.get("school", "")), normalize_handle(row.get("handle")))
            if key in classifications:
                raise ValueError(f"Duplicate classification {key} in {path}:{line_number}")
            categories = row.get("categories") or []
            if any(category not in CLUB_CATEGORIES for category in categories):
                raise ValueError(f"Invalid categories for {key} in {path}:{line_number}")
            classifications[key] = row
    return classifications


def _fetch_schools(sb: Any) -> dict[str, int]:
    result = sb.table(SCHOOLS).select("id,slug").in_("slug", list(UNION_TYPES)).execute()
    return {row["slug"]: int(row["id"]) for row in result.data or []}


def _fetch_clubs(sb: Any, school_ids: dict[str, int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    page_size = 1000
    while True:
        result = (
            sb.table(CLUBS)
            .select("id,club_name,school_id,categories,ig,club_type,status")
            .in_("school_id", list(school_ids.values()))
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        offset += page_size


def _workbook_index() -> dict[tuple[str, str], list[dict[str, Any]]]:
    rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in _read_xlsx_rows():
        school = str(row.get("school_slug") or "")
        handle = normalize_handle(row.get("ig_handle"))
        if school in UNION_TYPES and handle:
            rows[(school, handle)].append(row)
    return rows


def _new_candidate(
    school: str,
    handle: str,
    workbook: dict[tuple[str, str], list[dict[str, Any]]],
    classifications: dict[tuple[str, str], dict[str, Any]],
) -> tuple[dict[str, Any] | None, str | None]:
    workbook_matches = workbook.get((school, handle), [])
    if len(workbook_matches) == 1:
        row = workbook_matches[0]
        return {
            "club_name": str(row["name"])[:CLUB_NAME_MAX],
            "categories": row.get("categories") or [],
            "ig": handle,
            "club_page": row.get("directory"),
            "discord": row.get("discord"),
        }, None
    if len(workbook_matches) > 1:
        return None, "ambiguous_workbook_handle"

    classification = classifications.get((school, handle))
    if classification is None:
        return None, "missing_classification"
    if classification.get("action") != "insert":
        return None, "classification_review"
    if classification.get("confidence") != "high":
        return None, "classification_not_high_confidence"
    name = " ".join(str(classification.get("club_name") or "").split())
    if not name:
        return None, "classification_missing_name"
    return {
        "club_name": name[:CLUB_NAME_MAX],
        "categories": classification.get("categories") or [],
        "ig": handle,
        "club_page": None,
        "discord": None,
    }, None


def reconcile_planned_inserts(
    inserts: list[dict[str, Any]], reviews: list[dict[str, str]]
) -> list[dict[str, Any]]:
    """Hold insert candidates whose name or handle is not uniquely owned."""
    by_school_name: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_handle: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in inserts:
        by_school_name[(row["school"], normalize_name(row["club_name"]))].append(row)
        by_handle[normalize_handle(row["ig"])].append(row)

    duplicate_keys = {
        (row["school"], row["ig"])
        for rows in by_school_name.values()
        if len(rows) > 1
        for row in rows
    }
    cross_school_keys = {
        (row["school"], row["ig"])
        for rows in by_handle.values()
        if len({row["school"] for row in rows}) > 1
        for row in rows
    }
    kept: list[dict[str, Any]] = []
    for row in inserts:
        key = (row["school"], row["ig"])
        if key in duplicate_keys:
            reviews.append(
                {"school": row["school"], "handle": row["ig"], "reason": "duplicate_planned_name"}
            )
        elif key in cross_school_keys:
            reviews.append(
                {
                    "school": row["school"],
                    "handle": row["ig"],
                    "reason": "planned_handle_multiple_schools",
                }
            )
        else:
            kept.append(row)
    return kept


def build_plan(
    sb: Any,
    archives: dict[str, Path],
    classifications: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    school_ids = _fetch_schools(sb)
    missing_schools = sorted(set(archives) - set(school_ids))
    if missing_schools:
        raise ValueError(f"Schools missing from database: {', '.join(missing_schools)}")

    existing = _fetch_clubs(sb, {s: school_ids[s] for s in archives})
    slug_by_id = {school_id: slug for slug, school_id in school_ids.items()}
    by_handle: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_name: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    handles_across_schools: dict[str, set[str]] = defaultdict(set)
    for row in existing:
        school = slug_by_id[int(row["school_id"])]
        if handle := normalize_handle(row.get("ig")):
            by_handle[(school, handle)].append(row)
            handles_across_schools[handle].add(school)
        by_name[(school, normalize_name(row["club_name"]))].append(row)

    updates = [
        {
            "id": int(row["id"]),
            "school": slug_by_id[int(row["school_id"])],
            "club_type": UNION_TYPES[slug_by_id[int(row["school_id"])]],
        }
        for row in existing
        if row.get("club_type") != UNION_TYPES[slug_by_id[int(row["school_id"])]]
    ]
    inserts: list[dict[str, Any]] = []
    reviews: list[dict[str, str]] = []
    workbook = _workbook_index()

    for school, archive_path in sorted(archives.items()):
        for handle in sorted(read_following_handles(archive_path)):
            handle_matches = by_handle.get((school, handle), [])
            if handle_matches:
                if len(handle_matches) > 1:
                    reviews.append(
                        {"school": school, "handle": handle, "reason": "duplicate_database_handle"}
                    )
                continue

            candidate, reason = _new_candidate(school, handle, workbook, classifications)
            if candidate is None:
                reviews.append({"school": school, "handle": handle, "reason": str(reason)})
                continue

            name_matches = by_name.get((school, normalize_name(candidate["club_name"])), [])
            if len(name_matches) == 1:
                existing_row = name_matches[0]
                existing_handle = normalize_handle(existing_row.get("ig"))
                if existing_handle and existing_handle != handle:
                    reviews.append(
                        {
                            "school": school,
                            "handle": handle,
                            "reason": "database_name_handle_conflict",
                        }
                    )
                    continue
                update = next(
                    (item for item in updates if item["id"] == int(existing_row["id"])),
                    None,
                )
                if update is None:
                    update = {
                        "id": int(existing_row["id"]),
                        "school": school,
                        "club_type": UNION_TYPES[school],
                    }
                    updates.append(update)
                update["ig"] = handle
                if not existing_row.get("categories") and candidate["categories"]:
                    update["categories"] = candidate["categories"]
                continue
            if len(name_matches) > 1:
                reviews.append(
                    {"school": school, "handle": handle, "reason": "duplicate_database_name"}
                )
                continue
            other_schools = handles_across_schools.get(handle, set()) - {school}
            if other_schools:
                reviews.append(
                    {"school": school, "handle": handle, "reason": "handle_exists_other_school"}
                )
                continue
            inserts.append(
                {
                    **candidate,
                    "school": school,
                    "school_id": school_ids[school],
                    "club_type": "independent",
                    "status": "approved",
                }
            )

    inserts = reconcile_planned_inserts(inserts, reviews)
    return {
        "version": 1,
        "schools": sorted(archives),
        "updates": sorted(updates, key=lambda row: (row["school"], row["id"])),
        "inserts": sorted(inserts, key=lambda row: (row["school"], row["ig"])),
        "reviews": reviews,
    }


def write_plan(path: Path, plan: dict[str, Any]) -> None:
    path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n")


def plan_counts(plan: dict[str, Any]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for action in ("updates", "inserts", "reviews"):
        for row in plan[action]:
            counts[row["school"]][action] += 1
    return {school: dict(values) for school, values in sorted(counts.items())}


def apply_plan(sb: Any, plan: dict[str, Any], school: str | None = None) -> set[str]:
    changed_schools: set[str] = set()
    updates = [row for row in plan["updates"] if school is None or row["school"] == school]
    inserts = [row for row in plan["inserts"] if school is None or row["school"] == school]

    selected_schools = sorted({row["school"] for row in updates + inserts})
    if selected_schools:
        school_ids = _fetch_schools(sb)
        current_rows = _fetch_clubs(
            sb,
            {slug: school_ids[slug] for slug in selected_schools},
        )
        slug_by_id = {school_id: slug for slug, school_id in school_ids.items()}
        current_handles = {
            (slug_by_id[int(row["school_id"])], normalize_handle(row.get("ig")))
            for row in current_rows
            if normalize_handle(row.get("ig"))
        }
        inserts = [row for row in inserts if (row["school"], row["ig"]) not in current_handles]

    simple_updates: dict[tuple[str, str], list[int]] = defaultdict(list)
    detailed_updates: list[dict[str, Any]] = []
    for row in updates:
        if set(row) == {"id", "school", "club_type"}:
            simple_updates[(row["school"], row["club_type"])].append(row["id"])
        else:
            detailed_updates.append(row)

    for (update_school, club_type), ids in simple_updates.items():
        for start in range(0, len(ids), 200):
            sb.table(CLUBS).update({"club_type": club_type}).in_(
                "id", ids[start : start + 200]
            ).execute()
        changed_schools.add(update_school)

    for row in detailed_updates:
        update_payload = {key: value for key, value in row.items() if key not in {"id", "school"}}
        sb.table(CLUBS).update(update_payload).eq("id", row["id"]).execute()
        changed_schools.add(row["school"])

    for start in range(0, len(inserts), 200):
        chunk = inserts[start : start + 200]
        insert_payload = [
            {key: value for key, value in row.items() if key != "school"} for row in chunk
        ]
        sb.table(CLUBS).insert(insert_payload).execute()
        changed_schools.update(row["school"] for row in chunk)

    for changed_school in sorted(changed_schools):
        event_feed_revalidation_service.revalidate_school(
            changed_school,
            resources=("events", "positions", "clubs"),
        )
    return changed_schools


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", action="append", default=[], help="school=/path/export.zip")
    parser.add_argument("--classification", action="append", default=[], type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--school", choices=sorted(UNION_TYPES))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    try:
        if args.apply:
            if args.archive or args.classification:
                raise ValueError("--apply accepts only --plan and optional --school")
            plan = json.loads(args.plan.read_text())
            changed = apply_plan(get_sb(), plan, args.school)
            log.info("Applied plan for: %s", ", ".join(sorted(changed)) or "no schools")
            return 0

        if args.plan.exists():
            raise ValueError(f"Refusing to overwrite existing plan: {args.plan}")
        archives = parse_archive_args(args.archive)
        if not archives:
            raise ValueError("At least one --archive is required when creating a plan")
        classifications = read_classifications(args.classification)
        plan = build_plan(get_sb(), archives, classifications)
        write_plan(args.plan, plan)
        log.info("Plan written to %s", args.plan)
        for school, counts in plan_counts(plan).items():
            log.info("%s: %s", school, counts)
        return 0
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        log.error("%s", exc)
        return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    raise SystemExit(main())
