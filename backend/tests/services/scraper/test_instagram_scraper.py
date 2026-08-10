"""Tests for the Apify Instagram scraper wrapper."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from services.scraper.instagram_scraper import ACTOR_ID, PROFILE_ACTOR_ID, InstagramScraper


def _scraper_with_client(client: MagicMock) -> InstagramScraper:
    scraper = InstagramScraper(token="test-token")
    scraper._client = client
    return scraper


def test_scrape_uses_apify_run_model_attributes():
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = [
        {"id": "post-1", "isPinned": False}
    ]

    posts, pinned_warning = _scraper_with_client(client).scrape(
        "wat2do",
        results_limit=1,
    )

    assert posts == [{"id": "post-1", "isPinned": False}]
    assert pinned_warning is False
    client.actor.assert_called_once_with(ACTOR_ID)
    client.run.assert_called_once_with("run-123")
    client.dataset.assert_called_once_with("dataset-456")


def test_scrape_returns_empty_when_apify_run_fails():
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="FAILED",
        default_dataset_id=None,
    )

    posts, pinned_warning = _scraper_with_client(client).scrape("wat2do")

    assert posts == []
    assert pinned_warning is False
    client.dataset.assert_not_called()


def test_scrape_profiles_sends_all_identifiers_to_profile_actor():
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = [
        {"id": "42", "username": "wat2do", "profilePicUrlHD": "https://cdn/logo.jpg"}
    ]

    profiles = _scraper_with_client(client).scrape_profiles(["wat2do", " 42 ", ""])

    assert profiles == [
        {"id": "42", "username": "wat2do", "profilePicUrlHD": "https://cdn/logo.jpg"}
    ]
    client.actor.assert_called_once_with(PROFILE_ACTOR_ID)
    client.actor.return_value.start.assert_called_once_with(
        run_input={"usernames": ["wat2do", "42"]}
    )
