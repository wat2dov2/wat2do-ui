"""Unit tests for services/scraper/pipeline.

``process_post`` runs with its collaborators (storage, extraction, club
resolution, reconciliation, writers) replaced, so these tests pin how one
captured Instagram post or directory page is routed to events and positions.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.tables import EVENTS, POSITIONS
from services.scraper import pipeline as pipeline_module
from services.scraper.org_resolve import ResolvedClub
from services.scraper.pipeline import _extract_image_urls

_DIRECTORY_URL = "https://clubs.example.edu/events/123"


@pytest.fixture(autouse=True)
def nothing_imported(monkeypatch):
    monkeypatch.setattr(pipeline_module, "existing_shortcodes", lambda _shortcodes: set())
    monkeypatch.setattr(pipeline_module, "existing_urls", lambda _urls, **_kwargs: set())


@pytest.fixture
def school_writes(monkeypatch):
    """Record each per-school write stage instead of resolving clubs and writing rows."""
    calls = {"events": [], "positions": []}
    monkeypatch.setattr(
        pipeline_module,
        "_process_events_for_school",
        lambda events, **kwargs: calls["events"].append((events, kwargs)),
    )
    monkeypatch.setattr(
        pipeline_module,
        "_process_positions_for_school",
        lambda positions, **kwargs: calls["positions"].append((positions, kwargs)),
    )
    return calls


def _extract(monkeypatch, *, events=(), positions=()):
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kwargs: SimpleNamespace(events=list(events), positions=list(positions)),
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _directory_post() -> dict:
    return {
        "url": _DIRECTORY_URL,
        "caption": "Spring Social\nApril 3, 6 PM",
        "images": ["https://clubs.example.edu/poster.jpg"],
    }


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


def test_process_post_extracts_normalized_caption_with_claude(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: calls.append(kwargs) or SimpleNamespace(events=[], positions=[]),
    )

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/STATS/",
            "caption": r"📊 Review session\n\nBring questions.",
            "timestamp": _now_iso(),
        },
        school="uwaterloo",
    )

    assert calls[0]["caption_text"] == "📊 Review session\n\nBring questions."
    assert calls[0]["school"] == "uwaterloo"
    assert calls[0]["complete"] is pipeline_module.claude_completion


def test_process_post_reads_directory_text_field(monkeypatch):
    captions: list[str] = []
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **kwargs: (
            captions.append(kwargs["caption_text"]) or SimpleNamespace(events=[], positions=[])
        ),
    )

    pipeline_module.process_post({"url": _DIRECTORY_URL, "text": "Page text"}, school="upenn")

    assert captions == ["Page text"]


@pytest.mark.parametrize(
    ("url", "allow_all_domains"),
    [("https://www.instagram.com/p/POST/", False), (_DIRECTORY_URL, True)],
)
def test_only_directory_images_may_come_from_any_domain(
    monkeypatch, school_writes, url, allow_all_domains
):
    upload = Mock(side_effect=lambda urls, **_: list(urls))
    monkeypatch.setattr(pipeline_module, "upload_post_images", upload)
    _extract(monkeypatch)

    pipeline_module.process_post(
        {"url": url, "images": ["https://cdn/a.jpg", "https://cdn/b.jpg"]}, school="uwaterloo"
    )

    assert [call.args[0] for call in upload.call_args_list] == [
        ["https://cdn/a.jpg"],
        ["https://cdn/b.jpg"],
    ]
    assert all(
        call.kwargs == {"allow_all_domains": allow_all_domains} for call in upload.call_args_list
    )


@pytest.mark.parametrize(
    ("url", "shortcodes", "event_urls", "position_urls", "expected"),
    [
        pytest.param("https://www.instagram.com/p/SEEN/", {"SEEN"}, set(), set(), True, id="seen"),
        pytest.param("https://instagram.com/reel/NEW/", set(), set(), set(), False, id="new-reel"),
        pytest.param(_DIRECTORY_URL, set(), {_DIRECTORY_URL}, set(), True, id="directory-event"),
        pytest.param(_DIRECTORY_URL, set(), set(), {_DIRECTORY_URL}, True, id="directory-position"),
        pytest.param(_DIRECTORY_URL, {"123"}, set(), set(), False, id="directory-new"),
    ],
)
def test_already_imported_checks_the_source_identity(
    monkeypatch, url, shortcodes, event_urls, position_urls, expected
):
    shortcode_lookups = []
    url_lookups = []

    def existing_shortcodes(requested):
        shortcode_lookups.append(requested)
        return requested & shortcodes

    def existing_urls(requested, *, table=EVENTS):
        url_lookups.append((requested, table))
        return requested & (position_urls if table == POSITIONS else event_urls)

    monkeypatch.setattr(pipeline_module, "existing_shortcodes", existing_shortcodes)
    monkeypatch.setattr(pipeline_module, "existing_urls", existing_urls)

    assert pipeline_module._already_imported(url) is expected
    if "instagram.com" in url:
        assert len(shortcode_lookups) == 1
        assert url_lookups == []
    else:
        assert shortcode_lookups == []
        assert url_lookups[0] == ({url}, EVENTS)


def test_already_imported_source_is_not_uploaded_or_extracted(monkeypatch):
    monkeypatch.setattr(pipeline_module, "existing_urls", lambda urls, **_: set(urls))
    upload = Mock()
    extract = Mock()
    monkeypatch.setattr(pipeline_module, "upload_post_images", upload)
    monkeypatch.setattr(pipeline_module, "extract_post_content", extract)

    pipeline_module.process_post(_directory_post(), school="upenn")

    upload.assert_not_called()
    extract.assert_not_called()


def test_pipeline_routes_hiring_post_to_position_writer(monkeypatch):
    position = {
        "title": "Design Lead",
        "description": "Lead the visual design team.",
        "club": "UW Design Club",
        "position_type": "committee",
        "requirements": ["Portfolio"],
        "image_index": 0,
    }
    written: list[tuple[dict, dict]] = []

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    _extract(monkeypatch, positions=[position])
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
        lambda payload, **kwargs: written.append((payload, kwargs)) or "inserted",
    )

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/HIRING123/",
            "ownerUsername": "uwdesign",
            "caption": "We're hiring a design lead.",
            "timestamp": _now_iso(),
            "displayUrl": "https://example.com/hiring.jpg",
        },
        school="uwaterloo",
    )

    assert len(written) == 1
    payload, kwargs = written[0]
    assert payload["title"] == "Design Lead"
    assert payload["school"] == "uwaterloo"
    assert payload["source_image_url"] == "https://example.com/hiring.jpg"
    assert kwargs["ig_handle"] == "uwdesign"
    assert kwargs["source_url"] == "https://www.instagram.com/p/HIRING123/"
    assert kwargs["ingestion_source"] == "instagram_scraper"


def test_reviewed_position_update_keeps_source_media_and_runs_only_at_source_school(monkeypatch):
    original = {
        "id": 5486,
        "title": "Design Lead",
        "description": "Applications extended; original duties retained.",
        "club": "UW Design Club",
        "position_type": "committee",
        "source_url": "https://www.instagram.com/p/ORIGINAL/",
        "source_image_url": "https://example.com/original.jpg",
        "source_video_url": "https://example.com/original.mp4",
    }
    approved = dict(original)
    written = []
    resolved_calls = []
    monkeypatch.setattr(
        pipeline_module,
        "upload_post_images",
        lambda _urls, **_: ["https://example.com/extension.jpg"],
    )
    monkeypatch.setattr(
        pipeline_module, "upload_video_from_url", lambda _url: "https://example.com/extension.mp4"
    )
    _extract(monkeypatch, positions=[original])
    monkeypatch.setattr(
        pipeline_module,
        "_lookup_club_by_ig",
        lambda candidate: {"schools": {"slug": "uwindsor"}} if candidate == "coauthor" else None,
    )
    monkeypatch.setattr(
        pipeline_module,
        "resolve_club_for_scrape",
        lambda **kwargs: (
            resolved_calls.append(kwargs)
            or ResolvedClub(
                club_id=7,
                club_name="UW Design Club",
                ig_handle="uwdesign",
            )
        ),
    )
    monkeypatch.setattr(
        pipeline_module,
        "write_position",
        lambda payload, **kwargs: written.append((payload, kwargs)) or "updated",
    )

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/EXTENSION/",
            "ownerUsername": "uwdesign",
            "coauthors": [{"username": "coauthor"}],
            "caption": "Applications extended.",
            "timestamp": _now_iso(),
            "displayUrl": "https://example.com/extension-source.jpg",
            "videoUrl": "https://example.com/extension-source.mp4",
            "type": "Video",
        },
        school="uwaterloo",
    )

    assert len(written) == 1
    payload, kwargs = written[0]
    assert payload == {**approved, "school": "uwaterloo"}
    assert kwargs["source_url"] == "https://www.instagram.com/p/EXTENSION/"
    assert len(resolved_calls) == 1
    assert resolved_calls[0]["school"] == "uwaterloo"
    assert resolved_calls[0]["create_stub_if_missing"] is False


def test_coauthor_schools_receive_their_own_copies(monkeypatch, school_writes):
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    _extract(monkeypatch, events=[{"title": "Mixer"}], positions=[{"title": "Volunteer"}])
    monkeypatch.setattr(
        pipeline_module,
        "_lookup_club_by_ig",
        lambda handle: {"schools": {"slug": "uwindsor"}} if handle == "windsorclub" else None,
    )

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/MIXER/",
            "ownerUsername": "WaterlooClub",
            "coauthors": [{"username": "windsorclub"}, "@other"],
            "displayUrl": "https://cdn/mixer.jpg",
        },
        school="uwaterloo",
    )

    for stage in ("events", "positions"):
        calls = school_writes[stage]
        assert sorted(kwargs["target_school"] for _items, kwargs in calls) == [
            "uwaterloo",
            "uwindsor",
        ]
        for _items, kwargs in calls:
            assert kwargs["source_school"] == "uwaterloo"
            assert kwargs["candidate_handles"] == ["waterlooclub", "other", "windsorclub"]
            assert kwargs["handle"] == "waterlooclub"
            assert kwargs["publisher_ig"] is None


def test_cross_school_copies_do_not_inherit_source_seasons_when_reconciliation_fails(monkeypatch):
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
            publisher_ig=None,
        )
    assert reviewed[0]["campus_season_ids"] == ["hoco"]
    assert reviewed[1]["campus_season_ids"] is None
    assert written[1]["campus_season_ids"] is None
    assert source["campus_season_ids"] == ["hoco"]


def test_same_post_duplicate_extractions_collapse_before_reconciliation(monkeypatch):
    occurrence = {"dtstart_utc": "2026-10-20T22:00:00Z", "tz": "America/Toronto"}
    duplicate = {"title": "Tea Night", "location": "SLC", "occurrences": [occurrence]}
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
        lambda **kwargs: reviewed.append(kwargs) or kwargs["extracted_events"],
    )
    monkeypatch.setattr(
        pipeline_module, "write_event", lambda event, **_: written.append(event) or "inserted"
    )

    pipeline_module._process_events_for_school(
        [duplicate, dict(duplicate)],
        target_school="uwaterloo",
        source_school="uwaterloo",
        candidate_handles=["tea"],
        create_stub_if_missing=True,
        caption="Tea Night",
        source_url="https://instagram.com/p/tea",
        handle="tea",
        publisher_ig=None,
    )

    assert len(reviewed[0]["extracted_events"]) == 1
    assert reviewed[0]["resolved_club_ids"] == [7]
    assert reviewed[0]["complete"] is pipeline_module.claude_completion
    assert len(written) == 1


def test_carousel_video_stays_with_its_poster_after_an_image_fails(monkeypatch, school_writes):
    items = [{"title": "Video event", "image_index": 0}]
    monkeypatch.setattr(
        pipeline_module,
        "upload_post_images",
        lambda urls, **_: [] if urls == ["bad.jpg"] else ["stored.jpg"],
    )
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    _extract(monkeypatch, events=items)
    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/CAROUSEL/",
            "childPosts": [
                {"displayUrl": "bad.jpg"},
                {"displayUrl": "good.jpg", "videoUrl": "cdn.mp4"},
            ],
        },
        school="uwaterloo",
    )
    assert items[0]["source_image_url"] == "stored.jpg"
    assert items[0]["source_video_url"] == "stored.mp4"


def test_failed_video_download_retains_extracted_event_and_poster(monkeypatch, school_writes):
    items = [{"title": "Video event", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: ["stored.jpg"])
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: None)
    _extract(monkeypatch, events=items)
    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/REEL/",
            "displayUrl": "good.jpg",
            "videoUrl": "cdn.mp4",
        },
        school="uwaterloo",
    )
    assert items[0]["source_image_url"] == "stored.jpg"
    assert items[0]["source_video_url"] is None
    assert school_writes["events"][0][0] == items


def test_single_reel_keeps_video_when_provider_poster_urls_differ(monkeypatch, school_writes):
    events = [{"title": "Video event", "image_index": 0}]
    positions = [{"title": "Video position", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: ["stored.jpg"])
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    _extract(monkeypatch, events=events, positions=positions)
    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/reel/REEL/",
            "images": ["https://cdn/alternate-poster.jpg"],
            "displayUrl": "https://cdn/display-poster.jpg",
            "videoUrl": "https://cdn/reel.mp4",
        },
        school="uwaterloo",
    )
    for item in [*events, *positions]:
        assert item["source_image_url"] == "stored.jpg"
        assert item["source_video_url"] == "stored.mp4"


def test_carousel_root_video_is_not_attached_to_a_different_slide(monkeypatch, school_writes):
    items = [{"title": "Image event", "image_index": 1}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", lambda url: "stored.mp4")
    _extract(monkeypatch, events=items)
    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/CAROUSEL/",
            "displayUrl": "video-poster.jpg",
            "videoUrl": "cdn.mp4",
            "childPosts": [
                {"displayUrl": "video-poster.jpg", "videoUrl": "cdn.mp4"},
                {"displayUrl": "image.jpg"},
            ],
        },
        school="uwaterloo",
    )
    assert items[0]["source_image_url"] == "image.jpg"
    assert items[0]["source_video_url"] is None


@pytest.mark.parametrize("children", [None, []])
def test_declared_carousel_without_children_never_uses_its_root_video(
    monkeypatch, school_writes, children
):
    items = [{"title": "Uncertain carousel", "image_index": 0}]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    upload = Mock(return_value="stored.mp4")
    monkeypatch.setattr(pipeline_module, "upload_video_from_url", upload)
    _extract(monkeypatch, events=items)
    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/SIDECAR/",
            "type": "Sidecar",
            "displayUrl": "poster.jpg",
            "videoUrl": "wrong.mp4",
            "childPosts": children,
        },
        school="uwaterloo",
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
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: urls)
    monkeypatch.setattr(pipeline_module, "_lookup_club_by_ig", lambda _: None)
    event = {"title": "Party", "location": "Campus", "club": "Host"}
    _extract(monkeypatch, events=[event], positions=[{"title": "Volunteer", "club": "Host"}])
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
    write_event = Mock(return_value="inserted")
    write_position = Mock(return_value="inserted")
    monkeypatch.setattr(pipeline_module, "write_event", write_event)
    monkeypatch.setattr(pipeline_module, "write_position", write_position)
    pipeline_module.process_post(
        {
            "url": "https://instagram.com/p/POST/",
            "ownerUsername": "owner",
            "images": images,
            "coauthors": coauthors,
        },
        school="uwaterloo",
    )
    assert resolve.call_count == (4 if reconcile_changes_count else 2)
    assert all(
        call.kwargs["create_stub_if_missing"] is (len(images) <= 1)
        for call in resolve.call_args_list
    )
    assert bool(create.called) is expected
    assert write_position.call_count == 1
    assert write_event.call_count == (2 if reconcile_changes_count else 1)


def test_directory_page_has_no_handles_stubs_or_coauthor_schools(monkeypatch, school_writes):
    lookup = Mock(return_value=None)
    monkeypatch.setattr(pipeline_module, "_lookup_club_by_ig", lookup)
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    _extract(monkeypatch, events=[{"title": "Spring Social"}], positions=[{"title": "Tutor"}])

    pipeline_module.process_post(_directory_post(), school="upenn", publisher_ig="pennclubs")

    lookup.assert_not_called()
    for stage in ("events", "positions"):
        [(_items, kwargs)] = school_writes[stage]
        assert kwargs["target_school"] == "upenn"
        assert kwargs["candidate_handles"] == []
        assert kwargs["create_stub_if_missing"] is False
        assert kwargs["handle"] is None
        assert kwargs["publisher_ig"] == "pennclubs"


def _directory_resolution(monkeypatch, registered: dict[str, ResolvedClub]) -> list[dict]:
    """Resolve hosts by name and the publisher by handle; everything else is unregistered."""
    calls: list[dict] = []

    def resolve(**kwargs):
        calls.append(kwargs)
        handle = kwargs["ig_handle"] if isinstance(kwargs["ig_handle"], str) else None
        return registered.get(kwargs["club_name"] or handle or "") or ResolvedClub(
            club_id=None, club_name=kwargs["club_name"], ig_handle=None
        )

    monkeypatch.setattr(pipeline_module, "resolve_club_for_scrape", resolve)
    return calls


def test_directory_events_without_a_named_host_belong_to_the_publisher(monkeypatch):
    publisher = ResolvedClub(club_id=1, club_name="Penn Clubs", ig_handle="pennclubs")
    chess = ResolvedClub(club_id=2, club_name="Chess Club", ig_handle="pennchess")
    calls = _directory_resolution(monkeypatch, {"pennclubs": publisher, "Chess Club": chess})
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_: [])
    reviewed = []
    monkeypatch.setattr(
        pipeline_module,
        "reconcile_events",
        lambda **kwargs: reviewed.append(kwargs) or kwargs["extracted_events"],
    )
    written = []
    monkeypatch.setattr(
        pipeline_module,
        "write_event",
        lambda event, **kwargs: written.append((event, kwargs)) or "inserted",
    )

    pipeline_module._process_events_for_school(
        [
            {"title": "Unhosted social", "club": ""},
            {"title": "Chess night", "club": "Chess Club"},
            {"title": "Unregistered host", "club": "Knitting Club"},
        ],
        target_school="upenn",
        source_school="upenn",
        candidate_handles=[],
        create_stub_if_missing=False,
        caption="Events",
        source_url=_DIRECTORY_URL,
        handle=None,
        publisher_ig="pennclubs",
    )

    assert [kwargs["resolved_org"] for _event, kwargs in written] == [
        publisher,
        chess,
        ResolvedClub(club_id=None, club_name="Knitting Club", ig_handle=None),
    ]
    assert reviewed[0]["resolved_club_ids"] == [1, 2, None]
    assert all(kwargs["ingestion_source"] == "directory" for _event, kwargs in written)
    assert all(kwargs["ig_handle"] is None for _event, kwargs in written)
    assert [call["ig_handle"] for call in calls].count("pennclubs") == 1
    assert all(call["create_stub_if_missing"] is False for call in calls)


def test_directory_positions_without_a_registered_host_belong_to_the_publisher(monkeypatch):
    publisher = ResolvedClub(club_id=1, club_name="Penn Clubs", ig_handle="pennclubs")
    chess = ResolvedClub(club_id=2, club_name="Chess Club", ig_handle="pennchess")
    _directory_resolution(monkeypatch, {"pennclubs": publisher, "Chess Club": chess})
    written = []
    monkeypatch.setattr(
        pipeline_module,
        "write_position",
        lambda position, **kwargs: written.append((position, kwargs)) or "inserted",
    )

    pipeline_module._process_positions_for_school(
        [{"title": "Tutor", "club": "Knitting Club"}, {"title": "Captain", "club": "Chess Club"}],
        target_school="upenn",
        source_school="upenn",
        candidate_handles=[],
        create_stub_if_missing=False,
        source_url=_DIRECTORY_URL,
        handle=None,
        publisher_ig="pennclubs",
    )

    assert [kwargs["resolved_org"] for _position, kwargs in written] == [publisher, chess]
    assert [kwargs["ig_handle"] for _position, kwargs in written] == ["pennclubs", "pennchess"]
    assert all(kwargs["ingestion_source"] == "directory" for _position, kwargs in written)


def test_unregistered_publisher_leaves_directory_items_unresolved(monkeypatch):
    _directory_resolution(monkeypatch, {})
    written = []
    monkeypatch.setattr(
        pipeline_module,
        "write_position",
        lambda position, **kwargs: written.append(kwargs) or "inserted",
    )

    pipeline_module._process_positions_for_school(
        [{"title": "Tutor", "club": ""}],
        target_school="upenn",
        source_school="upenn",
        candidate_handles=[],
        create_stub_if_missing=False,
        source_url=_DIRECTORY_URL,
        handle=None,
        publisher_ig="pennclubs",
    )

    assert written[0]["resolved_org"].club_id is None
    assert written[0]["ig_handle"] == ""
