"""VESTIGIAL: the fixed-pipeline ingestion path, kept on purpose but unused.

The local ingestion processor now hands each source to the Haiku agent in
``services.ingestion.agent``, which reads and writes the database itself.
This module, with ``reconciler``, the candidate matching in ``dedup``,
``event_writer`` and ``position_writer``, is the earlier rigid pipeline. It is
kept as reference and as a fallback we may want again; do not delete it.

Process one captured post or directory page into events and positions.

Stages:
    1. Upload - push the source's images to application storage.
    2. Extract - triage and extract events and hiring positions with Claude.
    3. Reconcile - Pass 2 match/update event candidates.
    4. Save - write events, occurrences, and positions.

Public entry point: ``process_post``, called by the local ingestion processor
for each queued capture.
"""

from __future__ import annotations

import logging
from typing import Literal

from core.sanitize import normalize_scraped_text, parse_iso_datetime
from services.ingestion.agent import already_imported as _already_imported
from services.ingestion.agent import image_urls as _extract_image_urls
from services.ingestion.agent import is_instagram as _is_instagram
from services.ingestion.agent import video_urls as _extract_video_urls
from services.ingestion.claude_completion import claude_completion
from services.scraper.dedup import (
    collapse_duplicate_extractions,
    find_candidates,
)
from services.scraper.event_writer import _lookup_club_by_ig, write_event
from services.scraper.extractor import extract_post_content
from services.scraper.image_uploader import (
    single_post_video_url,
    upload_post_images,
    upload_video_from_url,
)
from services.scraper.org_resolve import ResolvedClub, resolve_club_for_scrape
from services.scraper.position_writer import write_position
from services.scraper.reconciler import reconcile_events

log = logging.getLogger(__name__)


def process_post(post: dict, *, school: str, publisher_ig: str | None = None) -> None:
    """Persist every verified event and position in one captured source.

    Instagram posts carry ``ownerUsername``/``coauthors``, which own the items
    and may target more schools. Official directory pages carry neither: hosts
    are matched by name at ``school``, and roles without a registered host fall
    back to the directory's publisher club ``publisher_ig``.
    """
    source_url = post["url"]
    if _already_imported(source_url):
        return
    instagram = _is_instagram(source_url)
    image_urls = _extract_image_urls(post)
    # Upload one poster at a time to retain its relationship to carousel videos
    # even when an earlier poster is rejected by storage validation.
    uploaded: list[str] = []
    source_images: list[str] = []
    for image_url in image_urls:
        stored = upload_post_images([image_url], allow_all_domains=not instagram)
        if stored:
            uploaded.extend(stored)
            source_images.append(image_url)

    caption = normalize_scraped_text(post.get("caption") or post.get("text")) or ""
    content = extract_post_content(
        caption_text=caption,
        image_urls=uploaded,
        post_created_at=parse_iso_datetime(post.get("timestamp")),
        school=school,
        complete=claude_completion,
    )
    events = content.events
    positions = content.positions
    if not events and not positions:
        return

    video_sources = _extract_video_urls(post)
    stored_videos = {
        source: upload_video_from_url(source) for source in dict.fromkeys(video_sources.values())
    }
    videos = [stored_videos.get(video_sources.get(image, "")) for image in source_images]
    # A standalone Reel can provide alternate poster URLs in `images` and
    # `displayUrl`. Its video still belongs to that poster (or caption alone).
    # A carousel must retain the exact per-slide association instead.
    fallback_video = stored_videos.get(single_post_video_url(post) or "")
    _attach_source_metadata(
        events, uploaded=uploaded, videos=videos, fallback_video=fallback_video, school=school
    )
    _attach_source_metadata(
        positions,
        uploaded=uploaded,
        videos=videos,
        fallback_video=fallback_video,
        school=school,
        preserve_existing_media=True,
    )

    handle = (post.get("ownerUsername") or "").strip().lstrip("@").lower() or None
    candidate_handles = _get_candidate_handles(post, handle or "") if instagram else []
    create_stub_if_missing = instagram and len(image_urls) <= 1

    target_schools = {school}
    for c in candidate_handles:
        org = _lookup_club_by_ig(c)
        if org and isinstance(org.get("schools"), dict) and org["schools"].get("slug"):
            target_schools.add(org["schools"]["slug"])

    for target_school in target_schools:
        _process_events_for_school(
            events,
            target_school=target_school,
            source_school=school,
            candidate_handles=candidate_handles,
            create_stub_if_missing=create_stub_if_missing,
            caption=caption,
            source_url=source_url,
            handle=handle,
            publisher_ig=publisher_ig,
        )
        _process_positions_for_school(
            positions,
            target_school=target_school,
            source_school=school,
            candidate_handles=candidate_handles,
            create_stub_if_missing=create_stub_if_missing,
            source_url=source_url,
            handle=handle,
            publisher_ig=publisher_ig,
        )


def _get_candidate_handles(post: dict, fallback_handle: str) -> list[str]:
    """Extract all relevant IG handles from a retrieved post payload."""
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
        h_clean = h.strip().lstrip("@").lower()
        if h_clean and h_clean not in seen:
            seen.add(h_clean)
            result.append(h_clean)

    # Resolve the post owner first, regardless of which coauthor triggered ingestion.
    # Remaining candidates have a stable order when the owner is not registered.
    owner_handle = owner.strip().lstrip("@").lower() if isinstance(owner, str) else ""
    return sorted(result, key=lambda candidate: (candidate != owner_handle, candidate))


