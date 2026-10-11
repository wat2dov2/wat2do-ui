from types import SimpleNamespace

import pytest

from core.tables import INGESTION_ITEMS
from services.ingestion import items as module


@pytest.fixture
def sb(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.ingestion.items")
    monkeypatch.setattr(
        module.school_service, "get_school_by_id", lambda school_id: SimpleNamespace(slug="ubc")
    )
    return fake_sb


def _item(**overrides):
    fields = {
        "source_url": "https://www.instagram.com/p/A/",
        "school": "ubc",
        "source": "instagram",
        "post": None,
        "directory_source_id": None,
        "attempts": 1,
    }
    return module.Item(**{**fields, **overrides})


def test_claim_leases_one_row_at_a_stage(sb):
    sb.set_response(
        data=[
            {
                "source_url": "https://www.instagram.com/p/A/",
                "school_id": 3,
                "source": "instagram",
                "post": None,
                "directory_source_id": None,
                "attempts": 1,
            }
        ]
    )

    assert module.claim("fetch") == _item()
    sb.rpc.assert_called_once_with(
        "claim_ingestion_item",
        {"p_stage": "fetch", "p_lease_seconds": module.CONTROL.claim_lease_seconds},
    )


def test_claim_returns_none_when_nothing_waits(sb):
    assert module.claim("ready") is None


def test_a_fetched_post_becomes_ready_with_a_fresh_retry_budget(sb):
    module.mark_fetched(_item(attempts=2), {"url": "https://www.instagram.com/p/A/"})

    values = sb.update.call_args.args[0]
    assert values["status"] == "ready" and values["attempts"] == 0
    assert values["claimed_until"] is None
    sb.eq.assert_called_once_with("source_url", "https://www.instagram.com/p/A/")


def test_a_released_row_waits_then_is_given_up(sb):
    module.release(_item(attempts=1), "ready")
    waiting = sb.update.call_args.args[0]
    assert waiting["status"] == "ready" and waiting["claimed_until"] is not None

    module.release(_item(attempts=module.CONTROL.max_attempts), "ready")
    assert sb.update.call_args.args[0]["status"] == "failed"


@pytest.mark.parametrize(
    ("url", "key"),
    [
        ("https://www.instagram.com/p/ABC/", "https://www.instagram.com/p/ABC/"),
        ("https://instagram.com/reel/ABC", "https://www.instagram.com/p/ABC/"),
        ("https://www.instagram.com/tv/A_b-C/", "https://www.instagram.com/p/A_b-C/"),
    ],
)
def test_every_form_of_a_post_url_is_one_key(url, key):
    assert module.post_key(url) == key


@pytest.mark.parametrize(
    "url",
    ["https://www.instagram.com/uwimprov/", "https://evil.com/p/ABC/", "http://instagram.com/p/A/"],
)
def test_only_post_urls_have_a_key(url):
    with pytest.raises(ValueError):
        module.post_key(url)


def test_queue_instagram_adds_each_post_once_and_keeps_existing_rows(sb, monkeypatch):
    monkeypatch.setattr(module.school_service, "get_school_id", lambda slug: 3)
    sb.set_response(data=[{"source_url": "https://www.instagram.com/p/A/"}])

    queued = module.queue_instagram(
        ["https://www.instagram.com/p/A/", "https://www.instagram.com/reel/A/"], school="ubc"
    )

    assert queued == 1
    sb.table.assert_called_once_with(INGESTION_ITEMS)
    sb.upsert.assert_called_once_with(
        [{"source_url": "https://www.instagram.com/p/A/", "school_id": 3, "source": "instagram"}],
        on_conflict="source_url",
        ignore_duplicates=True,
    )


def test_queue_instagram_needs_a_registered_school(sb, monkeypatch):
    monkeypatch.setattr(module.school_service, "get_school_id", lambda slug: None)
    with pytest.raises(ValueError):
        module.queue_instagram(["https://www.instagram.com/p/A/"], school="nowhere")
