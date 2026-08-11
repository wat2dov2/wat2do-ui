#!/usr/bin/env python3
"""Apply an LLM-reviewed organization reconciliation plan transactionally.

The plan is immutable operational input. Without ``--apply`` this script only
validates and reports outstanding actions. With ``--apply``, each selected
school is reconciled in one PostgreSQL transaction and its frontend cache is
revalidated once.

Usage (from backend/):
  uv run python scripts/reconcile_duplicate_organizations.py \
    --plan /tmp/organization-reconciliation.json

  uv run python scripts/reconcile_duplicate_organizations.py \
    --plan /tmp/organization-reconciliation.json --school utsc --apply
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import settings  # noqa: E402
from core.constants.organizations import ORGANIZATION_CATEGORIES  # noqa: E402
from core.constants.storage import BUCKET_ORGANIZATION_LOGOS  # noqa: E402
from core.database import get_sb  # noqa: E402
from core.tables import ORGANIZATIONS  # noqa: E402
from services.event_feed_revalidation import (  # noqa: E402
    event_feed_revalidation_service,
)
from services.storage_service import storage  # noqa: E402

log = logging.getLogger(__name__)

_EXPECTED_ROW_FIELDS = frozenset({"id", "organization_name", "ig"})
_UNIQUE_CHILDREN = (
    ("organization_claims", "user_id"),
    ("organization_integrations", "platform"),
    ("organization_invitations", "email"),
    ("organization_join_requests", "user_id"),
    ("organization_members", "user_id"),
    ("organization_memberships", "user_id"),
    ("user_saved_organizations", "user_id"),
)


def normalize_handle(value: object) -> str | None:
    handle = str(value or "").strip().lstrip("@").casefold()
    return handle or None


def _sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def _expected_rows(plan: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for merge in plan["merges"]:
        rows.append({"school": merge["school"], **merge["canonical"]})
        rows.extend({"school": merge["school"], **row} for row in merge["duplicates"])
    rows.extend(
        {"school": clear["school"], **clear["organization"]} for clear in plan["instagram_clears"]
    )
    return rows


def validate_plan(plan: dict[str, Any]) -> None:
    if plan.get("version") != 1:
        raise ValueError("Unsupported reconciliation plan version")
    if not isinstance(plan.get("merges"), list) or not isinstance(
        plan.get("instagram_clears"), list
    ):
        raise ValueError("Plan must contain merges and instagram_clears lists")

    used_ids: set[int] = set()
    for merge in plan["merges"]:
        if not merge.get("school") or not merge.get("duplicates"):
            raise ValueError("Every merge needs a school and at least one duplicate")
        rows = [merge.get("canonical"), *merge["duplicates"]]
        for row in rows:
            if not isinstance(row, dict) or set(row) != _EXPECTED_ROW_FIELDS:
                raise ValueError(f"Invalid expected organization row: {row!r}")
            row_id = int(row["id"])
            if row_id in used_ids:
                raise ValueError(f"Organization {row_id} appears in multiple actions")
            used_ids.add(row_id)

    for clear in plan["instagram_clears"]:
        row = clear.get("organization")
        if not clear.get("school") or not isinstance(row, dict):
            raise ValueError(f"Invalid Instagram clear action: {clear!r}")
        if set(row) != _EXPECTED_ROW_FIELDS or normalize_handle(row.get("ig")) is None:
            raise ValueError(f"Invalid Instagram clear organization: {row!r}")
        row_id = int(row["id"])
        if row_id in used_ids:
            raise ValueError(f"Organization {row_id} appears in multiple actions")
        used_ids.add(row_id)


def selected_plan(plan: dict[str, Any], school: str | None = None) -> dict[str, Any]:
    return {
        "version": plan["version"],
        "merges": [
            merge for merge in plan["merges"] if school is None or merge["school"] == school
        ],
        "instagram_clears": [
            clear
            for clear in plan["instagram_clears"]
            if school is None or clear["school"] == school
        ],
    }


def _fetch_current_rows(sb: Any, ids: list[int]) -> dict[int, dict[str, Any]]:
    if not ids:
        return {}
    result = (
        sb.table(ORGANIZATIONS)
        .select("id,organization_name,ig,logo_url,school:schools!inner(slug)")
        .in_("id", ids)
        .execute()
    )
    return {int(row["id"]): row for row in result.data or []}


def build_plan(sb: Any, decisions: dict[str, Any]) -> dict[str, Any]:
    if decisions.get("version") != 1:
        raise ValueError("Unsupported reconciliation decisions version")
    merges = decisions.get("merges")
    clears = decisions.get("instagram_clears")
    if not isinstance(merges, list) or not isinstance(clears, list):
        raise ValueError("Decisions must contain merges and instagram_clears lists")

    ids = [
        int(row_id)
        for merge in merges
        for row_id in [merge["canonical_id"], *merge["duplicate_ids"]]
    ]
    ids.extend(int(clear["id"]) for clear in clears)
    if len(ids) != len(set(ids)):
        raise ValueError("An organization appears in multiple reconciliation decisions")
    current_rows = _fetch_current_rows(sb, ids)
    missing = sorted(set(ids) - set(current_rows))
    if missing:
        raise ValueError(f"Decision organizations missing from database: {missing}")

    def freeze(row_id: int, school: str) -> dict[str, Any]:
        row = current_rows[row_id]
        if _school_slug(row) != school:
            raise ValueError(
                f"Organization {row_id} belongs to {_school_slug(row)!r}, not {school!r}"
            )
        return {
            "id": row_id,
            "organization_name": str(row["organization_name"]),
            "ig": normalize_handle(row.get("ig")),
        }

    plan = {
        "version": 1,
        "merges": [
            {
                "school": merge["school"],
                "canonical": freeze(int(merge["canonical_id"]), merge["school"]),
                "duplicates": [
                    freeze(int(row_id), merge["school"]) for row_id in merge["duplicate_ids"]
                ],
            }
            for merge in merges
        ],
        "instagram_clears": [
            {
                "school": clear["school"],
                "organization": freeze(int(clear["id"]), clear["school"]),
            }
            for clear in clears
        ],
    }
    validate_plan(plan)
    return plan


def write_plan(path: Path, plan: dict[str, Any]) -> None:
    path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n")


def _school_slug(row: dict[str, Any]) -> str:
    school = row.get("school") or {}
    return str(school.get("slug") or "")


def outstanding_plan(
    plan: dict[str, Any], current_rows: dict[int, dict[str, Any]]
) -> dict[str, Any]:
    outstanding_merges: list[dict[str, Any]] = []
    outstanding_clears: list[dict[str, Any]] = []

    for merge in plan["merges"]:
        canonical_id = int(merge["canonical"]["id"])
        duplicate_ids = [int(row["id"]) for row in merge["duplicates"]]
        canonical_exists = canonical_id in current_rows
        existing_duplicates = [row_id for row_id in duplicate_ids if row_id in current_rows]
        if canonical_exists and not existing_duplicates:
            continue
        if not canonical_exists or len(existing_duplicates) != len(duplicate_ids):
            raise ValueError(
                f"Merge for canonical {canonical_id} is partially applied or rows disappeared"
            )
        outstanding_merges.append(merge)

    for clear in plan["instagram_clears"]:
        row_id = int(clear["organization"]["id"])
        current = current_rows.get(row_id)
        if current is None:
            raise ValueError(f"Instagram clear target {row_id} disappeared")
        if normalize_handle(current.get("ig")) is None and current.get("logo_url") is None:
            continue
        outstanding_clears.append(clear)

    return {
        "version": plan["version"],
        "merges": outstanding_merges,
        "instagram_clears": outstanding_clears,
    }


def validate_current_rows(plan: dict[str, Any], current_rows: dict[int, dict[str, Any]]) -> None:
    for expected in _expected_rows(plan):
        row_id = int(expected["id"])
        current = current_rows.get(row_id)
        if current is None:
            continue
        actual = (
            _school_slug(current),
            str(current.get("organization_name") or ""),
            normalize_handle(current.get("ig")),
        )
        wanted = (
            expected["school"],
            expected["organization_name"],
            normalize_handle(expected.get("ig")),
        )
        if actual != wanted:
            raise ValueError(
                f"Organization {row_id} changed since review: expected {wanted!r}, got {actual!r}"
            )


def plan_counts(plan: dict[str, Any]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter[str]] = {}
    for action in ("merges", "instagram_clears"):
        for row in plan[action]:
            counts.setdefault(row["school"], Counter())[action] += 1
    return {school: dict(values) for school, values in sorted(counts.items())}


def _expected_rows_sql(plan: dict[str, Any]) -> str:
    values = []
    for row in _expected_rows(plan):
        values.append(
            "("
            + ", ".join(
                (
                    str(int(row["id"])),
                    _sql_literal(row["school"]),
                    _sql_literal(row["organization_name"]),
                    _sql_literal(normalize_handle(row.get("ig"))),
                )
            )
            + ")"
        )
    return ",\n    ".join(values)


def _merge_sql(merge: dict[str, Any]) -> str:
    canonical_id = int(merge["canonical"]["id"])
    duplicate_ids = [int(row["id"]) for row in merge["duplicates"]]
    all_ids = [canonical_id, *duplicate_ids]
    duplicate_csv = ", ".join(map(str, duplicate_ids))
    all_csv = ", ".join(map(str, all_ids))

    categories = ",\n        ".join(
        f"({_sql_literal(category)}, {index})"
        for index, category in enumerate(ORGANIZATION_CATEGORIES)
    )
    conflict_checks = "\n".join(
        f"""    IF EXISTS (
        SELECT 1 FROM {table}
        WHERE organization_id IN ({all_csv})
        GROUP BY {unique_column}
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Organization merge {canonical_id} has conflicting {table} rows';
    END IF;"""
        for table, unique_column in _UNIQUE_CHILDREN
    )
    statements = [
        f"""DO $conflicts_{canonical_id}$
BEGIN
{conflict_checks}
END
$conflicts_{canonical_id}$;""",
        f"""UPDATE organizations AS canonical
SET categories = COALESCE((
        SELECT jsonb_agg(allowed.category ORDER BY allowed.ordinality)
        FROM (VALUES
        {categories}
        ) AS allowed(category, ordinality)
        WHERE EXISTS (
            SELECT 1
            FROM organizations AS candidate
            CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(candidate.categories, '[]'::jsonb)
            ) AS present(category)
            WHERE candidate.id IN ({all_csv})
              AND present.category = allowed.category
        )
    ), '[]'::jsonb),
    organization_page = COALESCE(
        canonical.organization_page,
        (SELECT organization_page FROM organizations
         WHERE id IN ({duplicate_csv}) AND organization_page IS NOT NULL
         ORDER BY id LIMIT 1)
    ),
    discord = COALESCE(
        canonical.discord,
        (SELECT discord FROM organizations
         WHERE id IN ({duplicate_csv}) AND discord IS NOT NULL
         ORDER BY id LIMIT 1)
    ),
    organization_type = COALESCE(
        NULLIF(canonical.organization_type, 'independent'),
        (SELECT organization_type FROM organizations
         WHERE id IN ({duplicate_csv}) AND organization_type <> 'independent'
         ORDER BY id LIMIT 1),
        canonical.organization_type
    ),
    association_affiliated = canonical.association_affiliated OR EXISTS (
        SELECT 1 FROM organizations
        WHERE id IN ({duplicate_csv}) AND association_affiliated
    )
