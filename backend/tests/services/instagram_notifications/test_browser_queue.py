import json
import sqlite3
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.instagram_notifications import browser_queue as module

RECIPIENT_ID = "12342599092"
ACCOUNT_USERNAME = "ubc.wat2do.io"


@pytest.fixture
def queue(tmp_path):
    return module.BrowserJobQueue(tmp_path / "browser")


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
        queue.finish(job.id, result={"status": "succeeded"})
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

    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-priority")

    assert queue.get(first_id).state == "running"
    queue.finish(first_id, result={"status": "succeeded"})
    assert _complete_next(queue).id == digest_id
    assert _complete_next(queue).id == second_id
    assert queue.claim_next() is None


def test_engagement_cooldown_still_allows_immediate_digest_work(queue):
    engagement_id = _engagement(queue)
    assert queue.claim_next(allow_engagement=False) is None

    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-cooldown")

    assert _complete_next(queue, allow_engagement=False).id == digest_id
    assert queue.get(engagement_id).state == "pending"


@pytest.mark.parametrize("kind", ["digest", "retrieval", "engagement"])
def test_shared_rate_limit_holds_every_browser_kind_until_expiry(queue, monkeypatch, kind):
    clock = _clock(monkeypatch)
    first_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-active")
    active = queue.claim_next()
    pending_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-next")
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
    queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-auth")
    active = queue.claim_next()
    queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-after-auth")
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
    pending_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-maintenance")
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
        queue.finish(job_id, error="Instagram browser page returned HTTP 429", requeue=True)
    queue.finish(job_id, error="Instagram browser page returned HTTP 429")

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
    queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-noop")
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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"rate-limit-concurrent-{index}")
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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"progressive-rate-{index}")
    original = [queue.claim_next() for _ in range(14)]
    for job in original:
        queue.defer_for_rate_limit(job, "HTTP 429")
        queue.finish(job.id, error="HTTP 429", requeue=True, rate_limited_claim=job)
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    fresh = [queue.claim_next() for _ in range(14)]

    with ThreadPoolExecutor(max_workers=14) as executor:
        list(executor.map(lambda job: queue.defer_for_rate_limit(job, "HTTP 429"), fresh))

    expected = module.CONTROL.rate_limit_backoff_seconds * 2
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == expected
    assert queue.get_setting("browser_rate_limit_until") == clock.now + expected
    for job in fresh:
        queue.finish(job.id, error="HTTP 429", requeue=True, rate_limited_claim=job)
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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-reset")
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

    queue.finish(job_id, result={"status": "succeeded"})

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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "early-reset")
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

    queue.finish(job_id, result={"status": "succeeded"})

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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "recovery-boundary")
    queue.claim_next()
    clock.now = recovered_at + 1

    queue.finish(job_id, result={"status": "succeeded"})

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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "renewed-recovery")
    queue.claim_next()

    queue.finish(job_id, result={"status": "succeeded"})

    assert queue.get_setting("browser_rate_limit_backoff_seconds") == (
        module.CONTROL.rate_limit_backoff_seconds * 2
    )


@pytest.mark.parametrize("finish_after_expiry", [False, True])
def test_old_inflight_success_cannot_reset_active_or_expired_hold(
    queue, monkeypatch, finish_after_expiry
):
    clock = _clock(monkeypatch)
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-old-response")
    active = queue.claim_next()
    queue.defer_for_rate_limit(None, "HTTP 429")
    deadline = queue.get_setting("browser_rate_limit_until")
    if finish_after_expiry:
        clock.now = deadline

    queue.finish(job_id, result={"status": "succeeded"})

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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"progressive-no-reset-{state}")
    if state == "cancelled":
        queue.cancel(job_id)
    else:
        queue.claim_next()
        if state == "stale":
            queue.defer_for_rate_limit(None, "HTTP 429")
            queue.finish(job_id, result={"status": "succeeded"})
            clock.now = queue.get_setting("browser_rate_limit_until")
    deadline = queue.get_setting("browser_rate_limit_until")
    backoff = queue.get_setting("browser_rate_limit_backoff_seconds")

    queue.finish(
        job_id,
        error="HTTP 400" if state == "failed" else None,
        result={"status": "unsupported" if state == "unsupported" else "succeeded"},
    )

    assert queue.get_setting("browser_rate_limit_until") == deadline
    assert queue.get_setting("browser_rate_limit_backoff_seconds") == backoff


def test_digest_expires_normally_when_progressive_hold_exceeds_caller_deadline(queue, monkeypatch):
    clock = _clock(monkeypatch)
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-expired-caller")
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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "progressive-invalid")
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
    queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-invalid-active")
    active = queue.claim_next()
    pending_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-invalid-next")
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
    digest = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "urgent")
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

    queue.finish(queue.claim_next().id, result={"status": "succeeded"})
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
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-restart")
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
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "safe-read-recovery")
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
        job_id, result=result, error="Unconfirmed browser result" if result is None else None
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

    queue.finish(job_id, result={"status": "succeeded"})

    with pytest.raises(ValueError):
        queue.retry(job_id)
    assert queue.get(job_id).state == "succeeded"


