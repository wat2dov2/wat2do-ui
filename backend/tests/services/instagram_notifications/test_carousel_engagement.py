from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event, Lock
from types import SimpleNamespace
from unittest.mock import call

import pytest

from core.constants import INSTAGRAM_BATCH_PUBLISHED
from core.tables import (
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
    INSTAGRAM_PUBLISHING_ACCOUNTS,
)
from services.instagram_notifications import carousel_engagement
from services.instagram_notifications.browser_queue import BrowserJobQueue

NOW = datetime(2026, 9, 28, 15, tzinfo=timezone.utc)
ACTIVATED_AT = "2026-09-28T14:00:00+00:00"
BATCH_ID = "00000000-0000-0000-0000-000000000001"


def _account(**overrides):
    return {
        "account_key": "waterloo",
        "school_id": 7,
        "instagram_user_id": "17840000000001",
        "instagram_username": "waterloo.wat2do.io",
        "school_record": {"slug": "waterloo", "recipient_id": "76214170483"},
        **overrides,
    }


def _batch(**overrides):
    return {
        "id": BATCH_ID,
        "account_key": "waterloo",
        "school_id": 7,
        "instagram_user_id": "17840000000001",
        "published_at": "2026-09-28T14:30:00+00:00",
        **overrides,
    }


def _item(event_id=42, source_url="https://www.instagram.com/p/SOURCE42/"):
    return {
        "id": f"item-{event_id}",
        "event_id": event_id,
        "event": {"source_url": source_url},
    }


@pytest.fixture
def queue(tmp_path):
    queue = BrowserJobQueue(tmp_path)
    queue.set_setting("carousel_engagement_activated_at", ACTIVATED_AT)
    queue.set_setting("carousel_engagement_source_registered", True)
    return queue


@pytest.fixture(autouse=True)
def mock_delivery_ledger(patch_sb, fake_sb):
    patch_sb("services.instagram_notifications.ledger")
    frozen = {}
    lock = Lock()

    def rpc(name, params):
        if name != "freeze_instagram_browser_sources":
            return fake_sb
        with lock:
            sources = frozen.setdefault(
                params["p_batch_id"], [dict(source) for source in params["p_sources"]]
            )
            response = [dict(source) for source in sources]
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=response))

    fake_sb.rpc.side_effect = rpc
    return frozen


def _drain(queue):
    jobs = []
    while job := queue.claim_next():
        jobs.append(job)
        queue.finish(job, result={"status": "done"})
    return jobs


def test_first_run_persists_activation_without_historical_backfill(tmp_path, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue = BrowserJobQueue(tmp_path)
    fake_sb.queue_responses([NOW.isoformat(), []])

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 0, "posts": 0, "submitted": 0, "skipped": 0}
    assert queue.get_setting("carousel_engagement_activated_at") == NOW.isoformat()
    fake_sb.gte.assert_called_once_with("published_at", NOW.isoformat())
    fake_sb.lte.assert_called_once_with("published_at", NOW.isoformat())
    fake_sb.eq.assert_any_call("status", INSTAGRAM_BATCH_PUBLISHED)

    restarted = BrowserJobQueue(tmp_path)
    fake_sb.queue_responses([[]])
    carousel_engagement.sync_published_carousels(restarted, now=NOW + timedelta(days=1))
    assert fake_sb.gte.call_args_list == [
        call("published_at", NOW.isoformat()),
        call("published_at", NOW.isoformat()),
    ]
    fake_sb.rpc.assert_called_once_with(
        "ensure_instagram_browser_source", {"p_activated_at": NOW.isoformat()}
    )


