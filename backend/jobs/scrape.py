#!/usr/bin/env python3
"""Scraping job entry point.

Two invocation modes, distinguished by subcommands:

1. **User mode** — scrapes one handle with a 1-day cutoff (or 5 years if
   run via workflow_dispatch). Used by ``.github/workflows/process-single-user.yml``.

2. **Batch mode** — scrapes all Instagram handles loaded dynamically from
   the database for a given school. Used by ``.github/workflows/big-scrape.yml``.

Usage:
    cd backend
    python jobs/scrape.py batch --school "University of Waterloo" --limit 100 --cutoff-days 4 --dry-run true

Both modes write a one-line summary to stdout and exit 0 on success /
1 on failure so the workflow can grep the log.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

# Add backend root to path so service imports resolve when invoked as a
# script from inside backend/. Mirrors the pattern in
# recommender/job.py and jobs/send_notifications.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402  — triggers basicConfig for standalone execution
from core.constants import (  # noqa: E402
    SCRAPING_HANDLES_PER_RUN,
)
from services.scraper.pipeline import run_pipeline  # noqa: E402
from services.scraper.school_resolution import resolve_scrape_school  # noqa: E402
from services.scraper.single_user import (  # noqa: E402
    fetch_posts_for_single_user,
    filter_valid_posts,
    resolve_single_user_handle,
)

log = logging.getLogger(__name__)

# Deep look-back for ad-hoc single-user runs; in practice this means
# "ignore the cutoff" without disabling the filter code path.
_IGNORE_CUTOFF_DAYS = 365 * 5


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the wat2do scraping pipeline.")
    subparsers = parser.add_subparsers(dest="command", required=True, help="Scraping mode to run")

    # User subcommand
    user_parser = subparsers.add_parser("user", help="Scrape a single Instagram user")
    user_parser.add_argument("--username", required=True, help="Instagram username to scrape")
    user_parser.add_argument(
        "--school",
        default=None,
        help="Canonical school name (falls back to SCHOOL env, intended_recipient_id mapping, or Waterloo)",
    )
    user_parser.add_argument(
        "--limit", type=int, default=1, help="Max posts per handle (Apify resultsLimit)"
    )
    user_parser.add_argument(
        "--cutoff-days", type=int, default=1, help="Drop posts older than this many days"
    )
    user_parser.add_argument(
        "--dry-run",
        choices=["true", "false"],
        required=True,
        help="Whether to perform a dry run (true/false)",
    )
    user_parser.add_argument(
        "--allow-past-events",
        choices=["true", "false"],
        default="false",
        help="Whether to allow occurrences in the past (true/false)",
    )

    # Batch subcommand
    batch_parser = subparsers.add_parser(
        "batch", help="Scrape a batch of Instagram handles from the database for a school"
    )
    batch_parser.add_argument("--school", required=True, help="Canonical school name")
    batch_parser.add_argument(
        "--limit", type=int, default=None, help="Max posts per handle (Apify resultsLimit)"
    )
    batch_parser.add_argument(
        "--cutoff-days", type=int, default=4, help="Drop posts older than this many days"
    )
    batch_parser.add_argument(
        "--dry-run",
        choices=["true", "false"],
        required=True,
        help="Whether to perform a dry run (true/false)",
    )
    batch_parser.add_argument(
        "--allow-past-events",
        choices=["true", "false"],
        default="false",
        help="Whether to allow occurrences in the past (true/false)",
    )

    return parser.parse_args()


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _format_summary(
    school: str,
    handles: list[str],
    total_inserted: int,
    total_extracted: int,
    total_posts: int,
    dry_run: bool,
) -> str:
    prefix = "[DRY-RUN] " if dry_run else ""
    return (
        f"{prefix}{school}: {len(handles)} handle(s), "
        f"{total_posts} post(s) fetched, "
        f"{total_extracted} event(s) extracted, "
        f"{total_inserted} event(s) {'would be ' if dry_run else ''}saved"
    )


def _run_single_user_mode(
    username: str,
    school: str | None,
    cutoff_days: int,
    limit: int | None,
    dry_run: bool,
    allow_past_events: bool,
) -> int:
    resolved_school = resolve_scrape_school(explicit_school=school)
    target = username.strip()
    if not target:
        log.error("Repository dispatch triggered but no valid username provided, exiting.")
        return 1

    log.info(
        "Single-user mode: username=%s, school=%s, cutoff_days=%d, limit=%s, dry_run=%s, allow_past_events=%s",
        target,
        resolved_school,
        cutoff_days,
        limit,
        dry_run,
        allow_past_events,
    )

    from services.scraper.instagram_scraper import get_scraper

    scraper = get_scraper()
    posts, pinned_warning = fetch_posts_for_single_user(
        target,
        cutoff_days=cutoff_days,
        scraper=scraper,
    )
    posts = filter_valid_posts(posts)
    if not posts:
        log.info("No valid posts retrieved for target=%s", target)
        print(
            _format_summary(
                resolved_school,
                [target],
                0,
                0,
                0,
                dry_run=dry_run,
            )
        )
        return 0

    handle = resolve_single_user_handle(target=target, posts=posts)

    result = run_pipeline(
        usernames=[handle],
        school=resolved_school,
        cutoff_days=cutoff_days,
        results_limit=limit,
        dry_run=dry_run,
        github_run_id=os.getenv("GITHUB_RUN_ID"),
        allow_past_events=allow_past_events,
        prefetched_posts=posts,
        prefetched_pinned_warning=pinned_warning,
    )

    print(
        _format_summary(
            resolved_school,
            [handle],
            result.total_inserted,
            result.total_extracted,
            result.total_posts,
            dry_run=dry_run,
        )
    )
    return 0 if all(h.status != "error" for h in result.handles) else 1


def _run_big_scrape_mode(
    school: str,
    limit: int | None,
    cutoff_days: int,
    dry_run: bool,
    allow_past_events: bool,
) -> int:
    log.info("Fetching organization handles from database for school: %s", school)
    try:
        from core.database import get_sb
        from core.tables import ORGANIZATIONS

        rows = (
            get_sb()
            .table(ORGANIZATIONS)
            .select("ig")
            .eq("school", school)
            .not_.is_("ig", "null")
            .execute()
        ).data or []
        handles = []
        for r in rows:
            ig = r.get("ig")
            if not ig:
                continue
            ig_str = str(ig).strip()
            if ig_str and ig_str != "null":
                if "instagram.com/" in ig_str:
                    ig_str = ig_str.split("instagram.com/", 1)[1]
                ig_str = ig_str.split("/", 1)[0].strip()
                ig_str = ig_str.lstrip("@").strip()
                if ig_str:
                    handles.append(ig_str)
        # Deduplicate handles
        handles = list(dict.fromkeys(handles))
        log.info("Loaded %d dynamic handles from database", len(handles))
    except Exception as e:
        log.error("Failed to load handles from database: %s", e)
        return 1

    if dry_run:
        # Keep dry-runs short so operators can inspect model behaviour
        # without waiting for a multi-hour Apify run.
        handles = handles[:1]
    if not handles:
        log.error("No handles found for school %s", school)
        return 1

    log.info(
        "Big-scrape mode: school=%s, handles=%d, limit=%s, cutoff_days=%d, dry_run=%s, allow_past_events=%s",
        school,
        len(handles),
        limit,
        cutoff_days,
        dry_run,
        allow_past_events,
    )

    total_inserted = 0
    total_extracted = 0
    total_posts = 0
    any_error = False

    for chunk in _chunked(handles, SCRAPING_HANDLES_PER_RUN):
        result = run_pipeline(
            usernames=chunk,
            school=school,
            cutoff_days=cutoff_days,
            results_limit=limit,
            dry_run=dry_run,
            github_run_id=os.getenv("GITHUB_RUN_ID"),
            allow_past_events=allow_past_events,
        )
        total_inserted += result.total_inserted
        total_extracted += result.total_extracted
        total_posts += result.total_posts
        any_error = any_error or any(h.status == "error" for h in result.handles)

    print(
        _format_summary(
            school, handles, total_inserted, total_extracted, total_posts, dry_run=dry_run
        )
    )
    return 1 if any_error else 0


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args()

    # Convert string choice to boolean
    dry_run_bool = args.dry_run == "true"
    allow_past_events_bool = args.allow_past_events == "true"

    if args.command == "user":
        return _run_single_user_mode(
            username=args.username,
            school=args.school,
            cutoff_days=args.cutoff_days,
            limit=args.limit,
            dry_run=dry_run_bool,
            allow_past_events=allow_past_events_bool,
        )
    elif args.command == "batch":
        return _run_big_scrape_mode(
            school=args.school,
            limit=args.limit,
            cutoff_days=args.cutoff_days,
            dry_run=dry_run_bool,
            allow_past_events=allow_past_events_bool,
        )

    return 1


if __name__ == "__main__":
    sys.exit(main())
