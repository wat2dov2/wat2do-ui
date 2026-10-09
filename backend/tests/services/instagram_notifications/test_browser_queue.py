import base64
import copy
import errno
import gzip
import hashlib
import json
import random
import sqlite3
import subprocess
import sys
import threading
import tracemalloc
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from services.instagram_notifications import browser_queue as module
from services.instagram_notifications import browser_review as review_module

RECIPIENT_ID = "12342599092"
ACCOUNT_USERNAME = "ubc.wat2do.io"


@pytest.fixture
def queue(tmp_path):
    return module.BrowserJobQueue(tmp_path / "browser")


def test_delivery_generation_survives_reopen_and_changes_for_a_recreated_queue(tmp_path):
    directory = tmp_path / "delivery"
    first = module.BrowserJobQueue(directory)
    generation = first.delivery_generation
    assert str(module.uuid.UUID(generation)) == generation
    assert module.BrowserJobQueue(directory).delivery_generation == generation
    for path in directory.glob("jobs.sqlite3*"):
        path.unlink()
    assert module.BrowserJobQueue(directory).delivery_generation != generation


def test_concurrent_queue_initialization_shares_one_delivery_generation(tmp_path):
    directory = tmp_path / "delivery"
    with ThreadPoolExecutor(max_workers=4) as executor:
        generations = list(
            executor.map(lambda _: module.BrowserJobQueue(directory).delivery_generation, range(8))
        )
    assert len(set(generations)) == 1


def test_local_retry_only_revives_delivered_notification_reads_with_budget(queue):
    def retrieval(shortcode):
        return queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/{shortcode}/",
        )

    retryable = retrieval("Delivered")
    exhausted = retrieval("Exhausted")
    cancelled = retrieval("Cancelled")
    manual = retrieval("Manual")
    for job_id in (retryable, exhausted, cancelled):
        queue.set_setting(f"notification_delivery:{uuid4()}", job_id)
    with sqlite3.connect(queue.database_path) as db:
        db.execute("UPDATE jobs SET state='failed',attempts=1")
        db.execute(
            "UPDATE jobs SET attempts=? WHERE id=?",
            (module.CONTROL.ingestion_retry_limit, exhausted),
        )
        db.execute("UPDATE jobs SET state='cancelled' WHERE id=?", (cancelled,))
    assert queue.retry_failed_notification_retrievals() == 1
    assert queue.get(retryable).state == "pending"
    assert queue.get(retryable).attempts == 1
    assert queue.get(exhausted).state == "failed"
    assert queue.get(cancelled).state == "cancelled"
    assert queue.get(manual).state == "failed"
    assert queue.retry_failed_notification_retrievals() == 0


def test_recorded_engagement_sources_preserve_original_urls_and_reject_ambiguity(queue):
    _engagement(queue, "Original", event_id=7)
    expected = [{"post_url": "https://www.instagram.com/p/Original/", "event_id": 7}]
    assert (
        queue.recorded_engagement_sources(
            recipient_id=RECIPIENT_ID, account_username=ACCOUNT_USERNAME, event_ids=[7]
        )
        == expected
    )
    with pytest.raises(ValueError, match="faithfully"):
        queue.recorded_engagement_sources(
            recipient_id=RECIPIENT_ID, account_username=ACCOUNT_USERNAME, event_ids=[7, 8]
        )
    _engagement(queue, "Changed", event_id=7)
    with pytest.raises(ValueError, match="faithfully"):
        queue.recorded_engagement_sources(
            recipient_id=RECIPIENT_ID, account_username=ACCOUNT_USERNAME, event_ids=[7]
        )


def _storage_failure(code=sqlite3.SQLITE_FULL):
    error = sqlite3.OperationalError("private SQL and filesystem details")
    error.sqlite_errorcode = code
    return error


def _fail_queue_transaction(queue, monkeypatch, *, statement, failures, at_commit=False):
    """Exercise real transaction rollback while injecting an OS/SQLite write failure."""
    connect = queue._connect
    remaining = [failures]

    class Connection:
        def __init__(self):
            self.db = connect()
            self.matched = False

        def __enter__(self):
            self.db.__enter__()
            return self

        def __exit__(self, kind, error, traceback):
            if kind is None and self.matched and at_commit and remaining[0]:
                remaining[0] -= 1
                self.db.rollback()
                raise _storage_failure()
            return self.db.__exit__(kind, error, traceback)

        def execute(self, sql, *args):
            if sql.startswith(statement):
                self.matched = True
                if not at_commit and remaining[0]:
                    remaining[0] -= 1
                    raise _storage_failure()
            return self.db.execute(sql, *args)

        def __getattr__(self, name):
            return getattr(self.db, name)

    monkeypatch.setattr(queue, "_connect", Connection)
    sleeps = []
    monkeypatch.setattr(module.time, "sleep", sleeps.append)
    return remaining, sleeps


def _engagement(queue, shortcode="Post1", *, school="ubc", event_id=1):
    return queue.enqueue_engagement(
        school=school,
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        post_url=f"https://www.instagram.com/p/{shortcode}/",
        event_id=event_id,
    )


def _complete_next(queue, *, allow_engagement=True):
    job = queue.claim_next(allow_engagement=allow_engagement)
    if job is not None:
        queue.finish(job, result={"status": "succeeded"})
    return job


def _clock(monkeypatch):
    state = SimpleNamespace(now=10000.0, elapsed=0.0, after_sleep=lambda: None)

    def sleep(seconds):
        state.elapsed += seconds
        state.now += seconds
        state.after_sleep()

    monkeypatch.setattr(
        module,
        "time",
        SimpleNamespace(time=lambda: state.now, monotonic=lambda: state.elapsed, sleep=sleep),
    )
    return state


def test_new_digest_preempts_the_next_engagement_without_interrupting_running_job(queue):
    first_id = _engagement(queue, "First")
    second_id = _engagement(queue, "Second")
    running = queue.claim_next()
    assert running.id == first_id

    digest_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-priority")).id

    assert queue.get(first_id).state == "running"
    queue.finish(queue.get(first_id), result={"status": "succeeded"})
    assert _complete_next(queue).id == digest_id
    assert _complete_next(queue).id == second_id
    assert queue.claim_next() is None


def test_engagement_cooldown_still_allows_immediate_digest_work(queue):
    engagement_id = _engagement(queue)
    assert queue.claim_next(allow_engagement=False) is None

    digest_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-cooldown")).id

    assert _complete_next(queue, allow_engagement=False).id == digest_id
    assert queue.get(engagement_id).state == "pending"


@pytest.mark.parametrize("kind", ["digest", "retrieval", "engagement"])
def test_shared_rate_limit_holds_every_browser_kind_until_expiry(queue, monkeypatch, kind):
    clock = _clock(monkeypatch)
    first_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-active")).id
    active = queue.claim_next()
    pending_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-next")).id
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/RateLimited/",
        )
        if kind == "retrieval"
        else _engagement(queue, "RateLimited")
    )

    queue.defer_for_rate_limit(active, "Instagram public media request failed with HTTP 429")

    assert queue.is_rate_limited()
    assert queue.claim_next() is None
    assert queue.claim_companions(active, limit=14) == []
    assert queue.get(first_id).state == "running"
    assert queue.get(pending_id).state == "pending"
    assert queue.get(pending_id).attempts == 0
    assert not queue.get_setting("paused", False)
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    assert not queue.is_rate_limited()
    assert queue.claim_next().id == pending_id


def test_rate_limit_uses_existing_sanitized_diagnostics_without_changing_the_job(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/RateDiagnostic/",
    )
    active = queue.claim_next()
    untrusted_result = replace(
        active,
        result={"response_body": "must-not-be-logged"},
        payload={**active.payload, "response_body": "must-not-be-logged"},
    )
    reason = "Instagram public media request failed with HTTP 429"

    queue.defer_for_rate_limit(untrusted_result, reason)

    assert queue.get(job_id) == active
    assert queue.get_setting("browser_rate_limit_until") == (
        clock.now + module.CONTROL.rate_limit_backoff_seconds
    )
    with queue._connect() as db:
        events = [json.loads(row[0]) for row in db.execute("SELECT event FROM diagnostic_events")]
    event = next(event for event in events if event["payload"]["state"] == "rate_limited")
    assert event["payload"] == {
        "state": "rate_limited",
        "job_id": job_id,
        "kind": "retrieval",
        "reason": reason,
        "recorded_at": clock.now,
    }
    assert event["school"] == "ubc"
    assert event["ig_account"] == ACCOUNT_USERNAME
    assert event["post_url"] == "https://www.instagram.com/p/RateDiagnostic/"
    assert "must-not-be-logged" not in json.dumps(event)


def test_rate_limit_expiry_does_not_clear_human_recovery_pause(queue, monkeypatch):
    clock = _clock(monkeypatch)
    (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-auth")).id
    active = queue.claim_next()
    (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-after-auth")).id
    queue.set_setting("paused", "Instagram browser requires human account recovery")

    queue.defer_for_rate_limit(active, "Instagram browser page returned HTTP 429")
    clock.now += module.CONTROL.rate_limit_backoff_seconds

    assert not queue.is_rate_limited()
    assert queue.get_setting("paused") == "Instagram browser requires human account recovery"
    assert queue.claim_next() is None
    assert queue.claim_companions(active, limit=14) == []


def test_rate_limited_maintenance_uses_the_same_cooldown_without_a_synthetic_job(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    pending_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-maintenance")).id
    reason = "Instagram browser page returned HTTP 429"

    queue.defer_for_rate_limit(None, reason)

    assert queue.is_rate_limited()
    assert queue.claim_next() is None
    assert queue.get(pending_id).state == "pending"
    assert queue.get(pending_id).attempts == 0
    assert not queue.get_setting("paused", False)
    with queue._connect() as db:
        events = [json.loads(row[0]) for row in db.execute("SELECT event FROM diagnostic_events")]
    event = next(event for event in events if event["payload"]["state"] == "rate_limited")
    assert event["payload"] == {
        "state": "rate_limited",
        "job_id": None,
        "kind": None,
        "reason": reason,
        "recorded_at": clock.now,
    }
    assert event["school"] is None
    assert event["ig_account"] is None
    assert event["post_url"] is None
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    assert queue.claim_next().id == pending_id


@pytest.mark.parametrize("reason", ["", "   "])
def test_rate_limit_requires_a_reason_before_writing_cooldown_or_diagnostics(queue, reason):
    with pytest.raises(ValueError, match="diagnostic reason"):
        queue.defer_for_rate_limit(None, reason)

    assert not queue.is_rate_limited()
    with queue._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM diagnostic_events").fetchone()[0] == 0


def test_rate_limit_does_not_automatically_retry_uncertain_native_actions(queue, monkeypatch):
    clock = _clock(monkeypatch)
    job_id = _engagement(queue, "RateLimitNative")
    active = queue.claim_next()
    queue.defer_for_rate_limit(active, "Instagram browser page returned HTTP 429")
    with pytest.raises(ValueError, match="Engagement cannot be automatically requeued"):
        queue.finish(
            queue.get(job_id), error="Instagram browser page returned HTTP 429", requeue=True
        )
    queue.finish(queue.get(job_id), error="Instagram browser page returned HTTP 429")

    clock.now += module.CONTROL.rate_limit_backoff_seconds

    assert not queue.is_rate_limited()
    assert queue.claim_next() is None
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == 1
    queue.retry(job_id)
    assert queue.claim_next().id == job_id
    assert queue.get(job_id).attempts == 2


@pytest.mark.parametrize(
    "state",
    ["missing", "pending", "succeeded", "failed", "cancelled", "stale_attempt", "stale_started_at"],
)
def test_rate_limit_for_an_inactive_claim_is_a_noop_without_ghost_diagnostics(
    queue, monkeypatch, state
):
    _clock(monkeypatch)
    (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-noop")).id
    active = queue.claim_next()
    if state == "missing":
        active = replace(active, id="missing-rate-limit-job")
    elif state == "stale_attempt":
        active = replace(active, attempts=active.attempts - 1)
    elif state == "stale_started_at":
        active = replace(active, started_at=active.started_at - 1)
    else:
        with queue._connect() as db:
            db.execute("UPDATE jobs SET state=? WHERE id=?", (state, active.id))
    with queue._connect() as db:
        before = db.execute("SELECT event FROM diagnostic_events ORDER BY created_at").fetchall()

    queue.defer_for_rate_limit(active, "Instagram browser page returned HTTP 429")

    assert not queue.is_rate_limited()
    assert queue.get_setting("browser_rate_limit_until") is None
    with queue._connect() as db:
        assert (
            db.execute("SELECT event FROM diagnostic_events ORDER BY created_at").fetchall()
            == before
        )


def test_simultaneous_rate_limits_extend_one_shared_deadline_without_shortening_it(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    for index in range(14):
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"rate-limit-concurrent-{index}")).id
    jobs = [queue.claim_next() for _ in range(14)]
    local_clock = threading.local()
    entered = threading.Barrier(14)
    monkeypatch.setattr(
        module,
        "time",
        SimpleNamespace(time=lambda: getattr(local_clock, "now", clock.now)),
    )

    def defer(index):
        local_clock.now = clock.now + index
        entered.wait(timeout=5)
        queue.defer_for_rate_limit(jobs[index], "Instagram browser page returned HTTP 429")

    with ThreadPoolExecutor(max_workers=14) as executor:
        list(executor.map(defer, range(14)))
    expected = clock.now + 13 + module.CONTROL.rate_limit_backoff_seconds
    assert queue.get_setting("browser_rate_limit_until") == expected
    queue.defer_for_rate_limit(jobs[0], "Instagram browser page returned HTTP 429")
    assert queue.get_setting("browser_rate_limit_until") == expected
    assert queue.is_rate_limited(now=expected - 0.01)
    assert not queue.is_rate_limited(now=expected)
    with queue._connect() as db:
        events = [json.loads(row[0]) for row in db.execute("SELECT event FROM diagnostic_events")]
    assert sum(event["payload"]["state"] == "rate_limited" for event in events) == 15


def test_fourteen_confirmed_rate_limits_after_expiry_increase_backoff_only_once(queue, monkeypatch):
    clock = _clock(monkeypatch)
    for index in range(14):
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"progressive-rate-{index}")).id
    original = [queue.claim_next() for _ in range(14)]
    for job in original:
        queue.defer_for_rate_limit(job, "HTTP 429")
        queue.finish(job, error="HTTP 429", requeue=True, refund_rate_limit=True)
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    fresh = [queue.claim_next() for _ in range(14)]

    with ThreadPoolExecutor(max_workers=14) as executor:
        list(executor.map(lambda job: queue.defer_for_rate_limit(job, "HTTP 429"), fresh))

    expected = module.CONTROL.rate_limit_backoff_seconds * 2
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == expected
    assert queue.get_setting("browser_rate_limit_until") == clock.now + expected
    for job in fresh:
        queue.finish(job, error="HTTP 429", requeue=True, refund_rate_limit=True)
        assert queue.get(job.id).state == "pending"
        assert queue.get(job.id).attempts == 0
    assert not queue.get_setting("paused", False)


def test_progressive_backoff_survives_restart_and_caps_without_changing_human_pause(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    queue.set_setting("paused", "Instagram requires human account recovery")
    expected = module.CONTROL.rate_limit_backoff_seconds
    for _round in range(7):
        queue.defer_for_rate_limit(None, "HTTP 429")
        assert queue.get_setting("browser_rate_limit_backoff_seconds") == expected
        assert queue.get_setting("browser_rate_limit_until") == clock.now + expected
        queue = module.BrowserJobQueue(queue.state_directory)
        assert queue.is_rate_limited()
        assert queue.get_setting("paused") == "Instagram requires human account recovery"
        clock.now += expected
        expected = min(expected * 2, module.CONTROL.rate_limit_max_backoff_seconds)
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_max_backoff_seconds
    )


@pytest.mark.parametrize("kind", ["digest", "retrieval", "engagement", "inspection"])
def test_fresh_success_after_recovery_resets_backoff_but_keeps_deadline(queue, monkeypatch, kind):
    clock = _clock(monkeypatch)
    queue.defer_for_rate_limit(None, "HTTP 429")
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    queue.defer_for_rate_limit(None, "HTTP 429")
    deadline = queue.get_setting("browser_rate_limit_until")
    backoff = queue.get_setting("browser_rate_limit_backoff_seconds")
    clock.now = deadline + module.CONTROL.rate_limit_recovery_seconds
    job_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-reset")).id
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/ProgressiveReset/",
        )
        if kind == "retrieval"
        else queue.enqueue_engagement(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            post_url="https://www.instagram.com/p/ProgressiveReset/",
            dry_run=kind == "inspection",
        )
    )
    active = queue.claim_next()
    assert active.id == job_id
    assert active.started_at == clock.now

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    assert queue.get_setting("browser_rate_limit_until") == deadline
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        backoff if kind == "inspection" else 0
    )
    queue.defer_for_rate_limit(None, "HTTP 429")
    expected = backoff * 2 if kind == "inspection" else module.CONTROL.rate_limit_backoff_seconds
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == expected
    assert queue.get_setting("browser_rate_limit_until") == clock.now + expected


