"""Unit tests for services/scraper/directory_scraper."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from services.scraper.directory_scraper import (
    DirectoryConfig,
    _resolve_directory_club,
    crawl_directory_links,
    run_directory_pipeline,
    scrape_event_page,
)
from services.scraper.org_resolve import ResolvedClub


def directory_config(**overrides) -> DirectoryConfig:
    values = {
        "id": "test",
        "name": "Test",
        "school": "test-school",
        "default_club": "Test Students' Union",
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
        "laval",
        "mcmaster",
        "mcgill",
        "memorial",
        "mit",
        "nyu",
        "ocad",
        "ontariotech",
        "queens",
        "sfu",
        "tmu",
        "ualberta",
        "ubc",
        "ucalgary",
        "udem",
        "umanitoba",
        "uottawa",
        "upenn",
        "uqam",
        "usask",
        "utoronto",
        "utsc",
        "utm",
        "uwaterloo",
        "western",
        "windsor",
        "wlu",
        "york",
    }
    assert len({config.id for config in configs}) == len(configs)
    assert all(config.default_club for config in configs)
    assert all(config.event_url_patterns for config in configs)


@patch("services.scraper.dedup.get_sb")
def test_existing_urls_mock(mock_get_sb):
    from services.scraper.dedup import existing_urls

    mock_execute = MagicMock()
    mock_execute.data = [{"source_url": "https://example.com/event/1"}]
    mock_range = MagicMock()
    mock_range.execute.return_value = mock_execute
    mock_order = MagicMock()
    mock_order.range.return_value = mock_range
    mock_in = MagicMock()
    mock_in.order.return_value = mock_order
    mock_select = MagicMock()
    mock_select.in_.return_value = mock_in
    mock_table = MagicMock()
    mock_table.select.return_value = mock_select
    mock_get_sb.return_value.table.return_value = mock_table

    assert "https://example.com/event/1" in existing_urls({"https://example.com/event/1"})


@patch("services.scraper.directory_scraper.httpx.Client")
def test_crawl_directory_links(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client

    # Response for Page 1
    resp1 = MagicMock()
    resp1.text = """
    <html>
        <body>
            <a href="/event/tote-bag">Tote Bag Event</a>
            <a href="/event/chess-lessons">Chess Lessons</a>
            <a href="https://other.com/about">About Us</a>
            <a class="next" href="/events?page=2">Next Page</a>
        </body>
    </html>
    """
    resp1.raise_for_status = MagicMock()

    # Response for Page 2
    resp2 = MagicMock()
    resp2.text = """
    <html>
        <body>
            <a href="/event/trivia-night">Trivia Night</a>
        </body>
    </html>
    """
    resp2.raise_for_status = MagicMock()

    mock_client.get.side_effect = [resp1, resp2]

    config = directory_config(school="Test School", next_page_selector="a.next")

    urls = crawl_directory_links(config, max_pages=2)
    assert len(urls) == 3
    assert "https://example.com/event/tote-bag" in urls
    assert "https://example.com/event/chess-lessons" in urls
    assert "https://example.com/event/trivia-night" in urls


@patch("services.scraper.directory_scraper.httpx.Client")
def test_html_crawl_discovers_json_ld_event_urls(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client
    response = MagicMock()
    response.text = """
    <script type="application/ld+json">
      {"@type":"Event","url":"https://example.com/event/welcome?instance=42#details"}
    </script>
    <a href="https://facebook.com/share?u=https://example.com/event/welcome">Share</a>
    """
    response.raise_for_status = MagicMock()
    mock_client.get.return_value = response

    assert crawl_directory_links(directory_config(), max_pages=1) == [
        "https://example.com/event/welcome?instance=42"
    ]


@patch("services.scraper.directory_scraper.httpx.Client")
def test_json_crawl_discovers_event_urls(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client
    response = MagicMock()
    response.json.return_value = [
        {"title": "Welcome", "url": "https://events.example.edu/event/welcome"},
        {
            "title": {"rendered": "Orientation"},
            "link": "https://events.example.edu/event/orientation",
        },
        {"image": {"url": "https://cdn.example.edu/event-image.jpg"}},
    ]
    response.raise_for_status = MagicMock()
    mock_client.get.return_value = response
    config = directory_config(
        source_format="json",
        entry_url="https://events.example.edu/live/json/events",
        event_url_patterns=["events.example.edu/event/"],
        json_url_fields=["url", "link"],
    )

    assert crawl_directory_links(config, max_pages=5) == [
        "https://events.example.edu/event/welcome",
        "https://events.example.edu/event/orientation",
    ]
    mock_client.get.assert_called_once()


@patch("services.scraper.directory_scraper.httpx.Client")
def test_ical_crawl_preserves_identity_query_params(mock_client_cls):
    mock_client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = mock_client
    response = MagicMock()
    response.content = b"""BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:welcome@example.edu\r