def _attach_source_metadata(
    items: list[dict],
    *,
    uploaded: list[str],
    videos: list[str | None],
    fallback_video: str | None,
    school: str,
    preserve_existing_media: bool = False,
) -> None:
    for item in items:
        if preserve_existing_media and item.get("id") is not None:
            item["school"] = school
            continue
        try:
            index = int(item.get("image_index") or 0)
        except (TypeError, ValueError):
            index = 0
        if uploaded:
            selected = index if 0 <= index < len(uploaded) else 0
            item["source_image_url"] = uploaded[selected]
            item["source_video_url"] = videos[selected] or fallback_video
        elif fallback_video:
            item["source_video_url"] = fallback_video
        item["school"] = school


def _process_events_for_school(
    events: list[dict],
    *,
    target_school: str,
    source_school: str,
    candidate_handles: list[str],
    create_stub_if_missing: bool,
    caption: str,
    source_url: str,
    handle: str | None,
    publisher_ig: str | None,
) -> None:
    if not events:
        return

    events_copy = [{**event, "school": target_school} for event in events]
    if target_school != source_school:
        # Pass 1 saw only the source school's guidance. Pass 2 can classify the
        # destination independently; its failure fallback must remain unknown.
        for event in events_copy:
            event["campus_season_ids"] = None
    resolved_orgs = [
        resolve_club_for_scrape(
            ig_handle=candidate_handles,
            school=target_school,
            club_name=(event.get("club") or "").strip() or None,
            create_stub_if_missing=create_stub_if_missing and target_school == source_school,
        )
        for event in events_copy
    ]
    if publisher_ig:
        # A directory page without a named host belongs to its publishing club.
        resolved_orgs = [
            (_publisher_club(publisher_ig, target_school) or resolved)
            if resolved.club_id is None and not (event.get("club") or "").strip()
            else resolved
            for event, resolved in zip(events_copy, resolved_orgs, strict=True)
        ]
    events_copy, source_indexes, duplicate_count = collapse_duplicate_extractions(
        events_copy,
        club_ids=[resolved.club_id for resolved in resolved_orgs],
        ig_handles=[resolved.ig_handle for resolved in resolved_orgs],
    )
    if duplicate_count:
        resolved_orgs = [resolved_orgs[index] for index in source_indexes]
        log.info(
            "[%s] Collapsed %d same-post duplicate event extraction(s) for %s",
            handle,
            duplicate_count,
            target_school,
        )
    candidates_by_index = [
        find_candidates(
            title=event.get("title") or "",
            location=event.get("location") or "",
            description=event.get("description") or "",
            occurrences=event.get("occurrences") or [],
            ig_handle=resolved.ig_handle,
            club_id=resolved.club_id,
            club_name=resolved.club_name or ((event.get("club") or "").strip() or None),
        )
        for event, resolved in zip(events_copy, resolved_orgs, strict=True)
    ]
    reconciled = reconcile_events(
        extracted_events=events_copy,
        candidates_by_index=candidates_by_index,
        caption_text=caption,
        school=target_school,
        complete=claude_completion,
        resolved_club_ids=[resolved.club_id for resolved in resolved_orgs],
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
            else resolve_club_for_scrape(
                ig_handle=candidate_handles,
                school=target_school,
                club_name=(event.get("club") or "").strip() or None,
                create_stub_if_missing=create_stub_if_missing and target_school == source_school,
            )
        )
        write_event(
            event,
            ig_handle=handle,
            source_url=source_url,
            resolved_org=resolved,
            ingestion_source=_ingestion_source(source_url),
        )


def _process_positions_for_school(
    positions: list[dict],
    *,
    target_school: str,
    source_school: str,
    candidate_handles: list[str],
    create_stub_if_missing: bool,
    source_url: str,
    handle: str | None,
    publisher_ig: str | None,
) -> None:
    for original in positions:
        # A reviewed ID is one existing row at the notification's source school.
        # Cross-school coauthors may receive new roles, never copies of that ID.
        if original.get("id") is not None and target_school != source_school:
            continue
        position = {**original, "school": target_school}
        resolved = resolve_club_for_scrape(
            ig_handle=candidate_handles,
            school=target_school,
            club_name=(position.get("club") or "").strip() or None,
            create_stub_if_missing=(
                create_stub_if_missing
                and target_school == source_school
                and original.get("id") is None
            ),
        )
        if resolved.club_id is None and publisher_ig:
            resolved = _publisher_club(publisher_ig, target_school) or resolved
        write_position(
            position,
            ig_handle=handle or resolved.ig_handle or "",
            source_url=source_url,
            resolved_org=resolved,
            ingestion_source=_ingestion_source(source_url),
        )


def _publisher_club(publisher_ig: str, school: str) -> ResolvedClub | None:
    resolved = resolve_club_for_scrape(
        ig_handle=publisher_ig, school=school, club_name=None, create_stub_if_missing=False
    )
    return resolved if resolved.club_id is not None else None


def _ingestion_source(source_url: str) -> Literal["instagram_scraper", "directory"]:
    return "instagram_scraper" if _is_instagram(source_url) else "directory"