@pytest.mark.parametrize("kind", ["digest", "retrieval", "engagement"])
def test_one_success_after_cooldown_does_not_reset_sustained_rate_limits(queue, monkeypatch, kind):
    clock = _clock(monkeypatch)
    queue.defer_for_rate_limit(None, "HTTP 429")
    clock.now = queue.get_setting("browser_rate_limit_until")
    job_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "early-reset")).id
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/EarlyReset/",
        )
        if kind == "retrieval"
        else _engagement(queue, "EarlyReset")
    )
    assert queue.claim_next().id == job_id

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_backoff_seconds
    )
    queue.defer_for_rate_limit(None, "HTTP 429")
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_backoff_seconds * 2
    )


@pytest.mark.parametrize("starts_after_recovery", [False, True])
def test_rate_limit_recovery_requires_a_fresh_job_after_the_quiet_window(
    queue, monkeypatch, starts_after_recovery
):
    clock = _clock(monkeypatch)
    queue.defer_for_rate_limit(None, "HTTP 429")
    deadline = queue.get_setting("browser_rate_limit_until")
    recovered_at = deadline + module.CONTROL.rate_limit_recovery_seconds
    clock.now = recovered_at if starts_after_recovery else recovered_at - 0.01
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "recovery-boundary")).id
    queue.claim_next()
    clock.now = recovered_at + 1

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        0 if starts_after_recovery else module.CONTROL.rate_limit_backoff_seconds
    )


def test_another_rate_limit_restarts_the_recovery_window(queue, monkeypatch):
    clock = _clock(monkeypatch)
    queue.defer_for_rate_limit(None, "HTTP 429")
    original_recovery = (
        queue.get_setting("browser_rate_limit_until") + module.CONTROL.rate_limit_recovery_seconds
    )
    clock.now = original_recovery - 1
    queue.defer_for_rate_limit(None, "HTTP 429")
    clock.now = queue.get_setting("browser_rate_limit_until")
    assert clock.now > original_recovery
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "renewed-recovery")).id
    queue.claim_next()

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_backoff_seconds * 2
    )


@pytest.mark.parametrize("finish_after_expiry", [False, True])
def test_old_inflight_success_cannot_reset_active_or_expired_hold(
    queue, monkeypatch, finish_after_expiry
):
    clock = _clock(monkeypatch)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-old-response")).id
    active = queue.claim_next()
    queue.defer_for_rate_limit(None, "HTTP 429")
    deadline = queue.get_setting("browser_rate_limit_until")
    if finish_after_expiry:
        clock.now = deadline

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    assert active.started_at < deadline
    assert queue.get_setting("browser_rate_limit_until") == deadline
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_backoff_seconds
    )


@pytest.mark.parametrize("state", ["failed", "unsupported", "cancelled", "stale"])
def test_non_success_or_unchanged_finish_cannot_reset_progressive_backoff(
    queue, monkeypatch, state
):
    clock = _clock(monkeypatch)
    queue.defer_for_rate_limit(None, "HTTP 429")
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"progressive-no-reset-{state}")
    ).id
    if state == "cancelled":
        queue.cancel(job_id)
    else:
        queue.claim_next()
        if state == "stale":
            queue.defer_for_rate_limit(None, "HTTP 429")
            queue.finish(queue.get(job_id), result={"status": "succeeded"})
            clock.now = queue.get_setting("browser_rate_limit_until")
    deadline = queue.get_setting("browser_rate_limit_until")
    backoff = queue.get_setting("browser_rate_limit_backoff_seconds")

    queue.finish(
        queue.get(job_id),
        error="HTTP 400" if state == "failed" else None,
        result={"status": "unsupported" if state == "unsupported" else "succeeded"},
    )

    assert queue.get_setting("browser_rate_limit_until") == deadline
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == backoff


def test_digest_expires_normally_when_progressive_hold_exceeds_caller_deadline(queue, monkeypatch):
    clock = _clock(monkeypatch)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-expired-caller")).id
    queue.set_setting(
        "browser_rate_limit_backoff_seconds", module.CONTROL.rate_limit_max_backoff_seconds
    )
    queue.set_setting("browser_rate_limit_until", clock.now)
    queue.defer_for_rate_limit(None, "HTTP 429")
    assert module.CONTROL.rate_limit_max_backoff_seconds > module.CONTROL.result_timeout_seconds
    clock.now += module.CONTROL.result_timeout_seconds + 1
    assert queue.claim_next() is None
    assert queue.get(job_id).state == "pending"
    clock.now = queue.get_setting("browser_rate_limit_until")

    assert queue.claim_next() is None

    expired = queue.get(job_id)
    assert expired.state == "cancelled"
    assert expired.error == "Digest caller deadline expired"
    assert expired.attempts == 0


@pytest.mark.parametrize(
    "backoff",
    [
        False,
        "later",
        [],
        float("nan"),
        float("inf"),
        -1,
        1,
        module.CONTROL.rate_limit_backoff_seconds - 1,
        module.CONTROL.rate_limit_max_backoff_seconds + 1,
    ],
)
def test_invalid_progressive_backoff_cannot_admit_or_extend_browser_work(
    queue, monkeypatch, backoff
):
    _clock(monkeypatch)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-invalid")).id
    queue.set_setting("browser_rate_limit_backoff_seconds", backoff)

    with pytest.raises(ValueError, match="Browser rate limit interval is invalid"):
        queue.is_rate_limited()
    with pytest.raises(ValueError, match="Browser rate limit interval is invalid"):
        queue.claim_next()
    with pytest.raises(ValueError, match="Browser rate limit interval is invalid"):
        queue.defer_for_rate_limit(None, "HTTP 429")
    assert queue.get(job_id).state == "pending"
    assert queue.get(job_id).attempts == 0
    assert queue.get_setting("browser_rate_limit_until") is None


@pytest.mark.parametrize("deadline", [True, "later", [], float("nan"), float("inf")])
def test_invalid_rate_limit_deadline_cannot_admit_browser_work(queue, monkeypatch, deadline):
    _clock(monkeypatch)
    (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-invalid-active")).id
    active = queue.claim_next()
    pending_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-invalid-next")
    ).id
    queue.set_setting("browser_rate_limit_until", deadline)

    with pytest.raises(ValueError, match="Browser rate limit timestamp is invalid"):
        queue.is_rate_limited()
    with pytest.raises(ValueError, match="Browser rate limit timestamp is invalid"):
        queue.claim_next()
    with pytest.raises(ValueError, match="Browser rate limit timestamp is invalid"):
        queue.claim_companions(active, limit=14)
    assert queue.get(pending_id).state == "pending"
    assert queue.get(pending_id).attempts == 0


def test_school_posts_stay_together_and_digest_preempts_between_posts(queue):
    for index in range(3):
        _engagement(queue, f"Ubc{index}", school="ubc")
    _engagement(queue, "Sask", school="usask")
    assert _complete_next(queue).school == "ubc"
    digest = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "urgent")).id
    assert _complete_next(queue).id == digest
    assert [_complete_next(queue).school for _ in range(3)] == ["ubc", "ubc", "usask"]


def test_selected_school_survives_worker_restart(queue):
    for school in ("ubc", "usask"):
        for index in range(2):
            _engagement(queue, f"{school}{index}", school=school)
    first = _complete_next(queue)

    reopened = module.BrowserJobQueue(queue.state_directory)
    second = _complete_next(reopened)

    assert second.school == first.school


def test_same_post_in_two_carousels_or_permalink_forms_has_one_job_per_post(queue):
    first = _engagement(queue, "Shared", event_id=101)
    second = queue.enqueue_engagement(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=f" {ACCOUNT_USERNAME.upper()} ",
        post_url="https://www.instagram.com/reel/Shared/?igsh=tracking",
        event_id=202,
    )
    assert first == second

    queue.finish(queue.claim_next(), result={"status": "succeeded"})
    assert _engagement(queue, "Shared", event_id=303) == first
    assert queue.get(first).state == "succeeded"
    assert queue.claim_next() is None

    assert _engagement(queue, "Shared") == first


def test_same_event_post_is_distinct_for_each_school_account(queue):
    first = _engagement(queue, "Shared")
    second = queue.enqueue_engagement(
        school="usask",
        recipient_id="41553815702",
        account_username="usask.wat2do.io",
        post_url="https://www.instagram.com/p/Shared/",
        event_id=1,
    )

    assert first != second
    assert {_complete_next(queue).id, _complete_next(queue).id} == {first, second}


def test_recovery_requeues_reads_but_never_repeats_ambiguous_engagement(queue):
    engagement_id = _engagement(queue)
    assert queue.claim_next().id == engagement_id
    digest_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-restart")).id
    assert queue.claim_next().id == digest_id

    reopened = module.BrowserJobQueue(queue.state_directory)
    reopened.recover_interrupted()

    assert reopened.get(digest_id).state == "pending"
    assert reopened.get(engagement_id).state == "failed"
    assert "inspect browser state" in reopened.get(engagement_id).error
    assert _engagement(reopened) == engagement_id
    assert reopened.get(engagement_id).state == "failed"
    assert "inspect browser state" in reopened.get_setting("paused")
    assert reopened.claim_next() is None
    reopened.set_setting("paused", False)
    assert _complete_next(reopened).id == digest_id
    assert reopened.claim_next() is None

    reopened.retry(engagement_id)
    assert reopened.claim_next().id == engagement_id


@pytest.mark.parametrize("dry_run", [False, True])
def test_interrupted_engagement_preserves_existing_human_pause(queue, dry_run):
    job_id = queue.enqueue_engagement(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        post_url="https://www.instagram.com/p/InterruptedInspection/",
        dry_run=dry_run,
    )
    assert queue.claim_next().id == job_id
    queue.set_setting("paused", "Instagram requires human reauthorization")
    reopened = module.BrowserJobQueue(queue.state_directory)
    reopened.recover_interrupted()
    assert reopened.get_setting("paused") == "Instagram requires human reauthorization"
    assert reopened.get(job_id).state == "failed"


def test_interrupted_dry_run_does_not_pause_safe_read_recovery(queue):
    job_id = queue.enqueue_engagement(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        post_url="https://www.instagram.com/p/ReadOnlyInspection/",
        dry_run=True,
    )
    assert queue.claim_next().id == job_id
    digest_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "safe-read-recovery")).id
    assert queue.claim_next().id == digest_id
    reopened = module.BrowserJobQueue(queue.state_directory)
    reopened.recover_interrupted()
    assert not reopened.get_setting("paused", False)
    assert reopened.get(job_id).state == "failed"
    assert reopened.get(digest_id).state == "pending"
    assert reopened.claim_next().id == digest_id


@pytest.mark.parametrize("result", [None, {"status": "unsupported"}])
def test_failed_or_unsupported_engagement_requires_explicit_retry(queue, result):
    job_id = _engagement(queue)
    assert queue.claim_next().id == job_id
    queue.finish(
        queue.get(job_id),
        result=result,
        error="Unconfirmed browser result" if result is None else None,
    )

    assert _engagement(queue) == job_id
    assert queue.claim_next() is None
    queue.retry(job_id)
    assert queue.claim_next().id == job_id


def test_successful_or_running_engagement_cannot_be_retried_or_cancelled(queue):
    job_id = _engagement(queue)
    assert queue.claim_next().id == job_id
    queue.cancel(job_id)
    assert queue.get(job_id).state == "running"
    with pytest.raises(ValueError):
        queue.retry(job_id)

    queue.finish(queue.get(job_id), result={"status": "succeeded"})

    with pytest.raises(ValueError):
        queue.retry(job_id)
    assert queue.get(job_id).state == "succeeded"


def test_expired_digest_does_not_touch_the_browser_or_block_engagement(queue):
    digest_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-expired")).id
    engagement_id = _engagement(queue)

    next_job = queue.claim_next(
        now=queue.get(digest_id).created_at + module.CONTROL.result_timeout_seconds + 1,
    )

    assert next_job.id == engagement_id
    assert queue.get(digest_id).state == "cancelled"
    assert (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-expired")).id == digest_id
    assert queue.get(digest_id).state == "pending"


@pytest.mark.parametrize("worker_state", ["absent", "stale", "paused"])
def test_digest_wait_fails_promptly_and_cancels_unusable_pending_job(
    queue,
    monkeypatch,
    worker_state,
):
    clock = _clock(monkeypatch)
    if worker_state != "absent":
        queue.set_setting(
            "worker",
            {
                "running": True,
                "heartbeat": clock.now if worker_state == "paused" else 0,
            },
        )
    if worker_state == "paused":
        queue.set_setting("paused", True)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-unavailable")).id

    with pytest.raises(module.BrowserDigestError, match="unavailable or paused"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-unavailable",
        )

    assert clock.elapsed == 0
    assert queue.get(job_id).state == "cancelled"


def test_real_sqlite_busy_claim_waits_then_claims_exactly_once(queue, monkeypatch):
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "busy-claim")).id
    monkeypatch.setattr(
        module,
        "CONTROL",
        module.CONTROL.model_copy(update={"storage_busy_timeout_seconds": 0.01}),
    )
    waits = []
    with sqlite3.connect(queue.database_path) as blocker:
        blocker.execute("BEGIN IMMEDIATE")

        def release_lock(interval):
            waits.append(interval)
            blocker.rollback()

        monkeypatch.setattr(module.time, "sleep", release_lock)
        claimed = queue.claim_next()

    assert claimed.id == job_id
    assert claimed.attempts == 1
    assert waits == [module.CONTROL.storage_retry_interval_seconds]
    assert queue.claim_next() is None


