"""Unit tests for services/scraper/pipeline pure helpers.

Full pipeline integration (uploads -> extractor -> writer) is exercised by
integration tests. Here we cover the deterministic helpers so a regression
in filtering fails fast in unit tests.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from services.scraper import pipeline as pipeline_module
from services.scraper.org_resolve import ResolvedOrganization
from services.scraper.pipeline import (
    _extract_image_urls,
    _filter_new_posts,
)


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


def test_filter_new_posts_drops_duplicate_shortcode_in_same_batch():
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    posts = [
        {"url": "https://instagram.com/p/SAME/", "timestamp": _now_iso()},
        {"url": "https://instagram.com/p/SAME/", "timestamp": _now_iso()},
    ]

    fresh = _filter_new_posts(posts, seen_shortcodes=set(), cutoff=cutoff)

    assert fresh == [posts[0]]


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


def test_pipeline_normalizes_caption_before_extraction(monkeypatch):
    extracted_captions: list[str] = []

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: (
            extracted_captions.append(kwargs["caption_text"])
            or SimpleNamespace(events=[], positions=[])
        ),
    )

    result = SimpleNamespace(events_extracted=0, positions_extracted=0)
    pipeline_module._process_one_post(
        {
            "caption": r"\ud83d\udcca Review session\n\nBring questions.",
            "timestamp": _now_iso(),
        },
        handle="uwstatsclub",
        school="uwaterloo",
        result=result,
        dry_run=False,
    )

    assert extracted_captions == ["📊 Review session\n\nBring questions."]


def test_pipeline_routes_hiring_post_to_position_writer(monkeypatch):
    position = {
        "title": "Design Lead",
        "description": "Lead the visual design team.",
        "organization": "UW Design Club",
        "position_type": "committee",
        "requirements": ["Portfolio"],
        "image_index": 0,
    }
    written: list[dict] = []

    monkeypatch.setattr(pipeline_module, "existing_shortcodes", lambda shortcodes: set())
    monkeypatch.setattr(
        pipeline_module.workflow_run_service,
        "create_workflow_run",
        lambda _data: SimpleNamespace(id="run-1"),
    )
    monkeypatch.setattr(
        pipeline_module.workflow_run_service,
        "mark_finished",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kwargs: SimpleNamespace(events=[], positions=[position]),
    )
    monkeypatch.setattr(pipeline_module, "_lookup_organization_by_ig", lambda _handle: None)
    monkeypatch.setattr(
        pipeline_module,
        "resolve_organization_for_scrape",
        lambda **_kwargs: ResolvedOrganization(
            organization_id=7,
            organization_name="UW Design Club",
            ig_handle="uwdesign",
        ),
    )
    monkeypatch.setattr(
        pipeline_module,
        "write_position",
        lambda payload, **_kwargs: written.append(payload) or "inserted",
    )

    result = pipeline_module.run_pipeline(
        ig_handle="uwdesign",
        school="uwaterloo",
        posts=[
            {
                "url": "https://www.instagram.com/p/HIRING123/",
                "ownerUsername": "uwdesign",
                "caption": "We're hiring a design lead.",
                "timestamp": _now_iso(),
                "displayUrl": "https://example.com/hiring.jpg",
            }
        ],
        cutoff_days=1,
    )

    assert result.events_extracted == 0
    assert result.events_saved == 0
    assert result.positions_extracted == 1
    assert result.positions_saved == 1
    assert written[0]["title"] == "Design Lead"
    assert written[0]["school"] == "uwaterloo"
    assert written[0]["source_image_url"] == "https://example.com/hiring.jpg"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