DTSTART:20990901T170000Z\r
SUMMARY:Welcome\r
URL:https://groups.example.edu/rsvp?id=42\r
END:VEVENT\r
END:VCALENDAR\r
"""
    response.raise_for_status = MagicMock()
    mock_client.get.return_value = response
    config = directory_config(
        source_format="ical",
        entry_url="https://groups.example.edu/events.ics",
        event_url_patterns=["groups.example.edu/rsvp"],
    )

    assert crawl_directory_links(config, max_pages=5) == ["https://groups.example.edu/rsvp?id=42"]
    mock_client.get.assert_called_once()


@patch("services.scraper.directory_scraper.resolve_club_for_scrape")
def test_directory_club_falls_back_to_trusted_publisher(mock_resolve):
    mock_resolve.side_effect = [
        ResolvedClub(None, "WUSAThrift", None),
        ResolvedClub(7, "WUSA", None),
    ]
    event = {"club": "WUSAThrift"}
    config = directory_config(
        school="uwaterloo",
        default_club="WUSA",
    )

    resolved = _resolve_directory_club(event, config)

    assert event["club"] == "WUSA"
    assert resolved.club_id == 7
    assert mock_resolve.call_count == 2


@patch("services.scraper.directory_scraper.resolve_club_for_scrape")
def test_directory_club_keeps_a_known_explicit_host(mock_resolve):
    mock_resolve.return_value = ResolvedClub(9, "UW Tea Club", "uwteaclub")
    event = {"club": "UW Tea Club"}

    resolved = _resolve_directory_club(event, directory_config(school="uwaterloo"))

    assert event["club"] == "UW Tea Club"
    assert resolved.club_id == 9
    mock_resolve.assert_called_once()


@patch("services.scraper.directory_scraper.httpx.get")
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


@patch("services.scraper.directory_scraper.crawl_directory_links")
@patch("services.scraper.directory_scraper.scrape_event_page")
@patch("services.scraper.directory_scraper.upload_post_images")
@patch("services.scraper.directory_scraper.extract_events_from_post")
@patch("services.scraper.directory_scraper.existing_urls")
def test_run_directory_pipeline_dry_run(
    mock_existing_urls, mock_extract, mock_upload, mock_scrape, mock_crawl
):
    mock_crawl.return_value = ["https://example.com/event/1"]
    mock_scrape.return_value = ("Event text content", ["https://example.com/img.png"])
    mock_upload.return_value = ["https://supabase.com/stored.png"]
    mock_extract.return_value = [
        {
            "title": "Mocked Event",
            "description": "Mocked desc",
            "location": "SLC",
            "occurrences": [],
        }
    ]
    mock_existing_urls.return_value = set()

    config = directory_config(school="Test School")

    result = run_directory_pipeline(config, max_pages=1, dry_run=True)

    assert result.directory_name == "Test"
    assert result.pages_crawled == 1
    assert result.urls_found == 1
    assert result.urls_new == 1
    assert result.events_extracted == 1
    assert result.events_saved == 1

    mock_crawl.assert_called_once_with(config, max_pages=1)
    mock_scrape.assert_called_once_with("https://example.com/event/1", config)
    mock_upload.assert_called_once_with(["https://example.com/img.png"], allow_all_domains=True)
    mock_extract.assert_called_once_with(
        caption_text="Event text content",
        image_urls=["https://supabase.com/stored.png"],
        post_created_at=None,
        school="Test School",
        source_club="Test Students' Union",
    )


@pytest.mark.parametrize(
    "title,old_location,new_location",
    [
        ("Campus Life Fair", "SLC Great Hall", "SLC Great Hall"),
        (
            "Fruit & Veggie Market",
            "SLC Marketplace",
            "Student Life Centre, Pearl Sullivan Engineering",
        ),
    ],
)
def test_wusa_pipeline_updates_existing_event_with_canonical_owner(
    monkeypatch,
    title,
    old_location,
    new_location,
):
    from services import club_service
    from services.scraper import dedup, directory_scraper, event_writer

    configs = json.loads(
        (Path(__file__).parents[3] / "services/scraper/urls/directories.json").read_text()
    )
    config = DirectoryConfig.model_validate(next(row for row in configs if row["id"] == "wusa"))
    canonical_name = "Waterloo Undergraduate Student Association"
    club = {"id": 6943, "club_name": canonical_name, "ig": "yourwusa"}
    monkeypatch.setattr(
        club_service,
        "lookup_club_by_school_and_name",
        lambda school, name: club if school == "uwaterloo" and name == canonical_name else None,
    )
    monkeypatch.setattr(event_writer, "_lookup_club_by_ig", lambda _: None)
    occurrence = {"dtstart_utc": "2099-09-23T15:00:00Z", "dtend_utc": "2099-09-23T18:00:00Z"}
    candidate = {
        "id": 18880,
        "title": title,
        "location": old_location,
        "club_id": 6943,
        "ig_handle": "yourwusa",
        "event_dates": [occurrence],
    }
    monkeypatch.setattr(
        dedup, "_fetch_org_events_by_id", lambda club_id: [candidate] if club_id == 6943 else []
    )
    monkeypatch.setattr(dedup, "_fetch_day_events", lambda *_: [])
    monkeypatch.setattr(
        directory_scraper,
        "crawl_directory_links",
        lambda *_args, **_kwargs: ["https://wusa.ca/event/example"],
    )
    monkeypatch.setattr(directory_scraper, "existing_urls", lambda _: set())
    monkeypatch.setattr(directory_scraper, "scrape_event_page", lambda *_: ("Event details", []))
    monkeypatch.setattr(
        directory_scraper,
        "extract_events_from_post",
        lambda **_: [
            {"title": title, "location": new_location, "club": "WUSA", "occurrences": [occurrence]}
        ],
    )
    monkeypatch.setattr("services.scraper.reconciler._client", lambda: None)
    write = MagicMock(return_value="updated")
    monkeypatch.setattr(directory_scraper, "write_event", write)

    result = run_directory_pipeline(config)

    assert result.errors == []
    assert result.events_updated == 1
    saved = write.call_args.args[0]
    assert saved["id"] == 18880
    assert saved["location"] == new_location
    assert write.call_args.kwargs["resolved_org"].club_id == 6943
