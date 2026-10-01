"""Unit tests for services/scraper/pipeline pure helpers.

Full pipeline integration (uploads -> extractor -> writer) is exercised by
integration tests. Here we cover the deterministic helpers so a regression
in filtering fails fast in unit tests.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.scraper import pipeline as pipeline_module
from services.scraper.org_resolve import ResolvedClub
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
        {"url": "https://instagram.com/uwteaclub", "timestamp": _now_iso()},
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
        "club": "UW Design Club",
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
    monkeypatch.setattr(pipeline_module, "_lookup_club_by_ig", lambda _handle: None)
    monkeypatch.setattr(
        pipeline_module,
        "resolve_club_for_scrape",
        lambda **_kwargs: ResolvedClub(
            club_id=7,
            club_name="UW Design Club",
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


def test_cross_school_copies_do_not_inherit_source_seasons_when_reconciliation_fails(monkeypatch):
    from services.scraper.pipeline import ScrapeResult

    source = {"title": "Tea", "location": "Campus", "campus_season_ids": ["hoco"]}
    reviewed = []
    written = []
    monkeypatch.setattr(
        pipeline_module,
        "resolve_club_for_scrape",
        lambda **_: ResolvedClub(club_id=7, club_name="Tea Club", ig_handle="tea"),
    )
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_: [])
    monkeypatch.setattr(
        pipeline_module,
        "reconcile_events",
        lambda **kwargs: reviewed.append(kwargs["extracted_events"][0]) or None,
    )
    monkeypatch.setattr(
        pipeline_module, "write_event", lambda event, **_: written.append(event) or "inserted"
    )
    for school in ("uwaterloo", "mit"):
        pipeline_module._process_events_for_school(
            [source],
            target_school=school,
            source_school="uwaterloo",
            candidate_handles=["tea"],
            create_stub_if_missing=True,
            caption="Tea",
            source_url="https://instagram.com/p/tea",
            handle="tea",
            result=ScrapeResult(ig_handle="tea"),
            allow_past_events=False,
        )
    assert reviewed[0]["campus_season_ids"] == ["hoco"]
    assert reviewed[1]["campus_season_ids"] is None
    assert written[1]["campus_season_ids"] is None
    assert source["campus_season_ids"] == ["hoco"]


def test_carousel_video_stays_with_its_poster_after_an_image_fails(monkeypatch):
    items = [{"title": "Video event", "image_index": 0}]
    monkeypatch.setattr(
        pipeline_module,
        "upload_post_images",
        lambda urls: [] if urls == ["bad.jpg"] else ["stored.jpg"],
    )
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: SimpleNamespace(events=items, positions=[]),
    )
    pipeline_module._process_one_post(
        {
            "childPosts": [
                {"displayUrl": "bad.jpg"},
                {"displayUrl": "good.jpg", "videoUrl": "cdn.mp4"},
            ]
        },
        handle="club",
        school="uwaterloo",
        dry_run=True,
        result=SimpleNamespace(events_extracted=0, positions_extracted=0, events_saved=0),
    )
    assert items[0]["source_image_url"] == "stored.jpg"
    assert items[0]["source_video_url"] == "stored.mp4"


def test_failed_video_download_retains_extracted_event_and_poster(monkeypatch):
    items = [{"title": "Video event", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: ["stored.jpg"])
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: None)
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: SimpleNamespace(events=items, positions=[]),
    )
    result = SimpleNamespace(events_extracted=0, positions_extracted=0, events_saved=0)
    pipeline_module._process_one_post(
        {"displayUrl": "good.jpg", "videoUrl": "cdn.mp4"},
        handle="club",
        school="uwaterloo",
        dry_run=True,
        result=result,
    )
    assert items[0]["source_image_url"] == "stored.jpg"
    assert items[0]["source_video_url"] is None
    assert result.events_saved == 1


def test_single_reel_keeps_video_when_provider_poster_urls_differ(monkeypatch):
    events = [{"title": "Video event", "image_index": 0}]
    positions = [{"title": "Video position", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: ["stored.jpg"])
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: SimpleNamespace(events=events, positions=positions),
    )
    pipeline_module._process_one_post(
        {
            "images": ["https://cdn/alternate-poster.jpg"],
            "displayUrl": "https://cdn/display-poster.jpg",
            "videoUrl": "https://cdn/reel.mp4",
        },
        handle="club",
        school="uwaterloo",
        dry_run=True,
        result=SimpleNamespace(
            events_extracted=0, positions_extracted=0, events_saved=0, positions_saved=0
        ),
    )
    for item in [*events, *positions]:
        assert item["source_image_url"] == "stored.jpg"
        assert item["source_video_url"] == "stored.mp4"


def test_carousel_root_video_is_not_attached_to_a_different_slide(monkeypatch):
    items = [{"title": "Image event", "image_index": 1}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: SimpleNamespace(events=items, positions=[]),
    )
    pipeline_module._process_one_post(
        {
            "displayUrl": "video-poster.jpg",
            "videoUrl": "cdn.mp4",
            "childPosts": [
                {"displayUrl": "video-poster.jpg", "videoUrl": "cdn.mp4"},
                {"displayUrl": "image.jpg"},
            ],
        },
        handle="club",
        school="uwaterloo",
        dry_run=True,
        result=SimpleNamespace(events_extracted=0, positions_extracted=0, events_saved=0),
    )
    assert items[0]["source_image_url"] == "image.jpg"
    assert items[0]["source_video_url"] is None


@pytest.mark.parametrize("children", [None, []])
def test_declared_carousel_without_children_never_uses_its_root_video(monkeypatch, children):
    from unittest.mock import MagicMock

    items = [{"title": "Uncertain carousel", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    upload = MagicMock(return_value="stored.mp4")
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", upload)
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: SimpleNamespace(events=items, positions=[]),
    )
    pipeline_module._process_one_post(
        {
            "type": "Sidecar",
            "displayUrl": "poster.jpg",
            "videoUrl": "wrong.mp4",
            "childPosts": children,
        },
        handle="club",
        school="uwaterloo",
        dry_run=True,
        result=SimpleNamespace(events_extracted=0, positions_extracted=0, events_saved=0),
    )
    assert items[0]["source_video_url"] is None
    upload.assert_not_called()


def test_coauthor_notification_does_not_change_canonical_primary_account():
    from services.scraper.pipeline import _get_candidate_handles

    post = {"ownerUsername": "OWNER", "coauthors": ["cohost", "owner", "other"]}
    assert _get_candidate_handles(post, "cohost") == _get_candidate_handles(post, "other")
    assert _get_candidate_handles(post, "cohost")[0] == "owner"


@pytest.mark.parametrize(
    "images,coauthors,expected",
    [
        (["https://cdn/one.jpg"], [], True),
        (["https://cdn/one.jpg", "https://cdn/two.jpg"], [], False),
        (["https://cdn/one.jpg"], ["other"], False),
        (["https://cdn/one.jpg"], ["@OWNER", "owner"], True),
    ],
)
@pytest.mark.parametrize("reconcile_changes_count", [False, True])
def test_post_club_creation_policy_reaches_events_positions_and_reconciled_events(
    monkeypatch, images, coauthors, expected, reconcile_changes_count
):
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: urls)
    monkeypatch.setattr(pipeline_module, "_lookup_club_by_ig", lambda _: None)
    event = {"title": "Party", "location": "Campus", "club": "Host"}
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_: SimpleNamespace(
            events=[event], positions=[{"title": "Volunteer", "club": "Host"}]
        ),
    )
    from services.scraper import org_resolve

    monkeypatch.setattr(org_resolve.event_writer_mod, "_lookup_club_by_ig", lambda _: None)
    monkeypatch.setattr(org_resolve.club_service, "lookup_club_by_school_and_name", lambda *_: None)
    create = Mock(return_value={"id": 7, "club_name": "Host"})
    monkeypatch.setattr(org_resolve.event_writer_mod, "_ensure_club_by_ig", create)
    resolve = Mock(wraps=pipeline_module.resolve_club_for_scrape)
    monkeypatch.setattr(pipeline_module, "resolve_club_for_scrape", resolve)
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_: [])
    monkeypatch.setattr(
        pipeline_module,
        "reconcile_events",
        lambda **kw: (
            kw["extracted_events"]
            + ([{**event, "title": "Second party"}] if reconcile_changes_count else [])
        ),
    )
    monkeypatch.setattr(pipeline_module, "write_event", lambda *_args, **_kw: "inserted")
    monkeypatch.setattr(pipeline_module, "write_position", lambda *_args, **_kw: "inserted")
    result = pipeline_module.ScrapeResult(ig_handle="owner")
    pipeline_module._process_one_post(
        {
            "url": "https://instagram.com/p/POST/",
            "ownerUsername": "owner",
            "images": images,
            "coauthors": coauthors,
        },
        handle="owner",
        school="uwaterloo",
        result=result,
        dry_run=False,
    )
    assert resolve.call_count == (4 if reconcile_changes_count else 2)
    assert all(
        call.kwargs["create_stub_if_missing"] is (len(images) <= 1)
        for call in resolve.call_args_list
    )
    assert bool(create.called) is expected
    assert result.positions_saved == 1
    assert result.events_saved == (2 if reconcile_changes_count else 1)
