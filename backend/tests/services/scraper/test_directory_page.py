"""Directory source identity and media repair page tests."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from services.scraper.directory_config import DirectoryConfig
from services.scraper.directory_page import scrape_event_page


def directory_config(**overrides) -> DirectoryConfig:
    values = {
        "id": "test",
        "name": "Test",
        "school": "test-school",
        "default_club": "Test Students' Union",
        "default_club_ig": "testunion",
        "source_format": "html",
        "entry_url": "https://example.com/events",
        "event_url_patterns": ["/event/"],
    }
    values.update(overrides)
    return DirectoryConfig(**values)


def test_directory_config_instantiation():
    config = DirectoryConfig(
        id="test-dir",
        name="Test Directory",
        school="Test School",
        default_club="Test Students' Union",
        source_format="html",
        entry_url="https://example.com/events",
        event_url_patterns=["/event/"],
        next_page_selector="a.next",
        content_selector=".desc",
        image_selector="img.banner",
    )
    assert config.id == "test-dir"
    assert config.name == "Test Directory"
    assert config.school == "Test School"
    assert config.entry_url == "https://example.com/events"
    assert config.default_club == "Test Students' Union"
    assert config.source_format == "html"
    assert config.event_url_patterns == ["/event/"]
    assert config.next_page_selector == "a.next"
    assert config.content_selector == ".desc"
    assert config.image_selector == "img.banner"


def test_directory_catalog_covers_every_authoritative_school():
    config_path = Path(__file__).parents[3] / "services" / "scraper" / "urls" / "directories.json"
    configs = [DirectoryConfig.model_validate(item) for item in json.loads(config_path.read_text())]

    assert len(configs) == 36
    assert {config.school for config in configs} == {
        "berkeley",
        "brocku",
        "carleton",
        "columbia",
        "concordia",
        "cornell",
        "dalhousie",
        "guelph",
        "ulaval",
        "mcmaster",
        "mcgill",
        "mun",
        "mit",
        "nyu",
        "ocadu",
        "ontariotech",
        "queensu",
        "sfu",
        "tmu",
        "ualberta",
        "ubc",
        "ucalgary",
        "udem",
        "umanitoba",
        "ottawa",
        "upenn",
        "uqam",
        "usask",
        "utsg",
        "utsc",
        "utm",
        "uwaterloo",
        "uwo",
        "uwindsor",
        "wlu",
        "yorku",
    }
    assert len({config.id for config in configs}) == len(configs)
    assert all(config.default_club for config in configs)
    assert all(config.event_url_patterns for config in configs)


@patch("services.scraper.directory_page.httpx.get")
def test_scrape_event_page(mock_get):
    resp = MagicMock()
    resp.text = """
    <html>
        <body>
            <article class="entry-content">
                <h1>Fun Event</h1>
                <p class="desc">Come and join us for a fun event painting tote bags.</p>
                <img class="banner" src="/images/banner.png" />
                <img class="avatar" src="/images/avatar-1.png" />
            </article>
        </body>
    </html>
    """
    resp.raise_for_status = MagicMock()
    mock_get.return_value = resp

    config = directory_config(
        school="Test School",
        content_selector=".desc",
        image_selector="img.banner",
    )

    text, images = scrape_event_page("https://example.com/event/tote-bag", config)
    assert text == "Come and join us for a fun event painting tote bags."
    assert images == ["https://example.com/images/banner.png"]


@patch("services.scraper.directory_page.httpx.get")
def test_directory_artwork_prefers_event_metadata_and_lazy_source_over_spinner(mock_get):
    response = MagicMock()
    response.text = """<html><script type="application/ld+json">
    {"@type":"Event","url":"https://example.com/event/1","image":"/z-poster.jpg"}
    </script><header><img src="/a-header.jpg"></header><main>
    <h1>Campus lunch</h1><img src="/a-loading.gif" data-src="/b-lunch.jpg">
    <img src="/spinner.gif"><img src="/logo.png"></main></html>"""
    mock_get.return_value = response
    text, images = scrape_event_page("https://example.com/event/1", directory_config())
    assert "Campus lunch" in text
    assert images == ["https://example.com/z-poster.jpg", "https://example.com/b-lunch.jpg"]


@patch("services.scraper.directory_page.httpx.get")
def test_directory_with_only_body_chrome_does_not_invent_artwork(mock_get):
    response = MagicMock()
    response.text = '<body>Event details<img src="/unrelated-photo.jpg"></body>'
    mock_get.return_value = response
    text, images = scrape_event_page("https://example.com/event/1", directory_config())
    assert text
    assert images == []


@pytest.mark.parametrize(
    "school,handle",
    [
        ("cornell", "cornell_studentassembly"),
        ("wlu", "yourstudentsunion"),
        ("upenn", "pennua"),
        ("utsg", "uoftsu"),
    ],
)
def test_directory_fallback_is_student_government(school, handle):
    from services.scraper.directory_config import directory_configs

    config = next(c for c in directory_configs() if c.school == school)
    assert config.default_club_ig == handle


def test_directory_identity_does_not_match_another_host_with_the_same_path():
    from services.scraper.directory_config import directory_for_event

    assert directory_for_event("https://unrelated.example/event/poster", "uwaterloo") is None
    assert directory_for_event("https://wusa.ca/event/campus-event", "uwaterloo") is not None
    assert (
        directory_for_event("https://wusa.ca.evil.example/event/campus-event", "uwaterloo") is None
    )


@pytest.mark.parametrize(
    "directory_id, school",
    [
        ("utoronto-events", "utsg"),
        ("western-usc-events", "uwo"),
        ("queens-ams-events", "queensu"),
        ("yfs-events", "yorku"),
        ("uottawa-events", "ottawa"),
        ("ocad-events", "ocadu"),
        ("cadeul-events", "ulaval"),
        ("munsu-events", "mun"),
        ("uwsa-events", "uwindsor"),
    ],
)
def test_directory_configs_use_registered_school_slugs(directory_id, school):
    from services.scraper.directory_config import directory_configs

    config = next(row for row in directory_configs() if row.id == directory_id)
    assert config.school == school
