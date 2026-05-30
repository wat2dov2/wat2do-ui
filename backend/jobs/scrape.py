#!/usr/bin/env python3
"""Scraping job entry point.

Two invocation modes, distinguished by environment + arguments:

1. **Single-user mode** — set ``TARGET_USERNAME`` env var. The job
   scrapes that one handle with a 1-day cutoff (or 5 years if
   ``IGNORE_CUTOFF=true``). Used by ``.github/workflows/process-single-user.yml``.

2. **Big-scrape mode** — pass ``--urls-file`` and ``--school``. The
   job reads handles from the file and chunks them into batches of
   ``SCRAPING_HANDLES_PER_RUN`` per Apify run. Used by
   ``.github/workflows/big-scrape.yml``.

Usage:
    cd backend
    python jobs/scrape.py --urls-file services/wat2do/urls/uwaterloo.txt \\
        --school "University of Waterloo" --limit 100 --cutoff-days 4 --dry-run

Both modes write a one-line summary to stdout and exit 0 on success /
1 on failure so the workflow can grep the log.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Add backend root to path so service imports resolve when invoked as a
# script from inside backend/. Mirrors the pattern in
# recommender/job.py and jobs/send_notifications.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402  — triggers basicConfig for standalone execution
from core.constants import (  # noqa: E402
    SCRAPING_DEFAULT_CUTOFF_DAYS,
    SCRAPING_HANDLES_PER_RUN,
    SCRAPING_SINGLE_USER_CUTOFF_DAYS,
)
from services.scraper.pipeline import run_pipeline  # noqa: E402

log = logging.getLogger(__name__)

# Deep look-back for ad-hoc single-user runs.  Five years matches the
# historical v1 IGNORE_CUTOFF default; in practice it's "ignore the
# cutoff entirely" without disabling the filter code path.
_IGNORE_CUTOFF_DAYS = 365 * 5


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the wat2do scraping pipeline.")
    subparsers = parser.add_subparsers(dest="command", required=True, help="Scraping mode to run")

    # User subcommand
    user_parser = subparsers.add_parser("user", help="Scrape a single Instagram user")
    user_parser.add_argument("--username", required=True, help="Instagram username to scrape")
    user_parser.add_argument("--school", default="University of Waterloo", help="Canonical school name")
    user_parser.add_argument("--limit", type=int, default=1, help="Max posts per handle (Apify resultsLimit)")
    user_parser.add_argument("--cutoff-days", type=int, default=1, help="Drop posts older than this many days")
    user_parser.add_argument("--dry-run", action="store_true", help="Skip DB writes")

    # Batch subcommand
    batch_parser = subparsers.add_parser("batch", help="Scrape a batch of Instagram handles from a file")
    batch_parser.add_argument("--urls-file", type=Path, required=True, help="Path to a text file with one URL/handle per line")
    batch_parser.add_argument("--school", required=True, help="Canonical school name")
    batch_parser.add_argument("--limit", type=int, default=None, help="Max posts per handle (Apify resultsLimit)")
    batch_parser.add_argument("--cutoff-days", type=int, default=4, help="Drop posts older than this many days")
    batch_parser.add_argument("--dry-run", action="store_true", help="Skip DB writes")

    return parser.parse_args()


def _read_handles(urls_file: Path) -> list[str]:
    """Read one handle per line from ``urls_file``.

    Skips blanks and ``#`` comments. Each non-empty line should be either
    a full Instagram URL (``https://instagram.com/<handle>``) or a bare
    handle. Trailing slashes / paths are stripped so URLs with extra
    segments still resolve.
    """
    handles: list[str] = []
    for raw in urls_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "instagram.com/" in line:
            line = line.split("instagram.com/", 1)[1]
        # Drop trailing path segments / slashes (e.g. "uw_animusic/posts").
        handle = line.split("/", 1)[0].strip()
        if handle:
            handles.append(handle)
    return handles


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
    school: str,
    cutoff_days: int,
    limit: int | None,
    dry_run: bool,
) -> int:
    log.info(
        "Single-user mode: username=%s, school=%s, cutoff_days=%d, limit=%s, dry_run=%s",
        username,
        school,
        cutoff_days,
        limit,
        dry_run,
    )

    result = run_pipeline(
        usernames=[username],
        school=school,
        cutoff_days=cutoff_days,
        results_limit=limit,
        dry_run=dry_run,
        github_run_id=os.getenv("GITHUB_RUN_ID"),
    )

    print(
        _format_summary(
            school,
            [username],
            result.total_inserted,
            result.total_extracted,
            result.total_posts,
            dry_run=dry_run,
        )
    )
    return 0 if all(h.status != "error" for h in result.handles) else 1


def _run_big_scrape_mode(
    urls_file: Path,
    school: str,
    limit: int | None,
    cutoff_days: int,
    dry_run: bool,
) -> int:
    handles = _read_handles(urls_file)
    if dry_run:
        # v1 semantics: dry-run on a big-scrape only processes the first
        # handle so the operator can eyeball model behaviour without
        # waiting for a multi-hour Apify run.
        handles = handles[:1]
    if not handles:
        log.error("No handles found in %s", urls_file)
        return 1

    log.info(
        "Big-scrape mode: school=%s, handles=%d, limit=%s, cutoff_days=%d, dry_run=%s",
        school,
        len(handles),
        limit,
        cutoff_days,
        dry_run,
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

    if args.command == "user":
        return _run_single_user_mode(
            username=args.username,
            school=args.school,
            cutoff_days=args.cutoff_days,
            limit=args.limit,
            dry_run=args.dry_run,
        )
    elif args.command == "batch":
        return _run_big_scrape_mode(
            urls_file=args.urls_file,
            school=args.school,
            limit=args.limit,
            cutoff_days=args.cutoff_days,
            dry_run=args.dry_run,
        )

    return 1


if __name__ == "__main__":
    sys.exit(main())
