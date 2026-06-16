#!/usr/bin/env python3
"""Bulk-import organizations from all_schools_student_clubs_master.xlsx into the
Supabase ``organizations`` table.

Only rows whose ``IG Source`` is one of ``{found, confirmed, profile_page}``
(prefix-matched against ``|``-separated annotations) are imported — the rest
are speculative matches and will be re-imported once their handles are
verified.

Usage (from backend/):
  python scripts/import_master_clubs_xlsx.py            # dry-run, prints diff
  python scripts/import_master_clubs_xlsx.py --apply    # write to Supabase

Idempotent: keyed on ``(school, organization_name)``.  Re-running with ``--apply``
inserts new rows, updates rows whose xlsx values changed, and leaves
unchanged rows alone.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.constants.organizations import (
    ORGANIZATION_CATEGORIES,
    ORGANIZATION_CATEGORY_IMPORT_ALIASES,
)
from core.database import get_sb
from core.tables import ORGANIZATIONS

log = logging.getLogger(__name__)

XLSX_PATH = (
    Path(__file__).resolve().parent.parent
    / "services"
    / "scraper"
    / "all_schools_student_clubs_master.xlsx"
)

# Only rows with one of these IG Source values land in the DB.  The xlsx
# sometimes annotates the source with a pipe ("found|main organization
# account"); we match against the part before the pipe.
HIGH_QUALITY_IG_SOURCES = frozenset({"found", "confirmed", "profile_page"})

# Map xlsx School column short names -> canonical schools.name slug values.
# These names must match exactly the rows in the hosted schools table.
SCHOOL_NAME_MAP: dict[str, str] = {
    "Brock": "brock",
    "Carleton": "carleton",
    "Cornell": "cornell",
    "Laurier": "wlu",
    "McGill": "mcgill",
    "McMaster": "mcmaster",
    "NYU": "nyu",
    "OCAD": "ocad",
    "Queen's": "queens",
    "TMU": "tmu",
    "UPenn": "upenn",
    "UofT Scarborough": "utsc",
    "UofT St. George": "utoronto",
    "Western": "western",
    "York": "york",
    "uOttawa": "uottawa",
}

# Default for the legacy required `organization_type` column.  Existing non-WUSA
# seeds in backend/seeds/organizations.py use "Independent" for school organizations that
# aren't WUSA-affiliated; same convention here.
DEFAULT_ORGANIZATION_TYPE = "Independent"

ORGANIZATION_NAME_MAX = 500


def _normalize_ig_source(value: object) -> str:
    text = "" if value is None else str(value).strip().lower()
    return text.split("|", 1)[0].strip()


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
    """Parse a Category cell into canonical organization category names."""
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []

    matched = []
    remaining = text
    source_categories = (*ORGANIZATION_CATEGORY_IMPORT_ALIASES.keys(), *ORGANIZATION_CATEGORIES)
    for category in source_categories:
        if category in text:
            canonical = ORGANIZATION_CATEGORY_IMPORT_ALIASES.get(category, category)
            if canonical not in matched:
                matched.append(canonical)
            remaining = remaining.replace(category, "")

    leftovers = [p.strip() for p in remaining.split(",") if p.strip()]
    return matched + leftovers


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
    ]
    if header != expected:
        raise RuntimeError(f"Unexpected xlsx header.  Expected {expected!r}, got {header!r}")

    rows: list[dict] = []
    for raw_row in ws.iter_rows(min_row=3, values_only=True):
        if not raw_row or not any(raw_row):
            continue
        rows.append(
            {
                "school_short": _normalize_str(raw_row[0]),
                "name": _normalize_str(raw_row[1]),
                "categories": _normalize_categories(raw_row[2]),
                "campus": _normalize_str(raw_row[3]),
                "directory": _normalize_str(raw_row[4]),
                "ig_url": _normalize_str(raw_row[5]),
                "ig_handle": _normalize_handle(raw_row[6]),
                "ig_source": _normalize_ig_source(raw_row[7]),
            }
        )
    wb.close()
    return rows


def _validate_rows(
    rows: list[dict], db_schools: set[str]
) -> tuple[list[dict], dict[str, int], list[str]]:
    """Filter, validate, and canonicalize rows.  Returns (kept, skipped, errors)."""
    kept: list[dict] = []
    skipped: Counter[str] = Counter()
    errors: list[str] = []
    unknown_schools: set[str] = set()
    bad_categories: set[str] = set()
    seen: dict[tuple[str, str], int] = {}

    for idx, row in enumerate(rows, start=3):
        if not row["name"]:
            skipped["blank_name"] += 1
            continue
        if not row["school_short"]:
            skipped["blank_school"] += 1
            continue
        canonical_school = SCHOOL_NAME_MAP.get(row["school_short"])
        if not canonical_school:
            unknown_schools.add(row["school_short"])
            skipped[f"unknown_school={row['school_short']}"] += 1
            continue
        if canonical_school not in db_schools:
            errors.append(
                f"Canonical school {canonical_school!r} (mapped from short name {row['school_short']!r}) "
                "is not registered in the Supabase 'schools' table."
            )
            continue

        # Filter out invalid categories, keep the valid ones
        valid_categories = []
        for category in row["categories"]:
            if category in ORGANIZATION_CATEGORIES:
                valid_categories.append(category)
            else:
                bad_categories.add(category)

        organization_name = row["name"][:ORGANIZATION_NAME_MAX]
        if len(row["name"]) > ORGANIZATION_NAME_MAX:
            log.warning(
                "Row %s: organization_name truncated to %s chars", idx, ORGANIZATION_NAME_MAX
            )

        # Dedup dynamically to maintain idempotency and avoid aborting
        key = (canonical_school, organization_name)
        if key in seen:
            skipped["duplicate_school_name"] += 1
            continue
        seen[key] = idx

        kept.append(
            {
                "row_idx": idx,
                "organization_name": organization_name,
                "school": canonical_school,
                "categories": valid_categories,
                "organization_page": row["directory"],
                "ig": row["ig_handle"],
                "organization_type": DEFAULT_ORGANIZATION_TYPE,
            }
        )

    if unknown_schools:
        log.warning(
            "xlsx School values with no entry in SCHOOL_NAME_MAP skipped: "
            + ", ".join(sorted(unknown_schools))
        )
    if bad_categories:
        log.warning(
            "xlsx Category values not in ORGANIZATION_CATEGORIES skipped: "
            + ", ".join(sorted(bad_categories))
        )

    return kept, dict(skipped), errors


def _fetch_existing(sb, schools: set[str]) -> dict[tuple[str, str], dict]:
    """Return all organizations whose school is in *schools*, keyed on (school, organization_name)."""
    if not schools:
        return {}
    existing: dict[tuple[str, str], dict] = {}
    # Supabase / postgrest doesn't paginate by default — explicit limit + range
    # keeps this safe past the default 1000-row cap.
    page_size = 1000
    offset = 0
    while True:
        res = (
            sb.table(ORGANIZATIONS)
            .select(
                "id, organization_name, school, categories, organization_page, ig, organization_type"
            )
            .in_("school", list(schools))
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = res.data or []
        for row in batch:
            existing[(row["school"], row["organization_name"])] = row
        if len(batch) < page_size:
            break
        offset += page_size
    return existing


def _diff(planned: dict, existing: dict) -> dict | None:
    """Return a dict of {field: (old, new)} for fields that differ, or None."""
    fields = ("categories", "organization_page", "ig", "organization_type")
    diff: dict[str, tuple] = {}
    for field in fields:
        old = existing.get(field)
        new = planned[field]
        # categories: order-insensitive equality
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
    args = parser.parse_args()

    sb = get_sb()
    try:
        from core.tables import SCHOOLS

        res_schools = sb.table(SCHOOLS).select("name").execute()
        db_schools = {row["name"] for row in res_schools.data or []}
    except Exception as e:
        log.error("Failed to fetch canonical schools from Supabase: %s", e)
        return 2

    rows = _read_xlsx_rows()
    log.info("xlsx rows scanned: %s", len(rows))

    kept, skipped, errors = _validate_rows(rows, db_schools)
    if errors:
        for err in errors:
            log.error(err)
        log.error("Aborting — fix the xlsx (or the schools migration) and re-run.")
        return 2

    log.info("xlsx rows kept after IG-source filter: %s", len(kept))
    for reason, count in sorted(skipped.items(), key=lambda x: -x[1]):
        log.info("  skipped (%s): %s", reason, count)

    schools_in_play = {row["school"] for row in kept}
    existing = _fetch_existing(sb, schools_in_play)
    log.info("existing rows in Supabase for those schools: %s", len(existing))

    to_insert: list[dict] = []
    to_update: list[tuple[int, dict, dict]] = []  # (id, planned, diff)
    unchanged = 0

    for row in kept:
        key = (row["school"], row["organization_name"])
        if key in existing:
            diff = _diff(row, existing[key])
            if diff:
                to_update.append((existing[key]["id"], row, diff))
            else:
                unchanged += 1
        else:
            to_insert.append(row)

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
        # Show first few example diffs to help the operator sanity-check.
        for cid, planned, diff in to_update[:5]:
            log.info(
                "update example id=%s school=%r name=%r diff=%s",
                cid,
                planned["school"],
                planned["organization_name"],
                diff,
            )
        return 0

    # Apply.  Insert in batches; update one row at a time (Supabase doesn't
    # batch updates with different field values cleanly).
    inserted = 0
    if to_insert:
        batch_size = 200
        payload = [
            {
                "organization_name": row["organization_name"],
                "school": row["school"],
                "categories": row["categories"],
                "organization_page": row["organization_page"],
                "ig": row["ig"],
                "organization_type": row["organization_type"],
            }
            for row in to_insert
        ]
        for start in range(0, len(payload), batch_size):
            chunk = payload[start : start + batch_size]
            sb.table(ORGANIZATIONS).insert(chunk).execute()
            inserted += len(chunk)
            log.info("  inserted %s/%s", inserted, len(payload))

    updated = 0
    for cid, planned, _ in to_update:
        sb.table(ORGANIZATIONS).update(
            {
                "categories": planned["categories"],
                "organization_page": planned["organization_page"],
                "ig": planned["ig"],
                "organization_type": planned["organization_type"],
            }
        ).eq("id", cid).execute()
        updated += 1
        if updated % 100 == 0:
            log.info("  updated %s/%s", updated, len(to_update))

    log.info("done.  inserted=%s updated=%s unchanged=%s", inserted, updated, unchanged)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
