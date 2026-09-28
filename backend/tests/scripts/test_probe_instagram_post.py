import json
from unittest.mock import MagicMock

import pytest

from core.config import settings
from scripts import probe_instagram_post as command

URL = "https://www.instagram.com/reel/DdyqycEINNe/"


@pytest.fixture
def scraper(monkeypatch):
    monkeypatch.setattr(settings, "apify_api_token", "test-token")
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr("sys.argv", ["probe_instagram_post.py", "--url", URL, "--transcribe"])
    scraper = MagicMock()
    monkeypatch.setattr(command, "get_scraper", lambda: scraper)
    return scraper


def test_command_prints_transcript_json(scraper, monkeypatch, capsys):
    post = {"url": URL, "videoUrl": "https://example.test/video"}
    scraper.scrape_posts.return_value = [post]
    result = {"url": URL, "caption": "caption", "transcript": "speech"}
    transcribe = MagicMock(return_value=result)
    monkeypatch.setattr(command, "transcribe_post", transcribe)
    assert command.main() == 0
    assert json.loads(capsys.readouterr().out) == result
    transcribe.assert_called_once_with(post)


@pytest.mark.parametrize(
    "posts", [[], [{"url": "https://www.instagram.com/reel/wrong/"}], [{"error": "unavailable"}]]
)
def test_command_rejects_missing_or_wrong_post(scraper, posts, capsys):
    scraper.scrape_posts.return_value = posts
    assert command.main() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "requested post" in captured.err


@pytest.mark.parametrize("setting", ["openai_api_key", "apify_api_token"])
def test_missing_configuration_does_not_start_paid_scrape(scraper, monkeypatch, setting):
    monkeypatch.setattr(settings, setting, "")
    assert command.main() == 1
    scraper.scrape_posts.assert_not_called()


def test_inspection_still_works_without_openai(scraper, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["probe_instagram_post.py", "--url", URL])
    monkeypatch.setattr(settings, "openai_api_key", "")
    post = {"url": URL, "caption": "hello"}
    scraper.scrape_posts.return_value = [post]
    assert command.main() == 0
    assert json.loads(capsys.readouterr().out) == post
