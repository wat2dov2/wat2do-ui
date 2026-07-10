"""Scrape pipeline orchestrator.

Stages:
    1. Filter - drop posts already in the DB (skipped in dry-run).
    2. Upload - push each post's images to Supabase Storage.
    3. Extract - run vision-based extraction per post.
    4. Reconcile - Pass 2 match/update against existing candidates.
    5. Save - insert or update events and their event_dates rows.

Public entry point: ``run_pipeline``. ``backend/jobs/scrape.py`` prefetches
posts via Apify, then hands them here for processing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from core.constants import (
    WORKFLOW_RUN_ERROR,
    WORKFLOW_RUN_NO_POSTS,
    WORKFLOW_RUN_SUCCESS,
)
from schemas.workflow_run import WorkflowRunCreate
from services import workflow_run_service
from services.scraper.dedup import _extract_shortcode, existing_shortcodes, find_candidates
from services.scraper.event_writer import write_event
from services.scraper.extractor import extract_events_from_post
from services.scraper.image_uploader import upload_post_images
from services.scraper.org_resolve import resolve_organization_for_scrape
from services.scraper.reconciler import reconcile_events

log = logging.getLogger(__name__)


@dataclass
class ScrapeResult:
    """Outcome of processing one handle's prefetched posts."""

    ig_handle: str
    posts_fetched: int = 0
    posts_new: int = 0
    events_extracted: int = 0
    events_saved: int = 0
    events_updated: int = 0
    events_duplicates: int = 0
    pinned_post_warning: bool = False
    status: str = WORKFLOW_RUN_SUCCESS
    error_message: str | None = None
    workflow_run_id: str | None = None
    dry_run: bool = False


def run_pipeline(
    *,
    ig_handle: str,
    school: str,
    posts: list[dict],
    cutoff_days: int,
    pinned_post_warning: bool = False,
    dry_run: bool = False,
    github_run_id: str | None = None,
    allow_past_events: bool = False,
) -> ScrapeResult:
    """Process prefetched Apify posts for one Instagram handle."""
    result = ScrapeResult(
        ig_handle=ig_handle,
        pinned_post_warning=pinned_post_warning,
        dry_run=dry_run,
    )

    log.info(
        "Pipeline start: handle=%s, school=%s, cutoff_days=%d, dry_run=%s, posts=%d",
        ig_handle,
        school,
        cutoff_days,
        dry_run,
        len(posts),
    )

    if not dry_run:
        run = workflow_run_service.create_workflow_run(
            WorkflowRunCreate(ig_username=ig_handle, github_run_id=github_run_id),
        )
        result.workflow_run_id = run.id

    try:
        result.posts_fetched = len(posts)
        if not posts:
            result.status = WORKFLOW_RUN_NO_POSTS
            _finalize(result)
            return result

        seen_shortcodes: set[str] = set() if dry_run else existing_shortcodes()
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
        new_posts = _filter_new_posts(
            posts,
            seen_shortcodes=seen_shortcodes,
            cutoff=cutoff_dt,
        )
        result.posts_new = len(new_posts)

        for post in new_posts:
            _process_one_post(
                post,
                handle=ig_handle,
                school=school,
                result=result,
                dry_run=dry_run,
                allow_past_events=allow_past_events,
            )

        _finalize(result)
    except Exception as exc:
        log.exception("Pipeline failed for handle=%s: %s", ig_handle, exc)
        result.status = WORKFLOW_RUN_ERROR
        result.error_message = str(exc)[:4000]
        _finalize(result)

    return result


def _filter_new_posts(
    posts: list[dict],
    *,
    seen_shortcodes: set[str],
    cutoff: datetime,
) -> list[dict]:
    """Drop already-seen shortcodes and posts older than ``cutoff``."""
    fresh: list[dict] = []
    for post in posts:
        url = post.get("url") or ""
        shortcode = _extract_shortcode(url)
        if shortcode is None:
            continue
        if shortcode in seen_shortcodes:
            continue

        post_dt = parse_post_timestamp(post.get("timestamp"))
        if post_dt is not None and post_dt < cutoff:
            continue

        fresh.append(post)
    return fresh


def _process_one_post(
    post: dict,
    *,
    handle: str,
    school: str,
    result: ScrapeResult,
    dry_run: bool,
    allow_past_events: bool = False,
) -> None:
    image_urls = _extract_image_urls(post)
    uploaded = upload_post_images(image_urls)

    caption = post.get("caption") or post.get("text") or ""
    post_dt = parse_post_timestamp(post.get("timestamp"))

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
        try:
            idx = int(event.get("image_index") or 0)
        except (TypeError, ValueError):
            idx = 0
        if uploaded:
            event["source_image_url"] = uploaded[idx if 0 <= idx < len(uploaded) else 0]
        event["school"] = school

    if dry_run:
        for event in events:
            log.info(
                "[%s] DRY-RUN would save %r with %d occurrence(s)",
                handle,
                event.get("title"),
                len(event.get("occurrences", [])),
            )
            result.events_saved += 1
        return

    resolved_orgs = [
        resolve_organization_for_scrape(
            ig_handle=handle,
            school=school,
            organization_name=(event.get("organization") or "").strip() or None,
            create_stub_if_missing=True,
        )
        for event in events
    ]
    candidates_by_index = [
        find_candidates(
            title=event.get("title") or "",
            location=event.get("location") or "",
            description=event.get("description") or "",
            occurrences=event.get("occurrences") or [],
            ig_handle=resolved.ig_handle or handle,
            organization_id=resolved.organization_id,
            organization_name=resolved.organization_name
            or ((event.get("organization") or "").strip() or None),
        )
        for event, resolved in zip(events, resolved_orgs, strict=True)
    ]
    reconciled = reconcile_events(
        extracted_events=events,
        candidates_by_index=candidates_by_index,
        caption_text=caption,
        school=school,
        resolved_organization_ids=[r.organization_id for r in resolved_orgs],
        resolved_ig_handles=[r.ig_handle or handle for r in resolved_orgs],
    )
    # Pass 2 failure → insert-only Pass 1 events (strip any accidental ids).
    to_write = reconciled if reconciled is not None else [{**e, "id": None} for e in events]
    if reconciled is None:
        log.warning("[%s] Pass 2 failed; falling back to insert-only Pass 1 events", handle)

    for i, event in enumerate(to_write):
        if len(to_write) == len(resolved_orgs):
            resolved = resolved_orgs[i]
        else:
            resolved = resolve_organization_for_scrape(
                ig_handle=handle,
                school=school,
                organization_name=(event.get("organization") or "").strip() or None,
                create_stub_if_missing=True,
            )
        outcome = write_event(
            event,
            ig_handle=handle,
            source_url=source_url,
            allow_past_events=allow_past_events,
            resolved_org=resolved,
        )
        if outcome == "inserted":
            result.events_saved += 1
        elif outcome == "updated":
            result.events_updated += 1
            result.events_saved += 1


def _finalize(result: ScrapeResult) -> None:
    if result.dry_run or not result.workflow_run_id:
        return
    workflow_run_service.mark_finished(
        result.workflow_run_id,
        status=result.status,
        posts_fetched=result.posts_fetched,
        posts_new=result.posts_new,
        events_extracted=result.events_extracted,
        events_saved=result.events_saved,
        pinned_post_warning=result.pinned_post_warning,
        error_message=result.error_message,
    )


def _extract_image_urls(post: dict) -> list[str]:
    """Pull image URLs from an Apify Instagram-post-scraper item."""
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


def parse_post_timestamp(value: object) -> datetime | None:
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
