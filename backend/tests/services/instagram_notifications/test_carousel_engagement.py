from datetime import datetime, timedelta, timezone
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
    return queue


def _drain(queue):
    jobs = []
    while job := queue.claim_next():
        jobs.append(job)
        queue.finish(job.id, result={"status": "done"})
    return jobs


def test_first_run_persists_activation_without_historical_backfill(tmp_path, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    queue = BrowserJobQueue(tmp_path)
    fake_sb.queue_responses([[_account()], []])

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 0, "posts": 0, "submitted": 0, "skipped": 0}
    assert queue.get_setting("carousel_engagement_activated_at") == NOW.isoformat()
    fake_sb.gte.assert_called_once_with("published_at", NOW.isoformat())
    fake_sb.lte.assert_called_once_with("published_at", NOW.isoformat())
    fake_sb.eq.assert_any_call("status", INSTAGRAM_BATCH_PUBLISHED)

    restarted = BrowserJobQueue(tmp_path)
    fake_sb.queue_responses([[_account()], []])
    carousel_engagement.sync_published_carousels(restarted, now=NOW + timedelta(days=1))
    assert fake_sb.gte.call_args_list == [
        call("published_at", NOW.isoformat()),
        call("published_at", NOW.isoformat()),
    ]


def test_published_selection_enqueues_original_post_for_school_account_only(
    queue, fake_sb, patch_sb
):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [[_account()], [_batch()], [_item(source_url="https://instagram.com/p/SOURCE42?utm=x")]]
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
        call(INSTAGRAM_PUBLISHING_ACCOUNTS),
        call(INSTAGRAM_PUBLISH_BATCHES),
        call(INSTAGRAM_PUBLISH_ITEMS),
    ]
    fake_sb.eq.assert_any_call("enabled", True)
    fake_sb.eq.assert_any_call("status", INSTAGRAM_BATCH_PUBLISHED)
    fake_sb.eq.assert_any_call("batch_id", BATCH_ID)
    fake_sb.is_.assert_called_once_with("published_at", "null")
    fake_sb.gte.assert_called_once_with("published_at", ACTIVATED_AT)
    # No credential-loading helper, wildcard selection, or remote writes.
    selected_columns = [entry.args[0] for entry in fake_sb.select.call_args_list]
    assert not any("*" in columns or "token" in columns for columns in selected_columns)
    fake_sb.insert.assert_not_called()
    fake_sb.update.assert_not_called()
    fake_sb.upsert.assert_not_called()
    fake_sb.rpc.assert_not_called()


def test_non_instagram_sources_and_missing_sources_are_skipped(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [
            [_account()],
            [_batch()],
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
    fake_sb.queue_responses([accounts, [_batch()]])

    assert carousel_engagement.sync_published_carousels(queue, now=NOW) == {
        "batches": 1,
        "posts": 0,
        "submitted": 0,
        "skipped": 1,
    }
    assert _drain(queue) == []
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None


def test_corrected_recipient_identity_is_retried_on_next_poll(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses(
        [[_account(school_record={"slug": "waterloo", "recipient_id": None})], [_batch()]]
    )
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    fake_sb.queue_responses([[_account()], [_batch()], [_item()]])

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
    fake_sb.queue_responses([[_account()], [_batch()], [_item()]])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert len(_drain(queue)) == 1
    fake_sb.table.reset_mock()
    fake_sb.queue_responses([[_account()], [_batch()]])

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(minutes=1))

    assert stats == {"batches": 1, "posts": 0, "submitted": 0, "skipped": 1}
    assert _drain(queue) == []
    assert call(INSTAGRAM_PUBLISH_ITEMS) not in fake_sb.table.call_args_list


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
            [_account(instagram_username="unsupported.brand"), other_account],
            [_batch(), other_batch],
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
    fake_sb.queue_responses([[_account()], [_batch()], items])
    original_enqueue = queue.enqueue_engagement

    def fail_second_post(**kwargs):
        if kwargs["event_id"] == 43:
            raise RuntimeError("local queue temporarily unavailable")
        return original_enqueue(**kwargs)

    monkeypatch.setattr(queue, "enqueue_engagement", fail_second_post)
    with pytest.raises(RuntimeError, match="queue temporarily unavailable"):
        carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert queue.get_setting(f"carousel_engagement_batch:{BATCH_ID}") is None
    monkeypatch.setattr(queue, "enqueue_engagement", original_enqueue)
    fake_sb.queue_responses([[_account()], [_batch()], items])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    jobs = _drain(queue)
    assert {job.payload["event_id"] for job in jobs} == {42, 43}
    assert len(jobs) == 2


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
            [_account()],
            [_batch(), _batch(id=second_id)],
            [_item(1, "https://www.instagram.com/p/FIRST/")],
            [_item(2, "https://www.instagram.com/p/SECOND/")],
            [_batch(id=third_id)],
            [_item(3, "https://www.instagram.com/p/THIRD/")],
        ]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW)

    assert stats == {"batches": 3, "posts": 3, "submitted": 3, "skipped": 0}
    assert len(_drain(queue)) == 3
    fake_sb.or_.assert_called_once_with(
        "published_at.gt.2026-09-28T14:30:00+00:00,"
        "and(published_at.eq.2026-09-28T14:30:00+00:00,"
        f"id.gt.{second_id})"
    )
    assert fake_sb.order.call_args_list.count(call("published_at")) == 2


def test_late_publication_with_older_timestamp_is_discovered_on_next_poll(queue, fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.carousel_engagement")
    fake_sb.queue_responses([[_account()], [_batch()], [_item()]])
    carousel_engagement.sync_published_carousels(queue, now=NOW)
    assert len(_drain(queue)) == 1
    older_batch = _batch(
        id="00000000-0000-0000-0000-000000000002",
        published_at="2026-09-28T14:29:00+00:00",
    )
    fake_sb.queue_responses(
        [[_account()], [older_batch, _batch()], [_item(43, "https://www.instagram.com/p/LATE/")]]
    )

    stats = carousel_engagement.sync_published_carousels(queue, now=NOW + timedelta(minutes=1))

    assert stats == {"batches": 2, "posts": 1, "submitted": 1, "skipped": 1}
    assert {job.payload["post_url"] for job in _drain(queue)} == {
        "https://www.instagram.com/p/LATE/"
    }