def test_published_selection_enqueues_original_post_for_school_account_only(
    queue, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [[_batch()], [_account()], [_item(source_url="https://instagram.com/p/SOURCE42?utm=x")]]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 1, "posts": 1, "submitted": 1, "skipped": 0}
    jobs = _drain(queue)
    assert len(jobs) == 1
    assert "action" not in jobs[0].payload
    for job in jobs:
        assert job.recipient_id == "76214170483"
        assert job.account_username == "waterloo.wat2do.io"
        assert job.school == "waterloo"
        assert job.payload["event_id"] == 42
        assert job.payload["post_url"] == "https://www.instagram.com/p/SOURCE42/"

    assert fake_sb.table.call_args_list == [
        call(INSTAGRAM_PUBLISH_BATCHES),
        call(INSTAGRAM_PUBLISHING_ACCOUNTS),
        call(INSTAGRAM_PUBLISH_ITEMS),
        call(INSTAGRAM_PUBLISH_BATCHES),
    ]
    fake_sb.eq.assert_any_call("enabled", True)
    fake_sb.eq.assert_any_call("status", INSTAGRAM_BATCH_PUBLISHED)
    fake_sb.eq.assert_any_call("batch_id", BATCH_ID)
    fake_sb.is_.assert_called_once_with("published_at", "null")
    fake_sb.gte.assert_called_once_with("published_at", ACTIVATED_AT)
    # Only public source metadata is read; delivery returns no row representation.
    selected_columns = [entry.args[0] for entry in fake_sb.select.call_args_list]
    assert not any("*" in columns or "token" in columns for columns in selected_columns)
    fake_sb.insert.assert_not_called()
    fake_sb.update.assert_called_once_with(
        {
            "browser_delivery_generation": queue.delivery_generation,
            "browser_delivery_sources": [
                {"post_url": "https://www.instagram.com/p/SOURCE42/", "event_id": 42}
            ],
        },
        returning="minimal",
    )
    fake_sb.upsert.assert_not_called()
    fake_sb.rpc.assert_called_once_with(
        "freeze_instagram_browser_sources",
        {
            "p_batch_id": BATCH_ID,
            "p_sources": [{"post_url": "https://www.instagram.com/p/SOURCE42/", "event_id": 42}],
        },
    )


def test_non_instagram_sources_and_missing_sources_are_skipped(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [
            [_batch()],
            [_account()],
            [
                _item(1, "https://example.com/p/SOURCE42/"),
                _item(2, None),
                _item(3, "https://www.instagram.com/club/"),
                _item(4, "https://www.instagram.com/reel/REEL44/"),
            ],
        ]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 1, "posts": 1, "submitted": 1, "skipped": 3}
    assert {job.payload["post_url"] for job in _drain(queue)} == {
        "https://www.instagram.com/reel/REEL44/"
    }


@pytest.mark.parametrize(
    "accounts",
    [
        [],
        [_account(school_id=8)],
        [_account(instagram_user_id="17849999999999")],
        [_account(school_record={"slug": "waterloo", "recipient_id": None})],
        [_account(school_record={"slug": "waterloo", "recipient_id": "0"})],
    ],
)
def test_unconfigured_disabled_or_mismatched_accounts_cannot_queue_posts(
    accounts, queue, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch()], accounts])

    assert carousel_engagement.sync_published_carousels(queue, now=NOW) == {
        "batches": 1,
        "posts": 0,
        "submitted": 0,
        "skipped": 1,
    }
    assert _drain(queue) == []
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None
    fake_sb.update.assert_not_called()


def test_corrected_recipient_identity_is_retried_on_next_poll(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [[_batch()], [_account(school_record={"slug": "waterloo", "recipient_id": None})]]
    )
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    fake_sb.queue_responses([[_batch()], [_account()], [_item()]])

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(minutes=1))

    assert stats == {"batches": 1, "posts": 1, "submitted": 1, "skipped": 0}
    assert len(_drain(queue)) == 1


def test_get_engagement_account_resolves_public_identity_for_cli(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_account(instagram_username="WATERLOO.WAT2DO.IO")]])

    assert carousel_engagement.get_engagement_account(" Waterloo ") == (
        carousel_engagement.EngagementAccount(
            school="waterloo",
            recipient_id="76214170483",
            account_username="waterloo.wat2do.io",
        )
    )
    fake_sb.eq.assert_called_once_with("enabled", True)
    assert "encrypted_access_token" not in fake_sb.select.call_args.args[0]


