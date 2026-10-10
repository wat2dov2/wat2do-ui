"""Apify retrieval of exact posts and profiles for operator repair scripts.

Class-based per backend-architecture.md: external-client wrappers are
the one place we deviate from function-based services. The module
exports a singleton-friendly factory (``get_scraper``) so call sites do
not re-instantiate the client and tests can swap it via monkeypatch.
Each Apify run has a one-hour timeout.
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from typing import Literal

from apify_client import ApifyClient
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from core.config import settings
from core.constants import (
    SCRAPING_APIFY_TIMEOUT_SECONDS,
    SCRAPING_POLL_INTERVAL_SECONDS,
)
from core.controlbox import controlbox
from services.scraper.single_user import is_exact_post_url_target

log = logging.getLogger(__name__)

ACTOR_ID = "apify/instagram-post-scraper"
PROFILE_ACTOR_ID = "apify/instagram-profile-scraper"

_TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


class InstagramScraperError(RuntimeError):
    """A categorized provider failure safe to expose in workflow output."""

    def __init__(self, stage: Literal["start", "poll", "terminal", "dataset", "input"]):
        super().__init__(f"Instagram scraper provider {stage} failure")
        self.stage = stage


class InstagramScraper:
    """Fetch exact posts and profiles through the shared Apify client."""

    def scrape_posts(self, targets: list[str]) -> list[dict]:
        if not targets or not all(is_exact_post_url_target(target) for target in targets):
            raise InstagramScraperError("input")
        return self._run_actor(
            ACTOR_ID,
            {"username": list(dict.fromkeys(targets))},
            timeout_seconds=SCRAPING_APIFY_TIMEOUT_SECONDS,
        )

    def scrape_profiles(
        self,
        identifiers: list[str],
        *,
        timeout_seconds: int = SCRAPING_APIFY_TIMEOUT_SECONDS,
    ) -> list[dict]:
        """Return profile records for Instagram usernames, URLs, or ids."""
        targets = [identifier.strip() for identifier in identifiers if identifier.strip()]
        if not targets:
            return []
        log.info("Apify profile scrape start: targets=%d", len(targets))
        return self._run_actor(
            PROFILE_ACTOR_ID,
            {"usernames": targets},
            timeout_seconds=timeout_seconds,
        )

    def _run_actor(
        self,
        actor_id: str,
        run_input: dict[str, object],
        *,
        timeout_seconds: int,
    ) -> list[dict]:
        """Run one Apify actor and return its complete default dataset."""
        if not settings.apify_api_token:
            raise InstagramScraperError("start")
        client = ApifyClient(settings.apify_api_token)

        @retry(
            stop=stop_after_attempt(5),
            wait=wait_exponential_jitter(initial=1, max=10, jitter=2),
            reraise=True,
        )
        def _start_actor_with_retry() -> object:
            return client.actor(actor_id).start(
                run_input=run_input,
                memory_mbytes=controlbox.scraping.apify_memory_megabytes,
                run_timeout=timedelta(seconds=timeout_seconds),
            )

        try:
            run = _start_actor_with_retry()
        except Exception:
            log.error("Apify actor start failed after retries")
            raise InstagramScraperError("start") from None

        run_id = getattr(run, "id", None)
        if not run_id:
            log.error("Apify actor start did not return a run identifier")
            raise InstagramScraperError("start")
        log.info("Apify run started (run_id=%s); polling for completion", run_id)

        deadline = time.time() + timeout_seconds
        status = "RUNNING"
        completed_run = None
        try:
            while True:
                if time.time() > deadline:
                    log.error("Apify run timed out after %ds; aborting", timeout_seconds)
                    try:
                        client.run(run_id).abort()
                    except Exception:
                        log.warning("Apify run abort failed")
                    raise InstagramScraperError("poll") from None

                completed_run = client.run(run_id).get()
                if completed_run:
                    status = completed_run.status or "UNKNOWN"
                if status in _TERMINAL_STATUSES:
                    break
                time.sleep(SCRAPING_POLL_INTERVAL_SECONDS)
        except InstagramScraperError:
            raise
        except Exception:
            log.error("Apify run polling failed")
            try:
                client.run(run_id).abort()
            except Exception:
                log.warning("Apify run abort failed")
            raise InstagramScraperError("poll") from None
        except BaseException:
            try:
                client.run(run_id).abort()
            except Exception:
                log.warning("Apify run abort failed")
            raise

        if completed_run is None or status != "SUCCEEDED":
            log.error("Apify run %s ended with status=%s", run_id, status)
            raise InstagramScraperError("terminal")

        dataset_id = getattr(completed_run, "default_dataset_id", None)
        if not dataset_id:
            log.error("Apify run did not return a dataset identifier")
            raise InstagramScraperError("dataset")
        try:
            dataset_items = list(client.dataset(dataset_id).list_items().items)
        except Exception:
            log.error("Failed to fetch Apify dataset")
            raise InstagramScraperError("dataset") from None

        log.info("Apify run %s returned %d items", run_id, len(dataset_items))
        return dataset_items


_scraper: InstagramScraper | None = None


def get_scraper() -> InstagramScraper:
    """Return a process-wide ``InstagramScraper`` singleton.

    Tests can swap the singleton via ``monkeypatch.setattr(
        "services.scraper.instagram_scraper._scraper", fake)``.
    """
    global _scraper
    if _scraper is None:
        _scraper = InstagramScraper()
    return _scraper
