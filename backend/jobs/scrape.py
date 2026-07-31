#!/usr/bin/env python3
"""Single-user Instagram scrape job.

Used by ``.github/workflows/process-single-user.yml``. School is resolved from
``INTENDED_RECIPIENT_ID`` via the Supabase school directory.

Usage:
    cd backend
    INTENDED_RECIPIENT_ID=76214170483 python jobs/scrape.py --username club_handle --cutoff-days 1 --dry-run false

Writes a one-line summary to stdout and exits 0 on success / 1 on failure.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402  - triggers basicConfig for standalone execution
from core.constants import WORKFLOW_RUN_ERROR  # noqa: E402
from services.scraper.instagram_scraper import get_scraper  # noqa: E402
from services.scraper.pipeline import ScrapeResult, run_pipeline  # noqa: E402
from services.scraper.single_user import (  # noqa: E402
    SchoolResolutionError,
    fetch_posts_for_single_user,
    filter_valid_posts,
    resolve_single_user_handle,
    resolve_single_user_scrape_school,
)

log = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape a single Instagram user.")
    parser.add_argument("--username", required=True, help="Instagram username to scrape")
    parser.add_argument(
        "--cutoff-days", type=int, default=1, help="Drop posts older than this many days"
    )
    parser.add_argument(
        "--dry-run",
        choices=["true", "false"],
        required=True,
        help="Whether to perform a dry run (true/false)",
    )
    parser.add_argument(
        "--allow-past-events",
        choices=["true", "false"],
        default="false",
        help="Whether to allow occurrences in the past (true/false)",
    )
    return parser.parse_args()


def _print_summary(school: str, result: ScrapeResult) -> None:
    prefix = "[DRY-RUN] " if result.dry_run else ""
    saved = "would be " if result.dry_run else ""
    print(
        f"{prefix}{school}: 1 handle(s), "
        f"{result.posts_fetched} post(s) fetched, "
        f"{result.events_extracted} event(s) extracted, "
        f"{result.events_saved} event(s) {saved}saved"
    )


def _create_github_annotation(school: str, username: str | None, url: str | None) -> None:
    """Emit a GitHub Actions notice annotation summarising the processed post."""
    if url:
        message = f"{school}\n@{username}\n{url}"
    else:
        message = f"{school}\n@{username}"
    escaped = message.replace("\n", "%0A")
    print(f"::notice::{escaped}", flush=True)


def _log_automate_event(school: str, username: str | None, url: str | None) -> None:
    """Log the scrape event to the database for the live dashboard."""
    from services.automate_log_service import create_automate_log
    create_automate_log(
        event="SCRAPE_COMPLETED",
        sender_id=os.getenv("INTENDED_RECIPIENT_ID"),
        school=school,
        ig_account=username,
        post_url=url,
        payload=None,
    )


def run(
    *,
    username: str,
    cutoff_days: int,
    dry_run: bool,
    allow_past_events: bool,
) -> int:
    try:
        school = resolve_single_user_scrape_school()
    except SchoolResolutionError as exc:
        log.error("%s", exc)
        return 1

    target = username.strip()
    if not target:
        log.error("No valid username provided, exiting.")
        return 1

    log.info(
        "Single-user scrape: username=%s, school=%s, cutoff_days=%d, dry_run=%s, allow_past_events=%s",
        target,
        school,
        cutoff_days,
        dry_run,
        allow_past_events,
    )

    posts, pinned_warning = fetch_posts_for_single_user(
        target,
        cutoff_days=cutoff_days,
        scraper=get_scraper(),
    )
    posts = filter_valid_posts(posts)
    if not posts:
        log.info("No valid posts retrieved for target=%s", target)
        _print_summary(
            school,
            ScrapeResult(ig_handle=target, dry_run=dry_run),
        )
        return 0

    handle = resolve_single_user_handle(target=target, posts=posts)
    result = run_pipeline(
        ig_handle=handle,
        school=school,
        posts=posts,
        cutoff_days=cutoff_days,
        pinned_post_warning=pinned_warning,
        dry_run=dry_run,
        github_run_id=os.getenv("GITHUB_RUN_ID"),
        allow_past_events=allow_past_events,
    )
    _print_summary(school, result)

    resolved_username = posts[0].get("ownerUsername") or posts[0].get("username")
    resolved_url = posts[0].get("url")
    _create_github_annotation(school, resolved_username, resolved_url)
    _log_automate_event(school, resolved_username, resolved_url)

    return 0 if result.status != WORKFLOW_RUN_ERROR else 1


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args()
    return run(
        username=args.username,
        cutoff_days=args.cutoff_days,
        dry_run=args.dry_run == "true",
        allow_past_events=args.allow_past_events == "true",
    )


if __name__ == "__main__":
    sys.exit(main())
