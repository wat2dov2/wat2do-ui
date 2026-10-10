"""Exact Instagram post URL helpers shared by retrieval and repair scripts."""

from __future__ import annotations

from urllib.parse import urlsplit

from services.scraper.dedup import _extract_shortcode

_INSTAGRAM_POST_HOSTS = {"instagram.com", "www.instagram.com"}
_INSTAGRAM_POST_PATH_PREFIXES = {"p", "reel", "reels", "tv"}


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
            and len(path_parts) >= 2
            and path_parts[-2] in _INSTAGRAM_POST_PATH_PREFIXES
            and _extract_shortcode(target) == path_parts[-1]
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