def test_get_engagement_account_rejects_unconfigured_school(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")

    with pytest.raises(ValueError, match="no enabled Instagram publishing account"):
        carousel_engagement.get_engagement_account("waterloo")


def test_completed_batch_is_not_reinterpreted_when_original_event_is_edited(
    queue, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch()], [_account()], [_item()]])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert len(_drain(queue)) == 1
    fake_sb.table.reset_mock()
    fake_sb.queue_responses([[_batch()]])

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(minutes=1))

    assert stats == {"batches": 1, "posts": 0, "submitted": 0, "skipped": 1}
    assert _drain(queue) == []
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list
    assert call(INSTAGRAM_PUBLISHING_ACCOUNTS) not in fake_sb.table.call_args_list


def test_account_unavailable_to_browser_does_not_block_another_school(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    other_account = _account(
        account_key="queens",
        school_id=8,
        instagram_user_id="17840000000002",
        instagram_username="queens.wat2do.io",
        school_record={"slug": "queens", "recipient_id": "76214170484"},
    )
    other_batch = _batch(
        id="00000000-0000-0000-0000-000000000002",
        account_key="queens",
        school_id=8,
        instagram_user_id="17840000000002",
    )
    fake_sb.queue_responses(
        [
            [_batch(), other_batch],
            [_account(instagram_username="unsupported.brand"), other_account],
            [_item(43, "https://www.instagram.com/p/QUEENS/")],
        ]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 2, "posts": 1, "submitted": 1, "skipped": 1}
    jobs = _drain(queue)
    assert len(jobs) == 1
    assert {job.school for job in jobs} == {"queens"}
    assert {job.payload["post_url"] for job in jobs} == {"https://www.instagram.com/p/QUEENS/"}
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None


def test_partial_enqueue_failure_replays_without_duplicate_or_lost_posts(
    queue, fake_sb, patch_sb, monkeypatch
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    items = [_item(), _item(43, "https://www.instagram.com/p/SOURCE43/")]
    fake_sb.queue_responses([[_batch()], [_account()], items])
    original_enqueue = queue.enqueue_engagement

    def fail_second_post(**kwargs):
        if kwargs["event_id"] == 43:
            raise RuntimeError("local queue temporarily unavailable")
        return original_enqueue(**kwargs)

    monkeypatch.setattr(queue, "enqueue_engagement", fail_second_post)
    with pytest.raises(RuntimeError, match="queue temporarily unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None
    assert queue.get_setting(f"carousel_engagement_sources:{BATCH_ID}") == [
        {"post_url": "https://www.instagram.com/p/SOURCE42/", "event_id": 42},
        {"post_url": "https://www.instagram.com/p/SOURCE43/", "event_id": 43},
    ]
    fake_sb.update.assert_not_called()
    for item in items:
        item["event"]["source_url"] = "https://www.instagram.com/p/EDITED/"
    monkeypatch.setattr(queue, "enqueue_engagement", original_enqueue)
    fake_sb.table.reset_mock()
    fake_sb.queue_responses([[_batch()], [_account()], items])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    jobs = _drain(queue)
    assert {job.payload["event_id"] for job in jobs} == {42, 43}
    assert {job.payload["post_url"] for job in jobs} == {
        "https://www.instagram.com/p/SOURCE42/",
        "https://www.instagram.com/p/SOURCE43/",
    }
    assert len(jobs) == 2
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list


def test_pagination_keeps_batches_with_identical_publication_timestamps(
    queue, fake_sb, patch_sb, monkeypatch
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    monkeypatch.setattr(
        carousel_engagement,
        "_CONTROL",
        carousel_engagement._CONTROL.model_copy(update={"source_page_size": 2}),
    )
    second_id = "00000000-0000-0000-0000-000000000002"
    third_id = "00000000-0000-0000-0000-000000000003"
    fake_sb.queue_responses(
        [
            [_batch(), _batch(id=second_id)],
            [_account()],
            [_item(1, "https://www.instagram.com/p/FIRST/")],
            [],
            [_item(2, "https://www.instagram.com/p/SECOND/")],
            [],
            [_batch(id=third_id)],
            [_item(3, "https://www.instagram.com/p/THIRD/")],
            [],
        ]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 3, "posts": 3, "submitted": 3, "skipped": 0}
    assert len(_drain(queue)) == 3
    delivery_filter = (
        "browser_delivery_generation.is.null,"
        f"browser_delivery_generation.neq.{queue.delivery_generation}"
    )
    assert fake_sb.or_.call_args_list == [
        call(delivery_filter),
        call(
            f"and(or({delivery_filter}),"
            "or(published_at.gt.2026-09-28T14:30:00+00:00,"
            "and(published_at.eq.2026-09-28T14:30:00+00:00,"
            f"id.gt.{second_id})))"
        ),
    ]
    assert fake_sb.order.call_args_list.count(call("published_at")) == 2


def test_late_publication_with_older_timestamp_is_discovered_on_next_poll(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch()], [_account()], [_item()]])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert len(_drain(queue)) == 1
    older_batch = _batch(
        id="00000000-0000-0000-0000-000000000002",
        published_at="2026-09-28T14:29:00+00:00",
    )
    fake_sb.queue_responses(
        [
            [older_batch, _batch()],
            [_account()],
            [_item(43, "https://www.instagram.com/p/LATE/")],
        ]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(minutes=1))

    assert stats == {"batches": 2, "posts": 1, "submitted": 1, "skipped": 1}
    assert {job.payload["post_url"] for job in _drain(queue)} == {
        "https://www.instagram.com/p/LATE/"
    }


def test_idle_collection_does_not_reload_publishing_accounts(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue.set_setting("carousel_engagement_source_registered", True)
    fake_sb.set_response(data=[])

    assert carousel_engagement.sync_published_carousels(queue, now=NOW) == {
        "batches": 0,
        "posts": 0,
        "submitted": 0,
        "skipped": 0,
    }

    fake_sb.table.assert_called_once_with(INSTAGRAM_PUBLISH_BATCHES)


def test_existing_queue_registers_its_prior_activation_once(tmp_path, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue = BrowserJobQueue(tmp_path)
    queue.set_setting("carousel_engagement_activated_at", ACTIVATED_AT)
    fake_sb.queue_responses([ACTIVATED_AT, []])

    carousel_engagement.sync_published_carousels(queue, now=NOW)
    fake_sb.queue_responses([[]])
    carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(days=1))

    fake_sb.rpc.assert_called_once_with(
        "ensure_instagram_browser_source", {"p_activated_at": ACTIVATED_AT}
    )
    assert queue.get_setting("carousel_engagement_source_registered") is True


def test_recreated_queue_restores_cloud_activation_and_replays_older_deliveries(
    queue, tmp_path, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    rebuilt = BrowserJobQueue(tmp_path / "rebuilt")
    fake_sb.queue_responses([ACTIVATED_AT, [_batch()], [_account()], [_item()]])

    assert carousel_engagement.sync_published_carousels(rebuilt, now=NOW)["submitted"] == 1

    assert rebuilt.delivery_generation != queue.delivery_generation
    assert rebuilt.get_setting("carousel_engagement_activated_at") == ACTIVATED_AT
    fake_sb.gte.assert_called_once_with("published_at", ACTIVATED_AT)
    fake_sb.or_.assert_called_once_with(
        "browser_delivery_generation.is.null,"
        f"browser_delivery_generation.neq.{rebuilt.delivery_generation}"
    )
    fake_sb.update.assert_called_once_with(
        {
            "browser_delivery_generation": rebuilt.delivery_generation,
            "browser_delivery_sources": [
                {"post_url": "https://www.instagram.com/p/SOURCE42/", "event_id": 42}
            ],
        },
        returning="minimal",
    )


def test_source_registration_failure_retries_before_loading_batches(tmp_path, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue = BrowserJobQueue(tmp_path)
    fake_sb.raise_on_execute(RuntimeError("Source registration unavailable"))

    with pytest.raises(RuntimeError, match="Source registration unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert queue.get_setting("carousel_engagement_source_registered") is None
    fake_sb.table.assert_not_called()
    fake_sb.queue_responses([ACTIVATED_AT, []])
    carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(days=1))
    assert queue.get_setting("carousel_engagement_activated_at") == ACTIVATED_AT


def test_cloud_acknowledgement_retries_without_reinterpreting_completed_selection(
    queue, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.execute.side_effect = [
        SimpleNamespace(data=[_batch()]),
        SimpleNamespace(data=[_account()]),
        SimpleNamespace(data=[_item()]),
        RuntimeError("Cloud acknowledgement unavailable"),
    ]

    with pytest.raises(RuntimeError, match="Cloud acknowledgement unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is not None
    original_sources = queue.get_setting(f"carousel_engagement_sources:{BATCH_ID}")
    assert len(_drain(queue)) == 1
    fake_sb.table.reset_mock()
    fake_sb.queue_responses([[_batch()]])
    assert carousel_engagement.sync_published_carousels(queue, now=NOW)["skipped"] == 1
    assert fake_sb.table.call_args_list == [
        call(INSTAGRAM_PUBLISH_BATCHES),
        call(INSTAGRAM_PUBLISH_BATCHES),
    ]
    assert _drain(queue) == []
    assert fake_sb.update.call_args.args[0]["browser_delivery_sources"] == original_sources


def test_local_completion_receipt_failure_prevents_cloud_acknowledgement(
    queue, monkeypatch, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch()], [_account()], [_item()]])
    original_setting = queue.set_setting

    def fail_receipt(key, value):
        if key == f"carousel_engagement_batch:{BATCH_ID}":
            raise OSError("Local completion receipt unavailable")
        original_setting(key, value)

    monkeypatch.setattr(queue, "set_setting", fail_receipt)

    with pytest.raises(OSError, match="Local completion receipt unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)

    fake_sb.update.assert_not_called()
    assert len(_drain(queue)) == 1


def test_recreated_queue_uses_frozen_sources_after_the_event_url_changes(
    queue, tmp_path, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    original = "https://www.instagram.com/p/ORIGINAL/"
    item = _item(source_url=original)
    fake_sb.queue_responses([[_batch()], [_account()], [item]])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    delivered = fake_sb.update.call_args.args[0]
    assert delivered["browser_delivery_sources"] == [{"post_url": original, "event_id": 42}]

    item["event"]["source_url"] = "https://www.instagram.com/p/EDITED/"
    rebuilt = BrowserJobQueue(tmp_path / "rebuilt-frozen")
    fake_sb.table.reset_mock()
    fake_sb.queue_responses(
        [
            ACTIVATED_AT,
            [_batch(browser_delivery_sources=delivered["browser_delivery_sources"])],
            [_account()],
            [item],
        ]
    )
    carousel_engagement.sync_published_carousels(rebuilt, now=NOW)

    assert {job.payload["post_url"] for job in _drain(rebuilt)} == {original}
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list


def test_existing_completion_recovers_original_sources_from_durable_jobs(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    original = "https://www.instagram.com/p/ORIGINAL/"
    queue.enqueue_engagement(
        school="waterloo",
        recipient_id=_account()["school_record"]["recipient_id"],
        account_username=_account()["instagram_username"],
        post_url=original,
        event_id=42,
    )
    assert len(_drain(queue)) == 1
    queue.set_setting(f"carousel_engagement_batch:{BATCH_ID}", _batch()["published_at"])
    fake_sb.queue_responses(
        [[_batch()], [_account()], [_item(source_url="https://www.instagram.com/p/EDITED/")]]
    )

    assert carousel_engagement.sync_published_carousels(queue, now=NOW) == {
        "batches": 1,
        "posts": 0,
        "submitted": 0,
        "skipped": 1,
    }

    assert _drain(queue) == []
    assert fake_sb.update.call_args.args[0]["browser_delivery_sources"] == [
        {"post_url": original, "event_id": 42}
    ]


@pytest.mark.parametrize("unrecoverable", ["missing", "ambiguous", "no_items", "null_event"])
def test_unrecoverable_completed_selection_cannot_block_another_batch(
    queue, fake_sb, patch_sb, unrecoverable
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue.set_setting(f"carousel_engagement_batch:{BATCH_ID}", _batch()["published_at"])
    if unrecoverable == "ambiguous":
        for url in ["https://www.instagram.com/p/FIRST/", "https://www.instagram.com/p/SECOND/"]:
            queue.enqueue_engagement(
                school="waterloo",
                recipient_id=_account()["school_record"]["recipient_id"],
                account_username=_account()["instagram_username"],
                post_url=url,
                event_id=42,
            )
        _drain(queue)
    legacy_items = [] if unrecoverable == "no_items" else [_item()]
    if unrecoverable == "null_event":
        legacy_items[0]["event_id"] = None
    new_id = "00000000-0000-0000-0000-000000000002"
    fake_sb.queue_responses(
        [
            [_batch(), _batch(id=new_id)],
            [_account()],
            legacy_items,
            [_item(43, "https://www.instagram.com/p/NEW/")],
        ]
    )

    assert carousel_engagement.sync_published_carousels(queue, now=NOW) == {
        "batches": 2,
        "posts": 1,
        "submitted": 1,
        "skipped": 1,
    }

    assert {job.payload["post_url"] for job in _drain(queue)} == {
        "https://www.instagram.com/p/NEW/"
    }
    assert queue.get_setting(f"carousel_engagement_sources:{BATCH_ID}") is None
    fake_sb.update.assert_called_once_with(
        {
            "browser_delivery_generation": queue.delivery_generation,
            "browser_delivery_sources": [
                {"post_url": "https://www.instagram.com/p/NEW/", "event_id": 43}
            ],
        },
        returning="minimal",
    )


def test_no_eligible_sources_are_frozen_as_an_explicit_empty_selection(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [[_batch()], [_account()], [_item(source_url="https://example.com/post")]]
    )

    assert carousel_engagement.sync_published_carousels(queue, now=NOW)["submitted"] == 0

    assert queue.get_setting(f"carousel_engagement_sources:{BATCH_ID}") == []
    fake_sb.update.assert_called_once_with(
        {"browser_delivery_generation": queue.delivery_generation, "browser_delivery_sources": []},
        returning="minimal",
    )


@pytest.mark.parametrize("saved,expected_posts", [([], 0), (None, 1)])
def test_empty_cloud_selection_is_distinct_from_an_uncaptured_selection(
    queue, fake_sb, patch_sb, saved, expected_posts
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [
            [_batch(browser_delivery_sources=saved)],
            [_account()],
            [_item(source_url="https://www.instagram.com/p/EDITED/")],
        ]
    )

    assert carousel_engagement.sync_published_carousels(queue, now=NOW)["posts"] == expected_posts

    assert (call(INSTAGRAM_PUBLISH_ITEMS) in fake_sb.table.call_args_list) == (saved is None)
    assert len(_drain(queue)) == expected_posts
    if saved == []:
        assert fake_sb.update.call_args.args[0]["browser_delivery_sources"] == []


def test_frozen_source_receipt_failure_prevents_enqueue_and_cloud_acknowledgement(
    queue, monkeypatch, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch()], [_account()], [_item()]])
    original_setting = queue.set_setting

    def fail_sources(key, value):
        if key == f"carousel_engagement_sources:{BATCH_ID}":
            raise OSError("Frozen selection unavailable")
        original_setting(key, value)

    monkeypatch.setattr(queue, "set_setting", fail_sources)
    with pytest.raises(OSError, match="Frozen selection unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)

    fake_sb.update.assert_not_called()
    assert _drain(queue) == []


@pytest.mark.parametrize(
    "saved",
    [
        {},
        [{"post_url": "https://example.com/post", "event_id": 42}],
        [{"post_url": None, "event_id": 42}],
        [{"post_url": "https://www.instagram.com/p/POST/", "event_id": True}],
        [{"post_url": "https://www.instagram.com/p/POST/", "event_id": -1}],
    ],
)
def test_invalid_cloud_selection_is_not_queued_or_acknowledged(queue, fake_sb, patch_sb, saved):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_batch(browser_delivery_sources=saved)], [_account()]])

    assert carousel_engagement.sync_published_carousels(queue, now=NOW)["skipped"] == 1

    fake_sb.update.assert_not_called()
    assert _drain(queue) == []


def test_concurrent_collectors_adopt_one_atomic_cloud_selection(
    queue, monkeypatch, fake_sb, patch_sb, mock_delivery_ledger
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    captured = Event()
    release = Event()
    current_url = "https://www.instagram.com/p/ORIGINAL/"
    calls = 0

    def items(_):
        nonlocal calls
        calls += 1
        selection = [_item(source_url=current_url)]
        if calls == 1:
            captured.set()
            assert release.wait(5)
        return selection

    monkeypatch.setattr(carousel_engagement, "_published_items", items)
    fake_sb.queue_responses([[_batch()], [_account()], [_batch()], [_account()]])
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(carousel_engagement.sync_published_carousels, queue, now=NOW)
        try:
            assert captured.wait(5)
            current_url = "https://www.instagram.com/p/EDITED/"
            second = carousel_engagement.sync_published_carousels(queue, now=NOW)
            assert second["submitted"] == 1
        finally:
            release.set()
        assert first.result(timeout=5)["skipped"] == 1

    assert len(fake_sb.rpc.call_args_list) == 2
    assert {job.payload["post_url"] for job in _drain(queue)} == {current_url}
    assert (
        queue.get_setting(f"carousel_engagement_sources:{BATCH_ID}")
        == mock_delivery_ledger[BATCH_ID]
    )


def test_partial_enqueue_then_sqlite_loss_replays_cloud_frozen_selection(
    queue, tmp_path, monkeypatch, fake_sb, patch_sb, mock_delivery_ledger
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    original_enqueue = queue.enqueue_engagement

    def fail_second(**kwargs):
        if kwargs["event_id"] == 43:
            raise OSError("Local enqueue interrupted")
        return original_enqueue(**kwargs)

    monkeypatch.setattr(queue, "enqueue_engagement", fail_second)
    fake_sb.queue_responses(
        [
            [_batch()],
            [_account()],
            [_item(), _item(43, "https://www.instagram.com/p/SOURCE43/")],
        ]
    )
    with pytest.raises(OSError, match="Local enqueue interrupted"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)
    fake_sb.update.assert_not_called()
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None

    rebuilt = BrowserJobQueue(tmp_path / "partial-loss")
    fake_sb.table.reset_mock()
    fake_sb.queue_responses(
        [
            ACTIVATED_AT,
            [_batch(browser_delivery_sources=mock_delivery_ledger[BATCH_ID])],
            [_account()],
            [_item(source_url="https://www.instagram.com/p/EDITED/")],
        ]
    )
    assert carousel_engagement.sync_published_carousels(rebuilt, now=NOW)["submitted"] == 2

    assert {job.payload["post_url"] for job in _drain(rebuilt)} == {
        "https://www.instagram.com/p/SOURCE42/",
        "https://www.instagram.com/p/SOURCE43/",
    }
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list


def test_conflicting_local_and_cloud_receipts_fail_closed(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue.set_setting(
        f"carousel_engagement_sources:{BATCH_ID}",
        [{"post_url": "https://www.instagram.com/p/ORIGINAL/", "event_id": 42}],
    )
    fake_sb.queue_responses(
        [
            [
                _batch(
                    browser_delivery_sources=[
                        {"post_url": "https://www.instagram.com/p/OTHER/", "event_id": 42}
                    ]
                )
            ],
            [_account()],
        ]
    )

    assert carousel_engagement.sync_published_carousels(queue, now=NOW)["skipped"] == 1

    fake_sb.update.assert_not_called()
    assert _drain(queue) == []