@pytest.mark.parametrize("operation", ["claim", "refund", "completion"])
def test_full_commit_retries_the_transaction_without_duplicating_claim_or_refund(
    queue, monkeypatch, operation
):
    job_ids = [
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"commit-full-{index}")).id
        for index in range(3)
    ]
    first = queue.claim_next()
    if operation != "claim":
        queue.defer_for_rate_limit(first, "HTTP 429")
    remaining, waits = _fail_queue_transaction(
        queue,
        monkeypatch,
        statement="UPDATE jobs SET state=",
        failures=1,
        at_commit=True,
    )
    if operation == "claim":
        companions = queue.claim_companions(first, limit=2)
        assert {job.id for job in companions} == set(job_ids[1:])
        assert all(job.attempts == 1 for job in companions)
    elif operation == "refund":
        queue.finish(first, error="HTTP 429", requeue=True, refund_rate_limit=True)
        assert queue.get(first.id).state == "pending"
        assert queue.get(first.id).attempts == 0
    else:
        queue.finish(first, result={"status": "succeeded", "items": ["saved"]})
        assert queue.get(first.id).result == {"status": "succeeded", "items": ["saved"]}
        assert queue.get(first.id).attempts == 1
    assert remaining == [0]
    assert waits == [module.CONTROL.storage_retry_interval_seconds]
    assert not queue.storage_unavailable


def test_full_diagnostics_cannot_mask_a_committed_job_or_admit_more_work(
    queue, monkeypatch, caplog
):
    remaining, waits = _fail_queue_transaction(
        queue,
        monkeypatch,
        statement="INSERT INTO diagnostic_events",
        failures=module.CONTROL.storage_retry_limit,
    )
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "diagnostic-full")).id
    assert queue.get(job_id).state == "pending"
    assert remaining == [0]
    assert len(waits) == module.CONTROL.storage_retry_limit - 1
    assert queue.storage_unavailable
    assert queue.claim_next() is None
    assert not queue.get_setting("paused", False)
    assert "private SQL" not in caplog.text
    queue.recover_interrupted()
    assert queue.claim_next().id == job_id


@pytest.mark.parametrize("operation", ["retry", "refresh"])
def test_failed_diagnostic_read_does_not_repeat_committed_manual_transition(
    queue, monkeypatch, operation
):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/DiagnosticRead/",
    )
    assert queue.claim_next().id == job_id
    queue.finish(queue.get(job_id), error="Read failed")
    original_get = queue.get

    def fail_read(*args):
        raise _storage_failure()

    monkeypatch.setattr(queue, "get", fail_read)
    if operation == "retry":
        queue.retry(job_id)
    else:
        queue.refresh_retrieval(job_id)
    assert original_get(job_id).state == "pending"


def test_failed_auth_pause_write_stays_in_memory_until_durable_recovery(queue, monkeypatch):
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "retain-auth-pause")).id
    queue.claim_next()
    reason = "Instagram browser requires human account recovery"
    _fail_queue_transaction(
        queue,
        monkeypatch,
        statement="INSERT INTO settings VALUES",
        failures=module.CONTROL.storage_retry_limit,
    )
    with pytest.raises(sqlite3.OperationalError):
        queue.set_setting("paused", reason)
    assert queue.get_setting("paused") == reason
    assert queue.claim_next() is None
    queue.recover_interrupted()
    reopened = module.BrowserJobQueue(queue.state_directory)
    assert reopened.get_setting("paused") == reason
    assert reopened.get(job_id).state == "pending"
    assert reopened.claim_next() is None


def test_corrupt_storage_fails_without_retrying_or_exposing_private_details(queue, monkeypatch):
    calls = []
    waits = []

    def corrupt():
        calls.append(True)
        raise _storage_failure(sqlite3.SQLITE_CORRUPT)

    monkeypatch.setattr(queue, "_connect", corrupt)
    monkeypatch.setattr(module.time, "sleep", waits.append)
    with pytest.raises(sqlite3.OperationalError):
        queue.get_setting("worker")
    assert calls == [True]
    assert waits == []
    assert queue.storage_unavailable


@pytest.mark.parametrize("changed", [False, True])
def test_owned_setup_pause_restores_atomically_without_erasing_a_new_auth_hold(queue, changed):
    hold = "Installer owns browser bootstrap"
    queue.set_setting("paused", hold)
    newer = module.BrowserJobQueue(queue.state_directory)
    if changed:
        newer.set_setting("paused", "Instagram browser requires human account recovery")
    assert queue.compare_set_pause(hold, False) is not changed
    assert queue.get_setting("paused") == (
        "Instagram browser requires human account recovery" if changed else False
    )


def test_setup_pause_restore_keeps_a_new_auth_hold_that_could_not_be_written(queue, monkeypatch):
    hold = "Installer owns browser bootstrap"
    queue.set_setting("paused", hold)
    _fail_queue_transaction(
        queue,
        monkeypatch,
        statement="INSERT INTO settings VALUES",
        failures=module.CONTROL.storage_retry_limit,
    )
    with pytest.raises(sqlite3.OperationalError):
        queue.set_setting("paused", "Instagram browser requires human account recovery")
    assert queue.compare_set_pause(hold, False) is False
    queue.recover_interrupted()
    assert queue.get_setting("paused") == "Instagram browser requires human account recovery"


def test_pause_can_be_acquired_atomically_before_a_setting_exists(queue):
    hold = "Installer owns browser bootstrap"
    assert queue.get_setting("paused", False) is False
    assert queue.compare_set_pause(False, hold) is True
    assert queue.get_setting("paused") == hold
    assert queue.claim_next() is None


def test_storage_recovery_persists_a_rate_limit_that_could_not_be_written(queue, monkeypatch):
    clock = _clock(monkeypatch)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "unstored-rate-limit")).id
    active = queue.claim_next()
    connect = queue._connect
    attempts = []

    def full_connections():
        attempts.append(True)
        raise _storage_failure()

    monkeypatch.setattr(queue, "_connect", full_connections)
    with pytest.raises(sqlite3.OperationalError):
        queue.defer_for_rate_limit(active, "HTTP 429")
    assert queue.is_rate_limited()
    assert len(attempts) == module.CONTROL.storage_retry_limit
    monkeypatch.setattr(queue, "_connect", connect)
    clock.now += 10
    queue.recover_interrupted()
    assert queue.get(job_id).state == "pending"
    assert queue.is_rate_limited()
    assert queue.get_setting("browser_rate_limit_until") == (
        clock.now + module.CONTROL.rate_limit_backoff_seconds
    )
    assert queue.claim_next() is None
    assert not queue.get_setting("paused", False)


def test_digest_wait_returns_exact_worker_result(queue, monkeypatch):
    clock = _clock(monkeypatch)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})

    def worker_completes():
        job = queue.claim_next()
        assert job.kind == "digest"
        queue.finish(
            job,
            result={
                "account_username": ACCOUNT_USERNAME,
                "media_ids": ["123", "456"],
                "page_count": 2,
            },
        )

    clock.after_sleep = worker_completes

    result = module.QueuedInstagramDigestResolver(queue).resolve(
        RECIPIENT_ID,
        ACCOUNT_USERNAME,
        "cache-succeeded",
    )

    assert result == module.DigestResolution(ACCOUNT_USERNAME, ("123", "456"), 2)
    assert clock.elapsed == module.CONTROL.worker_poll_interval_seconds


@pytest.mark.parametrize("terminal_state", ["cancelled", "failed"])
def test_digest_wait_reports_terminal_failure(queue, monkeypatch, terminal_state):
    clock = _clock(monkeypatch)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-failed")).id

    def terminate_job():
        if terminal_state == "cancelled":
            queue.cancel(job_id)
        else:
            assert queue.claim_next().id == job_id
            queue.finish(queue.get(job_id), error="Instagram requires human reauthorization")

    clock.after_sleep = terminate_job

    with pytest.raises(module.BrowserDigestError, match="cancelled|reauthorization"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-failed",
        )

    assert queue.get(job_id).state == terminal_state


@pytest.mark.parametrize("failing_method", ["enqueue_digest", "get", "get_setting"])
def test_digest_storage_failures_preserve_sanitized_error_contract(
    queue,
    monkeypatch,
    failing_method,
):
    def fail(*_args, **_kwargs):
        raise sqlite3.OperationalError("private filesystem error")

    monkeypatch.setattr(queue, failing_method, fail)

    with pytest.raises(module.BrowserDigestError) as raised:
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-storage-error",
        )

    assert "private filesystem error" not in str(raised.value)


def test_concurrent_threads_deduplicate_submissions_and_claim_each_job_once(queue):
    def enqueue(index):
        client = module.BrowserJobQueue(queue.state_directory)
        return _engagement(client, "Shared"), _engagement(client, f"Unique{index}")

    with ThreadPoolExecutor(max_workers=8) as executor:
        submitted = list(executor.map(enqueue, range(20)))

    shared_ids = {item[0] for item in submitted}
    expected_ids = shared_ids | {item[1] for item in submitted}
    assert len(shared_ids) == 1
    assert len(expected_ids) == 21

    with ThreadPoolExecutor(max_workers=8) as executor:
        claimed = list(executor.map(lambda _index: queue.claim_next(), range(28)))

    actual_ids = [job.id for job in claimed if job is not None]
    assert len(actual_ids) == len(set(actual_ids)) == 21
    assert set(actual_ids) == expected_ids


def test_independent_processes_share_deduplication_and_atomic_claims(queue):
    source = """
import json, sys
from pathlib import Path
from services.instagram_notifications.browser_queue import BrowserJobQueue
queue = BrowserJobQueue(Path(sys.argv[1]))
def enqueue(shortcode):
    return queue.enqueue_engagement(school='ubc', recipient_id='12342599092',
        account_username='ubc.wat2do.io', post_url=f'https://www.instagram.com/p/{shortcode}/',
        )
shared = enqueue('Shared')
unique = enqueue('Child' + sys.argv[2])
job = queue.claim_next()
print(json.dumps({'shared':shared, 'unique':unique, 'claimed':job.id if job else None}))
"""
    processes = [
        subprocess.Popen(
            [sys.executable, "-c", source, str(queue.state_directory), str(index)],
            cwd=Path(__file__).resolve().parents[3],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for index in range(4)
    ]
    outputs = []
    try:
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            assert process.returncode == 0, stderr
            outputs.append(json.loads(stdout))
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)

    shared_ids = {output["shared"] for output in outputs}
    expected_ids = shared_ids | {output["unique"] for output in outputs}
    claimed_ids = [output["claimed"] for output in outputs if output["claimed"] is not None]
    assert len(shared_ids) == 1
    assert len(expected_ids) == 5
    while job := queue.claim_next():
        claimed_ids.append(job.id)
    assert set(claimed_ids) == expected_ids
    assert len(claimed_ids) == len(set(claimed_ids))


def test_digest_preempts_retrieval_and_retrieval_preempts_engagement(queue):
    engagement = _engagement(queue)
    retrieval = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/AbC/",
    )
    digest = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-first")).id
    assert _complete_next(queue).id == digest
    assert _complete_next(queue, allow_engagement=False).id == retrieval
    assert _complete_next(queue).id == engagement


def test_aged_engagement_drains_retrieval_before_switching_but_digest_stays_first(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/Running/",
    )
    running = queue.claim_next()
    engagement = _engagement(queue)
    remaining = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/Remaining/",
    )
    clock.now += module.CONTROL.engagement_max_wait_seconds
    assert queue.claim_companions(running, limit=14) == []
    assert queue.get(first).state == "running"
    assert queue.get(remaining).state == "pending"
    queue.finish(queue.get(first), result={"posts": []})
    digest = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "still-highest-priority")).id
    assert _complete_next(queue).id == digest
    assert _complete_next(queue).id == engagement
    assert _complete_next(queue).id == remaining


@pytest.mark.parametrize("reason", ["young", "cooldown", "excluded", "disabled"])
def test_ineligible_engagement_does_not_interrupt_continuous_retrieval(queue, monkeypatch, reason):
    clock = _clock(monkeypatch)
    queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/Running/",
    )
    first = queue.claim_next()
    engagement = queue.enqueue_engagement(
        school="uwo",
        recipient_id="456",
        account_username="wat2do.uwo",
        post_url="https://www.instagram.com/p/Featured/",
    )
    remaining = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/Refill/",
    )
    if reason != "young":
        clock.now += module.CONTROL.engagement_max_wait_seconds
    if reason == "cooldown":
        queue.set_setting("next_engagement_at", clock.now + 100)
    if reason == "excluded":
        queue.set_setting("excluded_accounts", ["wat2do.uwo"])
    companions = queue.claim_companions(first, limit=14, allow_engagement=reason != "disabled")
    assert [job.id for job in companions] == [remaining]
    assert queue.get(engagement).state == "pending"


def test_overdue_backlog_yields_retrieval_but_finishes_current_school_before_switching(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    initial = _engagement(queue, "InitialUBC")
    assert _complete_next(queue).id == initial
    assert queue.get_setting("engagement_school") == "ubc"
    clock.now += 1
    older_other_school = queue.enqueue_engagement(
        school="uwo",
        recipient_id="456",
        account_username="wat2do.uwo",
        post_url="https://www.instagram.com/p/OlderUWO/",
    )
    clock.now += 1
    second_current_school = _engagement(queue, "SecondUBC")
    clock.now += 1
    third_current_school = _engagement(queue, "ThirdUBC")
    first_read = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/ActiveRetrieval/",
    )
    active = queue.claim_next()
    assert active.id == first_read
    remaining_read = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/RemainingRetrieval/",
    )
    clock.now += module.CONTROL.engagement_max_wait_seconds
    assert queue.claim_companions(active, limit=14) == []
    queue.finish(queue.get(first_read), result={"posts": []})
    assert _complete_next(queue).id == second_current_school
    assert _complete_next(queue).id == third_current_school
    assert _complete_next(queue).id == older_other_school
    assert _complete_next(queue).id == remaining_read


