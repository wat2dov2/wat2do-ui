"""Single-user scrape helpers for repository_dispatch webhook runs."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from core.controlbox import controlbox
from services import school_service
from services.scraper.pipeline import parse_post_timestamp

log = logging.getLogger(__name__)

_RECENT_POST_WINDOW = timedelta(minutes=controlbox.scraping.single_user_recent_post_minutes)


class SchoolResolutionError(ValueError):
    """Raised when a single-user scrape cannot resolve its school."""


def resolve_single_user_scrape_school() -> str:
    """Resolve school from ``INTENDED_RECIPIENT_ID`` or ``TARGET_SCHOOL`` using school_service."""
    recipient_id = (os.getenv("INTENDED_RECIPIENT_ID") or "").strip()
    if recipient_id:
        school = school_service.get_school_by_recipient_id(recipient_id)
        if school is None:
            raise SchoolResolutionError(
                f"No school mapping in DB for intended_recipient_id={recipient_id!r}",
            )
        log.info(
            "Resolved school slug=%r from intended_recipient_id=%s via DB",
            school.slug,
            recipient_id,
        )
        return school.slug

    target_school = (os.getenv("TARGET_SCHOOL") or "").strip()
    if target_school:
        school = school_service.get_school(target_school)
        if school:
            log.info(
                "Resolved school slug=%r from target_school slug=%r via DB",
                school.slug,
                target_school,
            )
            return school.slug

        school = school_service.get_school_by_name(target_school)
        if school:
            log.info(
                "Resolved school slug=%r from target_school name=%r via DB",
                school.slug,
                target_school,
            )
            return school.slug

        raise SchoolResolutionError(
            f"Could not resolve school slug from target_school={target_school!r} via DB",
        )

    raise SchoolResolutionError(
        "Either INTENDED_RECIPIENT_ID or TARGET_SCHOOL is required for single-user scrapes",
    )


def is_post_url_target(target: str) -> bool:
    return target.startswith("http")


def is_numeric_id_target(target: str) -> bool:
    """Whether the target is an Instagram user id rather than a handle.

    The dispatch payload carries ``username`` when it has one and ``poster_id``
    when it does not, and the workflow falls back to the second. A handle is
    never all digits in practice, so a target that is tells us we were handed an
    id and have to look the handle up.
    """
    return target.isdigit()


def filter_valid_posts(posts: list[dict]) -> list[dict]:
    """Keep Apify items that look like real Instagram post URLs."""
    return [
        post
        for post in posts
        if not post.get("error")
        and not post.get("errorDescription")
        and post.get("url")
        and any(x in (post.get("url") or "") for x in ("/p/", "/reel/", "/tv/"))
    ]


def resolve_single_user_handle(*, target: str, posts: list[dict]) -> str:
    """Return the Instagram handle to use for pipeline grouping and DB writes.

    This value is stored as ``events.ig_handle`` and is what the published
    caption credits as ``@handle``, so a target that is not already a handle -
    a post URL, or a numeric user id from a dispatch payload without a
    ``username`` - is resolved against the scraped post's owner. Writing the id
    through verbatim is what put ``@79731783885`` in front of readers.
    """
    cleaned = target.strip().lstrip("@")
    if (is_post_url_target(cleaned) or is_numeric_id_target(cleaned)) and posts:
        owner = (posts[0].get("ownerUsername") or posts[0].get("username") or "").strip()
        if owner:
            return owner.lstrip("@")
        log.warning(
            "Could not resolve a handle for target=%r; storing it as-is",
            cleaned,
        )
    return cleaned


def fetch_posts_for_single_user(
    target: str,
    *,
    cutoff_days: int,
    scraper,
) -> tuple[list[dict], bool]:
    """Fetch the one post (or newest of several) to process for a webhook run."""
    is_post = is_post_url_target(target)

    posts, pinned_warning = scraper.scrape(
        target,
        results_limit=1,
        cutoff_days=cutoff_days,
    )

    if not is_post and posts and posts[0].get("timestamp"):
        post_dt = parse_post_timestamp(posts[0]["timestamp"])
        now = datetime.now(timezone.utc)
        if post_dt and post_dt > now - _RECENT_POST_WINDOW:
            log.info("Fetched post is recent, using it")
        else:
            log.info("Fetched post is not recent, fetching more posts to find the most recent")
            posts, pinned_warning = scraper.scrape(
                target,
                results_limit=4,
                cutoff_days=cutoff_days,
            )

    if len(posts) > 1:
        posts.sort(key=lambda item: item.get("timestamp", 0), reverse=True)
        posts = posts[:1]

    return posts, pinned_warning