def test_expired_digest_does_not_touch_the_browser_or_block_engagement(queue):
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-expired")
    engagement_id = _engagement(queue)

    next_job = queue.claim_next(
        now=queue.get(digest_id).created_at + module.CONTROL.result_timeout_seconds + 1,
    )

    assert next_job.id == engagement_id
    assert queue.get(digest_id).state == "cancelled"
    assert queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-expired") == digest_id
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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-unavailable")

    with pytest.raises(module.BrowserDigestError, match="unavailable or paused"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-unavailable",
        )

    assert clock.elapsed == 0
    assert queue.get(job_id).state == "cancelled"


def test_real_sqlite_busy_claim_waits_then_claims_exactly_once(queue, monkeypatch):
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "busy-claim")
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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"commit-full-{index}")
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
        queue.finish(first.id, error="HTTP 429", requeue=True, rate_limited_claim=first)
        assert queue.get(first.id).state == "pending"
        assert queue.get(first.id).attempts == 0
    else:
        queue.finish(first.id, result={"status": "succeeded", "items": ["saved"]})
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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "diagnostic-full")
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
    queue.finish(job_id, error="Read failed")
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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "retain-auth-pause")
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
    assert queue.restore_pause(hold, False) is not changed
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
    assert queue.restore_pause(hold, False) is False
    queue.recover_interrupted()
    assert queue.get_setting("paused") == "Instagram browser requires human account recovery"


def test_storage_recovery_persists_a_rate_limit_that_could_not_be_written(queue, monkeypatch):
    clock = _clock(monkeypatch)
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "unstored-rate-limit")
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
            job.id,
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
    # Durable successful reads are available even after the worker exits.
    queue.set_setting("worker", {"running": False, "heartbeat": clock.now})
    assert (
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-succeeded",
        )
        == result
    )


@pytest.mark.parametrize("terminal_state", ["cancelled", "failed"])
def test_digest_wait_reports_terminal_failure(queue, monkeypatch, terminal_state):
    clock = _clock(monkeypatch)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-failed")

    def terminate_job():
        if terminal_state == "cancelled":
            queue.cancel(job_id)
        else:
            assert queue.claim_next().id == job_id
            queue.finish(job_id, error="Instagram requires human reauthorization")

    clock.after_sleep = terminate_job

    with pytest.raises(module.BrowserDigestError, match="cancelled|reauthorization"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-failed",
        )

    assert queue.get(job_id).state == terminal_state


def test_digest_caller_deadline_cancels_pending_work(queue, monkeypatch):
    clock = _clock(monkeypatch)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-timeout")

    def advance_past_deadline():
        clock.elapsed = module.CONTROL.result_timeout_seconds + 1

    clock.after_sleep = advance_past_deadline

    with pytest.raises(module.BrowserDigestError, match="timed out"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            "cache-timeout",
        )

    assert queue.get(job_id).state == "cancelled"


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
    digest = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-first")
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
    queue.finish(first, result={"posts": []})
    digest = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "still-highest-priority")
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
    queue.finish(first_read, result={"posts": []})
    assert _complete_next(queue).id == second_current_school
    assert _complete_next(queue).id == third_current_school
    assert _complete_next(queue).id == older_other_school
    assert _complete_next(queue).id == remaining_read


@pytest.mark.parametrize("kind", ["digest", "retrieval"])
def test_safe_read_retry_preserves_diagnostic_reason_without_exposing_terminal_failure(queue, kind):
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "read-retry")
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
        job_id,
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
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-last-budget")
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

    queue.finish(job_id, error=reason, requeue=True, rate_limited_claim=active)

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
    queue.finish(job_id, error="Instagram public media request failed with HTTP 400")
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit


@pytest.mark.parametrize("requeue,kind", [(False, "digest"), (True, "engagement")])
def test_rate_limit_attempt_refund_requires_a_requeued_read(queue, requeue, kind):
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-guard")
        if kind == "digest"
        else _engagement(queue, "RateRefundNative")
    )
    active = queue.claim_next()
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events").fetchall()

    with pytest.raises(ValueError):
        queue.finish(job_id, error="HTTP 429", requeue=requeue, rate_limited_claim=active)

    assert queue.get(job_id) == active
    with queue._connect() as db:
        assert db.execute("SELECT event FROM diagnostic_events").fetchall() == events


