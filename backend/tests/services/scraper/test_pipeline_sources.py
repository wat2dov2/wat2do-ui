"""How the vestigial pipeline reads a source's identity and images."""

import pytest

from core.tables import EVENTS, POSITIONS
from services.scraper import pipeline as module

_DIRECTORY_URL = "https://uwaterloo.ca/events/123"


def test_extract_image_urls_carousel_via_images_field():
    post = {"images": [{"url": "https://cdn/a.jpg"}, {"url": "https://cdn/b.jpg"}]}
    assert module._extract_image_urls(post) == ["https://cdn/a.jpg", "https://cdn/b.jpg"]


def test_extract_image_urls_falls_back_to_child_posts():
    post = {
        "images": [],
        "childPosts": [{"displayUrl": "https://cdn/x.jpg"}, {"displayUrl": "https://cdn/y.jpg"}],
    }
    assert module._extract_image_urls(post) == ["https://cdn/x.jpg", "https://cdn/y.jpg"]


def test_extract_image_urls_falls_back_to_display_url():
    assert module._extract_image_urls({"displayUrl": "https://cdn/single.jpg"}) == [
        "https://cdn/single.jpg"
    ]


def test_extract_image_urls_returns_empty_list_when_no_images():
    assert module._extract_image_urls({"caption": "no images"}) == []


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

    monkeypatch.setattr(module, "existing_shortcodes", existing_shortcodes)
    monkeypatch.setattr(module, "existing_urls", existing_urls)

    assert module._already_imported(url) is expected
    if "instagram.com" in url:
        assert len(shortcode_lookups) == 1
        assert url_lookups == []
    else:
        assert shortcode_lookups == []
        assert url_lookups[0] == ({url}, EVENTS)