@pytest.mark.parametrize("kind", ["digest", "retrieval"])
def test_safe_read_retry_preserves_diagnostic_reason_without_exposing_terminal_failure(queue, kind):
    job_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "read-retry")).id
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/ReadRetry/",
        )
    )
    queue.claim_next()
    queue.finish(
        queue.get(job_id),
        result={"private_details": "must-not-be-logged"},
        error="Transient bridge failure",
        requeue=True,
    )
    job = queue.get(job_id)
    assert job.state == "pending"
    assert job.error is None
    assert job.result is None
    assert job.attempts == 1
    queue.record_diagnostic("pending", job)
    with queue._connect() as db:
        assert db.execute("SELECT started_at FROM jobs WHERE id=?", (job_id,)).fetchone()[0] is None
        events = [
            json.loads(row[0])
            for row in db.execute("SELECT event FROM diagnostic_events ORDER BY created_at")
        ]
    assert [(event["payload"]["state"], event["payload"]["reason"]) for event in events] == [
        ("queued", None),
        ("retrying", "Transient bridge failure"),
        ("pending", None),
    ]
    assert events[1]["payload"]["job_id"] == job_id
    assert events[1]["payload"]["kind"] == kind
    assert events[1]["ig_account"] == ACCOUNT_USERNAME
    assert events[1]["post_url"] == (
        "https://www.instagram.com/p/ReadRetry/" if kind == "retrieval" else None
    )
    assert set(events[1]["payload"]) == {"state", "job_id", "kind", "reason", "recorded_at"}
    assert "must-not-be-logged" not in json.dumps(events[1])
    assert queue.claim_next().attempts == 2


@pytest.mark.parametrize("kind", ["digest", "retrieval"])
def test_confirmed_rate_limit_preserves_last_read_attempt_budget_and_claim_diagnostics(
    queue, monkeypatch, kind
):
    clock = _clock(monkeypatch)
    job_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-last-budget")).id
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/RateLastBudget/",
        )
    )
    with queue._connect() as db:
        db.execute(
            "UPDATE jobs SET attempts=? WHERE id=?",
            (module.CONTROL.ingestion_retry_limit - 1, job_id),
        )
    active = queue.claim_next()
    assert active.attempts == module.CONTROL.ingestion_retry_limit
    queue.record_diagnostic("running", active)
    reason = "Instagram public media request failed with HTTP 429"
    queue.defer_for_rate_limit(active, reason)

    queue.finish(active, error=reason, requeue=True, refund_rate_limit=True)

    held = queue.get(job_id)
    assert held.state == "pending"
    assert held.attempts == module.CONTROL.ingestion_retry_limit - 1
    assert held.error is None
    assert queue.claim_next() is None
    with queue._connect() as db:
        events = [json.loads(row[0]) for row in db.execute("SELECT event FROM diagnostic_events")]
        assert db.execute("SELECT started_at FROM jobs WHERE id=?", (job_id,)).fetchone()[0] is None
    assert [(event["payload"]["state"], event["payload"]["reason"]) for event in events] == [
        ("queued", None),
        ("running", None),
        ("rate_limited", reason),
        ("retrying", reason),
    ]
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    retried = queue.claim_next()
    assert retried.id == job_id
    assert retried.attempts == module.CONTROL.ingestion_retry_limit
    queue.finish(queue.get(job_id), error="Instagram public media request failed with HTTP 400")
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit


@pytest.mark.parametrize("requeue,kind", [(False, "digest"), (True, "engagement")])
def test_rate_limit_attempt_refund_requires_a_requeued_read(queue, requeue, kind):
    job_id = (
        (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-guard")).id
        if kind == "digest"
        else _engagement(queue, "RateRefundNative")
    )
    active = queue.claim_next()
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events").fetchall()

    with pytest.raises(ValueError):
        queue.finish(active, error="HTTP 429", requeue=requeue, refund_rate_limit=True)

    assert queue.get(job_id) == active
    with queue._connect() as db:
        assert db.execute("SELECT event FROM diagnostic_events").fetchall() == events


@pytest.mark.parametrize(
    "error,result",
    [(None, None), ("", None), ("   ", None), ("HTTP 429", {}), ("HTTP 429", {"status": "failed"})],
)
def test_rate_limit_attempt_refund_requires_nonempty_error_and_no_result(queue, error, result):
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-result")).id
    active = queue.claim_next()

    with pytest.raises(ValueError, match="rate-limited claim refund"):
        queue.finish(active, error=error, result=result, requeue=True, refund_rate_limit=True)

    assert queue.get(job_id) == active


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "engagement"},
        {"state": "pending"},
        {"started_at": None},
        {"attempts": 0},
    ],
)
def test_rate_limit_attempt_refund_requires_the_original_running_read_claim(queue, changes):
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-identity")).id
    active = queue.claim_next()

    with pytest.raises(ValueError, match="rate-limited claim refund"):
        queue.finish(
            replace(active, **changes),
            error="HTTP 429",
            requeue=True,
            refund_rate_limit=True,
        )

    assert queue.get(job_id) == active


def test_simultaneous_rate_limited_completions_refund_only_one_claim(queue, monkeypatch):
    _clock(monkeypatch)
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-concurrent")
    ).id
    active = queue.claim_next()
    queue.record_diagnostic("running", active)
    queue.defer_for_rate_limit(active, "HTTP 429")

    def finish(_index):
        queue.finish(active, error="HTTP 429", requeue=True, refund_rate_limit=True)

    with ThreadPoolExecutor(max_workers=14) as executor:
        list(executor.map(finish, range(14)))

    assert queue.get(job_id).state == "pending"
    assert queue.get(job_id).attempts == 0
    with queue._connect() as db:
        states = [
            json.loads(row[0])["payload"]["state"]
            for row in db.execute("SELECT event FROM diagnostic_events")
        ]
    assert states == ["queued", "running", "rate_limited", "retrying"]


def test_old_rate_limited_claim_cannot_refund_or_defer_a_new_claim_with_same_attempt_number(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-stale")).id
    original = queue.claim_next()
    queue.defer_for_rate_limit(original, "HTTP 429")
    queue.finish(original, error="HTTP 429", requeue=True, refund_rate_limit=True)
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    current = queue.claim_next()
    assert current.attempts == original.attempts
    assert current.started_at != original.started_at
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events").fetchall()

    queue.defer_for_rate_limit(original, "HTTP 429")
    queue.finish(original, error="HTTP 429", requeue=True, refund_rate_limit=True)

    assert queue.get(job_id) == current
    assert not queue.is_rate_limited()
    with queue._connect() as db:
        assert db.execute("SELECT event FROM diagnostic_events").fetchall() == events
    queue.defer_for_rate_limit(current, "HTTP 429")
    queue.finish(current, error="HTTP 429", requeue=True, refund_rate_limit=True)
    assert queue.get(job_id).attempts == 0


@pytest.mark.parametrize("rate_limited", [False, True])
@pytest.mark.parametrize("state", ["missing", "pending", "succeeded", "failed", "cancelled"])
def test_noop_safe_read_requeue_does_not_record_retry_diagnostics(queue, state, rate_limited):
    job_id = (queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "no-retry")).id
    original = queue.claim_next()
    assert original.id == job_id
    if state == "missing":
        job_id = "missing-read"
        original = replace(original, id=job_id)
    if state in {"succeeded", "failed"}:
        queue.finish(queue.get(job_id), error="Previous failure" if state == "failed" else None)
    elif state in {"pending", "cancelled"}:
        queue.finish(queue.get(job_id), error="Previous transient failure", requeue=True)
        if state == "cancelled":
            queue.cancel(job_id)
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events ORDER BY created_at").fetchall()
    queue.finish(
        original,
        error="Transient bridge failure",
        requeue=True,
        refund_rate_limit=rate_limited,
    )
    job = queue.get(job_id)
    if state == "missing":
        assert job is None
    else:
        assert job.state == state
    with queue._connect() as db:
        assert (
            db.execute("SELECT event FROM diagnostic_events ORDER BY created_at").fetchall()
            == events
        )


def test_automatic_retry_cannot_repeat_an_engagement(queue):
    job_id = _engagement(queue)
    queue.claim_next()
    with pytest.raises(ValueError, match="Engagement cannot"):
        queue.finish(queue.get(job_id), error="Uncertain click", requeue=True)
    assert queue.get(job_id).state == "running"
    with queue._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM diagnostic_events").fetchone()[0] == 1


def test_paused_queue_does_not_claim_even_when_worker_observed_resume_earlier(queue):
    job_id = _engagement(queue)
    queue.set_setting("paused", "Human account recovery")
    assert queue.claim_next() is None
    assert queue.get(job_id).state == "pending"


def test_public_bootstrap_account_is_peeked_without_claiming_or_unexcluding_jobs(queue):
    assert queue.peek_account_username() is None
    excluded = _engagement(queue, "ExcludedProfile")
    queue.set_setting("excluded_accounts", [ACCOUNT_USERNAME])
    available = (queue.enqueue_digest("456", "wat2do.uwo", "bootstrap-public-profile")).id
    assert queue.peek_account_username() == "wat2do.uwo"
    assert queue.get(excluded).state == queue.get(available).state == "pending"
    assert queue.get(excluded).attempts == queue.get(available).attempts == 0


def test_diagnostic_publishing_stops_between_http_calls_without_losing_unsent_events(
    queue, monkeypatch
):
    from services import automate_log_service

    queue.record_diagnostic("first")
    queue.record_diagnostic("second")
    calls = []
    monkeypatch.setattr(
        automate_log_service, "create_automate_log", lambda **event: calls.append(event) or True
    )
    queue.publish_diagnostics(should_stop=lambda: len(calls) >= 1)
    assert len(calls) == 1
    queue.publish_diagnostics()
    assert len(calls) == 2
    assert {event["payload"]["state"] for event in calls} == {"first", "second"}


def test_retrieval_recovery_and_refresh_preserve_other_history(queue):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/Club.Name/",
    )
    assert queue.claim_next().id == job_id
    queue.recover_interrupted()
    assert queue.get(job_id).state == "pending"
    assert not queue.get_setting("paused", False)
    assert queue.claim_next().id == job_id
    queue.finish(queue.get(job_id), result={"posts": []})
    queue.refresh_retrieval(job_id)
    assert queue.get(job_id).result is None
    assert queue.get(job_id).attempts == 0
    assert queue.get(job_id).payload["url"] == "https://www.instagram.com/club.name/"


def test_old_queue_upgrade_keeps_jobs_settings_and_selected_school(queue):
    job_id = _engagement(queue)
    queue.set_setting("important", {"checkpoint": 7})
    queue.claim_next()
    queue.finish(queue.get(job_id), result={"status": "succeeded"})
    # Reproduce the deployed schema rather than starting with a new queue.
    with sqlite3.connect(queue.database_path) as db:
        db.execute("PRAGMA writable_schema=ON")
        db.execute(
            "UPDATE sqlite_master SET sql=replace(sql, \"'digest', 'retrieval', 'engagement'\", \"'digest', 'engagement'\") WHERE name='jobs'"
        )
        db.execute("PRAGMA writable_schema=OFF")
    reopened = module.BrowserJobQueue(queue.state_directory)
    assert reopened.get(job_id).state == "succeeded"
    assert reopened.get_setting("important") == {"checkpoint": 7}
    assert reopened.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/AbC/",
    )
    assert reopened.get_setting("engagement_school") == "ubc"


def test_digest_companions_never_cross_accounts_or_include_excluded_targets(tmp_path):
    q = module.BrowserJobQueue(tmp_path / "parallel")
    first = (q.enqueue_digest("123", "wat2do.ubc", "first")).id
    same = (q.enqueue_digest("123", "wat2do.ubc", "second")).id
    other = (q.enqueue_digest("456", "wat2do.utm", "third")).id
    excluded = (q.enqueue_digest("789", "wat2do.utsc", "fourth")).id
    q.set_setting("excluded_accounts", ["wat2do.utsc"])
    claimed = q.claim_next()
    assert claimed.id == first
    assert [job.id for job in q.claim_companions(claimed, limit=9)] == [same]
    assert q.get(same).attempts == 1
    assert q.get(other).state == q.get(excluded).state == "pending"


def test_waiting_digest_and_pause_prevent_filling_retrieval_batch(tmp_path):
    q = module.BrowserJobQueue(tmp_path / "parallel")
    first = q.enqueue_retrieval(
        school="ubc",
        recipient_id="123",
        account_username="wat2do.ubc",
        url="https://www.instagram.com/p/First/",
    )
    second = q.enqueue_retrieval(
        school="ubc",
        recipient_id="123",
        account_username="wat2do.ubc",
        url="https://www.instagram.com/p/Second/",
    )
    claimed = q.claim_next()
    assert claimed.id == first
    digest = (q.enqueue_digest("123", "wat2do.ubc", "digest")).id
    assert q.claim_companions(claimed, limit=9) == []
    q.cancel(digest)
    q.set_setting("paused", "human recovery")
    assert q.claim_companions(claimed, limit=9) == []
    assert q.get(second).state == "pending"


def test_diagnostics_preserve_unsent_events_and_allowlist_payload(queue, monkeypatch):
    from services import automate_log_service

    job_id = _engagement(queue)
    job = queue.claim_next()
    queue.record_diagnostic("running", job)
    queue.finish(queue.get(job_id), error="Matching Instagram browser account is unavailable")
    queue.record_diagnostic("failed", queue.get(job_id))
    queue.set_setting("paused", "Instagram browser requires human account recovery")
    monkeypatch.setattr(automate_log_service, "create_automate_log", lambda **event: False)
    queue.publish_diagnostics()
    with queue._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM diagnostic_events").fetchone()[0] == 4
    events = []
    monkeypatch.setattr(
        automate_log_service, "create_automate_log", lambda **event: events.append(event) or True
    )
    queue.publish_diagnostics()
    assert [event["payload"]["state"] for event in events] == [
        "queued",
        "running",
        "failed",
        "paused",
    ]
    assert events[0]["payload"]["job_id"] == job_id
    assert events[0]["sender_id"] == "instagram-browser-worker"
    assert "recipient_id" not in events[0]["payload"]
    assert "payload" not in events[0]["payload"]
    with queue._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM diagnostic_events").fetchone()[0] == 0


def test_deduplicated_queueing_does_not_duplicate_diagnostics(queue):
    assert _engagement(queue) == _engagement(queue)
    with queue._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM diagnostic_events").fetchone()[0] == 1


def test_digest_waits_through_installer_pause_and_worker_restart(queue, monkeypatch):
    clock = _clock(monkeypatch)
    queue.set_setting("paused", module.WORKER_INSTALLATION_PAUSE)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
    sleeps = []

    def restart_worker():
        assert queue.get_setting("paused") == module.WORKER_INSTALLATION_PAUSE
        assert queue.claim_next() is None
        sleeps.append(clock.elapsed)
        if len(sleeps) == 1:
            queue.set_setting("worker", {"running": False, "heartbeat": 0})
            return
        queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
        assert queue.compare_set_pause(module.WORKER_INSTALLATION_PAUSE, False)
        queue.finish(
            queue.claim_next(),
            result={"account_username": ACCOUNT_USERNAME, "media_ids": ["123"], "page_count": 1},
        )

    clock.after_sleep = restart_worker
    result = module.QueuedInstagramDigestResolver(queue).resolve(
        RECIPIENT_ID, ACCOUNT_USERNAME, "install-restart"
    )
    assert result.media_ids == ("123",)
    assert len(sleeps) == 2
    assert clock.elapsed == 2 * module.CONTROL.worker_poll_interval_seconds
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("replaced", [False, True])
def test_installer_pause_waits_only_to_original_digest_deadline(queue, monkeypatch, replaced):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "install-expiry")
    queue.set_setting("paused", module.WORKER_INSTALLATION_PAUSE)
    queue.set_setting("worker", {"running": False, "heartbeat": 0})
    newer = []

    def replace_original_submission():
        if replaced and not newer:
            queue.cancel(receipt.id)
            newer.append(queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "install-expiry"))

    clock.after_sleep = replace_original_submission
    with pytest.raises(module.BrowserDigestError, match="timed out"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID, ACCOUNT_USERNAME, "install-expiry"
        )
    assert clock.elapsed == module.CONTROL.result_timeout_seconds
    assert queue.get_setting("paused") == module.WORKER_INSTALLATION_PAUSE
    assert queue.claim_next() is None
    if replaced:
        assert queue.get(receipt.id) == newer[0]
        assert newer[0].state == "pending"
    else:
        assert queue.get(receipt.id).state == "cancelled"


