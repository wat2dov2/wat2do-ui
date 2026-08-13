"""Unit tests for services/scraper/directory_scraper."""

from unittest.mock import MagicMock, patch

import pytest

from services.scraper.directory_scraper import (
    DirectoryConfig,
    DirectoryScrapeResult,
    crawl_directory_links,
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