WHERE canonical.id = {canonical_id};""",
    ]

    for duplicate_id in duplicate_ids:
        for table in ("events", "positions", *(table for table, _ in _UNIQUE_CHILDREN)):
            statements.append(
                f"UPDATE {table} SET organization_id = {canonical_id} "
                f"WHERE organization_id = {duplicate_id};"
            )
        statements.append(f"DELETE FROM organizations WHERE id = {duplicate_id};")
    return "\n".join(statements)


def build_transaction_sql(plan: dict[str, Any]) -> str:
    expected_values = _expected_rows_sql(plan)
    action_sql = [_merge_sql(merge) for merge in plan["merges"]] + [
        "UPDATE organizations SET ig = NULL, logo_url = NULL "
        f"WHERE id = {int(clear['organization']['id'])};"
        for clear in plan["instagram_clears"]
    ]
    return f"""BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE reconciliation_expected (
    id integer PRIMARY KEY,
    school text NOT NULL,
    organization_name text NOT NULL,
    ig text
) ON COMMIT DROP;

INSERT INTO reconciliation_expected (id, school, organization_name, ig) VALUES
    {expected_values};

SELECT pg_advisory_xact_lock(20260811, 1);

DO $validate$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM reconciliation_expected AS expected
        LEFT JOIN organizations AS actual ON actual.id = expected.id
        LEFT JOIN schools ON schools.id = actual.school_id
        WHERE actual.id IS NULL
           OR schools.slug IS DISTINCT FROM expected.school
           OR actual.organization_name IS DISTINCT FROM expected.organization_name
           OR NULLIF(lower(trim(BOTH '@' FROM actual.ig)), '')
              IS DISTINCT FROM expected.ig
    ) THEN
        RAISE EXCEPTION 'Organization reconciliation plan no longer matches production';
    END IF;
