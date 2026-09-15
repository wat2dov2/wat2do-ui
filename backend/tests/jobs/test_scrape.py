"""Tests for single-target scrape workflow exit semantics."""

import logging

import pytest

from jobs import scrape
from services.scraper.instagram_scraper import InstagramScraperError


def _run_with_empty_provider_result(monkeypatch, targets: list[str]) -> int:
    monkeypatch.setattr(scrape, "resolve_single_user_scrape_school", lambda: "uwaterloo")
    monkeypatch.setattr(scrape, "get_scraper", lambda: object())
    monkeypatch.setattr(
        scrape,
        "fetch_posts_for_targets",
        lambda *_args, **_kwargs: ([], False),
    )
    return scrape.run(
        targets=targets,
        cutoff_days=1,
        dry_run=False,
        allow_past_events=False,
    )


@pytest.mark.parametrize("path", ["p/POST123", "reel/REEL123", "tv/TV123"])
def test_run_fails_when_exact_post_url_returns_no_valid_post(monkeypatch, path):
    status = _run_with_empty_provider_result(
        monkeypatch,
        [f"https://www.instagram.com/{path}/"],
    )

    assert status == 1


@pytest.mark.parametrize(
    "target",
    [
        "wat2do",
        "@wat2do",
        "https://www.instagram.com/wat2do/",
        "https://example.com/p/POST123/",
    ],
)
def test_run_succeeds_when_non_post_target_returns_no_posts(monkeypatch, target):
    assert _run_with_empty_provider_result(monkeypatch, [target]) == 0


def test_run_succeeds_when_mixed_targets_return_no_posts(monkeypatch):
    assert (
        _run_with_empty_provider_result(
            monkeypatch,
            ["https://www.instagram.com/p/POST123/", "wat2do"],
        )
        == 0
    )


@pytest.mark.parametrize(
    "returned_urls",
    [
        ["https://www.instagram.com/p/WRONG123/"],
        [
            "https://www.instagram.com/p/POST123/",
            "https://www.instagram.com/p/EXTRA123/",
        ],
    ],
)
def test_run_fails_before_pipeline_when_exact_provider_media_does_not_match(
    monkeypatch,
    returned_urls,
):
    monkeypatch.setattr(scrape, "resolve_single_user_scrape_school", lambda: "uwaterloo")
    monkeypatch.setattr(scrape, "get_scraper", lambda: object())
    monkeypatch.setattr(
        scrape,
        "fetch_posts_for_targets",
        lambda *_args, **_kwargs: ([{"url": url} for url in returned_urls], False),
    )
    monkeypatch.setattr(
        scrape,
        "run_pipeline",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("mismatched exact media must not reach the pipeline")
        ),
    )

    status = scrape.run(
        targets=["https://www.instagram.com/p/POST123/"],
        cutoff_days=1,
        dry_run=False,
        allow_past_events=False,
    )

    assert status == 1


def test_run_converts_sanitized_provider_failure_to_nonzero(monkeypatch, caplog):
    secret = "raw-provider-secret"
    monkeypatch.setattr(scrape, "resolve_single_user_scrape_school", lambda: "uwaterloo")
    monkeypatch.setattr(scrape, "get_scraper", lambda: object())

    def fail(*_args, **_kwargs):
        try:
            raise RuntimeError(secret)
        except RuntimeError:
            raise InstagramScraperError("poll") from None

    monkeypatch.setattr(scrape, "fetch_posts_for_targets", fail)

    with caplog.at_level(logging.ERROR):
        status = scrape.run(
            targets=["wat2do"],
            cutoff_days=1,
            dry_run=False,
            allow_past_events=False,
        )

    assert status == 1
    assert "Instagram scraper provider poll failure" in caplog.text
    assert secret not in caplog.text


def test_content_failure_reason_reaches_workflow_logs(monkeypatch, caplog):
    from services.scraper.instagram_scraper import InstagramScraper

    target = "https://www.instagram.com/p/POST123/"
    monkeypatch.setattr(scrape, "resolve_single_user_scrape_school", lambda: "uwaterloo")
    monkeypatch.setattr(scrape, "get_scraper", InstagramScraper)
    monkeypatch.setattr(
        InstagramScraper, "_fetch_embed", lambda *_: "<html>private-response-content</html>"
    )
    with caplog.at_level(logging.ERROR):
        status = scrape.run(
            targets=[target], cutoff_days=1825, dry_run=False, allow_past_events=False
        )
    assert status == 1
    assert target in caplog.text
    assert "No complete matching media object returned" in caplog.text
    assert "private-response-content" not in caplog.text


def test_exact_post_ingestion_uses_embed_data_without_apify(monkeypatch):
    import json
    from unittest.mock import MagicMock

    from services.scraper.instagram_scraper import InstagramScraper

    url = "https://www.instagram.com/p/POST123/"
    payload = {
        "shortcode": "POST123",
        "owner": {"username": "club"},
        "caption": {"text": "Join us!"},
        "carousel_media_count": 2,
        "carousel_media": [
            {"display_url": "https://example.com/1.jpg"},
            {"display_url": "https://example.com/2.jpg"},
        ],
    }
    monkeypatch.setattr(scrape, "resolve_single_user_scrape_school", lambda: "ulaval")
    monkeypatch.setattr(scrape, "get_scraper", InstagramScraper)
    monkeypatch.setattr(
        InstagramScraper, "_fetch_embed", staticmethod(lambda *_: json.dumps(payload))
    )
    monkeypatch.setattr(InstagramScraper, "_run_actor", lambda *_a, **_k: pytest.fail("Apify call"))
    pipeline = MagicMock(return_value=scrape.ScrapeResult(ig_handle="club", posts_fetched=1))
    monkeypatch.setattr(scrape, "run_pipeline", pipeline)
    monkeypatch.setattr(scrape, "_log_automate_event", lambda *_: None)
    assert scrape.run(targets=[url], cutoff_days=1, dry_run=False, allow_past_events=False) == 0
    post = pipeline.call_args.kwargs["posts"][0]
    assert pipeline.call_args.kwargs["school"] == "ulaval"
    assert post["timestamp"] is None
    assert len(post["images"]) == 2