@pytest.mark.parametrize(
    "pause",
    [
        "Instagram browser requires human account recovery",
        "Instagram browser request cancellation could not be confirmed: Apple Event -600",
        module.WORKER_INSTALLATION_PAUSE + "; human account recovery",
    ],
)
def test_digest_waits_only_for_exact_installer_hold_and_never_auth_holds(queue, monkeypatch, pause):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "auth-during-install")
    queue.set_setting("paused", pause)
    queue.set_setting("worker", {"running": False, "heartbeat": 0})
    with pytest.raises(module.BrowserDigestError, match="worker is paused") as error:
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID, ACCOUNT_USERNAME, "auth-during-install"
        )
    assert clock.elapsed == 0
    assert pause in str(error.value)
    assert queue.get_setting("paused") == pause
    assert queue.get(receipt.id).state == "cancelled"
    assert queue.get(receipt.id).attempts == 0


@pytest.mark.parametrize("outcome", ["success", "failure", "requeue", "missing"])
def test_old_completion_cannot_change_a_new_running_read_claim(queue, outcome):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/OriginalClaim/",
    )
    original = queue.claim_next(now=100)
    queue.finish(original, error="Temporary read failure", requeue=True)
    current = queue.claim_next(now=200)
    if outcome == "missing":
        original = replace(original, id="missing-claim")
    with queue._connect() as db:
        diagnostics = db.execute("SELECT event FROM diagnostic_events").fetchall()
    queue.finish(
        original,
        result={"status": "succeeded", "from": "old claim"} if outcome == "success" else None,
        error="Old read failed" if outcome != "success" else None,
        requeue=outcome == "requeue",
    )
    assert queue.get(job_id) == current
    with queue._connect() as db:
        assert db.execute("SELECT event FROM diagnostic_events").fetchall() == diagnostics


@pytest.mark.parametrize("refund_rate_limit", [False, True])
def test_digest_caller_can_cancel_pending_retry_with_original_admission(
    queue, monkeypatch, refund_rate_limit
):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "retry-cancellation")
    clock.now += 10
    claim = queue.claim_next()
    assert not queue.cancel_pending_digest(receipt)
    clock.now += 30
    queue.finish(
        claim,
        error="Temporary read failure",
        requeue=True,
        refund_rate_limit=refund_rate_limit,
    )
    retry = queue.get(receipt.id)
    assert retry.created_at == receipt.created_at
    assert retry.attempts == (0 if refund_rate_limit else 1)
    assert retry.started_at is None
    assert queue.cancel_pending_digest(receipt)
    assert queue.get(receipt.id).state == "cancelled"


@pytest.mark.parametrize("refund_rate_limit", [False, True])
@pytest.mark.parametrize("deadline_offset", [0, 1])
def test_automatic_digest_retry_expires_at_original_admission_deadline(
    queue, monkeypatch, refund_rate_limit, deadline_offset
):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "retry-expiry")
    clock.now += 10
    claim = queue.claim_next()
    clock.now += 30
    queue.finish(
        claim,
        error="Temporary read failure",
        requeue=True,
        refund_rate_limit=refund_rate_limit,
    )
    clock.now = receipt.created_at + module.CONTROL.result_timeout_seconds + deadline_offset
    assert queue.claim_next() is None
    expired = queue.get(receipt.id)
    assert expired.created_at == receipt.created_at
    assert expired.state == "cancelled"
    assert expired.error == "Digest caller deadline expired"


def test_rate_limit_cooldown_does_not_renew_digest_caller_lifetime(queue, monkeypatch):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cooldown-expiry")
    clock.now = receipt.created_at + module.CONTROL.result_timeout_seconds - 10
    claim = queue.claim_next()
    queue.defer_for_rate_limit(claim, "Instagram rate limit")
    queue.finish(claim, error="Instagram rate limit", requeue=True, refund_rate_limit=True)
    assert queue.claim_next() is None
    clock.now = queue.get_setting("browser_rate_limit_until")
    assert clock.now > receipt.created_at + module.CONTROL.result_timeout_seconds
    assert queue.claim_next() is None
    expired = queue.get(receipt.id)
    assert expired.created_at == receipt.created_at
    assert expired.state == "cancelled"
    assert expired.attempts == 0
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("terminal_state", ["failed", "cancelled"])
def test_explicit_digest_resubmission_renews_admission_and_fences_original_caller(
    queue, monkeypatch, terminal_state
):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "new-admission")
    if terminal_state == "failed":
        queue.finish(queue.claim_next(), error="Read failure")
    else:
        queue.cancel(receipt.id)
    clock.now += module.CONTROL.result_timeout_seconds + 1
    current = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "new-admission")
    assert current.id == receipt.id
    assert current.created_at == clock.now
    assert current.attempts == 0
    assert not queue.cancel_pending_digest(receipt)
    assert queue.get(current.id) == current
    assert queue.claim_next().id == current.id


def test_digest_companions_expire_old_admissions_before_claiming_fresh_work(queue, monkeypatch):
    clock = _clock(monkeypatch)
    first = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "first-running")
    claim = queue.claim_next()
    assert claim.id == first.id
    clock.now += 1
    expired = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "expired-companion")
    clock.now = expired.created_at + module.CONTROL.result_timeout_seconds
    fresh = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "fresh-companion")
    assert [job.id for job in queue.claim_companions(claim, limit=9)] == [fresh.id]
    assert queue.get(expired.id).state == "cancelled"


def test_expired_digest_does_not_block_retrieval_batch_refill(queue, monkeypatch):
    clock = _clock(monkeypatch)
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/FirstRefill/",
    )
    claim = queue.claim_next()
    assert claim.id == first
    expired = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "expired-before-refill")
    clock.now = expired.created_at + module.CONTROL.result_timeout_seconds
    fresh = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/SecondRefill/",
    )
    assert [job.id for job in queue.claim_companions(claim, limit=9)] == [fresh]
    assert queue.get(expired.id).state == "cancelled"


def test_digest_receipt_preserves_original_generation_during_submission_return_race(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    enqueue = queue.enqueue_digest
    newer = []

    def submit_then_replace(*args):
        receipt = enqueue(*args)
        queue.cancel(receipt.id)
        clock.now += 1
        newer.append(enqueue(*args))
        return receipt

    monkeypatch.setattr(queue, "enqueue_digest", submit_then_replace)
    with pytest.raises(module.BrowserDigestError, match="unavailable or paused"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID, ACCOUNT_USERNAME, "replacement-after-submit"
        )
    assert queue.get(newer[0].id) == newer[0]
    assert newer[0].state == "pending"


def test_late_digest_waiter_shares_original_admission_expiry_instead_of_extending_it(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "shared-pending-expiry")
    clock.now += module.CONTROL.result_timeout_seconds - 10

    def heartbeat():
        queue.set_setting("worker", {"running": True, "heartbeat": clock.now})

    heartbeat()
    clock.after_sleep = heartbeat
    with pytest.raises(module.BrowserDigestError, match="timed out"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID, ACCOUNT_USERNAME, "shared-pending-expiry"
        )
    assert clock.elapsed == 10
    assert queue.get(receipt.id).state == "cancelled"
    assert clock.now == receipt.created_at + module.CONTROL.result_timeout_seconds


def test_late_digest_waiter_can_reuse_an_already_completed_result_after_admission_expiry(
    queue, monkeypatch
):
    clock = _clock(monkeypatch)
    receipt = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "completed-replay")
    queue.finish(
        queue.claim_next(),
        result={"account_username": ACCOUNT_USERNAME, "media_ids": ["123"], "page_count": 1},
    )
    queue.set_setting("worker", {"running": False, "heartbeat": clock.now})
    clock.now += module.CONTROL.result_timeout_seconds + 1
    result = module.QueuedInstagramDigestResolver(queue).resolve(
        RECIPIENT_ID, ACCOUNT_USERNAME, "completed-replay"
    )
    assert result.media_ids == ("123",)
    assert queue.get(receipt.id).state == "succeeded"
    assert clock.elapsed == 0


def test_competing_collectors_retry_a_failed_read_once_without_resetting_attempts(queue):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/CollectorRetry/",
    )
    original = queue.claim_next()
    queue.finish(original, error="Temporary read failure")
    queue.set_setting(f"notification_delivery:{uuid4()}", job_id)
    with ThreadPoolExecutor(max_workers=14) as executor:
        changes = list(
            executor.map(lambda _: queue.retry_failed_notification_retrievals(), range(14))
        )
    assert sum(changes) == 1
    assert queue.get(job_id).state == "pending"
    assert queue.get(job_id).attempts == original.attempts


@pytest.mark.parametrize("state", ["pending", "cancelled", "succeeded", "exhausted", "engagement"])
def test_collector_admission_preserves_cancellation_and_retry_budgets(queue, state):
    job_id = (
        _engagement(queue)
        if state == "engagement"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/PreserveCollectorState/",
        )
    )
    if state == "cancelled":
        queue.cancel(job_id)
    elif state != "pending":
        for _ in range(module.CONTROL.ingestion_retry_limit if state == "exhausted" else 1):
            claim = queue.claim_next()
            queue.finish(claim, error=None if state == "succeeded" else "Read failure")
            if (
                state == "exhausted"
                and queue.get(job_id).attempts < module.CONTROL.ingestion_retry_limit
            ):
                queue.retry(job_id)
    before = queue.get(job_id)
    queue.set_setting(f"notification_delivery:{uuid4()}", job_id)
    assert not queue.retry_failed_notification_retrievals()
    assert queue.get(job_id) == before


def test_manual_import_reset_rechecks_running_state_before_changing_retry_markers(queue):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/ManualRetryAdmission/",
    )
    keys = [f"manual_imported:{job_id}", f"manual_import_attempts:{job_id}"]
    queue.set_setting(keys[0], True)
    queue.set_setting(keys[1], 3)
    stale = queue.get(job_id)
    assert stale.state == "pending"
    claim = queue.claim_next()
    with pytest.raises(ValueError, match="idle retrieval"):
        queue.reset_retrieval_import(job_id, import_setting_keys=keys)
    assert queue.get(job_id) == claim
    assert queue.get_setting(keys[0]) is True
    assert queue.get_setting(keys[1]) == 3


def test_manual_import_reset_changes_only_requested_markers_before_next_claim(queue):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/ManualRetryMarkers/",
    )
    queue.finish(queue.claim_next(), result={"posts": ["old signed media"]})
    selected = f"notification_import_attempts:{uuid4()}"
    unrelated = f"notification_import_attempts:{uuid4()}"
    keys = [selected, f"manual_imported:{job_id}", f"manual_import_attempts:{job_id}"]
    for key in [*keys, unrelated]:
        queue.set_setting(key, 3)
    queue.reset_retrieval_import(job_id, import_setting_keys=keys)
    claim = queue.claim_next()
    assert claim.attempts == 1
    assert claim.result is None
    assert all(not queue.get_setting(key) for key in keys)
    assert queue.get_setting(unrelated) == 3


def test_status_distinguishes_rate_limit_hold_from_ready_admission(queue, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: now[0])
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/VisibleCooldown/",
    )
    queue.defer_for_rate_limit(None, "Instagram rate limit")
    hold = queue.status()["rate_limit"]

    assert hold["remaining_seconds"] == module.CONTROL.rate_limit_backoff_seconds
    assert hold["backoff_seconds"] == module.CONTROL.rate_limit_backoff_seconds
    assert queue.claim_next() is None

    now[0] = hold["retry_at"]
    assert queue.status()["rate_limit"]["remaining_seconds"] == 0
    assert queue.claim_next().id == job_id


def test_status_reports_no_rate_limit_before_any_hold(queue):
    assert queue.status()["rate_limit"] == {
        "retry_at": None,
        "remaining_seconds": 0,
        "backoff_seconds": 0,
    }


@pytest.fixture
def review_store():
    connection = sqlite3.connect(":memory:")
    connection.execute(
        "CREATE TABLE review_snapshots(digest TEXT PRIMARY KEY,payload BLOB NOT NULL)"
    )
    try:
        yield connection, review_module.ReviewSnapshotStore(connection)
    finally:
        connection.close()


def test_review_snapshots_preserve_artwork_order_types_and_independent_mutable_values(review_store):
    connection, store = review_store
    shared = {"description": "Verified source café " * 500, "candidate_ids": [3, 2, 1]}
    target = {
        "image_map": {"https://images.test/z": "uploaded-z", "https://images.test/a": "uploaded-a"},
        "codex_review": {"reviewer": "Codex", "decision": "unresolved", "school": "ubc"},
        "content": shared,
        "history": [shared, {"ref": "literal user data", "version": True}],
        "types": [True, False, None, 1, 1.0, "1", "雪"],
    }
    with connection:
        reference = store.put(target)
    restored = store.get(reference)
    assert restored == target
    assert list(restored) == list(target)
    assert list(restored["image_map"].values()) == ["uploaded-z", "uploaded-a"]
    assert [type(value) for value in restored["types"]] == [
        type(value) for value in target["types"]
    ]
    restored["content"]["candidate_ids"].append(99)
    assert restored["history"][0]["candidate_ids"] == [3, 2, 1]
    assert store.get(reference) == target
    before = connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    with connection:
        assert store.put(target) == reference
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == before


def test_review_snapshot_artifact_text_preserves_original_whitespace_and_utf8_hash(review_store):
    _, store = review_store
    artifact = '{\n  "image_map": {"z": "café", "a": "雪"},\n  "source": "reviewed"\n}\n'
    reference = store.put(artifact)
    restored = store.get(reference)
    assert restored == artifact
    assert hashlib.sha256(restored.encode()).digest() == hashlib.sha256(artifact.encode()).digest()


