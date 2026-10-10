"""Targeted repair of stored posters and missing scraped videos without extraction."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from urllib.parse import urlsplit

from PIL import Image

from core.constants import BUCKET_EVENT_IMAGES, BUCKET_EVENT_VIDEOS
from core.controlbox import controlbox
from core.database import get_sb
from core.exceptions import NotFoundError, ValidationError
from core.tables import EVENTS, POSITIONS
from services import school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.scraper.image_uploader import (
    is_carousel_post,
    single_post_video_url,
    upload_image_from_url,
    upload_video_from_url,
)
from services.scraper.single_user import exact_post_results_match_targets, is_exact_post_url_target
from services.storage_service import storage

MediaResource = Literal["events", "positions"]


@dataclass(frozen=True)
class MediaRepairTarget:
    resource: MediaResource
    id: int
    school: str
    source_url: str | None
    source_image_url: str | None
    source_video_url: str | None


def load_media_target(resource: MediaResource, item_id: int) -> MediaRepairTarget:
    if resource not in {EVENTS, POSITIONS} or item_id < 1:
        raise ValidationError("Select one valid event or position ID")
    rows = (
        get_sb()
        .table(resource)
        .select(
            f"id,source_url,source_image_url,source_video_url,{school_service.SCHOOL_SLUG_EMBED}"
        )
        .eq("id", item_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise NotFoundError("Media repair target was not found")
    row = school_service.with_school_slug(rows[0])
    return MediaRepairTarget(
        resource=resource,
        id=row["id"],
        school=row["school"],
        source_url=row.get("source_url"),
        source_image_url=row.get("source_image_url"),
        source_video_url=row.get("source_video_url"),
    )


def _report(target: MediaRepairTarget, kind: str, status: str) -> dict:
    return {
        "resource": target.resource,
        "id": target.id,
        "school": target.school,
        "kind": kind,
        "status": status,
        "source_post_url": target.source_url,
    }


def repair_stored_image(target: MediaRepairTarget, *, apply: bool = False) -> dict:
    """Replace one oversized owned poster at a new immutable URL, never in place."""
    report = _report(target, "image", "unavailable")
    original_url = target.source_image_url
    path = storage.path_from_url(original_url or "", BUCKET_EVENT_IMAGES)
    if path is None:
        report["reason"] = "Target has no image in the configured event-image storage"
        return report
    original, content_type = storage.download_file(BUCKET_EVENT_IMAGES, path)
    with Image.open(BytesIO(original)) as image:
        report.update(width=image.width, height=image.height, original_bytes=len(original))
        if getattr(image, "is_animated", False):
            report.update(status="unsupported", reason="Animated posters retain their frames")
            return report
        if image.width <= controlbox.uploads.event_image_rendition_width_pixels:
            report["status"] = "already_sized"
            return report
    prepared, prepared_type = storage.validate_and_prepare(
        BUCKET_EVENT_IMAGES, original, content_type
    )
    with Image.open(BytesIO(prepared)) as image:
        report.update(new_width=image.width, new_height=image.height, new_bytes=len(prepared))
    report.update(status="ready", previous_image_url=original_url)
    if not apply:
        return report
    url = storage.upload_file(BUCKET_EVENT_IMAGES, prepared, prepared_type)
    return _save_asset(target, report, "source_image_url", url, BUCKET_EVENT_IMAGES)


def repair_instagram_image(
    target: MediaRepairTarget, post: dict | None = None, *, apply: bool = False
) -> dict:
    """Restore a missing poster from its exact source post's cover artwork."""
    report = _report(target, "instagram-image", "needs_source")
    if target.source_image_url:
        report["status"] = "already_present"
        return report
    if not target.source_url or not is_exact_post_url_target(target.source_url):
        report.update(status="unavailable", reason="Target has no exact Instagram source post")
        return report
    if post is None:
        return report
    if not exact_post_results_match_targets([target.source_url], [post]):
        raise ValidationError("Provider result does not match the target's exact Instagram post")
    image_url = post.get("displayUrl")
    if not isinstance(image_url, str) or not image_url:
        report.update(status="unavailable", reason="Source post has no cover artwork")
        return report
    report.update(status="ready", provider_post_url=post["url"])
    if not apply:
        return report
    url = upload_image_from_url(image_url, bucket=BUCKET_EVENT_IMAGES)
    if not url:
        report.update(status="failed", reason="Poster could not be downloaded and validated")
        return report
    return _save_asset(target, report, "source_image_url", url, BUCKET_EVENT_IMAGES)


def repair_stored_video(
    target: MediaRepairTarget, post: dict | None = None, *, apply: bool = False
) -> dict:
    """Restore a standalone video's exact source association; never guess a carousel slide."""
    report = _report(target, "video", "needs_source")
    if target.source_video_url:
        report.update(status="already_present", source_video_url=target.source_video_url)
        return report
    if not target.source_url or not is_exact_post_url_target(target.source_url):
        report.update(status="unavailable", reason="Target has no exact Instagram source post")
        return report
    if post is None:
        report["reason"] = "Provide exact-post provider JSON or explicitly fetch that one post"
        return report
    if not exact_post_results_match_targets([target.source_url], [post]):
        raise ValidationError("Provider result does not match the target's exact Instagram post")
    video_url = single_post_video_url(post)
    if not video_url:
        report.update(
            status="unsupported",
            reason="Carousel slide association is unknown"
            if is_carousel_post(post)
            else "Post has no downloadable video",
        )
        return report
    try:
        source_host = urlsplit(video_url).hostname
    except ValueError:
        source_host = None
    # Report public provenance, never the provider's signed CDN query string.
    report.update(status="ready", provider_post_url=post["url"], source_video_host=source_host)
    if not apply:
        return report
    url = upload_video_from_url(video_url)
    if not url:
        report.update(status="failed", reason="Video could not be downloaded and validated")
        return report
    return _save_asset(target, report, "source_video_url", url, BUCKET_EVENT_VIDEOS)


def _save_asset(target: MediaRepairTarget, report: dict, field: str, url: str, bucket: str) -> dict:
    query = get_sb().table(target.resource).update({field: url}).eq("id", target.id)
    if field == "source_video_url":
        query = query.is_(field, "null").eq("source_url", target.source_url)
    elif target.source_image_url is None:
        query = query.is_(field, "null").eq("source_url", target.source_url)
    else:
        query = query.eq(field, target.source_image_url)
    # A lost response may follow a committed update. Preserve the new asset on
    # exceptions so the operator can inspect it without breaking a saved URL.
    rows = query.execute().data or []
    if not rows:
        path = storage.path_from_url(url, bucket)
        if path:
            storage.delete_file(bucket, path)
        report.update(status="conflict", reason="Target changed before the repair was saved")
        return report
    event_feed_revalidation_service.revalidate_school(target.school, resources=(target.resource,))
    report.update(status="updated", **{field: url})
    return report
