#!/usr/bin/env python3
"""Bulk-import clubs from wat2do-clubs.xlsx into the
Supabase ``clubs`` table.

Every row with a name and a registered school slug is imported.  The sheet's
``IG Source`` column records how a handle was discovered and gates overwrites in
the SPA merge pipeline; it does not affect what lands in the database.

Usage (from backend/):
  python scripts/import_master_clubs_xlsx.py            # dry-run, prints diff
  python scripts/import_master_clubs_xlsx.py --apply    # write to Supabase

Idempotent: keyed on ``(school, club_name)``.  Re-running with ``--apply``
inserts new rows, updates rows whose xlsx values changed, and leaves
unchanged rows alone.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections import Counter
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.constants.clubs import (
    CLUB_CATEGORIES,
    CLUB_CATEGORY_IMPORT_ALIASES,
)
from core.database import get_sb
from core.tables import CLUBS
from services.event_feed_revalidation import event_feed_revalidation_service

log = logging.getLogger(__name__)

XLSX_PATH = Path(__file__).resolve().parent.parent / "services" / "scraper" / "wat2do-clubs.xlsx"

# The xlsx School column holds canonical schools.slug values directly
# (e.g. "wlu", "utsc", "utsg"); rows whose slug is not registered in the
# hosted schools table are skipped with a warning so the sheet can contain
# schools that have not launched yet.

# The sheet's Club Type column holds the student-association slug that
# owns the club (e.g. "msu" for McMaster).  A blank cell means "no opinion": the
# insert omits the field so the database default (`independent`) applies, and the
# update leaves whatever an admin already chose.  Only a non-blank cell writes.
CLUB_TYPE_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

CLUB_NAME_MAX = 500


def _normalize_handle(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.startswith("@"):
        text = text[1:]
    return text or None


def _normalize_categories(raw: object) -> list[str]:
    """Parse a Category cell into canonical club category names."""
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []

    matched = []
    remaining = text
    source_categories = (*CLUB_CATEGORY_IMPORT_ALIASES.keys(), *CLUB_CATEGORIES)
    for category in source_categories:
        if category in text:
            canonical = CLUB_CATEGORY_IMPORT_ALIASES.get(category, category)
            if canonical not in matched:
                matched.append(canonical)
            remaining = remaining.replace(category, "")

    leftovers = [p.strip() for p in remaining.split(",") if p.strip()]
    return matched + leftovers


def _normalize_club_type(value: object) -> str | None:
    """Lowercase the Club Type cell.  Blank means None; validation is later."""
    if value is None:
        return None
    return str(value).strip().lower() or None


def _normalize_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _read_xlsx_rows() -> list[dict]:
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=2, max_row=2))]
    expected = [
        "School",
        "Name",
        "Category",
        "Campus",
        "Directory URL",
        "Instagram URL",
        "Instagram Handle",
        "IG Source",
        "Discord URL",
        "Discord Source",
        "Club Type",
    ]
    if header != expected:
        raise RuntimeError(f"Unexpected xlsx header.  Expected {expected!r}, got {header!r}")

    rows: list[dict] = []
    for raw_row in ws.iter_rows(min_row=3, values_only=True):
        if not raw_row or not any(raw_row):
            continue
        rows.append(
            {
                "school_slug": _normalize_str(raw_row[0]),
                "name": _normalize_str(raw_row[1]),
                "categories": _normalize_categories(raw_row[2]),
                "directory": _normalize_str(raw_row[4]),
                "ig_handle": _normalize_handle(raw_row[6]),
                "discord": _normalize_str(raw_row[8]) if len(raw_row) > 8 else None,
                "club_type": _normalize_club_type(raw_row[10] if len(raw_row) > 10 else None),
            }
        )
    wb.close()
    return rows


def _validate_rows(
    rows: list[dict], db_schools: dict[str, int]
) -> tuple[list[dict], dict[str, int]]:
    """Filter, validate, and canonicalize rows.  Returns (kept, skipped)."""
    kept: list[dict] = []
    skipped: Counter[str] = Counter()
    unknown_schools: set[str] = set()
    bad_categories: set[str] = set()
    bad_club_types: set[str] = set()
    seen: dict[tuple[str, str], int] = {}

    for idx, row in enumerate(rows, start=3):
        if not row["name"]:
            skipped["blank_name"] += 1
            continue
        if not row["school_slug"]:
            skipped["blank_school"] += 1
            continue
        canonical_school = row["school_slug"]
        if canonical_school not in db_schools:
            unknown_schools.add(canonical_school)
            skipped[f"unknown_school={canonical_school}"] += 1
            continue

        valid_categories = []
        for category in row["categories"]:
            if category in CLUB_CATEGORIES:
                valid_categories.append(category)
            else:
                bad_categories.add(category)

        club_type = row["club_type"]
        if club_type and not CLUB_TYPE_PATTERN.match(club_type):
            bad_club_types.add(club_type)
            club_type = None

        club_name = row["name"][:CLUB_NAME_MAX]
        if len(row["name"]) > CLUB_NAME_MAX:
            log.warning("Row %s: club_name truncated to %s chars", idx, CLUB_NAME_MAX)

        key = (canonical_school, club_name)
        if key in seen:
            skipped["duplicate_school_name"] += 1
            continue
        seen[key] = idx

        kept.append(
            {
                "club_name": club_name,
                "school": canonical_school,
                "school_id": db_schools[canonical_school],
                "categories": valid_categories,
                "club_page": row["directory"],
                "ig": row["ig_handle"],
                "discord": row["discord"],
                "club_type": club_type,
            }
        )

    if unknown_schools:
        log.warning(
            "xlsx School slugs not registered in the Supabase 'schools' table skipped: "
            + ", ".join(sorted(unknown_schools))
        )
    if bad_categories:
        log.warning(
            "xlsx Category values not in CLUB_CATEGORIES skipped: "
            + ", ".join(sorted(bad_categories))
        )
    if bad_club_types:
        log.warning(
            "xlsx Club Type values rejected (must be lowercase kebab-case): "
            + ", ".join(sorted(bad_club_types))
        )

    return kept, dict(skipped)


def _fetch_existing(sb, schools: dict[str, int]) -> dict[tuple[str, str], dict]:
    """Return all clubs whose school is in *schools*, keyed on (school, club_name)."""
    if not schools:
        return {}
    existing: dict[tuple[str, str], dict] = {}
    # Explicit limit + range: PostgREST defaults to a 1000-row cap.
    page_size = 1000
    offset = 0
    while True:
        res = (
            sb.table(CLUBS)
            .select(
                "id, club_name, school_id, school_record:schools(slug), "
                "categories, club_page, ig, discord, club_type"
            )
            .in_("school_id", list(schools.values()))
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = res.data or []
        for row in batch:
            school = (row.pop("school_record", None) or {}).get("slug")
            if school:
                existing[(school, row["club_name"])] = row
        if len(batch) < page_size:
            break
        offset += page_size
    return existing


def _diff(planned: dict, existing: dict) -> dict | None:
    """Return a dict of {field: (old, new)} for fields that differ, or None."""
    fields = ("categories", "club_page", "ig", "discord", "club_type")
    diff: dict[str, tuple] = {}
    for field in fields:
        old = existing.get(field)
        new = planned[field]
        if field == "club_type" and new is None:
            # A blank cell is "no opinion", so never clear an admin's choice.
            continue
        if field == "categories":
            old_set = set(old or [])
            new_set = set(new or [])
            if old_set != new_set:
                diff[field] = (sorted(old_set), sorted(new_set))
        else:
            if (old or None) != (new or None):
                diff[field] = (old, new)
    return diff or None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write inserts and updates to Supabase.  Without this flag, prints the diff and exits.",
    )
    parser.add_argument(
        "--school",
        help="Only import rows for this school slug (e.g. mcmaster).  Default: every school.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Only import the first N rows that would change.  Use to rehearse on one club.",
    )
    args = parser.parse_args()

    sb = get_sb()
    try:
        from core.tables import SCHOOLS

        res_schools = sb.table(SCHOOLS).select("id,slug").execute()
        db_schools = {row["slug"]: int(row["id"]) for row in res_schools.data or []}
    except Exception as e:
        log.error("Failed to fetch canonical schools from Supabase: %s", e)
        return 2

    rows = _read_xlsx_rows()
    log.info("xlsx rows scanned: %s", len(rows))

    if args.school:
        if args.school not in db_schools:
            log.error("--school %r is not a slug in the Supabase 'schools' table.", args.school)
            return 2
        rows = [row for row in rows if row["school_slug"] == args.school]
        log.info("xlsx rows for school %r: %s", args.school, len(rows))

    kept, skipped = _validate_rows(rows, db_schools)
    log.info("xlsx rows kept: %s", len(kept))
    for reason, count in sorted(skipped.items(), key=lambda x: -x[1]):
        log.info("  skipped (%s): %s", reason, count)

    schools_in_play = {row["school"]: row["school_id"] for row in kept}
    existing = _fetch_existing(sb, schools_in_play)
    log.info("existing rows in Supabase for those schools: %s", len(existing))

    to_insert: list[dict] = []
    to_update: list[tuple[int, dict, dict]] = []  # (id, planned, diff)
    unchanged = 0

    for row in kept:
        key = (row["school"], row["club_name"])
        if key in existing:
            diff = _diff(row, existing[key])
            if diff:
                to_update.append((existing[key]["id"], row, diff))
            else:
                unchanged += 1
        else:
            to_insert.append(row)

    if args.limit is not None:
        to_insert = to_insert[: args.limit]
        to_update = to_update[: max(0, args.limit - len(to_insert))]
        log.info(
            "--limit %s: capped to %s insert(s) and %s update(s)",
            args.limit,
            len(to_insert),
            len(to_update),
        )

    log.info("to insert: %s", len(to_insert))
    log.info("to update: %s", len(to_update))
    log.info("unchanged: %s", unchanged)

    by_school: Counter[str] = Counter()
    for row in to_insert:
        by_school[row["school"]] += 1
    if by_school:
        log.info("inserts by school:")
        for school, count in by_school.most_common():
            log.info("  %s: %s", school, count)

    if not args.apply:
        log.info("Dry run only.  Pass --apply to write.")
        for cid, planned, diff in to_update[:5]:
            log.info(
                "update example id=%s school=%r name=%r diff=%s",
                cid,
                planned["school"],
                planned["club_name"],
                diff,
            )
        return 0

    # Insert in batches; update one row at a time (Supabase doesn't batch
    # updates with different field values cleanly).
    inserted = 0
    if to_insert:
        batch_size = 200
        payload = [
            {
                "club_name": row["club_name"],
                "school_id": row["school_id"],
                "categories": row["categories"],
                "club_page": row["club_page"],
                "ig": row["ig"],
                # Omitted when blank so the database default (`independent`) applies.
                **({"club_type": row["club_type"]} if row["club_type"] else {}),
            }
            for row in to_insert
        ]
        for start in range(0, len(payload), batch_size):
            chunk = payload[start : start + batch_size]
            sb.table(CLUBS).insert(chunk).execute()
            for school in sorted({row["school"] for row in to_insert[start : start + batch_size]}):
                event_feed_revalidation_service.revalidate_school(school, resources=("clubs",))
            inserted += len(chunk)
            log.info("  inserted %s/%s", inserted, len(payload))

    updated = 0
    for cid, planned, _ in to_update:
        sb.table(CLUBS).update(
            {
                "categories": planned["categories"],
                "club_page": planned["club_page"],
                "ig": planned["ig"],
                "discord": planned["discord"],
                # Omitted when blank so an admin's existing choice survives re-import.
                **({"club_type": planned["club_type"]} if planned["club_type"] else {}),
            }
        ).eq("id", cid).execute()
        event_feed_revalidation_service.revalidate_school(
            planned["school"],
            resources=("events", "positions", "clubs"),
        )
        updated += 1
        if updated % 100 == 0:
            log.info("  updated %s/%s", updated, len(to_update))

    log.info("done.  inserted=%s updated=%s unchanged=%s", inserted, updated, unchanged)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