@pytest.mark.parametrize(
    "damage",
    ["missing_child", "changed_child", "extra_gzip_member", "invalid_format", "version", "digest"],
)
def test_review_snapshot_damage_fails_closed_without_disclosing_evidence(review_store, damage):
    connection, store = review_store
    superseded = store.put({"decision": "superseded"})
    pinned = store.put({"decision": "held"})
    reference = store.put({"snapshot": {"source": "PRIVATE_EVIDENCE " * 500}})
    child = connection.execute(
        "SELECT digest,payload FROM review_snapshots WHERE digest NOT IN (?,?,?)",
        (reference["sha256"], superseded["sha256"], pinned["sha256"]),
    ).fetchone()
    assert child is not None
    if damage == "missing_child":
        connection.execute("DELETE FROM review_snapshots WHERE digest=?", (child[0],))
    elif damage == "changed_child":
        connection.execute(
            "UPDATE review_snapshots SET payload=? WHERE digest=?",
            (gzip.compress(b'"PRIVATE_TAMPERED_EVIDENCE"'), child[0]),
        )
    elif damage == "extra_gzip_member":
        connection.execute(
            "UPDATE review_snapshots SET payload=? WHERE digest=?",
            (child[1] + gzip.compress(b"PRIVATE_EVIDENCE"), child[0]),
        )
    elif damage == "invalid_format":
        payload = b'["unknown_format","PRIVATE_EVIDENCE"]'
        digest = hashlib.sha256(payload).hexdigest()
        connection.execute(
            "INSERT INTO review_snapshots VALUES (?,?)", (digest, gzip.compress(payload))
        )
        reference = {"version": 1, "sha256": digest}
    elif damage == "version":
        reference = {**reference, "version": True}
    else:
        reference = {"version": 1, "sha256": "../../PRIVATE_EVIDENCE"}
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        store.get(reference)
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__cause__ is None
    assert error.value.__context__ is None
    before = connection.execute(
        "SELECT digest,payload FROM review_snapshots ORDER BY digest"
    ).fetchall()
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        store.collect([pinned, reference])
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__context__ is None
    assert (
        connection.execute("SELECT digest,payload FROM review_snapshots ORDER BY digest").fetchall()
        == before
    )


def test_review_snapshot_reuse_verifies_immutable_content_before_publication(review_store):
    connection, store = review_store
    reference = store.put({"decision": "unresolved"})
    connection.execute(
        "UPDATE review_snapshots SET payload=? WHERE digest=?",
        (b"PRIVATE_CORRUPTED_BLOB", reference["sha256"]),
    )
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        store.put({"decision": "unresolved"})
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__context__ is None


def test_review_snapshot_quota_and_caller_rollback_preserve_previous_checkpoint(
    review_store, monkeypatch
):
    connection, store = review_store
    connection.execute("CREATE TABLE checkpoint(value TEXT NOT NULL)")
    with connection:
        previous = store.put({"decision": "unresolved", "evidence": "keep"})
        connection.execute("INSERT INTO checkpoint VALUES (?)", (json.dumps(previous),))
    count = connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_storage_max_mb": 1}),
    )
    large = base64.b64encode(random.Random(7).randbytes(2 * 1024 * 1024)).decode()
    with pytest.raises(review_module.ReviewSnapshotError):
        with connection:
            reference = store.put({"old": "keep", "new": large})
            connection.execute("UPDATE checkpoint SET value=?", (json.dumps(reference),))
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == count
    assert json.loads(connection.execute("SELECT value FROM checkpoint").fetchone()[0]) == previous
    assert store.get(previous)["decision"] == "unresolved"
    with pytest.raises(RuntimeError, match="caller failed"):
        with connection:
            store.put({"new": "otherwise valid"})
            raise RuntimeError("caller failed")
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == count


def test_review_snapshot_bounds_repeated_reference_expansion(review_store, monkeypatch):
    connection, store = review_store
    child = json.dumps(["value", "x" * 1100], separators=(",", ":")).encode()
    child_hash = hashlib.sha256(child).hexdigest()
    root = json.dumps(["array", [["ref", child_hash]] * 4], separators=(",", ":")).encode()
    root_hash = hashlib.sha256(root).hexdigest()
    connection.executemany(
        "INSERT INTO review_snapshots VALUES (?,?)",
        [(child_hash, gzip.compress(child)), (root_hash, gzip.compress(root))],
    )
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_max_bytes": 4096}),
    )
    with pytest.raises(review_module.ReviewSnapshotError):
        store.get({"version": 1, "sha256": root_hash})
    with pytest.raises(review_module.ReviewSnapshotError):
        store.collect([{"version": 1, "sha256": root_hash}])
    with pytest.raises(review_module.ReviewSnapshotError):
        store.put("x" * 4097)
    deep = None
    for _ in range(65):
        deep = [deep]
    with pytest.raises(review_module.ReviewSnapshotError):
        store.put(deep)
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == 2


@pytest.mark.parametrize(
    ("indent", "compact", "ascii_only", "newline"),
    [
        (None, False, True, False),
        (None, True, False, True),
        (2, False, False, False),
        (4, True, True, False),
        ("\t", False, False, True),
    ],
)
def test_review_artifact_native_recipes_reproduce_exact_text(indent, compact, ascii_only, newline):
    value = {
        "image_map": {"z": "café", "a": "雪"},
        "numbers": [1, 1.0, -0.0, float("nan"), float("inf"), -float("inf")],
        "literal": ["value", {"ref": "ordinary JSON"}],
    }
    text = json.dumps(
        value,
        indent=indent,
        ensure_ascii=ascii_only,
        separators=(",", ":") if compact else None,
    ) + ("\n" if newline else "")
    envelope = review_module.encode_review_artifact(text)
    assert envelope["format"] == "json"
    assert list(envelope["value"]["image_map"]) == ["z", "a"]
    restored = review_module.decode_review_artifact(envelope)
    assert restored == text
    assert restored.encode() == text.encode()


def test_review_artifact_recipes_share_snapshots_across_different_formatting(review_store):
    connection, store = review_store
    value = {"candidate_snapshot": [{"id": 1, "description": "Reviewed candidate " * 300}]}
    first = json.dumps(value, indent=2) + "\n"
    second = json.dumps(value, separators=(",", ":"))
    first_reference = store.put(review_module.encode_review_artifact(first))
    before = connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    second_reference = store.put(review_module.encode_review_artifact(second))
    assert first_reference != second_reference
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == before + 1
    assert review_module.decode_review_artifact(store.get(first_reference)) == first
    assert review_module.decode_review_artifact(store.get(second_reference)) == second


@pytest.mark.parametrize("text", [json.dumps({"original": [1, 2]}, indent=3), '{ "n": 1e3 }\n\n'])
def test_review_artifact_non_native_format_uses_lossless_raw_fallback(text):
    envelope = review_module.encode_review_artifact(text)
    assert envelope["format"] == "raw"
    assert review_module.decode_review_artifact(envelope) == text


def test_review_artifact_recipe_validation_and_expansion_remain_bounded(monkeypatch):
    recipe = {
        "ensure_ascii": False,
        "indent": 4,
        "separators": "default",
        "trailing_newline": False,
    }
    envelope = {"version": 1, "format": "json", "value": "PRIVATE_EVIDENCE", "recipe": recipe}
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        review_module.decode_review_artifact({**envelope, "recipe": {**recipe, "indent": 10**6}})
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__context__ is None
    value = ["x"] * 100
    for _ in range(12):
        value = [value]
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_max_bytes": 1024}),
    )
    assert len(json.dumps(value, separators=(",", ":"))) < 1024
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        review_module.decode_review_artifact({**envelope, "value": value})
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__context__ is None


def test_review_snapshot_nested_values_do_not_retain_each_serialized_subtree(
    review_store, monkeypatch
):
    _, store = review_store
    value = "x" * (1024 * 1024)
    for _ in range(40):
        value = {"nested": value}
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_max_bytes": 2 * 1024 * 1024}),
    )
    tracemalloc.start()
    try:
        reference = store.put(value)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 16 * 1024 * 1024
    assert store.get(reference) == value


def _held_review_target():
    return {
        "source_url": "https://www.instagram.com/p/HeldReviewSource/",
        "image_map": {"https://images.test/z": "upload-z", "https://images.test/a": "upload-a"},
        "content": {"caption": "Source café evidence " * 500, "candidate_ids": [3, 2, 1]},
        "codex_review": {
            "reviewer": "Codex",
            "decision": "unresolved",
            "school": "mun",
            "source_url": "https://www.instagram.com/p/HeldReviewSource/",
            "reason": "Recipient and source school need reconciliation",
        },
    }


def test_queue_compacts_legacy_held_reviews_and_round_trips_new_ordered_values(queue):
    key = "notification_reviewed_target:legacy-held"
    target = _held_review_target()
    with queue._connect() as connection:
        connection.execute("INSERT INTO settings VALUES (?,?)", (key, json.dumps(target)))
    assert queue.get_setting(key) == target

    assert queue.compact_review_settings() == {"compacted": 1, "already_compact": 0, "changed": 0}
    with queue._connect() as connection:
        pointer = json.loads(
            connection.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()[0]
        )
    assert "content" not in pointer
    assert pointer["codex_review"]["decision"] == "unresolved"
    assert pointer["codex_review"]["school"] == "mun"
    restored = queue.get_setting(key)
    assert restored == target
    assert list(restored) == list(target)
    assert list(restored["image_map"].values()) == ["upload-z", "upload-a"]
    assert restored["codex_review"]["reason"] == target["codex_review"]["reason"]

    target["content"]["candidate_ids"].append(4)
    queue.set_setting(key, target)
    assert module.BrowserJobQueue(queue.state_directory).get_setting(key) == target
    assert queue.compact_review_settings() == {"compacted": 0, "already_compact": 1, "changed": 0}


def test_queue_review_migration_preserves_a_decision_changed_after_its_source_read(
    queue, monkeypatch
):
    key = "notification_reviewed_target:concurrent-decision"
    target = _held_review_target()
    legacy_text = json.dumps(target)
    with queue._connect() as connection:
        connection.execute("INSERT INTO settings VALUES (?,?)", (key, legacy_text))
    fresh = {**target, "codex_review": {**target["codex_review"], "reason": "New verified source"}}
    writer = module.BrowserJobQueue(queue.state_directory)
    decode = json.loads
    changed = False

    def another_reviewer_publishes(text, *args, **kwargs):
        nonlocal changed
        value = decode(text, *args, **kwargs)
        if text == legacy_text and not changed:
            changed = True
            writer.set_setting(key, fresh)
        return value

    monkeypatch.setattr(module.json, "loads", another_reviewer_publishes)
    assert queue.compact_review_settings() == {"compacted": 0, "already_compact": 0, "changed": 1}
    assert changed
    assert queue.get_setting(key) == fresh


def test_queue_failed_review_checkpoint_commit_rolls_back_its_new_snapshot(queue, monkeypatch):
    key = "notification_reviewed_target:durable-checkpoint"
    target = _held_review_target()
    queue.set_setting(key, target)
    with queue._connect() as connection:
        before = connection.execute(
            "SELECT digest,payload FROM review_snapshots ORDER BY digest"
        ).fetchall()
    _fail_queue_transaction(
        queue,
        monkeypatch,
        statement="INSERT INTO settings",
        failures=module.CONTROL.storage_retry_limit,
        at_commit=True,
    )
    fresh = {**target, "content": {"caption": "New source evidence " * 500}}
    with pytest.raises(sqlite3.OperationalError):
        queue.set_setting(key, fresh)
    assert queue.get_setting(key) == target
    with queue._connect() as connection:
        assert (
            connection.execute(
                "SELECT digest,payload FROM review_snapshots ORDER BY digest"
            ).fetchall()
            == before
        )


def test_queue_review_storage_quota_rejects_new_pointer_but_reuses_existing_content(
    queue, monkeypatch
):
    key = "notification_reviewed_target:bounded-storage"
    target = _held_review_target()
    queue.set_setting(key, target)
    with queue._connect() as connection:
        before = connection.execute(
            "SELECT count(*),SUM(length(payload)) FROM review_snapshots"
        ).fetchone()
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_storage_max_mb": 1}),
    )
    queue.set_setting(key, target)
    queue.set_setting("notification_reviewed_target:same-evidence", target)
    with queue._connect() as connection:
        assert tuple(
            connection.execute(
                "SELECT count(*),SUM(length(payload)) FROM review_snapshots"
            ).fetchone()
        ) == tuple(before)
    large = base64.b64encode(random.Random(11).randbytes(2 * 1024 * 1024)).decode()
    with pytest.raises(review_module.ReviewSnapshotError):
        queue.set_setting(key, {**target, "private_source": large})
    assert queue.get_setting(key) == target
    with queue._connect() as connection:
        assert tuple(
            connection.execute(
                "SELECT count(*),SUM(length(payload)) FROM review_snapshots"
            ).fetchone()
        ) == tuple(before)


def test_queue_artifact_publication_preserves_exact_bytes_hash_and_repeated_storage(
    queue, tmp_path
):
    path = tmp_path / "notification-checkpoint.json"
    text = (
        '{\n  "image_map": {"z": "café", "a": "雪"},\n  "caption": '
        + json.dumps("evidence " * 1000)
        + "\n}\n"
    )
    original = text.encode()
    path.write_bytes(original)
    original_hash = hashlib.sha256(original).hexdigest()
    assert queue.write_review_artifact(path, text, expected_sha256=original_hash)
    descriptor = path.read_bytes()
    assert len(descriptor) < len(original)
    assert queue.review_artifact_bytes(path) == original
    assert queue.read_review_artifact(path) == json.loads(text)
    assert hashlib.sha256(queue.review_artifact_bytes(path)).hexdigest() == original_hash
    with queue._connect() as connection:
        before = tuple(
            connection.execute(
                "SELECT count(*),SUM(length(payload)) FROM review_snapshots"
            ).fetchone()
        )
    assert queue.write_review_artifact(path, text, expected_sha256=original_hash)
    assert path.read_bytes() == descriptor
    with queue._connect() as connection:
        assert (
            tuple(
                connection.execute(
                    "SELECT count(*),SUM(length(payload)) FROM review_snapshots"
                ).fetchone()
            )
            == before
        )

    fresh_text = '{"checkpoint": "new decision"}\n'
    assert queue.write_review_artifact(path, fresh_text, expected_sha256=original_hash)
    fresh_descriptor = path.read_bytes()
    assert not queue.write_review_artifact(path, text, expected_sha256=original_hash)
    assert path.read_bytes() == fresh_descriptor
    assert queue.review_artifact_bytes(path) == fresh_text.encode()
    assert (
        module.BrowserJobQueue(queue.state_directory).review_artifact_bytes(path)
        == fresh_text.encode()
    )


def test_queue_artifact_filesystem_failure_preserves_prior_checkpoint_until_retry(
    queue, tmp_path, monkeypatch
):
    path = tmp_path / "notification-current.json"
    original = '{"decision": "held", "source": "Original café"}\n'
    fresh = '{"decision": "approved", "source": "Fresh source"}\n'
    queue.write_review_artifact(path, original)
    previous = path.read_bytes()
    publish = module.atomic_write

    def storage_full(*_args, **_kwargs):
        raise OSError(errno.ENOSPC, "private filesystem details")

    monkeypatch.setattr(module, "atomic_write", storage_full)
    with pytest.raises(OSError) as error:
        queue.write_review_artifact(
            path, fresh, expected_sha256=hashlib.sha256(original.encode()).hexdigest()
        )
    assert error.value.errno == errno.ENOSPC
    assert path.read_bytes() == previous
    assert queue.review_artifact_bytes(path) == original.encode()
    monkeypatch.setattr(module, "atomic_write", publish)
    assert queue.write_review_artifact(
        path, fresh, expected_sha256=hashlib.sha256(original.encode()).hexdigest()
    )
    assert queue.review_artifact_bytes(path) == fresh.encode()


