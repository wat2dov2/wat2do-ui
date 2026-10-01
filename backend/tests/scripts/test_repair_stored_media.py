import json
from dataclasses import replace
from unittest.mock import MagicMock

import pytest

from scripts import repair_stored_media as script
from services.scraper.media_repair import MediaRepairTarget


@pytest.fixture
def target(monkeypatch):
    target = MediaRepairTarget(
        resource="events",
        id=29122,
        school="uwaterloo",
        source_url="https://www.instagram.com/p/ORIGINAL/",
        source_image_url=None,
        source_video_url=None,
    )
    monkeypatch.setattr(script, "load_media_target", lambda *_: target)
    return target


def test_default_video_preview_does_not_fetch_upload_or_write(target, monkeypatch, capsys):
    provider = MagicMock()
    monkeypatch.setattr(script, "get_scraper", provider)
    assert script.main(["video", "--event-id", "29122"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "needs_source"
    assert result["apply"] is False
    provider.assert_not_called()


def test_fetch_is_one_exact_post_and_still_only_previews(target, monkeypatch, capsys):
    provider = MagicMock()
    provider.scrape_posts.return_value = [
        {"url": target.source_url, "videoUrl": "https://scontent.cdninstagram.com/post.mp4"}
    ]
    monkeypatch.setattr(script, "get_scraper", lambda: provider)
    assert script.main(["video", "--event-id", "29122", "--fetch"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "ready"
    assert result["apply"] is False
    provider.scrape_posts.assert_called_once_with([target.source_url])


def test_already_repaired_video_skips_provider_even_with_fetch(target, monkeypatch, capsys):
    monkeypatch.setattr(
        script,
        "load_media_target",
        lambda *_: replace(
            target, source_video_url="https://wat2do.io/media/event-videos/existing.mp4"
        ),
    )
    provider = MagicMock()
    monkeypatch.setattr(script, "get_scraper", provider)
    assert script.main(["video", "--event-id", "29122", "--fetch", "--apply"]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "already_present"
    provider.assert_not_called()


def test_provider_mismatch_and_raw_errors_never_export_signed_urls(target, monkeypatch, capsys):
    provider = MagicMock()
    provider.scrape_posts.return_value = [{"url": "https://instagram.com/p/OTHER/"}]
    monkeypatch.setattr(script, "get_scraper", lambda: provider)
    assert script.main(["video", "--event-id", "29122", "--fetch"]) == 1
    assert "exact post" in capsys.readouterr().err
    provider.scrape_posts.side_effect = RuntimeError("secret-signed-url")
    assert script.main(["video", "--event-id", "29122", "--fetch"]) == 1
    error = capsys.readouterr().err
    assert "RuntimeError" in error
    assert "secret-signed-url" not in error


def test_apply_without_source_does_not_claim_success(target, capsys):
    assert script.main(["video", "--event-id", "29122", "--apply"]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "needs_source"


def test_image_preview_and_apply_share_exact_target(target, monkeypatch):
    repair = MagicMock(return_value={"status": "ready"})
    monkeypatch.setattr(script, "repair_stored_image", repair)
    assert script.main(["image", "--event-id", "29122"]) == 0
    repair.assert_called_once_with(target, apply=False)
    repair.return_value = {"status": "updated"}
    assert script.main(["image", "--event-id", "29122", "--apply"]) == 0
    repair.assert_called_with(target, apply=True)


def test_cli_requires_one_target_and_rejects_provider_flags_for_images():
    for arguments in (
        ["image"],
        ["image", "--event-id", "1", "--position-id", "2"],
        ["image", "--event-id", "1", "--fetch"],
    ):
        with pytest.raises(SystemExit):
            script.main(arguments)


def test_instagram_image_fetch_uses_existing_exact_post_repair_path(target, monkeypatch, capsys):
    provider = MagicMock()
    provider.scrape_posts.return_value = [
        {"url": target.source_url, "displayUrl": "https://scontent.cdninstagram.com/poster.jpg"}
    ]
    monkeypatch.setattr(script, "get_scraper", lambda: provider)
    repair = MagicMock(side_effect=[{"status": "needs_source"}, {"status": "ready"}])
    monkeypatch.setattr(script, "repair_instagram_image", repair)
    assert script.main(["instagram-image", "--event-id", "29122", "--fetch"]) == 0
    provider.scrape_posts.assert_called_once_with([target.source_url])
    assert repair.call_args.args == (target, provider.scrape_posts.return_value[0])
    assert repair.call_args.kwargs == {"apply": False}
    assert json.loads(capsys.readouterr().out)["status"] == "ready"
