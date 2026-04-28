"""Scrape pipeline orchestrator.

Stages (matches v1 ``event_processor.py`` flow):
    1. Filter — drop posts already in the DB (skipped in dry-run).
    2. Upload — push each post's images to Supabase Storage.
    3. Extract — run vision-based extraction per post.
    4. Save — insert one events row per occurrence (multi-occurrence events
       become multiple rows; single-image multi-event posts stay as
       multiple rows too — v2's flat schema means consolidation is a
       no-op here).

Public entry point: ``run_pipeline``. Used by both single-user (one
handle) and big-scrape (many handles, chunked) modes — chunking lives
in ``backend/jobs/scrape.py``, not here, so the pipeline stays oblivious
to which mode it's serving.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from core.constants import (
    SCRAPE_RUN_ERROR,
    SCRAPE_RUN_NO_POSTS,
    SCRAPE_RUN_SUCCESS,
)
from schemas.scrape_run import ScrapeRunCreate
from services import scrape_run_service
from services.wat2do.dedup import _extract_shortcode, existing_shortcodes
from services.wat2do.event_writer import write_event
from services.wat2do.extractor import extract_events_from_post
from services.wat2do.image_uploader import upload_post_images

# ``instagram_scraper`` pulls in ``apify_client``, which is heavy and
# unnecessary for the deterministic helpers below.  Tests that exercise
# only those helpers should not pay the import cost — get_scraper is
# imported lazily inside run_pipeline.

log = logging.getLogger(__name__)


@dataclass
class HandleResult:
    """Per-handle pipeline result. Aggregated by the caller for summary logs."""
    ig_handle: str
    posts_fetched: int = 0
    posts_new: int = 0
    events_extracted: int = 0
    events_saved: int = 0
    events_updated: int = 0
    events_duplicates: int = 0
    pinned_post_warning: bool = False
    status: str = SCRAPE_RUN_SUCCESS
    error_message: str | None = None
    scrape_run_id: str | None = None


@dataclass
class PipelineResult:
    """Aggregate result across all handles in one run."""
    handles: list[HandleResult] = field(default_factory=list)
    dry_run: bool = False

    @property
    def total_inserted(self) -> int:
        return sum(h.events_saved for h in self.handles)

    @property
    def total_extracted(self) -> int:
        return sum(h.events_extracted for h in self.handles)

    @property
    def total_posts(self) -> int:
        return sum(h.posts_fetched for h in self.handles)


def run_pipeline(
    *,
    usernames: list[str],
    school: str,
    cutoff_days: int,
    results_limit: int | None = None,
    dry_run: bool = False,
    github_run_id: str | None = None,
) -> PipelineResult:
    """Run the four-stage pipeline against ``usernames`` for ``school``.

    Args:
        usernames: Instagram handles to scrape (no leading @).
        school: full canonical school name (used for prompt context).
        cutoff_days: drop posts older than this many days.
        results_limit: max posts per handle (None = Apify default).
        dry_run: when True, skip ScrapeRun row creation, skip the
            seen-shortcodes filter, skip DB inserts. Image uploads
            and OpenAI calls still run so the workflow exercises the
            same network paths.
        github_run_id: optional GitHub Actions run id for ScrapeRun
            tracking. Has no effect in dry-run.

    Returns the aggregate ``PipelineResult``.
    """
    if not usernames:
        return PipelineResult(handles=[], dry_run=dry_run)

    from services.wat2do.instagram_scraper import get_scraper
    scraper = get_scraper()

    seen_shortcodes: set[str] = set() if dry_run else existing_shortcodes()
    log.info(
        "Pipeline start: %d username(s), school=%s, cutoff_days=%d, dry_run=%s",
        len(usernames), school, cutoff_days, dry_run,
    )

    posts, pinned_warning = scraper.scrape(
        usernames,
        results_limit=results_limit,
        cutoff_days=cutoff_days,
    )
    log.info("Apify returned %d total post(s) for %d handle(s)", len(posts), len(usernames))

    grouped = _group_by_handle(posts, usernames)

    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
    handle_results: list[HandleResult] = []

    for handle in usernames:
        result = HandleResult(ig_handle=handle, pinned_post_warning=pinned_warning)
        if not dry_run:
            run = scrape_run_service.create_scrape_run(
                ScrapeRunCreate(ig_username=handle, github_run_id=github_run_id),
            )
            result.scrape_run_id = run.id

        try:
            handle_posts = grouped.get(handle, [])
            result.posts_fetched = len(handle_posts)
            if not handle_posts:
                result.status = SCRAPE_RUN_NO_POSTS
                handle_results.append(result)
                _finalize(result, dry_run=dry_run)
                continue

            new_posts = _filter_new_posts(
                handle_posts, seen_shortcodes=seen_shortcodes, cutoff=cutoff_dt,
            )
            result.posts_new = len(new_posts)

            for post in new_posts:
                _process_one_post(post, handle=handle, school=school, result=result, dry_run=dry_run)

            handle_results.append(result)
            _finalize(result, dry_run=dry_run)
        except Exception as e:
            log.exception("Pipeline failed for handle=%s: %s", handle, e)
            result.status = SCRAPE_RUN_ERROR
            result.error_message = str(e)[:4000]
            handle_results.append(result)
            _finalize(result, dry_run=dry_run)

    return PipelineResult(handles=handle_results, dry_run=dry_run)


def _group_by_handle(posts: list[dict], usernames: list[str]) -> dict[str, list[dict]]:
    """Bucket Apify results by their ``ownerUsername`` (or ``username``) field.

    Instagram handles are case-insensitive — Apify sometimes returns
    ``ownerUsername`` in different casing than the requested handle (we
    ask for ``uwteaclub``, get back ``UWTeaClub``). A case-sensitive
    bucket would silently drop those posts and report ``posts_fetched=0``,
    making active accounts look dormant. Match casefold-on-both-sides.
    """
    lookup = {h.lower(): h for h in usernames}
    by_handle: dict[str, list[dict]] = {h: [] for h in usernames}
    for post in posts:
        owner = (post.get("ownerUsername") or post.get("username") or "").lower()
        canonical = lookup.get(owner)
        if canonical is not None:
            by_handle[canonical].append(post)
    return by_handle


def _filter_new_posts(
    posts: list[dict],
    *,
    seen_shortcodes: set[str],
    cutoff: datetime,
) -> list[dict]:
    """Drop already-seen shortcodes and posts older than ``cutoff``.

    Uses ``dedup._extract_shortcode`` for both the seen-set lookup and
    the URL-shape check so a URL with a query string or fragment
    canonicalises the same way it does in the DB-backed seen set.
    """
    fresh: list[dict] = []
    for post in posts:
        url = post.get("url") or ""
        shortcode = _extract_shortcode(url)
        if shortcode is None:
            # Profile link, story URL, or unrecognised path — skip.
            continue
        if shortcode in seen_shortcodes:
            continue

        timestamp = post.get("timestamp")
        post_dt = _parse_post_timestamp(timestamp)
        if post_dt is not None and post_dt < cutoff:
            continue

        fresh.append(post)
    return fresh


def _process_one_post(
    post: dict,
    *,
    handle: str,
    school: str,
    result: HandleResult,
    dry_run: bool,
) -> None:
    image_urls = _extract_image_urls(post)
    uploaded = upload_post_images(image_urls)

    caption = post.get("caption") or post.get("text") or ""
    post_dt = _parse_post_timestamp(post.get("timestamp"))

    events = extract_events_from_post(
        caption_text=caption,
        image_urls=uploaded,
        post_created_at=post_dt,
        school=school,
    )
    result.events_extracted += len(events)
    if not events:
        return

    source_url = post.get("url") or ""

    for event in events:
        # Pick the source image based on the extractor's image_index, with
        # bounds-fallback to the first uploaded image (mirrors v1). The
        # model occasionally returns a non-int (e.g. the string ``"first"``);
        # ``int()`` with TypeError fallback keeps the pipeline alive.
        try:
            idx = int(event.get("image_index") or 0)
        except (TypeError, ValueError):
            idx = 0
        if uploaded:
            event["source_image_url"] = uploaded[idx if 0 <= idx < len(uploaded) else 0]

        if dry_run:
            log.info(
                "[%s] DRY-RUN would save %r with %d occurrence(s)",
                handle, event.get("title"), len(event.get("occurrences", [])),
            )
            result.events_saved += 1
            continue

        outcome = write_event(event, ig_handle=handle, source_url=source_url)
        if outcome == "inserted":
            result.events_saved += 1
        elif outcome == "updated":
            result.events_updated += 1
            result.events_saved += 1
        elif outcome == "duplicate":
            result.events_duplicates += 1


def _finalize(result: HandleResult, *, dry_run: bool) -> None:
    if dry_run or not result.scrape_run_id:
        return
    scrape_run_service.mark_finished(
        result.scrape_run_id,
        status=result.status,
        posts_fetched=result.posts_fetched,
        posts_new=result.posts_new,
        events_extracted=result.events_extracted,
        events_saved=result.events_saved,
        pinned_post_warning=result.pinned_post_warning,
        error_message=result.error_message,
    )


def _extract_image_urls(post: dict) -> list[str]:
    """Pull image URLs from an Apify Instagram-post-scraper item.

    Apify's actor returns slightly different shapes for single-image vs.
    carousel posts. We accept the union and fall back to ``displayUrl``
    so single-image posts still produce one URL.
    """
    images: list[str] = []

    images_field = post.get("images")
    if isinstance(images_field, list):
        for entry in images_field:
            url = (entry.get("url") if isinstance(entry, dict) else entry) or ""
            if url:
                images.append(url)

    if not images:
        children = post.get("childPosts")
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    url = child.get("displayUrl") or ""
                    if url:
                        images.append(url)

    if not images:
        single = post.get("displayUrl")
        if single:
            images.append(single)

    return images


def _parse_post_timestamp(value: object) -> datetime | None:
    """Apify timestamps come as ISO 8601 strings (sometimes with trailing Z)."""
    if not isinstance(value, str) or not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00") if value.endswith("Z") else value
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
