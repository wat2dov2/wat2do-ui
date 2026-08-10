"""Apify Instagram scraper wrappers.

Class-based per backend-architecture.md: external-client wrappers are
the one place we deviate from function-based services. The module
exports a singleton-friendly factory (``get_scraper``) so call sites do
not re-instantiate the client and tests can swap it via monkeypatch.

Current Apify policy:
    * ``skipPinnedPosts=True`` always set on the actor input.
    * 1-hour timeout per Apify run.
    * Server-side warning when a pinned post comes back despite the flag
      (Apify occasionally violates skipPinnedPosts when ``resultsLimit==1``).
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone

from apify_client import ApifyClient
from apify_client.errors import ApifyApiError

from core.config import settings
from core.constants import (
    SCRAPING_APIFY_TIMEOUT_SECONDS,
    SCRAPING_POLL_INTERVAL_SECONDS,
)

log = logging.getLogger(__name__)

ACTOR_ID = "apify/instagram-post-scraper"
PROFILE_ACTOR_ID = "apify/instagram-profile-scraper"

_TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


class InstagramScraper:
    """Thin Apify-client wrapper for Instagram post and profile scraping."""

    def __init__(self, token: str | None = None) -> None:
        self._token = token or settings.apify_api_token
        if not self._token:
            raise RuntimeError(
                "APIFY_API_TOKEN is not set. The scraping pipeline cannot run "
                "without an Apify token. Set it in .env (local) or GitHub repo "
                "secrets (workflows)."
            )
        self._client = ApifyClient(self._token)

    def scrape(
        self,
        target: str,
        *,
        results_limit: int | None = None,
        cutoff_days: int = 1,
        timeout_seconds: int = SCRAPING_APIFY_TIMEOUT_SECONDS,
    ) -> tuple[list[dict], bool]:
        """Run the actor for ``target``; return (raw_posts, pinned_warning).

        ``target`` is an Instagram handle, @handle, or post URL.
        """
        username_list = [target]
        has_post_url = target.startswith("http")

        cutoff = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
        cutoff_str = cutoff.strftime("%Y-%m-%d")

        run_input: dict[str, object] = {
            "username": username_list,
            "skipPinnedPosts": True,
            "onlyPostsNewerThan": cutoff_str,
        }
        if results_limit:
            run_input["resultsLimit"] = results_limit

        log.info(
            "Apify scrape start: target=%s, limit=%s, cutoff=%s",
            target,
            results_limit,
            cutoff_str,
        )

        dataset_items = self._run_actor(
            ACTOR_ID,
            run_input,
            timeout_seconds=timeout_seconds,
        )

        pinned_returned = False
        if not has_post_url:
            pinned_returned = any(bool(item.get("isPinned")) for item in dataset_items)
        if results_limit == 1 and pinned_returned:
            warning = "Apify returned a pinned post while resultsLimit=1"
            log.warning(warning)
            if os.getenv("GITHUB_ACTIONS", "").lower() == "true":
                # GitHub Actions reads ``::warning::`` annotations from stdout;
                # logger output is captured separately and does not produce
                # the annotation, so we still print here.
                print(f"::warning::{warning}")

        return dataset_items, pinned_returned

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
        try:
            run = self._client.actor(actor_id).start(run_input=run_input)
        except ApifyApiError as e:
            log.error("Apify start failed: %s", e)
            return []
        except Exception as e:
            log.error("Apify actor call failed: %s", e)
            return []

        run_id = run.id
        log.info("Apify run started (run_id=%s); polling for completion", run_id)

        deadline = time.time() + timeout_seconds
        status = "RUNNING"
        completed_run = None
        try:
            while True:
                if time.time() > deadline:
                    log.error("Apify run timed out after %ds; aborting", timeout_seconds)
                    try:
                        self._client.run(run_id).abort()
                    except Exception as e:
                        log.warning("Apify abort failed for %s: %s", run_id, e)
                    return []

                completed_run = self._client.run(run_id).get()
                if completed_run:
                    status = completed_run.status or "UNKNOWN"
                if status in _TERMINAL_STATUSES:
                    break
                time.sleep(SCRAPING_POLL_INTERVAL_SECONDS)
        except Exception as e:
            log.error("Apify polling failed for %s: %s", run_id, e)
            return []

        if completed_run is None or status != "SUCCEEDED":
            log.error("Apify run %s ended with status=%s", run_id, status)
            return []

        try:
            dataset_id = completed_run.default_dataset_id
            dataset_items = list(self._client.dataset(dataset_id).list_items().items)
        except Exception as e:
            log.error("Failed to fetch Apify dataset for %s: %s", run_id, e)
            return []

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