@pytest.mark.parametrize(
    "error,result",
    [(None, None), ("", None), ("   ", None), ("HTTP 429", {}), ("HTTP 429", {"status": "failed"})],
)
def test_rate_limit_attempt_refund_requires_nonempty_error_and_no_result(queue, error, result):
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-result")
    active = queue.claim_next()

    with pytest.raises(ValueError, match="rate-limited claim refund"):
        queue.finish(job_id, error=error, result=result, requeue=True, rate_limited_claim=active)

    assert queue.get(job_id) == active


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "other-job"},
        {"kind": "engagement"},
        {"state": "pending"},
        {"started_at": None},
        {"attempts": 0},
    ],
)
def test_rate_limit_attempt_refund_requires_the_original_running_read_claim(queue, changes):
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-identity")
    active = queue.claim_next()

    with pytest.raises(ValueError, match="rate-limited claim refund"):
        queue.finish(
            job_id,
            error="HTTP 429",
            requeue=True,
            rate_limited_claim=replace(active, **changes),
        )

    assert queue.get(job_id) == active


def test_simultaneous_rate_limited_completions_refund_only_one_claim(queue, monkeypatch):
    _clock(monkeypatch)
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-concurrent")
    active = queue.claim_next()
    queue.record_diagnostic("running", active)
    queue.defer_for_rate_limit(active, "HTTP 429")

    def finish(_index):
        queue.finish(job_id, error="HTTP 429", requeue=True, rate_limited_claim=active)

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
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "rate-limit-refund-stale")
    original = queue.claim_next()
    queue.defer_for_rate_limit(original, "HTTP 429")
    queue.finish(job_id, error="HTTP 429", requeue=True, rate_limited_claim=original)
    clock.now += module.CONTROL.rate_limit_backoff_seconds
    current = queue.claim_next()
    assert current.attempts == original.attempts
    assert current.started_at != original.started_at
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events").fetchall()

    queue.defer_for_rate_limit(original, "HTTP 429")
    queue.finish(job_id, error="HTTP 429", requeue=True, rate_limited_claim=original)

    assert queue.get(job_id) == current
    assert not queue.is_rate_limited()
    with queue._connect() as db:
        assert db.execute("SELECT event FROM diagnostic_events").fetchall() == events
    queue.defer_for_rate_limit(current, "HTTP 429")
    queue.finish(job_id, error="HTTP 429", requeue=True, rate_limited_claim=current)
    assert queue.get(job_id).attempts == 0


@pytest.mark.parametrize("rate_limited", [False, True])
@pytest.mark.parametrize("state", ["missing", "pending", "succeeded", "failed", "cancelled"])
def test_noop_safe_read_requeue_does_not_record_retry_diagnostics(queue, state, rate_limited):
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "no-retry")
    original = queue.claim_next()
    assert original.id == job_id
    if state == "missing":
        job_id = "missing-read"
        original = replace(original, id=job_id)
    if state in {"succeeded", "failed"}:
        queue.finish(job_id, error="Previous failure" if state == "failed" else None)
    elif state in {"pending", "cancelled"}:
        queue.finish(job_id, error="Previous transient failure", requeue=True)
        if state == "cancelled":
            queue.cancel(job_id)
    with queue._connect() as db:
        events = db.execute("SELECT event FROM diagnostic_events ORDER BY created_at").fetchall()
    queue.finish(
        job_id,
        error="Transient bridge failure",
        requeue=True,
        rate_limited_claim=original if rate_limited else None,
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
        queue.finish(job_id, error="Uncertain click", requeue=True)
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
    available = queue.enqueue_digest("456", "wat2do.uwo", "bootstrap-public-profile")
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
    queue.finish(job_id, result={"posts": []})
    queue.refresh_retrieval(job_id)
    assert queue.get(job_id).result is None
    assert queue.get(job_id).attempts == 0
    assert queue.get(job_id).payload["url"] == "https://www.instagram.com/club.name/"


def test_old_queue_upgrade_keeps_jobs_settings_and_selected_school(queue):
    job_id = _engagement(queue)
    queue.set_setting("important", {"checkpoint": 7})
    queue.claim_next()
    queue.finish(job_id, result={"status": "succeeded"})
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
    first = q.enqueue_digest("123", "wat2do.ubc", "first")
    same = q.enqueue_digest("123", "wat2do.ubc", "second")
    other = q.enqueue_digest("456", "wat2do.utm", "third")
    excluded = q.enqueue_digest("789", "wat2do.utsc", "fourth")
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
    digest = q.enqueue_digest("123", "wat2do.ubc", "digest")
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
    queue.finish(job_id, error="Matching Instagram browser account is unavailable")
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


def test_digest_reports_recovery_pause_without_claiming_or_resuming(queue, monkeypatch):
    clock = _clock(monkeypatch)
    queue.set_setting("worker", {"running": True, "heartbeat": clock.now})
    reason = "Instagram browser request cancellation could not be confirmed: Apple Event -600"
    queue.set_setting("paused", reason)
    with pytest.raises(module.BrowserDigestError, match="Apple Event -600"):
        module.QueuedInstagramDigestResolver(queue).resolve(
            RECIPIENT_ID, ACCOUNT_USERNAME, "paused-digest"
        )
    assert queue.get_setting("paused") == reason
    assert queue.claim_next() is None
    assert clock.elapsed == 0
