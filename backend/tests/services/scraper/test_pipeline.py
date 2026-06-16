"""Unit tests for services/wat2do/pipeline pure helpers.

Full pipeline integration (Apify -> uploads -> extractor -> writer) is
exercised by the dry-run workflow in CI. Here we cover the deterministic
helpers so a regression in filtering / grouping fails fast in unit tests.
"""

from datetime import datetime, timedelta, timezone

from services.scraper.pipeline import (
    _extract_image_urls,
    _filter_new_posts,
    _group_by_handle,
    _parse_post_timestamp,
)

# ── _parse_post_timestamp ─────────────────────────────────────────────


def test_parse_post_timestamp_z_suffix():
    parsed = _parse_post_timestamp("2026-04-27T14:00:00Z")
    assert parsed is not None
    assert parsed.tzinfo == timezone.utc


def test_parse_post_timestamp_invalid_returns_none():
    assert _parse_post_timestamp("garbage") is None
    assert _parse_post_timestamp(None) is None
    assert _parse_post_timestamp(12345) is None


# ── _group_by_handle ──────────────────────────────────────────────────


def test_group_by_handle_buckets_by_owner_username():
    posts = [
        {"ownerUsername": "uwteaorganization", "url": "https://instagram.com/p/a/"},
        {"ownerUsername": "wasawaterloo", "url": "https://instagram.com/p/b/"},
        {"ownerUsername": "uwteaorganization", "url": "https://instagram.com/p/c/"},
        {"ownerUsername": "unknown_handle", "url": "https://instagram.com/p/d/"},
    ]
    grouped = _group_by_handle(posts, ["uwteaorganization", "wasawaterloo"])
    assert len(grouped["uwteaorganization"]) == 2
    assert len(grouped["wasawaterloo"]) == 1
    # Posts whose owner isn't in the requested list are dropped.
    assert "unknown_handle" not in grouped


def test_group_by_handle_falls_back_to_username_field():
    """Apify sometimes returns ``username`` instead of ``ownerUsername``."""
    posts = [{"username": "uwteaorganization", "url": "https://instagram.com/p/a/"}]
    grouped = _group_by_handle(posts, ["uwteaorganization"])
    assert len(grouped["uwteaorganization"]) == 1


def test_group_by_handle_is_case_insensitive():
    """Instagram handles are case-insensitive; Apify sometimes returns
    ``ownerUsername`` in different casing than what we requested."""
    posts = [
        {"ownerUsername": "UWTeaOrganization", "url": "https://instagram.com/p/a/"},
        {"ownerUsername": "uwteaorganization", "url": "https://instagram.com/p/b/"},
        {"ownerUsername": "UwTeaOrganization", "url": "https://instagram.com/p/c/"},
    ]
    grouped = _group_by_handle(posts, ["uwteaorganization"])
    # All three casings should land in the canonical-cased key.
    assert len(grouped["uwteaorganization"]) == 3


def test_group_by_handle_supports_coauthor_producers():
    posts = [
        {
            "ownerUsername": "external_collaborator",
            "url": "https://instagram.com/p/a/",
            "coauthor_producers": [
                {"username": "external_collaborator"},
                {"username": "UWTeaOrganization"},
            ],
        },
        {
            "ownerUsername": "another_external",
            "url": "https://instagram.com/p/b/",
            "coauthors": ["another_external", "wasawaterloo"],
        },
    ]
    grouped = _group_by_handle(posts, ["uwteaorganization", "wasawaterloo"])
    assert len(grouped["uwteaorganization"]) == 1
    assert len(grouped["wasawaterloo"]) == 1


# ── _filter_new_posts ─────────────────────────────────────────────────


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
    """Non-/p/ and non-/reel/ URLs (profile links, story URLs) are dropped."""
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


# ── _extract_image_urls ──────────────────────────────────────────────


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