END
$validate$;

{"\n\n".join(action_sql)}

COMMIT;
"""


def run_transaction(sql: str) -> None:
    if not settings.database_url:
        raise ValueError("DATABASE_URL is required to apply reconciliation")
    psql = shutil.which("psql")
    if psql is None:
        raise ValueError("psql is required to apply reconciliation")
    parsed = urlparse(settings.database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("DATABASE_URL must be a PostgreSQL connection URL")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment.update(
        {
            "PGHOST": parsed.hostname,
            "PGPORT": str(parsed.port or 5432),
            "PGUSER": unquote(parsed.username or ""),
            "PGPASSWORD": unquote(parsed.password or ""),
            "PGDATABASE": unquote(parsed.path.lstrip("/") or "postgres"),
        }
    )
    query = parse_qs(parsed.query)
    if sslmode := query.get("sslmode", [None])[-1]:
        environment["PGSSLMODE"] = sslmode
    result = subprocess.run(
        [psql, "--no-psqlrc", "--set", "ON_ERROR_STOP=1"],
        input=sql,
        text=True,
        capture_output=True,
        check=False,
        env=environment,
    )
    if result.returncode:
        detail = (
            result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "unknown error"
        )
        raise RuntimeError(f"Organization reconciliation transaction failed: {detail}")


def _obsolete_logo_urls(plan: dict[str, Any], current_rows: dict[int, dict[str, Any]]) -> set[str]:
    removed_ids = {int(row["id"]) for merge in plan["merges"] for row in merge["duplicates"]}
    removed_ids.update(int(clear["organization"]["id"]) for clear in plan["instagram_clears"])
    return {
        str(current_rows[row_id]["logo_url"])
        for row_id in removed_ids
        if row_id in current_rows and current_rows[row_id].get("logo_url")
    }


def delete_unreferenced_logos(sb: Any, urls: set[str]) -> int:
    deleted = 0
    for url in sorted(urls):
        result = sb.table(ORGANIZATIONS).select("id").eq("logo_url", url).limit(1).execute()
        if result.data:
            continue
        path = storage.path_from_url(url, BUCKET_ORGANIZATION_LOGOS)
        if path is None:
            continue
        storage.delete_file(BUCKET_ORGANIZATION_LOGOS, path)
        deleted += 1
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--decisions", type=Path)
    parser.add_argument("--school")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    try:
        if args.decisions:
            if args.apply or args.school:
                raise ValueError("--decisions cannot be combined with --apply or --school")
            if args.plan.exists():
                raise ValueError(f"Refusing to overwrite existing plan: {args.plan}")
            decisions = json.loads(args.decisions.read_text())
            plan = build_plan(get_sb(), decisions)
            write_plan(args.plan, plan)
            log.info("Reviewed plan written to %s", args.plan)
            for school, school_counts in plan_counts(plan).items():
                log.info("%s: %s", school, school_counts)
            return 0

        plan = json.loads(args.plan.read_text())
        validate_plan(plan)
        plan = selected_plan(plan, args.school)
        expected_ids = [int(row["id"]) for row in _expected_rows(plan)]
        sb = get_sb()
        current_rows = _fetch_current_rows(sb, expected_ids)
        plan = outstanding_plan(plan, current_rows)
        validate_current_rows(plan, current_rows)

        counts = plan_counts(plan)
        for school, school_counts in counts.items():
            log.info("%s: %s", school, school_counts)
        if not counts:
            log.info("No outstanding reconciliation actions")
            return 0
        if not args.apply:
            log.info("Dry run only. Re-run with --apply to write changes.")
            return 0

        obsolete_logos = _obsolete_logo_urls(plan, current_rows)
        run_transaction(build_transaction_sql(plan))
        deleted_logos = delete_unreferenced_logos(sb, obsolete_logos)
        changed_schools = sorted(counts)
        event_feed_revalidation_service.revalidate_schools(changed_schools)
        log.info(
            "Reconciled %s; deleted %d unreferenced logos",
            ", ".join(changed_schools),
            deleted_logos,
        )
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        log.error("%s", exc)
        return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    raise SystemExit(main())
