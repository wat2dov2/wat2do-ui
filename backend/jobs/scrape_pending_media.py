#!/usr/bin/env python3
"""Process pending exact Instagram posts using Apify."""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from core.logging import GitHubActionErrorHandler  # noqa: E402
from jobs.scrape import run  # noqa: E402
from services.instagram_notifications.ledger import (  # noqa: E402
    MediaClaim,
    claim_next_pending_media,
    mark_media_failed,
    mark_media_succeeded,
    rollback_media_claim,
)

log = logging.getLogger(__name__)


def _process_claim(claim: MediaClaim, *, cutoff_days: int) -> int:
    os.environ["INTENDED_RECIPIENT_ID"] = claim.intended_recipient_id
    try:
        status = run(
            targets=[claim.source_url],
            cutoff_days=cutoff_days,
            dry_run=False,
            allow_past_events=False,
        )
    except Exception:  # noqa: BLE001 - every claim must reach a terminal ledger state
        log.error("Exact Instagram media scrape raised an unexpected error.")
        status = 1
        failure_category = "scrape_exception"
    else:
        failure_category = "scrape_error"

    try:
        if status == 2:
            finalized = rollback_media_claim(
                media_row_id=claim.media_row_id,
                claim_token=claim.claim_token,
            )
            if finalized:
                log.info("Rolled back transient infrastructure failure to pending queue.")
        else:
            finalized = (
                mark_media_succeeded(
                    media_row_id=claim.media_row_id,
                    claim_token=claim.claim_token,
                )
                if status == 0
                else mark_media_failed(
                    media_row_id=claim.media_row_id,
                    claim_token=claim.claim_token,
                    failure_category=failure_category,
                )
            )
    except Exception:  # noqa: BLE001 - never leak database details
        log.error("Instagram media ledger finalization failed.")
        finalized = False

    if not finalized:
        log.error("Instagram media claim was not finalized.")

    if not finalized:
        return 1
    return 2 if status == 2 else (0 if status == 0 else 1)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger().addHandler(GitHubActionErrorHandler())

    try:
        cutoff_days = int(os.getenv("CUTOFF_DAYS", "1"))
    except ValueError:
        log.error("CUTOFF_DAYS must be an integer.")
        return 1

    github_run_id = (os.getenv("GITHUB_RUN_ID") or "").strip() or None

    start_time = datetime.now()
    max_runtime = timedelta(hours=5, minutes=30)

    overall_status = 0
    processed_count = 0

    while True:
        if datetime.now() - start_time > max_runtime:
            log.warning(
                "Reached 5.5 hour runtime limit. Triggering a new workflow run and exiting."
            )
            import subprocess

            try:
                subprocess.run(["gh", "workflow", "run", "scrape-pending-media.yml"], check=True)
            except Exception as e:
                log.error("Failed to trigger new workflow: %s", e)
            return overall_status

        try:
            claim = claim_next_pending_media(github_run_id=github_run_id)
        except Exception:  # noqa: BLE001 - database details must stay out of logs
            log.error("Instagram notification ledger claim failed.")
            return 1

        if claim is None:
            break

        processed_count += 1
        claim_status = _process_claim(claim, cutoff_days=cutoff_days)
        if claim_status == 2:
            log.warning(
                "Infrastructure failure detected. Halting worker to prevent infinite retry loops."
            )
            overall_status = 1
            break

        overall_status = max(overall_status, claim_status)

    if processed_count:
        success_msg = f"Processed {processed_count} pending Instagram media target(s)."
        log.info(success_msg)
        if os.getenv("GITHUB_ACTIONS") == "true":
            print(f"::notice::{success_msg}", flush=True)
    else:
        success_msg = "No pending Instagram media remain."
        log.info(success_msg)
        if os.getenv("GITHUB_ACTIONS") == "true":
            print(f"::notice::{success_msg}", flush=True)

    return overall_status


if __name__ == "__main__":
    sys.exit(main())
