"""Instagram retrieval: public embeds for exact posts, Apify for manual lookups.

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
from typing import Literal

import httpx
from apify_client import ApifyClient
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from core.config import settings
from core.constants import (
    SCRAPING_APIFY_TIMEOUT_SECONDS,
    SCRAPING_POLL_INTERVAL_SECONDS,
)
from core.controlbox import controlbox
from services.scraper.instagram_embed import InstagramEmbedError, extract_post
from services.scraper.single_user import is_exact_post_url_target

log = logging.getLogger(__name__)

ACTOR_ID = "apify/instagram-post-scraper"
PROFILE_ACTOR_ID = "apify/instagram-profile-scraper"

_TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}
_CONTROL = controlbox.scraping


def _transient_http_error(error: BaseException) -> bool:
    return isinstance(error, httpx.TransportError) or (
        isinstance(error, httpx.HTTPStatusError) and error.response.status_code >= 500
    )


class InstagramScraperError(RuntimeError):
    """A categorized provider failure safe to expose in workflow output."""

    def __init__(
        self,
        stage: Literal["start", "poll", "terminal", "dataset", "input", "http", "content"],
        *,
        detail: str | None = None,
    ):
        message = f"Instagram scraper provider {stage} failure"
        super().__init__(f"{message}: {detail}" if detail else message)
        self.stage = stage


class InstagramScraper:
    """Fetch exact posts without credentials; retain separate manual lookup tools."""

    def scrape_posts(self, targets: list[str]) -> list[dict]:
        if not targets or not all(is_exact_post_url_target(target) for target in targets):
            raise InstagramScraperError("input")
        posts = []
        with httpx.Client(timeout=_CONTROL.embed_timeout_seconds, follow_redirects=False) as client:
            for target in dict.fromkeys(targets):
                try:
                    response = self._fetch_embed(client, target)
                    posts.append(extract_post(response, target))
                except httpx.HTTPError:
                    raise InstagramScraperError("http") from None
                except InstagramEmbedError as exc:
                    raise InstagramScraperError("content", detail=f"{target}: {exc}") from None
                except (
                    ValueError,
                    TypeError,
                    KeyError,
                    IndexError,
                    AttributeError,
                    OverflowError,
                ) as exc:
                    # Unanticipated library errors can contain response data; report only the type.
                    raise InstagramScraperError(
                        "content",
                        detail=f"{target}: Unexpected embed structure ({type(exc).__name__})",
                    ) from None
        return posts

    @staticmethod
    @retry(
        retry=retry_if_exception(_transient_http_error),
        stop=stop_after_attempt(_CONTROL.embed_maximum_attempts),
        wait=wait_exponential_jitter(
            initial=_CONTROL.embed_retry_wait_seconds,
            max=_CONTROL.embed_retry_maximum_wait_seconds,
        ),
        reraise=True,
    )
    def _fetch_embed(client: httpx.Client, target: str) -> str:
        response = client.get(f"{target.rstrip('/')}/embed/captioned/")
        response.raise_for_status()
        return response.text

    def scrape_latest(
        self,
        target: str | list[str],
        *,
        results_limit: int | None = None,
        cutoff_days: int = 1,
        timeout_seconds: int = SCRAPING_APIFY_TIMEOUT_SECONDS,
    ) -> tuple[list[dict], bool]:
        """Manual username lookup only; exact posts use ``scrape_posts``."""
        username_list = [target] if isinstance(target, str) else target
        if any(t.startswith("http") for t in username_list):
            raise InstagramScraperError("input")

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
        if not settings.apify_api_token:
            raise InstagramScraperError("start")
        client = ApifyClient(settings.apify_api_token)

        @retry(
            stop=stop_after_attempt(5),
            wait=wait_exponential_jitter(initial=1, max=10, jitter=2),
            reraise=True,
        )
        def _start_actor_with_retry() -> object:
            return client.actor(actor_id).start(run_input=run_input)

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
            raise InstagramScraperError("poll") from None

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
