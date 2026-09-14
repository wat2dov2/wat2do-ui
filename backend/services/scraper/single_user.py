"""Single-user scrape helpers for repository_dispatch webhook runs."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from core.controlbox import controlbox
from core.sanitize import parse_iso_datetime
from services import school_service
from services.scraper.dedup import _extract_shortcode

log = logging.getLogger(__name__)

_RECENT_POST_WINDOW = timedelta(minutes=controlbox.scraping.single_user_recent_post_minutes)
_INSTAGRAM_POST_HOSTS = {"instagram.com", "www.instagram.com"}
_INSTAGRAM_POST_PATH_PREFIXES = {"p", "reel", "tv"}


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

        raise SchoolResolutionError(
            f"Could not resolve school slug from target_school={target_school!r} via DB",
        )

    raise SchoolResolutionError(
        "Either INTENDED_RECIPIENT_ID or TARGET_SCHOOL is required for single-user scrapes",
    )


def is_exact_post_url_target(target: str) -> bool:
    """Return whether a target identifies one exact Instagram post."""
    try:
        parsed = urlsplit(target)
        path_parts = [part for part in parsed.path.split("/") if part]
        return (
            parsed.scheme == "https"
            and parsed.hostname in _INSTAGRAM_POST_HOSTS
            and parsed.port is None
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and len(path_parts) == 2
            and path_parts[0] in _INSTAGRAM_POST_PATH_PREFIXES
            and _extract_shortcode(target) == path_parts[1]
        )
    except ValueError:
        return False


def exact_post_results_match_targets(targets: list[str], posts: list[dict]) -> bool:
    """Require a one-to-one shortcode match for exact post scrape results."""
    expected = {_extract_shortcode(target) for target in targets}
    returned_urls = [post.get("url") for post in posts]
    if (
        None in expected
        or len(posts) != len(expected)
        or any(
            not isinstance(url, str) or not is_exact_post_url_target(url) for url in returned_urls
        )
    ):
        return False
    returned = {_extract_shortcode(url) for url in returned_urls}
    return returned == expected


def filter_valid_posts(posts: list[dict]) -> list[dict]:
    """Keep retrieved items that identify real Instagram posts."""
    return [
        post
        for post in posts
        if not post.get("error")
        and not post.get("errorDescription")
        and post.get("url")
        and any(x in (post.get("url") or "") for x in ("/p/", "/reel/", "/tv/"))
    ]


def fetch_posts_for_targets(
    targets: list[str],
    *,
    cutoff_days: int,
    scraper,
) -> tuple[list[dict], bool]:
    """Fetch the posts to process for a webhook run or manual dispatch."""
    if targets and all(is_exact_post_url_target(t) for t in targets):
        return scraper.scrape_posts(targets), False

    posts, pinned_warning = scraper.scrape_latest(
        targets,
        results_limit=1,
        cutoff_days=cutoff_days,
    )

    if len(targets) == 1 and posts and posts[0].get("timestamp"):
        post_dt = parse_iso_datetime(posts[0]["timestamp"])
        now = datetime.now(timezone.utc)
        if post_dt and post_dt > now - _RECENT_POST_WINDOW:
            log.info("Fetched post is recent, using it")
        else:
            # WORKAROUND: Apify has a known bug where `skipPinnedPosts` is sometimes ignored
            # when `resultsLimit=1`. If the only post returned is old, it's likely a pinned post
            # that consumed our limit. We re-fetch with a higher limit to find the newest unpinned post.
            log.info("Fetched post is not recent, fetching more posts to find the most recent")
            posts, pinned_warning = scraper.scrape_latest(
                targets,
                results_limit=4,
                cutoff_days=cutoff_days,
            )

    if len(posts) > 1:
        posts.sort(key=lambda item: item.get("timestamp", 0), reverse=True)
        posts = posts[:1]

    return posts, pinned_warning
