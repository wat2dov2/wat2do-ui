#!/usr/bin/env python3
"""Bulk-import organizations from all_schools_student_clubs_master.xlsx into the
Supabase ``clubs`` table.

Only rows whose ``IG Source`` is one of ``{found, confirmed, profile_page}``
(prefix-matched against ``|``-separated annotations) are imported — the rest
are speculative matches and will be re-imported once their handles are
verified.

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
import sys
from collections import Counter
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.constants.organizations import ORGANIZATION_CATEGORIES
from core.database import get_sb
from core.tables import CLUBS

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

# Map xlsx School column short names -> canonical schools.name values.
# These names must match exactly the rows seeded in
# 20260610180000_add_schools_and_email_domains.sql.
SCHOOL_NAME_MAP: dict[str, str] = {
    "Brock": "Brock University",
    "Carleton": "Carleton University",
    "Cornell": "Cornell University",
    "Laurier": "Wilfrid Laurier University",
    "McGill": "McGill University",
    "McMaster": "McMaster University",
    "NYU": "New York University",
    "OCAD": "OCAD University",
    "Queen's": "Queen's University",
    "TMU": "Toronto Metropolitan University",
    "UPenn": "University of Pennsylvania",
    "UofT Scarborough": "University of Toronto - Scarborough",
    "UofT St. George": "University of Toronto - St. George",
    "Western": "Western University",
    "York": "York University",
    "uOttawa": "University of Ottawa",
}

# Default for the legacy required `club_type` column.  Existing non-WUSA
# seeds in backend/seeds/clubs.py use "Independent" for school clubs that
# aren't WUSA-affiliated; same convention here.
DEFAULT_CLUB_TYPE = "Independent"

CLUB_NAME_MAX = 500


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
    """Parse a Category cell into a list of canonical category names.

    The xlsx uses ``, `` as a separator BUT some canonical names also
    contain commas (e.g. "Charitable, Community Service & International
    Development").  We split on ``, ``, then greedily re-join adjacent
    fragments into the longest prefix that matches a canonical name.
    """
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []

    parts = [p.strip() for p in text.split(",")]
    parts = [p for p in parts if p]

    # Greedy re-join: at each position, find the longest run of
    # consecutive parts whose ", "-joined form is a canonical category.
    results: list[str] = []
    i = 0
    canonical_set = set(ORGANIZATION_CATEGORIES)
    while i < len(parts):
        matched = None
        # Try the longest run first so "Charitable, Community Service & ..."
        # wins over the prefix "Charitable".
        for j in range(len(parts), i, -1):
            candidate = ", ".join(parts[i:j])
            if candidate in canonical_set:
                matched = (candidate, j)
                break
        if matched is None:
            # Couldn't match this fragment to any canonical name — keep
            # the raw fragment so _validate_rows surfaces it as an error.
            results.append(parts[i])
            i += 1
        else:
            results.append(matched[0])
            i = matched[1]
    return results


def _normalize_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _read_xlsx_rows() -> list[dict]:
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=2, max_row=2))]
    expected = ["School", "Name", "Category", "Campus", "Directory URL",
                "Instagram URL", "Instagram Handle", "IG Source"]
    if header != expected:
        raise RuntimeError(
            f"Unexpected xlsx header.  Expected {expected!r}, got {header!r}"
        )

    rows: list[dict] = []
    for raw_row in ws.iter_rows(min_row=3, values_only=True):
        if not raw_row or not any(raw_row):
            continue
        rows.append({
            "school_short": _normalize_str(raw_row[0]),
            "name":         _normalize_str(raw_row[1]),
            "categories":   _normalize_categories(raw_row[2]),
            "campus":       _normalize_str(raw_row[3]),
            "directory":    _normalize_str(raw_row[4]),
            "ig_url":       _normalize_str(raw_row[5]),
            "ig_handle":    _normalize_handle(raw_row[6]),
            "ig_source":    _normalize_ig_source(raw_row[7]),
        })
    wb.close()
    return rows


def _validate_rows(rows: list[dict]) -> tuple[list[dict], dict[str, int], list[str]]:
    """Filter, validate, and canonicalize rows.  Returns (kept, skipped, errors)."""
    kept: list[dict] = []
    skipped: Counter[str] = Counter()
    errors: list[str] = []
    unknown_schools: set[str] = set()
    bad_categories: set[str] = set()

    for idx, row in enumerate(rows, start=3):
        if row["ig_source"] not in HIGH_QUALITY_IG_SOURCES:
            skipped[f"ig_source={row['ig_source'] or '<blank>'}"] += 1
            continue
        if not row["name"]:
            skipped["blank_name"] += 1
            continue
        if not row["school_short"]:
            skipped["blank_school"] += 1
            continue
        canonical_school = SCHOOL_NAME_MAP.get(row["school_short"])
        if not canonical_school:
            unknown_schools.add(row["school_short"])
            continue
        for category in row["categories"]:
            if category not in ORGANIZATION_CATEGORIES:
                bad_categories.add(category)

        club_name = row["name"][:CLUB_NAME_MAX]
        if len(row["name"]) > CLUB_NAME_MAX:
            log.warning("Row %s: club_name truncated to %s chars", idx, CLUB_NAME_MAX)

        kept.append({
            "row_idx":     idx,
            "club_name":   club_name,
            "school":      canonical_school,
            "categories":  row["categories"],
            "club_page":   row["directory"],
            "ig":          row["ig_handle"],
            "club_type":   DEFAULT_CLUB_TYPE,
        })

    if unknown_schools:
        errors.append(
            "xlsx School values with no entry in SCHOOL_NAME_MAP: "
            + ", ".join(sorted(unknown_schools))
        )
    if bad_categories:
        errors.append(
            "xlsx Category values not in ORGANIZATION_CATEGORIES: "
            + ", ".join(sorted(bad_categories))
        )
    return kept, dict(skipped), errors


def _fetch_existing(sb, schools: set[str]) -> dict[tuple[str, str], dict]:
    """Return all clubs whose school is in *schools*, keyed on (school, club_name)."""
    if not schools:
        return {}
    existing: dict[tuple[str, str], dict] = {}
    # Supabase / postgrest doesn't paginate by default — explicit limit + range
    # keeps this safe past the default 1000-row cap.
    page_size = 1000
    offset = 0
    while True:
        res = (
            sb.table(CLUBS)
              .select("id, club_name, school, categories, club_page, ig, club_type")
              .in_("school", list(schools))
              .range(offset, offset + page_size - 1)
              .execute()
        )
        batch = res.data or []
        for row in batch:
            existing[(row["school"], row["club_name"])] = row
        if len(batch) < page_size:
            break
        offset += page_size
    return existing


def _diff(planned: dict, existing: dict) -> dict | None:
    """Return a dict of {field: (old, new)} for fields that differ, or None."""
    fields = ("categories", "club_page", "ig", "club_type")
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
        "--apply", action="store_true",
        help="Write inserts and updates to Supabase.  Without this flag, prints the diff and exits.",
    )
    args = parser.parse_args()

    rows = _read_xlsx_rows()
    log.info("xlsx rows scanned: %s", len(rows))

    kept, skipped, errors = _validate_rows(rows)
    if errors:
        for err in errors:
            log.error(err)
        log.error("Aborting — fix the xlsx (or the schools migration) and re-run.")
        return 2

    log.info("xlsx rows kept after IG-source filter: %s", len(kept))
    for reason, count in sorted(skipped.items(), key=lambda x: -x[1]):
        log.info("  skipped (%s): %s", reason, count)

    schools_in_play = {row["school"] for row in kept}
    sb = get_sb()
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
            log.info("update example id=%s school=%r name=%r diff=%s",
                     cid, planned["school"], planned["club_name"], diff)
        return 0

    # Apply.  Insert in batches; update one row at a time (Supabase doesn't
    # batch updates with different field values cleanly).
    inserted = 0
    if to_insert:
        batch_size = 200
        payload = [
            {
                "club_name":  row["club_name"],
                "school":     row["school"],
                "categories": row["categories"],
                "club_page":  row["club_page"],
                "ig":         row["ig"],
                "club_type":  row["club_type"],
            }
            for row in to_insert
        ]
        for start in range(0, len(payload), batch_size):
            chunk = payload[start:start + batch_size]
            sb.table(CLUBS).insert(chunk).execute()
            inserted += len(chunk)
            log.info("  inserted %s/%s", inserted, len(payload))

    updated = 0
    for cid, planned, _ in to_update:
        sb.table(CLUBS).update({
            "categories": planned["categories"],
            "club_page":  planned["club_page"],
            "ig":         planned["ig"],
            "club_type":  planned["club_type"],
        }).eq("id", cid).execute()
        updated += 1
        if updated % 100 == 0:
            log.info("  updated %s/%s", updated, len(to_update))

    log.info("done.  inserted=%s updated=%s unchanged=%s", inserted, updated, unchanged)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    raise SystemExit(main())
