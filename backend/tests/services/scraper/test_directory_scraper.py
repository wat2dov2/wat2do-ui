"""Unit tests for services/scraper/directory_scraper."""

from unittest.mock import MagicMock, patch

import pytest

from services.scraper.directory_scraper import (
    DirectoryConfig,
    crawl_directory_links,
    is_url_scraped,
    run_directory_pipeline,
    scrape_event_page,
)


def test_directory_config_instantiation():
    config = DirectoryConfig(
        id="test-dir",
        name="Test Directory",
        school="Test School",
        entry_url="https://example.com/events",
        event_url_contains="/event/",
        next_page_selector="a.next",
        content_selector=".desc",
        image_selector="img.banner",
    )
    assert config.id == "test-dir"
    assert config.name == "Test Directory"
    assert config.school == "Test School"
    assert config.entry_url == "https://example.com/events"
    assert config.event_url_contains == "/event/"
    assert config.next_page_selector == "a.next"
    assert config.content_selector == ".desc"
    assert config.image_selector == "img.banner"


@patch("services.scraper.directory_scraper.get_sb")
def test_is_url_scraped_true(mock_get_sb):
    # Set up mock query response
    mock_execute = MagicMock()
    mock_execute.data = [{"id": 42}]

    mock_eq = MagicMock()
    mock_eq.limit.return_value.execute.return_value = mock_execute

    mock_select = MagicMock()
    mock_select.eq.return_value = mock_eq

    mock_table = MagicMock()
    mock_table.select.return_value = mock_select

    mock_get_sb.return_value.table.return_value = mock_table

    assert is_url_scraped("https://example.com/event/1") is True
    mock_get_sb.return_value.table.assert_called_with("events")
    mock_select.eq.assert_called_with("source_url", "https://example.com/event/1")


@patch("services.scraper.directory_scraper.get_sb")
def test_is_url_scraped_false(mock_get_sb):
    # Set up empty response
    mock_execute = MagicMock()
    mock_execute.data = []

    mock_eq = MagicMock()
    mock_eq.limit.return_value.execute.return_value = mock_execute

    mock_select = MagicMock()
    mock_select.eq.return_value = mock_eq

    mock_table = MagicMock()
    mock_table.select.return_value = mock_select

    mock_get_sb.return_value.table.return_value = mock_table

    assert is_url_scraped("https://example.com/event/2") is False


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

    config = DirectoryConfig(
        id="test",
        name="Test",
        school="Test School",
        entry_url="https://example.com/events",
        event_url_contains="/event/",
        next_page_selector="a.next",
    )

    urls = crawl_directory_links(config, max_pages=2)
    assert len(urls) == 3
    assert "https://example.com/event/tote-bag" in urls
    assert "https://example.com/event/chess-lessons" in urls
    assert "https://example.com/event/trivia-night" in urls


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

    config = DirectoryConfig(
        id="test",
        name="Test",
        school="Test School",
        entry_url="https://example.com/events",
        event_url_contains="/event/",
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
@patch("services.scraper.directory_scraper.is_url_scraped")
def test_run_directory_pipeline_dry_run(
    mock_is_scraped, mock_extract, mock_upload, mock_scrape, mock_crawl
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
    mock_is_scraped.return_value = False

    config = DirectoryConfig(
        id="test",
        name="Test",
        school="Test School",
        entry_url="https://example.com/events",
        event_url_contains="/event/",
    )

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
    )