def test_queue_artifact_hash_damage_fails_closed_without_private_evidence(queue, tmp_path):
    path = tmp_path / "notification-damaged.json"
    queue.write_review_artifact(path, '{"source": "PRIVATE_SOURCE_EVIDENCE"}\n')
    descriptor = json.loads(path.read_bytes())
    descriptor["original_sha256"] = "0" * 64
    path.write_text(json.dumps(descriptor))
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        queue.read_review_artifact(path)
    assert "PRIVATE_" not in str(error.value)
    assert "integrity" in str(error.value)


def test_review_snapshot_collection_preserves_shared_roots_and_caller_rollback(
    review_store, monkeypatch
):
    connection, store = review_store
    shared = {"source": "verified café " * 1000, "image_map": {"z": "z-image", "a": "a-image"}}
    held = {"decision": "unresolved", "evidence": shared}
    artifact = ["pinned artifact", shared, {"source": "artifact " * 1000}]
    with connection:
        held_ref = store.put(held)
        artifact_ref = store.put(artifact)
        old_ref = store.put({"superseded": shared, "old_only": "old evidence " * 1000})
    before = connection.execute(
        "SELECT digest,payload FROM review_snapshots ORDER BY digest"
    ).fetchall()

    def forbid_materialization(_reference):
        raise AssertionError("Collection must inspect the graph without materializing snapshots")

    with pytest.raises(RuntimeError, match="caller failed"):
        with connection, monkeypatch.context() as patch:
            connection.execute("BEGIN")
            patch.setattr(store, "get", forbid_materialization)
            assert store.collect([held_ref, artifact_ref, held_ref]) > 0
            raise RuntimeError("caller failed")
    assert (
        connection.execute("SELECT digest,payload FROM review_snapshots ORDER BY digest").fetchall()
        == before
    )
    assert store.get(old_ref)["old_only"].startswith("old evidence")

    with connection:
        connection.execute("BEGIN")
        deleted = store.collect([held_ref, artifact_ref])
    remaining = connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    assert deleted == len(before) - remaining > 0
    assert store.get(held_ref) == held
    assert store.get(artifact_ref) == artifact
    assert list(store.get(held_ref)["evidence"]["image_map"]) == ["z", "a"]
    with pytest.raises(review_module.ReviewSnapshotError):
        store.get(old_ref)


@pytest.mark.parametrize(
    "body",
    [
        ["object", [["same", ["value", 1]], ["same", ["value", 2]]]],
        ["array", [["ref", {"PRIVATE_EVIDENCE": True}]]],
        ["array", [["unsupported", "PRIVATE_EVIDENCE"]]],
    ],
)
def test_review_snapshot_collection_rejects_malformed_graph_before_deleting(review_store, body):
    connection, store = review_store
    store.put({"unreachable": "preserve until roots validate"})
    raw = json.dumps(body, separators=(",", ":")).encode()
    digest = hashlib.sha256(raw).hexdigest()
    connection.execute("INSERT INTO review_snapshots VALUES (?,?)", (digest, gzip.compress(raw)))
    before = connection.execute(
        "SELECT digest,payload FROM review_snapshots ORDER BY digest"
    ).fetchall()
    reference = {"version": 1, "sha256": digest}
    with pytest.raises(review_module.ReviewSnapshotError) as error:
        store.collect([reference])
    assert "PRIVATE_" not in str(error.value)
    assert error.value.__context__ is None
    with pytest.raises(review_module.ReviewSnapshotError):
        store.get(reference)
    assert (
        connection.execute("SELECT digest,payload FROM review_snapshots ORDER BY digest").fetchall()
        == before
    )


def test_review_snapshot_collection_rejects_linked_depth_and_cycles(review_store, monkeypatch):
    connection, store = review_store
    raw = b'["value",null]'
    for _ in range(66):
        digest = hashlib.sha256(raw).hexdigest()
        connection.execute(
            "INSERT INTO review_snapshots VALUES (?,?)", (digest, gzip.compress(raw))
        )
        raw = json.dumps(["array", [["ref", digest]]], separators=(",", ":")).encode()
    before = connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    with pytest.raises(review_module.ReviewSnapshotError):
        store.collect([{"version": 1, "sha256": digest}])
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == before

    # Hash integrity is tested separately; inject a cycle at the verified-read
    # boundary to exercise the collector's explicit recursion guard.
    monkeypatch.setattr(store, "_read_node", lambda _digest, _maximum: raw)
    with pytest.raises(review_module.ReviewSnapshotError):
        store.collect([{"version": 1, "sha256": digest}])
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == before


def test_review_snapshot_collection_requires_caller_transaction(review_store):
    connection, store = review_store
    with connection:
        reference = store.put({"decision": "held"})
    with pytest.raises(review_module.ReviewSnapshotError):
        store.collect([])
    assert not connection.in_transaction
    assert store.get(reference) == {"decision": "held"}
    with connection:
        connection.execute("BEGIN")
        assert store.collect([]) == 1
    assert connection.execute("SELECT count(*) FROM review_snapshots").fetchone()[0] == 0


def _completion_packet(queue, tmp_path, batch=1, *, held=False, effects=False):
    rid, token, notification = str(uuid4()), str(uuid4()), str(uuid4())
    url = f"https://www.instagram.com/p/Storage{batch}/"
    jid = queue.enqueue_retrieval(
        school="ubc", recipient_id=RECIPIENT_ID, account_username=ACCOUNT_USERNAME, url=url
    )
    post = {"url": url, "caption": "A reviewed source"}
    claim = queue.claim_next()
    assert claim and claim.id == jid
    queue.finish(claim, result={"posts": [post]})
    decision = "held" if held else "event_and_position" if effects else "non_event"
    target = {
        "job_id": jid,
        "school": "ubc",
        "image_map": {"https://images.test/z": "upload-z", "https://images.test/a": "upload-a"},
        "row": {
            "id": rid,
            "source_url": url,
            "notification": {"school_id": 1, "intended_recipient_id": RECIPIENT_ID},
        },
        "posts": [post],
        "codex_review": {
            "reviewer": "Codex",
            "decision": "unresolved" if held else "import",
            "source_decision": decision,
            "school": "ubc",
            "source_url": url,
        },
        "candidate_context": ["large preserved baseline " + str(i) for i in range(1000)],
    }
    queue.set_setting(module._REVIEW_PREFIX + rid, target)
    ledger = {
        "id": rid,
        "status": "pending" if held else "succeeded",
        "claim_token": None if held else token,
        "notification_id": notification,
        "source_url": url,
        "succeeded_at": None if held else "2026-10-08T12:00:00Z",
    }
    claims = (
        []
        if held
        else [
            {
                "operation": operation,
                "state": "existing_service_returned",
                "result": True,
                "claim": {"media_row_id": rid, "claim_token": token},
            }
            for operation in ("claim_pending_browser_media", "mark_media_succeeded")
        ]
    )
    events, positions, writes, bindings = [], [], [], []
    if effects:
        club = {"id": 10, "school_id": 1, "name": "Student Society"}
        event = {
            "title": "Campus mixer",
            "location": "Student Hall",
            "source_url": url,
            "source_image_url": "https://images.test/z",
            "occurrences": [
                {"dtstart_utc": "2026-10-10T18:00:00Z", "dtend_utc": "2026-10-10T20:00:00Z"}
            ],
        }
        position = {
            "title": "Volunteer coordinator",
            "description": "Coordinate the student society volunteer team",
            "position_type": "volunteer",
            "deadline_date": "2026-10-20",
            "source_url": url,
            "source_image_url": "https://images.test/a",
        }
        events = [
            {"id": 100 + batch, "school_id": 1, "club_id": 10, "cohost_club_ids": [20], **event}
        ]
        positions = [
            {"id": 200 + batch, "school_id": 1, "club_id": 10, "cohost_club_ids": [], **position}
        ]
        for kind, payload, row in (
            ("event", event, events[0]),
            ("position", position, positions[0]),
        ):
            write = {
                "media_row_id": rid,
                "kind": kind,
                "outcome": "inserted",
                kind: payload,
                "club": club,
            }
            if kind == "position":
                write["verified_position_row"] = row
            writes.append(write)
            bindings.append(
                {
                    "media_row_id": rid,
                    "kind": kind,
                    "approved_index": 0,
                    "native_id": row["id"],
                    "action": "created",
                    "native_outcome": "inserted",
                    "native_payload_sha256": module.BrowserJobQueue._review_hash(payload),
                    "full_native_row_sha256": module.BrowserJobQueue._review_hash(row),
                    "host_id": club["id"],
                    "source_url": url,
                    "cohost_ids": row["cohost_club_ids"],
                }
            )
    frozen = tmp_path / f"notification-frozen-drain{batch}.json"
    queue.write_review_artifact(frozen, json.dumps([target]))
    inputs = {
        "approved": [] if held else [target],
        "held": [target] if held else [],
        "packet": {"targets": [target]},
        "journal": {"writes": writes},
        "claims": claims,
        "full": [
            {
                "ledger": ledger,
                "school": "ubc",
                "decision": decision,
                "recipient": {"school_id": 1},
                "events": events,
                "positions": positions,
            }
        ],
        "freeze": {
            "batch": f"drain{batch}",
            "reviews": [
                {
                    "path": str(frozen),
                    "sha256": hashlib.sha256(queue.review_artifact_bytes(frozen)).hexdigest(),
                    "frozen": True,
                    "final_handshake": True,
                }
            ],
        },
    }
    files = {key: tmp_path / f"notification-{key}-drain{batch}apply.json" for key in inputs}
    for key, path in files.items():
        queue.write_review_artifact(path, json.dumps(inputs[key]))
    qa = {
        "reviewer": "Codex independent read-only terminal QA",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "drain": batch,
        "parent_reported_actual_terminal_success": {
            "native_exit_code": 0,
            "full_exit_code": 0,
            "native_session": 1,
            "full_session": 2,
        },
        "all_packet_ledgers_school_source_recipient_exact_tokens_and_held_pending_verified": True,
        "review_or_native_inconsistencies": [],
        "input_sha256": {
            key: hashlib.sha256(queue.review_artifact_bytes(path)).hexdigest()
            for key, path in files.items()
        },
        "native_effect_bindings": bindings,
        "per_source_readback": [
            {
                "media_row_id": rid,
                "school": "ubc",
                "source_decision": decision,
                "native_ledger": ledger,
                "recipient_readback": {
                    "id": notification,
                    "school_id": 1,
                    "intended_recipient_id": RECIPIENT_ID,
                },
                "global_source_baseline_preserved": True,
                "events": events,
                "positions": positions,
            }
        ],
    }
    qa_path = tmp_path / f"notification-completion-drain{batch}.json"
    queue.write_review_artifact(qa_path, json.dumps(qa))
    return rid, target, qa_path, files, qa


@pytest.mark.parametrize("damage", ["terminal", "hash", "token", "recipient", "listing", "marker"])
def test_completion_proof_failure_never_records_retention(queue, tmp_path, damage):
    rid, target, path, files, qa = _completion_packet(queue, tmp_path)
    if damage == "terminal":
        qa["parent_reported_actual_terminal_success"]["native_exit_code"] = 1
    elif damage == "hash":
        qa["input_sha256"]["approved"] = "0" * 64
    elif damage == "token":
        qa["per_source_readback"][0]["native_ledger"]["claim_token"] = str(uuid4())
    elif damage == "recipient":
        qa["per_source_readback"][0]["recipient_readback"]["school_id"] = 2
    elif damage == "listing":
        qa["per_source_readback"][0]["events"] = [{"id": 1, "school_id": 1}]
    else:
        altered = copy.deepcopy(target)
        altered["candidate_context"].append("later unresolved evidence")
        queue.set_setting(module._REVIEW_PREFIX + rid, altered)
    queue.write_review_artifact(path, json.dumps(qa))
    with pytest.raises(review_module.ReviewSnapshotError):
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    with sqlite3.connect(queue.database_path) as db:
        assert db.execute("SELECT count(*) FROM review_completions").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM review_artifact_retention").fetchone()[0] == 0
    assert queue.get_setting(module._REVIEW_PREFIX + rid)["candidate_context"]


def test_automatic_cleanup_retires_verified_history_keeps_latest_pending_and_jobs(
    queue, tmp_path, monkeypatch
):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    pending = _completion_packet(queue, tmp_path, 3, held=True)
    for rid, target, path, files, qa in packets:
        assert queue.record_review_completion(path, input_paths=files, artifact_paths=[]) == {
            "completed": 1,
            "held": 0,
            "artifacts": 9,
        }
    rid, target, path, files, qa = pending
    assert queue.record_review_completion(path, input_paths=files, artifact_paths=[])["held"] == 1
    with sqlite3.connect(queue.database_path) as db:
        jobs = db.execute("SELECT * FROM jobs ORDER BY id").fetchall()
        db.execute(
            "UPDATE review_completions SET completed_at=completed_at-?",
            (module.CONTROL.completed_review_retention_seconds + 1,),
        )
        db.execute(
            "UPDATE review_artifact_retention SET sealed_at=sealed_at-?",
            (module.CONTROL.completed_review_retention_seconds + 1,),
        )
    stats = queue.maintain_review_storage(force=True)
    assert stats["retired_targets"] == 1
    assert stats["retired_artifacts"] == 9
    assert stats["collected_snapshots"] > 0
    first, latest = packets
    assert (
        queue.get_setting(module._REVIEW_PREFIX + first[0])["completed_review_receipt"]["job_id"]
        == first[1]["job_id"]
    )
    assert queue.get_setting(module._REVIEW_PREFIX + latest[0]) == latest[1]
    assert queue.get_setting(module._REVIEW_PREFIX + pending[0]) == pending[1]
    assert queue.read_review_artifact(first[2])["format"] == "wat2do-completed-review-v1"
    assert queue.read_review_artifact(latest[2]) == latest[4]
    assert queue.maintain_review_storage() == {"deferred": "interval"}
    with sqlite3.connect(queue.database_path) as db:
        assert db.execute("SELECT * FROM jobs ORDER BY id").fetchall() == jobs
        assert db.execute("PRAGMA auto_vacuum").fetchone()[0] == 2
    # A new media delivery reopens only that source, even if an old receipt exists.
    queue.set_setting(module._REVIEW_PREFIX + first[0], first[1])
    queue.set_setting("notification_delivery:" + first[0], first[1]["job_id"])
    assert queue.maintain_review_storage(force=True)["retired_targets"] == 0
    assert queue.get_setting(module._REVIEW_PREFIX + first[0]) == first[1]


