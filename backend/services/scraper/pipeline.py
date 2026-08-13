"""Scrape pipeline orchestrator.

Stages:
    1. Filter - drop posts already in the DB (skipped in dry-run).
    2. Upload - push each post's images to application storage.
    3. Extract - triage and extract events and hiring positions per post.
    4. Reconcile - Pass 2 match/update event candidates.
    5. Save - write events, occurrences, and positions.

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
from core.sanitize import normalize_scraped_text, parse_iso_datetime
from schemas.workflow_run import WorkflowRunCreate
from services import workflow_run_service
from services.scraper.dedup import _extract_shortcode, existing_shortcodes, find_candidates
from services.scraper.event_writer import _lookup_organization_by_ig, write_event
from services.scraper.extractor import extract_post_content
from services.scraper.image_uploader import upload_post_images
from services.scraper.org_resolve import resolve_organization_for_scrape
from services.scraper.position_writer import write_position
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
    positions_extracted: int = 0
    positions_saved: int = 0
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

        target_shortcodes = {_extract_shortcode(p.get("url") or "") for p in posts}
        target_shortcodes.discard(None)
        seen_shortcodes: set[str] = set() if dry_run else existing_shortcodes(target_shortcodes)
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

        post_dt = parse_iso_datetime(post.get("timestamp"))
        if post_dt is not None and post_dt < cutoff:
            continue

        fresh.append(post)
    return fresh


def _get_candidate_handles(post: dict, fallback_handle: str) -> list[str]:
    """Extract all relevant IG handles from an Apify post payload."""
    handles = []

    # 1. Target handle
    if fallback_handle:
        handles.append(fallback_handle)

    # 2. ownerUsername
    owner = post.get("ownerUsername")
    if owner and isinstance(owner, str) and owner != fallback_handle:
        handles.append(owner)

    # 3. coauthors
    coauthors = post.get("coauthors")
    if isinstance(coauthors, list):
        for c in coauthors:
            if isinstance(c, dict) and c.get("username"):
                handles.append(c["username"])
            elif isinstance(c, str):
                handles.append(c)

    # Keep unique, preserve order
    seen = set()
    result = []
    for h in handles:
        h_clean = h.strip().lstrip("@")
        if h_clean and h_clean not in seen:
            seen.add(h_clean)
            result.append(h_clean)

    return result


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

    caption = normalize_scraped_text(post.get("caption") or post.get("text")) or ""
    post_dt = parse_iso_datetime(post.get("timestamp"))

    content = extract_post_content(
        caption_text=caption,
        image_urls=uploaded,
        post_created_at=post_dt,
        school=school,
    )
    events = content.events
    positions = content.positions
    result.events_extracted += len(events)
    result.positions_extracted += len(positions)
    if not events and not positions:
        return

    source_url = post.get("url") or ""
    _attach_source_metadata(events, uploaded=uploaded, school=school)
    _attach_source_metadata(positions, uploaded=uploaded, school=school)

    if dry_run:
        for event in events:
            log.info(
                "[%s] DRY-RUN would save %r with %d occurrence(s)",
                handle,
                event.get("title"),
                len(event.get("occurrences", [])),
            )
            result.events_saved += 1
        for position in positions:
            log.info(
                "[%s] DRY-RUN would save position %r",
                handle,
                position.get("title"),
            )
            result.positions_saved += 1
        return

    candidate_handles = _get_candidate_handles(post, handle)

    target_schools = {school}
    for c in candidate_handles:
        org = _lookup_organization_by_ig(c)
        if org and isinstance(org.get("schools"), dict) and org["schools"].get("slug"):
            target_schools.add(org["schools"]["slug"])

    for target_school in target_schools:
        _process_events_for_school(
            events,
            target_school=target_school,
            source_school=school,
            candidate_handles=candidate_handles,
            caption=caption,
            source_url=source_url,
            handle=handle,
            result=result,
            allow_past_events=allow_past_events,
        )
        _process_positions_for_school(
            positions,
            target_school=target_school,
            source_school=school,
            candidate_handles=candidate_handles,
            source_url=source_url,
            handle=handle,
            result=result,
        )


def _attach_source_metadata(
    items: list[dict],
    *,
    uploaded: list[str],
    school: str,
) -> None:
    for item in items:
        try:
            index = int(item.get("image_index") or 0)
        except (TypeError, ValueError):
            index = 0
        if uploaded:
            item["source_image_url"] = uploaded[index if 0 <= index < len(uploaded) else 0]
        item["school"] = school


def _process_events_for_school(
    events: list[dict],
    *,
    target_school: str,
    source_school: str,
    candidate_handles: list[str],
    caption: str,
    source_url: str,
    handle: str,
    result: ScrapeResult,
    allow_past_events: bool,
) -> None:
    if not events:
        return

    events_copy = [{**event, "school": target_school} for event in events]
    resolved_orgs = [
        resolve_organization_for_scrape(
            ig_handle=candidate_handles,
            school=target_school,
            organization_name=(event.get("organization") or "").strip() or None,
            create_stub_if_missing=(target_school == source_school),
        )
        for event in events_copy
    ]
    candidates_by_index = [
        find_candidates(
            title=event.get("title") or "",
            location=event.get("location") or "",
            description=event.get("description") or "",
            occurrences=event.get("occurrences") or [],
            ig_handle=resolved.ig_handle,
            organization_id=resolved.organization_id,
            organization_name=resolved.organization_name
            or ((event.get("organization") or "").strip() or None),
        )
        for event, resolved in zip(events_copy, resolved_orgs, strict=True)
    ]
    reconciled = reconcile_events(
        extracted_events=events_copy,
        candidates_by_index=candidates_by_index,
        caption_text=caption,
        school=target_school,
        resolved_organization_ids=[resolved.organization_id for resolved in resolved_orgs],
        resolved_ig_handles=[resolved.ig_handle for resolved in resolved_orgs],
    )
    to_write = (
        reconciled if reconciled is not None else [{**event, "id": None} for event in events_copy]
    )
    if reconciled is None:
        log.warning(
            "[%s] Pass 2 failed for %s; falling back to insert-only Pass 1 events",
            handle,
            target_school,
        )

    for index, event in enumerate(to_write):
        event["school"] = target_school
        resolved = (
            resolved_orgs[index]
            if len(to_write) == len(resolved_orgs)
            else resolve_organization_for_scrape(
                ig_handle=candidate_handles,
                school=target_school,
                organization_name=(event.get("organization") or "").strip() or None,
                create_stub_if_missing=(target_school == source_school),
            )
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


def _process_positions_for_school(
    positions: list[dict],
    *,
    target_school: str,
    source_school: str,
    candidate_handles: list[str],
    source_url: str,
    handle: str,
    result: ScrapeResult,
) -> None:
    for original in positions:
        position = {**original, "school": target_school}
        resolved = resolve_organization_for_scrape(
            ig_handle=candidate_handles,
            school=target_school,
            organization_name=(position.get("organization") or "").strip() or None,
            create_stub_if_missing=(target_school == source_school),
        )
        outcome = write_position(
            position,
            ig_handle=handle,
            source_url=source_url,
            resolved_org=resolved,
        )
        if outcome == "inserted":
            result.positions_saved += 1


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
