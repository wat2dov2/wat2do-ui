#!/usr/bin/env python3
"""Scrape directories job entry point.

Reads directory targets from directories.json and crawls them to extract and save events.
Supports running a single directory target, limiting pagination, and dry-run mode.

Usage:
    cd backend
    python jobs/scrape_directories.py --max-pages 2 --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Add backend root to path so service imports resolve when invoked as a
# script from inside backend/.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import core.logging  # noqa: F401, E402  — triggers basicConfig for standalone execution
from services.scraper.directory_scraper import (  # noqa: E402
    DirectoryConfig,
    run_directory_pipeline,
)

log = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the wat2do directory scraping job.")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("services/scraper/urls/directories.json"),
        help="Path to the directories JSON configuration file",
    )
    parser.add_argument(
        "--directory",
        type=str,
        default=None,
        help="Specific directory ID to scrape (default: scrape all)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=5,
        help="Max pages to crawl per directory (default: 5)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Whether to perform a dry run (no DB writes)",
    )
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args()

    if not args.config.exists():
        log.error("Configuration file not found: %s", args.config)
        return 1

    try:
        with open(args.config, "r", encoding="utf-8") as f:
            configs_raw = json.load(f)
    except Exception as e:
        log.error("Failed to load configuration file %s: %s", args.config, e)
        return 1

    configs = [DirectoryConfig(**c) for c in configs_raw]

    if args.directory:
        configs = [c for c in configs if c.id == args.directory]
        if not configs:
            log.error("No directory found with ID: %s", args.directory)
            return 1

    log.info(
        "Directory scraper starting: directories=%d, max_pages=%d, dry_run=%s",
        len(configs),
        args.max_pages,
        args.dry_run,
    )

    any_error = False
    summaries = []

    for config in configs:
        result = run_directory_pipeline(
            config,
            max_pages=args.max_pages,
            dry_run=args.dry_run,
        )

        prefix = "[DRY-RUN] " if args.dry_run else ""
        summary = (
            f"{prefix}{config.name} ({config.school}): crawled {result.pages_crawled} page(s), "
            f"found {result.urls_found} URL(s) total, processed {result.urls_new} new URL(s), "
            f"extracted {result.events_extracted} event(s), "
            f"saved {result.events_saved} event(s) ({result.events_updated} updated, "
            f"{result.events_duplicates} duplicates)"
        )
        summaries.append(summary)
        print(summary)

        if result.errors:
            any_error = True
            log.error(
                "[%s] Directory scraping completed with %d error(s):", config.id, len(result.errors)
            )
            for err in result.errors:
                log.error(" - %s", err)

    print("\n--- Scrape Run Finished ---")
    for s in summaries:
        print(s)

    return 1 if any_error else 0


if __name__ == "__main__":
    sys.exit(main())