def test_maintenance_preserves_old_descriptor_after_failed_publication(
    queue, tmp_path, monkeypatch
):
    path = tmp_path / "notification-checkpoint.json"
    old = {"evidence": "old " * 10000}
    new = {"evidence": "new " * 10000}
    queue.write_review_artifact(path, json.dumps(old))
    with monkeypatch.context() as context:
        context.setattr(
            module, "atomic_write", lambda *args: (_ for _ in ()).throw(OSError("publish failed"))
        )
        with pytest.raises(OSError):
            queue.write_review_artifact(path, json.dumps(new))
    queue.maintain_review_storage(force=True)
    assert queue.read_review_artifact(path) == old
    queue.write_review_artifact(path, json.dumps(new))
    assert queue.maintain_review_storage(force=True)["collected_snapshots"] > 0
    assert queue.read_review_artifact(path) == new


def test_maintenance_defers_active_import_and_preserves_corrupt_root(queue, tmp_path):
    packet = _completion_packet(queue, tmp_path)
    queue.set_setting("notification_browser_import_claim", {"media_row_id": packet[0]})
    assert queue.maintain_review_storage(force=True) == {"deferred": "active import claim"}
    queue.set_setting("notification_browser_import_claim", None)
    missing = tmp_path / "notification-missing.json"
    queue.write_review_artifact(missing, json.dumps({"evidence": "must stay" * 1000}))
    missing.unlink()
    with sqlite3.connect(queue.database_path) as db:
        before = db.execute(
            "SELECT digest,payload FROM review_snapshots ORDER BY digest"
        ).fetchall()
    with pytest.raises(FileNotFoundError):
        queue.maintain_review_storage(force=True)
    with sqlite3.connect(queue.database_path) as db:
        assert (
            db.execute("SELECT digest,payload FROM review_snapshots ORDER BY digest").fetchall()
            == before
        )


def test_repeated_checkpoint_updates_are_collected_to_current_evidence(queue, tmp_path):
    path = tmp_path / "notification-current.json"
    for index in range(40):
        queue.write_review_artifact(
            path,
            json.dumps({"batch": index, "evidence": [str(index) + str(n) for n in range(1000)]}),
        )
    with sqlite3.connect(queue.database_path) as db:
        before = db.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    assert queue.maintain_review_storage(force=True)["collected_snapshots"] > 0
    with sqlite3.connect(queue.database_path) as db:
        after = db.execute("SELECT count(*) FROM review_snapshots").fetchone()[0]
    assert after < before / 10
    assert queue.read_review_artifact(path)["batch"] == 39


def test_completed_source_reopened_as_held_keeps_its_full_batch_artifacts(queue, tmp_path):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    for _, _, path, files, _ in packets:
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    rid, target, path, files, _ = packets[0]
    frozen = Path(queue.read_review_artifact(files["freeze"])["reviews"][0]["path"])
    originals = {
        checkpoint: queue.review_artifact_bytes(checkpoint)
        for checkpoint in [path, frozen, *files.values()]
    }
    held = copy.deepcopy(target)
    held["codex_review"].update(
        decision="unresolved",
        source_decision="held",
        reason="A new source discrepancy needs review",
    )
    queue.set_setting(module._REVIEW_PREFIX + rid, held)
    with sqlite3.connect(queue.database_path) as db:
        age = module.CONTROL.completed_review_retention_seconds + 1
        db.execute("UPDATE review_completions SET completed_at=completed_at-?", (age,))
        db.execute("UPDATE review_artifact_retention SET sealed_at=sealed_at-?", (age,))

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_targets"] == 0
    assert stats["retired_artifacts"] == 0
    assert queue.get_setting(module._REVIEW_PREFIX + rid) == held
    assert all(
        queue.review_artifact_bytes(checkpoint) == raw for checkpoint, raw in originals.items()
    )


def test_completion_sealing_rejects_artwork_order_changed_after_verification(queue, tmp_path):
    rid, target, path, files, _ = _completion_packet(queue, tmp_path)
    changed = copy.deepcopy(target)
    changed["image_map"] = dict(reversed(list(changed["image_map"].items())))
    assert changed == target
    assert list(changed["image_map"]) != list(target["image_map"])
    queue.set_setting(module._REVIEW_PREFIX + rid, changed)

    with pytest.raises(review_module.ReviewSnapshotError):
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])

    with sqlite3.connect(queue.database_path) as db:
        assert db.execute("SELECT count(*) FROM review_completions").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM review_artifact_retention").fetchone()[0] == 0
    assert list(queue.get_setting(module._REVIEW_PREFIX + rid)["image_map"].values()) == [
        "upload-a",
        "upload-z",
    ]


def test_completion_retention_preserves_artwork_order_changed_after_sealing(queue, tmp_path):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    for _, _, path, files, _ in packets:
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    rid, target, path, _, qa = packets[0]
    changed = copy.deepcopy(target)
    changed["image_map"] = dict(reversed(list(changed["image_map"].items())))
    queue.set_setting(module._REVIEW_PREFIX + rid, changed)
    with sqlite3.connect(queue.database_path) as db:
        age = module.CONTROL.completed_review_retention_seconds + 1
        db.execute("UPDATE review_completions SET completed_at=completed_at-?", (age,))
        db.execute("UPDATE review_artifact_retention SET sealed_at=sealed_at-?", (age,))

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_targets"] == 0
    assert stats["retired_artifacts"] == 0
    assert list(queue.get_setting(module._REVIEW_PREFIX + rid)["image_map"].values()) == [
        "upload-a",
        "upload-z",
    ]
    assert queue.read_review_artifact(path) == qa


def _expire_review_retention(queue):
    with sqlite3.connect(queue.database_path) as db:
        age = module.CONTROL.completed_review_retention_seconds + 1
        db.execute("UPDATE review_completions SET completed_at=completed_at-?", (age,))
        db.execute("UPDATE review_artifact_retention SET sealed_at=sealed_at-?", (age,))


def _fill_snapshot_quota(queue, maximum_bytes, *, pinned):
    with sqlite3.connect(queue.database_path) as db:
        stored = db.execute("SELECT SUM(length(payload)) FROM review_snapshots").fetchone()[0]
        remaining = maximum_bytes - stored
        low, high = 0, remaining
        while low < high:
            count = (low + high + 1) // 2
            raw = json.dumps(["value", {"padding": "x" * count}], separators=(",", ":")).encode()
            if len(gzip.compress(raw, compresslevel=0, mtime=0)) <= remaining:
                low = count
            else:
                high = count - 1
        raw = json.dumps(["value", {"padding": "x" * low}], separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        payload = gzip.compress(raw, compresslevel=0, mtime=0)
        db.execute("INSERT INTO review_snapshots VALUES (?,?)", (digest, payload))
        if pinned:
            db.execute(
                "INSERT INTO settings VALUES (?,?)",
                (
                    "notification_reviewed_target:quota-pinned-evidence",
                    json.dumps(
                        {"review_snapshot": {"version": 1, "sha256": digest}, "codex_review": {}}
                    ),
                ),
            )
        assert maximum_bytes - stored - len(payload) < 8
    return digest


@pytest.mark.parametrize("pinned", [False, True], ids=["orphan-pressure", "live-root-pressure"])
def test_completed_artifact_retirement_recovers_full_quota_without_losing_live_roots(
    queue, tmp_path, monkeypatch, pinned
):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    for _, _, path, files, _ in packets:
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    _expire_review_retention(queue)
    maximum_bytes = 1024**2
    monkeypatch.setattr(
        review_module,
        "CONTROL",
        review_module.CONTROL.model_copy(update={"review_snapshot_storage_max_mb": 1}),
    )
    digest = _fill_snapshot_quota(queue, maximum_bytes, pinned=pinned)
    with sqlite3.connect(queue.database_path) as db:
        jobs = db.execute("SELECT * FROM jobs ORDER BY id").fetchall()

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_targets"] == 1
    assert stats["retired_artifacts"] == 9
    assert stats["snapshot_bytes"] < maximum_bytes
    assert queue.read_review_artifact(packets[0][2])["format"] == "wat2do-completed-review-v1"
    assert queue.read_review_artifact(packets[1][2]) == packets[1][4]
    assert queue.get_setting(module._REVIEW_PREFIX + packets[1][0]) == packets[1][1]
    with sqlite3.connect(queue.database_path) as db:
        assert (
            bool(db.execute("SELECT 1 FROM review_snapshots WHERE digest=?", (digest,)).fetchone())
            == pinned
        )
        assert db.execute("SELECT * FROM jobs ORDER BY id").fetchall() == jobs
    if pinned:
        assert queue.get_setting("notification_reviewed_target:quota-pinned-evidence")["padding"]


@pytest.mark.parametrize("refresh_state", ["pending", "running", "new_success"])
def test_pending_or_refreshed_source_generation_keeps_its_previous_full_review(
    queue, tmp_path, refresh_state
):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    for _, _, path, files, _ in packets:
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    _expire_review_retention(queue)
    rid, target, path, _, qa = packets[0]
    queue.refresh_retrieval(target["job_id"])
    if refresh_state != "pending":
        claim = queue.claim_next()
        assert claim.id == target["job_id"]
        if refresh_state == "new_success":
            queue.finish(
                claim,
                result={
                    "posts": [
                        {"url": target["row"]["source_url"], "caption": "Fresh unreviewed evidence"}
                    ]
                },
            )
    current = queue.get(target["job_id"])

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_targets"] == 0
    assert stats["retired_artifacts"] == 0
    assert queue.get(target["job_id"]) == current
    assert queue.get_setting(module._REVIEW_PREFIX + rid) == target
    assert queue.read_review_artifact(path) == qa


def test_completion_receipt_binds_real_event_and_position_writes_to_native_readbacks(
    queue, tmp_path
):
    rid, target, path, files, qa = _completion_packet(queue, tmp_path, effects=True)

    stats = queue.record_review_completion(path, input_paths=files, artifact_paths=[])

    assert stats == {"completed": 1, "held": 0, "artifacts": 9}
    with sqlite3.connect(queue.database_path) as db:
        receipt = json.loads(
            db.execute(
                "SELECT receipt FROM review_completions WHERE media_row_id=?", (rid,)
            ).fetchone()[0]
        )
    assert [
        (listing["kind"], listing["id"], listing["action"]) for listing in receipt["listings"]
    ] == [
        ("event", 101, "created"),
        ("position", 201, "created"),
    ]
    assert [listing["sha256"] for listing in receipt["listings"]] == [
        binding["full_native_row_sha256"] for binding in qa["native_effect_bindings"]
    ]
    assert receipt["source_url"] == target["row"]["source_url"]
    assert queue.get_setting(module._REVIEW_PREFIX + rid) == target


def test_mixed_verified_and_held_packet_keeps_all_shared_batch_checkpoints(queue, tmp_path):
    approved = _completion_packet(queue, tmp_path, 1)
    held = _completion_packet(queue, tmp_path, 99, held=True)
    rid, target, path, files, qa = approved
    inputs = {key: queue.read_review_artifact(checkpoint) for key, checkpoint in files.items()}
    inputs["held"] = [held[1]]
    inputs["packet"]["targets"].append(held[1])
    inputs["full"].extend(queue.read_review_artifact(held[3]["full"]))
    frozen = Path(inputs["freeze"]["reviews"][0]["path"])
    queue.write_review_artifact(frozen, json.dumps([target, held[1]]))
    inputs["freeze"]["reviews"][0]["sha256"] = hashlib.sha256(
        queue.review_artifact_bytes(frozen)
    ).hexdigest()
    for key, checkpoint in files.items():
        queue.write_review_artifact(checkpoint, json.dumps(inputs[key]))
    qa["per_source_readback"].extend(held[4]["per_source_readback"])
    qa["input_sha256"] = {
        key: hashlib.sha256(queue.review_artifact_bytes(checkpoint)).hexdigest()
        for key, checkpoint in files.items()
    }
    queue.write_review_artifact(path, json.dumps(qa))
    assert queue.record_review_completion(path, input_paths=files, artifact_paths=[]) == {
        "completed": 1,
        "held": 1,
        "artifacts": 9,
    }
    latest = _completion_packet(queue, tmp_path, 2)
    queue.record_review_completion(latest[2], input_paths=latest[3], artifact_paths=[])
    originals = {
        checkpoint: queue.review_artifact_bytes(checkpoint)
        for checkpoint in [path, frozen, *files.values()]
    }
    _expire_review_retention(queue)

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_artifacts"] == 0
    assert queue.get_setting(module._REVIEW_PREFIX + held[0]) == held[1]
    assert all(
        queue.review_artifact_bytes(checkpoint) == raw for checkpoint, raw in originals.items()
    )
    with sqlite3.connect(queue.database_path) as db:
        assert (
            db.execute(
                "SELECT 1 FROM review_completions WHERE media_row_id=?", (held[0],)
            ).fetchone()
            is None
        )


def test_interrupted_completed_artifact_publication_repairs_registry_on_next_maintenance(
    queue, tmp_path, monkeypatch
):
    packets = [_completion_packet(queue, tmp_path, batch) for batch in (1, 2)]
    for _, _, path, files, _ in packets:
        queue.record_review_completion(path, input_paths=files, artifact_paths=[])
    _expire_review_retention(queue)
    with sqlite3.connect(queue.database_path) as db:
        jobs = db.execute("SELECT * FROM jobs ORDER BY id").fetchall()
    published = []
    publish = module.atomic_write

    def interrupted_after_publish(path, raw):
        publish(path, raw)
        published.append(path)
        raise OSError(errno.ENOSPC, "Synthetic failure after checkpoint publication")

    with monkeypatch.context() as context:
        context.setattr(module, "atomic_write", interrupted_after_publish)
        with pytest.raises(OSError):
            queue.maintain_review_storage(force=True)
    assert len(published) == 1
    checkpoint = published[0]
    durable = checkpoint.read_bytes()
    receipt = queue.read_review_artifact(checkpoint)
    assert receipt["format"] == "wat2do-completed-review-v1"
    assert receipt["completed_media"][0]["media_row_id"] == packets[0][0]
    with sqlite3.connect(queue.database_path) as db:
        assert db.execute(
            "SELECT 1 FROM review_artifacts WHERE path=?", (str(checkpoint),)
        ).fetchone()
        assert (
            db.execute(
                "SELECT retired_at FROM review_artifact_retention WHERE path=?", (str(checkpoint),)
            ).fetchone()[0]
            is None
        )

    stats = queue.maintain_review_storage(force=True)

    assert stats["retired_artifacts"] == 9
    assert checkpoint.read_bytes() == durable
    assert queue.read_review_artifact(checkpoint) == receipt
    assert queue.read_review_artifact(packets[1][2]) == packets[1][4]
    with sqlite3.connect(queue.database_path) as db:
        assert (
            db.execute("SELECT 1 FROM review_artifacts WHERE path=?", (str(checkpoint),)).fetchone()
            is None
        )
        assert (
            db.execute(
                "SELECT retired_at FROM review_artifact_retention WHERE path=?", (str(checkpoint),)
            ).fetchone()[0]
            is not None
        )
        assert db.execute("SELECT * FROM jobs ORDER BY id").fetchall() == jobs
