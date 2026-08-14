"""Tests for the Apify Instagram scraper wrapper."""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.scraper.instagram_scraper import (
    ACTOR_ID,
    PROFILE_ACTOR_ID,
    InstagramScraper,
    InstagramScraperError,
)


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


def test_scrape_raises_sanitized_terminal_error_when_apify_run_fails():
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="FAILED",
        default_dataset_id=None,
    )

    with pytest.raises(InstagramScraperError) as raised:
        _scraper_with_client(client).scrape("wat2do")

    assert raised.value.stage == "terminal"
    assert str(raised.value) == "Instagram scraper provider terminal failure"
    client.dataset.assert_not_called()


@pytest.mark.parametrize("failure_stage", ["start", "poll", "dataset"])
def test_scrape_raises_sanitized_provider_errors(failure_stage, caplog):
    secret = f"secret-{failure_stage}-provider-detail"
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )

    if failure_stage == "start":
        client.actor.return_value.start.side_effect = RuntimeError(secret)
    elif failure_stage == "poll":
        client.run.return_value.get.side_effect = RuntimeError(secret)
    else:
        client.dataset.return_value.list_items.side_effect = RuntimeError(secret)

    with caplog.at_level(logging.ERROR), pytest.raises(InstagramScraperError) as raised:
        _scraper_with_client(client).scrape("wat2do")

    assert raised.value.stage == failure_stage
    assert str(raised.value) == f"Instagram scraper provider {failure_stage} failure"
    assert secret not in str(raised.value)
    assert secret not in caplog.text


def test_scrape_preserves_successful_empty_dataset():
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = []

    posts, pinned_warning = _scraper_with_client(client).scrape("wat2do")

    assert posts == []
    assert pinned_warning is False


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
