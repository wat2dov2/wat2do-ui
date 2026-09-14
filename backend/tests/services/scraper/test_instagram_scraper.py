"""Tests for the Apify Instagram scraper wrapper."""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from tenacity import wait_none

from services.scraper.instagram_scraper import (
    ACTOR_ID,
    PROFILE_ACTOR_ID,
    InstagramScraper,
    InstagramScraperError,
)


def _public_client(monkeypatch, handler):
    from services.scraper import instagram_scraper as module

    client_type = httpx.Client
    monkeypatch.setattr(module.settings, "apify_api_token", "")
    monkeypatch.setattr(module, "ApifyClient", lambda *_: pytest.fail("Apify must not be called"))
    monkeypatch.setattr(
        module.httpx,
        "Client",
        lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(InstagramScraper._fetch_embed.retry, "wait", wait_none())
    return InstagramScraper()


def test_exact_posts_need_no_apify_and_retry_transient_http_failure(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "shortcode": "ABC123",
                "owner": {"username": "club"},
                "caption": {"text": "Hello"},
                "display_url": "https://example.com/photo.jpg",
            },
        )

    scraper = _public_client(monkeypatch, handler)
    posts = scraper.scrape_posts(["https://www.instagram.com/p/ABC123/"])
    assert posts[0]["caption"] == "Hello"
    assert len(calls) == 2
    assert str(calls[0].url) == "https://www.instagram.com/p/ABC123/embed/captioned/"
    assert "cookie" not in calls[0].headers
    assert "authorization" not in calls[0].headers


@pytest.mark.parametrize("status", [302, 403, 404, 429])
def test_unavailable_post_fails_without_apify_or_aggressive_retry(monkeypatch, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"location": "https://example.com/login"})

    scraper = _public_client(monkeypatch, handler)
    with pytest.raises(InstagramScraperError, match="http failure"):
        scraper.scrape_posts(["https://www.instagram.com/p/ABC123/"])
    assert len(calls) == 1


def test_login_shell_fails_instead_of_empty_success(monkeypatch):
    scraper = _public_client(monkeypatch, lambda request: httpx.Response(200, text="Log in"))
    with pytest.raises(InstagramScraperError, match="content failure"):
        scraper.scrape_posts(["https://www.instagram.com/p/ABC123/"])


def test_invalid_target_never_requests_network(monkeypatch):
    scraper = _public_client(monkeypatch, lambda request: pytest.fail("Unexpected network call"))
    with pytest.raises(InstagramScraperError, match="input failure"):
        scraper.scrape_posts(["https://example.com/p/ABC123/"])


def _scraper_with_client(client: MagicMock, monkeypatch) -> InstagramScraper:
    monkeypatch.setattr("services.scraper.instagram_scraper.settings.apify_api_token", "test-token")
    monkeypatch.setattr("services.scraper.instagram_scraper.ApifyClient", lambda token: client)
    return InstagramScraper()


def test_scrape_uses_apify_run_model_attributes(monkeypatch):
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = [
        {"id": "post-1", "isPinned": False}
    ]

    posts, pinned_warning = _scraper_with_client(client, monkeypatch).scrape_latest(
        "wat2do",
        results_limit=1,
    )

    assert posts == [{"id": "post-1", "isPinned": False}]
    assert pinned_warning is False
    client.actor.assert_called_once_with(ACTOR_ID)
    client.run.assert_called_once_with("run-123")
    client.dataset.assert_called_once_with("dataset-456")


def test_scrape_raises_sanitized_terminal_error_when_apify_run_fails(monkeypatch):
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="FAILED",
        default_dataset_id=None,
    )

    with pytest.raises(InstagramScraperError) as raised:
        _scraper_with_client(client, monkeypatch).scrape_latest("wat2do")

    assert raised.value.stage == "terminal"
    assert str(raised.value) == "Instagram scraper provider terminal failure"
    client.dataset.assert_not_called()


@pytest.mark.parametrize("failure_stage", ["start", "poll", "dataset"])
def test_scrape_raises_sanitized_provider_errors(failure_stage, caplog, monkeypatch):
    secret = f"secret-{failure_stage}-provider-detail"
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )

    if failure_stage == "start":
        monkeypatch.setattr(
            "services.scraper.instagram_scraper.wait_exponential_jitter",
            lambda **kwargs: wait_none(),
        )
        client.actor.return_value.start.side_effect = RuntimeError(secret)
    elif failure_stage == "poll":
        client.run.return_value.get.side_effect = RuntimeError(secret)
    else:
        client.dataset.return_value.list_items.side_effect = RuntimeError(secret)

    with caplog.at_level(logging.ERROR), pytest.raises(InstagramScraperError) as raised:
        _scraper_with_client(client, monkeypatch).scrape_latest("wat2do")

    assert raised.value.stage == failure_stage
    assert str(raised.value) == f"Instagram scraper provider {failure_stage} failure"
    assert secret not in str(raised.value)
    assert secret not in caplog.text
    assert client.actor.return_value.start.call_count == (5 if failure_stage == "start" else 1)


def test_scrape_preserves_successful_empty_dataset(monkeypatch):
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = []

    posts, pinned_warning = _scraper_with_client(client, monkeypatch).scrape_latest("wat2do")

    assert posts == []
    assert pinned_warning is False


def test_scrape_profiles_sends_all_identifiers_to_profile_actor(monkeypatch):
    client = MagicMock()
    client.actor.return_value.start.return_value = SimpleNamespace(id="run-123")
    client.run.return_value.get.return_value = SimpleNamespace(
        status="SUCCEEDED",
        default_dataset_id="dataset-456",
    )
    client.dataset.return_value.list_items.return_value.items = [
        {"id": "42", "username": "wat2do", "profilePicUrlHD": "https://cdn/logo.jpg"}
    ]

    profiles = _scraper_with_client(client, monkeypatch).scrape_profiles(["wat2do", " 42 ", ""])

    assert profiles == [
        {"id": "42", "username": "wat2do", "profilePicUrlHD": "https://cdn/logo.jpg"}
    ]
    client.actor.assert_called_once_with(PROFILE_ACTOR_ID)
    client.actor.return_value.start.assert_called_once_with(
        run_input={"usernames": ["wat2do", "42"]}
    )
