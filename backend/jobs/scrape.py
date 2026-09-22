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
from services.scraper.instagram_scraper import (  # noqa: E402
    InstagramScraperError,
    get_scraper,
)
from services.scraper.pipeline import ScrapeResult, run_pipeline  # noqa: E402
from services.scraper.single_user import (  # noqa: E402
    SchoolResolutionError,
    exact_post_results_match_targets,
    fetch_posts_for_targets,
    filter_valid_posts,
    is_exact_post_url_target,
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
        f"{result.events_saved} event(s) {saved}saved, "
        f"{result.positions_extracted} position(s) extracted, "
        f"{result.positions_saved} position(s) {saved}saved"
    )


def _create_github_annotation(
    school: str, username: str | None, url: str | None, result: ScrapeResult
) -> None:
    """Emit a GitHub Actions notice annotation summarising the processed post."""
    lines = [f"{school} | @{username}"]
    if url:
        lines.append(url)

    if result.events_saved > 0 or result.positions_saved > 0:
        lines.append(
            f"✅ Saved {result.events_saved} event(s) and {result.positions_saved} position(s)."
        )
    else:
        if result.posts_fetched == 0:
            lines.append("❌ No posts retrieved.")
        elif result.posts_new == 0:
            lines.append("❌ Post was previously processed or is older than the cutoff date.")
        elif result.events_extracted == 0 and result.positions_extracted == 0:
            lines.append("❌ Post did not contain an event or position.")
        else:
            lines.append(
                "❌ Post extracted but discarded during save (event dates passed or missing required fields)."
            )

    message = "\n".join(lines)
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
    targets: list[str],
    cutoff_days: int,
    dry_run: bool,
    allow_past_events: bool,
) -> int:
    try:
        school = resolve_single_user_scrape_school()
    except SchoolResolutionError as exc:
        log.error("%s", exc)
        return 1

    clean_targets = [t.strip() for t in targets if t.strip()]
    if not clean_targets:
        log.error("No valid targets provided, exiting.")
        return 1

    log.info(
        "Batch scrape: targets=%d, school=%s, cutoff_days=%d, dry_run=%s, allow_past_events=%s",
        len(clean_targets),
        school,
        cutoff_days,
        dry_run,
        allow_past_events,
    )

    exact_post_targets = all(is_exact_post_url_target(t) for t in clean_targets)
    try:
        posts, pinned_warning = fetch_posts_for_targets(
            clean_targets,
            cutoff_days=cutoff_days,
            scraper=get_scraper(),
        )
    except InstagramScraperError as exc:
        log.error("%s", exc)
        if getattr(exc, "stage", None) != "input":
            return 2
        return 1

    posts = filter_valid_posts(posts)
    if (
        exact_post_targets
        and posts
        and not exact_post_results_match_targets(
            clean_targets,
            posts,
        )
    ):
        log.error("Exact Instagram post scrape returned mismatched media")
        _print_summary(
            school,
            ScrapeResult(ig_handle="unknown", dry_run=dry_run),
        )
        return 1
    if not posts:
        log_method = log.warning if exact_post_targets else log.info
        log_method("No valid posts retrieved for targets")
        if exact_post_targets:
            print(
                "::warning::Exact post retrieval failed; the media claim must not be marked successful.",
                flush=True,
            )
        _print_summary(
            school,
            ScrapeResult(ig_handle="unknown", dry_run=dry_run),
        )
        return 1 if exact_post_targets else 0

    from collections import defaultdict

    posts_by_owner = defaultdict(list)
    for p in posts:
        owner = (p.get("ownerUsername") or p.get("username") or "unknown").strip()
        posts_by_owner[owner].append(p)

    overall_status = 0
    pipeline_cutoff = 1825 if exact_post_targets else cutoff_days
    for owner, owner_posts in posts_by_owner.items():
        handle = owner.lstrip("@")
        result = run_pipeline(
            ig_handle=handle,
            school=school,
            posts=owner_posts,
            cutoff_days=pipeline_cutoff,
            pinned_post_warning=pinned_warning if len(clean_targets) == 1 else False,
            dry_run=dry_run,
            github_run_id=os.getenv("GITHUB_RUN_ID"),
            allow_past_events=allow_past_events,
        )
        _print_summary(school, result)

        resolved_url = owner_posts[0].get("url")
        _create_github_annotation(school, handle, resolved_url, result)
        _log_automate_event(school, handle, resolved_url)

        if result.status == WORKFLOW_RUN_ERROR:
            overall_status = 1

    return overall_status


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args()
    return run(
        targets=[args.username],
        cutoff_days=args.cutoff_days,
        dry_run=args.dry_run == "true",
        allow_past_events=args.allow_past_events == "true",
    )


if __name__ == "__main__":
    sys.exit(main())
