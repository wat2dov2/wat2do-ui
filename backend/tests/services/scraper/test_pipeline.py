"""Unit tests for services/scraper/pipeline pure helpers.

Full pipeline integration (uploads -> extractor -> writer) is exercised by
integration tests. Here we cover the deterministic helpers so a regression
in filtering fails fast in unit tests.
"""

from datetime import datetime, timedelta, timezone

from services.scraper.pipeline import (
    _extract_image_urls,
    _filter_new_posts,
    parse_post_timestamp,
)


def test_parse_post_timestamp_z_suffix():
    parsed = parse_post_timestamp("2026-04-27T14:00:00Z")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc


def test_parse_post_timestamp_invalid_returns_none():
    assert parse_post_timestamp("garbage") is None
    assert parse_post_timestamp(None) is None
    assert parse_post_timestamp(12345) is None


def test_filter_new_posts_drops_seen_shortcodes():
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts = [
        {"url": "https://instagram.com/p/SEEN/", "timestamp": _now_iso()},
        {"url": "https://instagram.com/p/NEW/", "timestamp": _now_iso()},
    ]
    fresh = _filter_new_posts(posts, seen_shortcodes={"SEEN"}, cutoff=cutoff)
    assert len(fresh) == 1
    assert fresh[0]["url"].endswith("NEW/")


def test_filter_new_posts_drops_old_posts():
    cutoff = datetime.now(timezone.utc) - timedelta(days=4)
    too_old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    fresh_ts = _now_iso()
    posts = [
        {"url": "https://instagram.com/p/OLD/", "timestamp": too_old},
        {"url": "https://instagram.com/p/NEW/", "timestamp": fresh_ts},
    ]
    fresh = _filter_new_posts(posts, seen_shortcodes=set(), cutoff=cutoff)
    assert [p["url"] for p in fresh] == ["https://instagram.com/p/NEW/"]


def test_filter_new_posts_drops_non_post_urls():
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts = [
        {"url": "https://instagram.com/uwteaorganization", "timestamp": _now_iso()},
        {"url": "https://instagram.com/p/REAL/", "timestamp": _now_iso()},
    ]
    fresh = _filter_new_posts(posts, seen_shortcodes=set(), cutoff=cutoff)
    assert len(fresh) == 1


def test_filter_new_posts_accepts_reels():
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts = [{"url": "https://instagram.com/reel/REEL1/", "timestamp": _now_iso()}]
    fresh = _filter_new_posts(posts, seen_shortcodes=set(), cutoff=cutoff)
    assert len(fresh) == 1


def test_extract_image_urls_carousel_via_images_field():
    post = {
        "images": [
            {"url": "https://cdn/a.jpg"},
            {"url": "https://cdn/b.jpg"},
        ],
    }
    assert _extract_image_urls(post) == ["https://cdn/a.jpg", "https://cdn/b.jpg"]


def test_extract_image_urls_falls_back_to_child_posts():
    post = {
        "images": [],
        "childPosts": [
            {"displayUrl": "https://cdn/x.jpg"},
            {"displayUrl": "https://cdn/y.jpg"},
        ],
    }
    assert _extract_image_urls(post) == ["https://cdn/x.jpg", "https://cdn/y.jpg"]


def test_extract_image_urls_falls_back_to_display_url():
    post = {"displayUrl": "https://cdn/single.jpg"}
    assert _extract_image_urls(post) == ["https://cdn/single.jpg"]


def test_extract_image_urls_returns_empty_list_when_no_images():
    assert _extract_image_urls({"caption": "no images"}) == []


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
