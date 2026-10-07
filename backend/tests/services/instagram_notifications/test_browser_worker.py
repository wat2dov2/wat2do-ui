import fcntl
import json
import signal
import sqlite3
import threading
from concurrent.futures import ALL_COMPLETED
from concurrent.futures import wait as wait_for_futures
from dataclasses import replace
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

from services.instagram_notifications import browser_worker as module
from services.instagram_notifications import carousel_engagement, notification_ingestion
from services.instagram_notifications.browser_digest import DigestResolution
from services.instagram_notifications.browser_queue import BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserAccountChanged,
    BrowserRateLimited,
    BrowserTabPool,
    _BrowserAutomationTransient,
    _BrowserPageUnavailable,
    _BrowserReadCleanupPending,
    _BrowserTabUnavailable,
)
from services.instagram_notifications.browser_worker import maintain_tab_pool

RECIPIENT_ID = "12342599092"
ACCOUNT_USERNAME = "ubc.wat2do.io"


@pytest.fixture(autouse=True)
def isolated_browser(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_tabs": 10}))
    monkeypatch.setattr(notification_ingestion, "sync_notification_media", lambda _: {})
    monkeypatch.setattr(module, "maintain_tab_pool", lambda _: None)
    monkeypatch.setattr(module, "BROWSER_LOCK_PATH", str(tmp_path / "browser.lock"))
    monkeypatch.setattr(
        module,
        "BrowserInstagramSession",
        lambda: pytest.fail("Worker tests must never operate the browser"),
    )

    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(
            settle_registered_tabs=lambda: None,
            ensure_capacity=lambda: [],
            prepare=lambda job, count: (
                [
                    SimpleNamespace(
                        cancel_pending_request=lambda: None,
                        current_page_path=lambda **kwargs: "/",
                        current_account_username=lambda: ACCOUNT_USERNAME,
                        poll_until=lambda ready: ready(),
                    )
                    for _ in range(count)
                ],
                ACCOUNT_USERNAME,
            ),
        ),
    )


@pytest.fixture
def queue(tmp_path):
    return BrowserJobQueue(tmp_path / "queue")


def _engagement(queue, shortcode="Post1"):
    return queue.enqueue_engagement(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        post_url=f"https://www.instagram.com/p/{shortcode}/",
    )


def _settling_executor(execute):
    """Stub operations prove settlement before returning, as query does."""

    def settled(job, *, session=None, on_rate_limit=None):
        try:
            result = execute(job, session=session)
            if job.kind == "retrieval":
                result = {**result, "account_username": session.current_account_username()}
            return result
        except BrowserRateLimited as exc:
            if on_rate_limit is not None:
                on_rate_limit(exc)
            raise
        finally:
            if session is not None:
                session.cancel_pending_request()

    return settled


def _run_test_source_pollers(queue, stopping):
    pollers = module._source_pollers(queue, stopping)
    for poller in pollers:
        poller.start()
    try:
        assert stopping.wait(5), "A test source must request shutdown"
    finally:
        stopping.set()
        for poller in pollers:
            poller.join(timeout=5)


def test_busy_browser_lock_prevents_claiming_any_job(queue, monkeypatch):
    job_id = _engagement(queue)
    monkeypatch.setattr(queue, "claim_next", lambda **_: pytest.fail("No browser ownership"))

    with open(module.BROWSER_LOCK_PATH, "a+") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert module.process_next_job(queue) is False

    assert queue.get(job_id).state == "pending"


def test_digest_overtakes_likes_during_engagement_cooldown(queue, monkeypatch):
    first = _engagement(queue, "First")
    second = _engagement(queue, "Second")
    now = [10000.0]
    monkeypatch.setattr(module, "time", SimpleNamespace(time=lambda: now[0]))
    executed = []

    def execute(job, **kwargs):
        executed.append(job.id)
        return {"status": "succeeded"}

    monkeypatch.setattr(module, "execute_job", execute)

    assert module.process_next_job(queue) is True
    assert (
        queue.get_setting("next_engagement_at")
        == now[0] + module.CONTROL.engagement_interval_seconds
    )
    assert module.process_next_job(queue) is False
    digest = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-priority")
    assert module.process_next_job(queue) is True
    assert executed == [first, digest]
    assert queue.get(second).state == "pending"

    now[0] += module.CONTROL.engagement_interval_seconds
    assert module.process_next_job(queue) is True
    assert executed == [first, digest, second]


def test_job_deadline_disarms_alarm_and_restores_signal_handler(monkeypatch):
    previous = object()
    state = {"handler": previous}
    timer_calls = []

    def install_signal(_signum, handler):
        old = state["handler"]
        state["handler"] = handler
        return old

    monkeypatch.setattr(
        module,
        "signal",
        SimpleNamespace(
            SIGALRM=14,
            ITIMER_REAL=0,
            signal=install_signal,
            setitimer=lambda timer, seconds: timer_calls.append((timer, seconds)),
        ),
    )

    with pytest.raises(TimeoutError, match="deadline"):
        with module.job_deadline():
            state["handler"](14, None)

    assert state["handler"] is previous
    assert timer_calls == [(0, module.CONTROL.job_timeout_seconds), (0, 0)]


def test_timed_out_job_is_failed_once_and_releases_browser_for_digest(queue, monkeypatch):
    job_id = _engagement(queue)

    def timeout(_job):
        raise TimeoutError("Instagram browser job exceeded its deadline")

    monkeypatch.setattr(module, "execute_job", timeout)
    assert module.process_next_job(queue) is True
    assert queue.get(job_id).state == "failed"
    assert "deadline" in queue.get(job_id).error
    assert queue.get_setting("next_engagement_at") > 0
    assert not queue.get_setting("paused", False)

    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-after-timeout")
    monkeypatch.setattr(module, "execute_job", lambda job, **kwargs: {"status": "succeeded"})

    assert module.process_next_job(queue) is True
    assert queue.get(digest_id).state == "succeeded"
    assert queue.get(job_id).state == "failed"


def test_unconfirmed_cleanup_quarantines_all_browser_work(queue, monkeypatch):
    job_id = _engagement(queue)

    def unsafe_cleanup(_job):
        raise module.BrowserSessionError(
            "Instagram browser request cancellation could not be confirmed",
        )

    monkeypatch.setattr(module, "execute_job", unsafe_cleanup)

    assert module.process_next_job(queue) is True
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-quarantined")

    assert queue.get(job_id).state == "failed"
    assert "cancellation could not be confirmed" in queue.get_setting("paused")
    assert module.process_next_job(queue) is False
    assert queue.get(digest_id).state == "pending"


@pytest.mark.parametrize("interruption", [KeyboardInterrupt, SystemExit])
def test_interruption_fails_job_and_quarantines_before_releasing_lock(
    queue,
    monkeypatch,
    interruption,
):
    job_id = _engagement(queue)

    def interrupted(_job):
        raise interruption()

    monkeypatch.setattr(module, "execute_job", interrupted)

    with pytest.raises(interruption):
        module.process_next_job(queue)

    assert queue.get(job_id).state == "failed"
    assert queue.get_setting("paused")
    with open(module.BROWSER_LOCK_PATH, "a+") as probe:
        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_unexpected_exception_is_sanitized_and_requires_inspection(queue, monkeypatch, caplog):
    job_id = _engagement(queue)

    def fail(_job):
        raise RuntimeError("private request credential details")

    monkeypatch.setattr(module, "execute_job", fail)

    assert module.process_next_job(queue) is True

    assert queue.get(job_id).state == "failed"
    assert "RuntimeError" in queue.get(job_id).error
    assert queue.get_setting("paused")
    assert "private request credential details" not in queue.get(job_id).error
    assert "private request credential details" not in caplog.text


@pytest.mark.parametrize("kind", ["engagement", "digest", "retrieval"])
@pytest.mark.parametrize(
    "code,reason",
    [
        (sqlite3.SQLITE_FULL, "Browser queue storage is full; free disk space before resuming"),
        (
            sqlite3.SQLITE_BUSY,
            "Browser queue storage is locked; inspect competing queue writers before resuming",
        ),
        (
            sqlite3.SQLITE_LOCKED,
            "Browser queue storage is locked; inspect competing queue writers before resuming",
        ),
        (
            sqlite3.SQLITE_READONLY,
            "Browser queue storage is read-only; restore write access before resuming",
        ),
        (sqlite3.SQLITE_IOERR, "Browser queue storage is unavailable; inspect before resuming"),
        (
            sqlite3.SQLITE_FULL | 256,
            "Browser queue storage is full; free disk space before resuming",
        ),
        (None, "Browser queue storage is unavailable; inspect before resuming"),
    ],
)
def test_job_storage_errors_have_safe_actionable_diagnostics(
    queue, monkeypatch, caplog, kind, code, reason
):
    job_id = (
        _engagement(queue)
        if kind == "engagement"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "storage-error")
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/StorageError/",
        )
    )
    failure = sqlite3.OperationalError("private SQL payload and filesystem details")
    if code is not None:
        failure.sqlite_errorcode = code

    def fail(*args, **kwargs):
        raise failure

    monkeypatch.setattr(module, "execute_job", fail)

    assert module.process_next_job(queue)

    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).error == reason
    assert queue.get_setting("paused") == reason
    assert reason in caplog.text
    assert "private SQL payload" not in caplog.text
    assert not queue.is_rate_limited()


@pytest.mark.parametrize("source", ["collector", "heartbeat"])
def test_background_storage_failure_reports_full_disk_without_raw_details(
    queue, monkeypatch, caplog, source
):
    failure = sqlite3.OperationalError("private filesystem details")
    failure.sqlite_errorcode = sqlite3.SQLITE_FULL
    reason = "Browser queue storage is full; free disk space before resuming"
    if source == "collector":
        stopping = threading.Event()

        def fail():
            stopping.set()
            raise failure

        module._poll_source(queue, "source_status", fail, stopping)
        assert queue.get_setting("source_status")["error"] == reason
    else:
        waits = iter([False, True])

        def fail(*args):
            raise failure

        monkeypatch.setattr(queue, "set_setting", fail)
        module._keep_worker_alive(queue, SimpleNamespace(wait=lambda _: next(waits)))

    assert reason in caplog.text
    assert "private filesystem details" not in caplog.text


def test_known_account_failure_does_not_quarantine_other_notifications(queue, monkeypatch):
    failed_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-missing-account")

    def unavailable(_job, **kwargs):
        raise module.BrowserSessionError("Matching Instagram browser account is unavailable")

    monkeypatch.setattr(module, "execute_job", unavailable)
    assert module.process_next_job(queue) is True

    assert queue.get(failed_id).state == "failed"
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("kind", ["engagement", "digest", "retrieval"])
@pytest.mark.parametrize("stage", ["preparation", "execution"])
def test_foreground_initialization_failure_pauses_before_more_jobs_are_claimed(
    queue, monkeypatch, kind, stage
):
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_tabs": 2}))
    reason = (
        "Bring the registered Instagram window to the foreground briefly to initialize "
        "its worker tabs, then resume the browser worker"
    )
    ids = [
        _engagement(queue, f"Foreground{index}")
        if kind == "engagement"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"foreground-{index}")
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Foreground{index}/",
        )
        for index in range(3)
    ]

    def fail(*args, **kwargs):
        raise module.BrowserSessionError(reason)

    if stage == "preparation":
        monkeypatch.setattr(
            module,
            "BrowserTabPool",
            lambda _: SimpleNamespace(settle_registered_tabs=fail, prepare=fail),
        )
        monkeypatch.setattr(
            module,
            "execute_job",
            lambda *args, **kwargs: pytest.fail("Preparation must stop first"),
        )
    else:
        monkeypatch.setattr(module, "execute_job", fail)

    assert module.process_next_job(queue)

    assert queue.get_setting("paused") == reason
    assert queue.get(ids[0]).state == "failed"
    assert queue.get(ids[0]).error == reason
    # A streaming read may already occupy the second mocked slot before the
    # first failure settles. The hold must preserve work not yet admitted.
    assert queue.get(ids[-1]).state == "pending"
    assert queue.get(ids[-1]).attempts == 0
    queue.set_setting("next_engagement_at", 0)
    assert not module.process_next_job(queue)
    assert queue.get(ids[-1]).state == "pending"
    assert queue.get(ids[-1]).attempts == 0
    assert not queue.is_rate_limited()


@pytest.mark.parametrize(
    "kind,dry_run",
    [("digest", False), ("retrieval", False), ("engagement", False), ("engagement", True)],
)
def test_execute_job_shares_pinned_session_without_repeating_successful_operation_cleanup(
    queue,
    monkeypatch,
    kind,
    dry_run,
):
    from services.instagram_notifications import browser_ingestion

    calls = []
    session = SimpleNamespace(
        cancel_pending_request=lambda: pytest.fail("Successful operations already own settlement")
    )
    monkeypatch.setattr(module, "BrowserInstagramSession", lambda: session)

    def resolver(*, session):
        calls.append(("digest-session", session))
        return SimpleNamespace(
            resolve=lambda *args: DigestResolution(ACCOUNT_USERNAME, ("123",), 1)
        )

    def executor(*, session):
        calls.append(("engagement-session", session))
        return SimpleNamespace(
            engage_post=lambda *args, inspect=False: (
                calls.append("inspect" if inspect else "execute") or {"status": "succeeded"}
            ),
        )

    monkeypatch.setattr(module, "BrowserInstagramDigestResolver", resolver)
    monkeypatch.setattr(module, "BrowserInstagramEngagementExecutor", executor)

    def retrieve(session):
        calls.append(("retrieval-session", session))
        return SimpleNamespace(retrieve=lambda *args, **kwargs: {"status": "succeeded"})

    monkeypatch.setattr(browser_ingestion, "BrowserInstagramRetriever", retrieve)
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-session")
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/OwnedSettlement/",
        )
        if kind == "retrieval"
        else _engagement(queue)
    )
    job = queue.get(job_id)
    if dry_run:
        job = replace(job, payload={**job.payload, "dry_run": True})

    result = module.execute_job(job)

    assert calls[0] == (f"{kind}-session", session)
    if kind == "digest":
        assert result["media_ids"] == ("123",)
    elif kind == "engagement":
        assert calls[1] == ("inspect" if dry_run else "execute")


@pytest.mark.parametrize("kind", ["digest", "retrieval"])
def test_successful_query_settlement_proof_is_not_rechecked_by_worker(queue, monkeypatch, kind):
    from services.instagram_notifications import browser_ingestion, browser_session

    proof_seen = False
    cancellations = []

    def run(source, timeout):
        nonlocal proof_seen
        if source == browser_session._cancel_request_source():
            cancellations.append(True)
            if proof_seen:
                raise module.BrowserSessionError(
                    "Instagram browser request cancellation could not be confirmed"
                )
            return "settled"
        if source == "start-query-fixture":
            return "started"
        if source.startswith("delete window["):
            return "cleared"
        assert "settled: request.settled" in source
        proof_seen = True
        return json.dumps(
            {
                "result": {"state": "succeeded", "media_ids": ["123"], "page_count": 1},
                "settled": True,
            }
        )

    session = browser_session.BrowserInstagramSession(javascript_runner=run, sleep=lambda _: None)

    def resolve(*args):
        payload = session.query("start-query-fixture")
        return DigestResolution(
            ACCOUNT_USERNAME, tuple(payload["media_ids"]), payload["page_count"]
        )

    monkeypatch.setattr(
        module, "BrowserInstagramDigestResolver", lambda **kwargs: SimpleNamespace(resolve=resolve)
    )
    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda _: SimpleNamespace(
            retrieve=lambda *args, **kwargs: session.query("start-query-fixture")
        ),
    )
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "query-owned-proof")
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/QueryOwnedProof/",
        )
    )
    result = module.execute_job(queue.get(job_id), session=session)
    assert proof_seen
    assert len(cancellations) == 1
    assert result["media_ids"] == (("123",) if kind == "digest" else ["123"])


@pytest.mark.parametrize("kind", ["retrieval", "digest", "engagement"])
@pytest.mark.parametrize(
    "error", [KeyboardInterrupt, SystemExit, TimeoutError, RuntimeError, module.BrowserSessionError]
)
def test_execute_job_cleans_up_on_every_failed_exit(queue, monkeypatch, kind, error):
    from services.instagram_notifications import browser_ingestion

    calls = []
    session = SimpleNamespace(
        cancel_pending_request=lambda: calls.append("cleanup"), is_secondary_read_tab=False
    )
    monkeypatch.setattr(module, "BrowserInstagramSession", lambda: session)

    def fail(*_args, **_kwargs):
        raise error()

    monkeypatch.setattr(
        module, "BrowserInstagramEngagementExecutor", lambda **_: SimpleNamespace(engage_post=fail)
    )
    monkeypatch.setattr(
        module, "BrowserInstagramDigestResolver", lambda **_: SimpleNamespace(resolve=fail)
    )
    monkeypatch.setattr(
        browser_ingestion, "BrowserInstagramRetriever", lambda _: SimpleNamespace(retrieve=fail)
    )
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "failed-exit")
        if kind == "digest"
        else queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/FailedExit/",
        )
        if kind == "retrieval"
        else _engagement(queue)
    )

    with pytest.raises(error):
        module.execute_job(queue.get(job_id))

    assert calls == ["cleanup"]


def test_failed_cleanup_does_not_swallow_shutdown_interrupt(queue, monkeypatch):
    def fail_cleanup():
        raise module.BrowserSessionError(
            "Instagram browser request cancellation could not be confirmed"
        )

    def interrupted(*_args, **_kwargs):
        raise KeyboardInterrupt()

    monkeypatch.setattr(
        module,
        "BrowserInstagramSession",
        lambda: SimpleNamespace(cancel_pending_request=fail_cleanup),
    )
    monkeypatch.setattr(
        module,
        "BrowserInstagramEngagementExecutor",
        lambda **_: SimpleNamespace(engage_post=interrupted),
    )

    with pytest.raises(KeyboardInterrupt):
        module.execute_job(queue.get(_engagement(queue)))


def test_second_worker_cannot_recover_or_claim_the_first_workers_jobs(queue, monkeypatch):
    monkeypatch.setattr(
        queue, "recover_interrupted", lambda: pytest.fail("Worker is not singleton")
    )
    monkeypatch.setattr(
        module, "process_next_job", lambda _: pytest.fail("Worker is not singleton")
    )

    with (queue.state_directory / "worker.lock").open("a+") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match="already running"):
            module.run_worker(queue, once=True)


def test_once_recovers_under_browser_lock_and_never_starts_collection(queue, monkeypatch):
    job_id = _engagement(queue)
    assert queue.claim_next().id == job_id
    original_recovery = queue.recover_interrupted
    calls = []

    def recover():
        with open(module.BROWSER_LOCK_PATH, "a+") as probe:
            with pytest.raises(BlockingIOError):
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        calls.append("recover")
        original_recovery()

    monkeypatch.setattr(queue, "recover_interrupted", recover)
    monkeypatch.setattr(module, "_source_pollers", lambda *_: pytest.fail("Once must not collect"))
    prior_term = signal.getsignal(signal.SIGTERM)

    module.run_worker(queue, once=True, collect=True)

    assert calls == ["recover"]
    assert queue.get(job_id).state == "failed"
    assert queue.get_setting("worker")["running"] is False
    assert signal.getsignal(signal.SIGTERM) is prior_term


def test_collector_source_failure_is_sanitized_and_retried(queue, monkeypatch, caplog):
    stopping = threading.Event()
    attempts = []

    def sync(_queue):
        attempts.append("sync")
        if len(attempts) == 1:
            raise ValueError("private database credentials")
        stopping.set()
        return {"submitted": 0}

    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", sync)
    monkeypatch.setattr(
        module, "CONTROL", module.CONTROL.model_copy(update={"source_poll_interval_seconds": 0.01})
    )

    _run_test_source_pollers(queue, stopping)

    assert len(attempts) == 2
    assert queue.get_setting("source_status")["result"] == {"submitted": 0}
    assert "private database credentials" not in caplog.text


def test_blocked_collector_cannot_delay_a_digest_and_stops_on_shutdown(queue, monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-independent")
    original_process = module.process_next_job
    calls = []

    def blocked_sync(_queue):
        entered.set()
        assert release.wait(timeout=5)
        finished.set()
        return {"submitted": 0}

    def execute(job, **kwargs):
        assert entered.is_set()
        assert not finished.is_set()
        calls.append(job.id)
        return {"status": "succeeded"}

    def process(current_queue):
        assert entered.wait(timeout=5)
        if calls:
            release.set()
            raise KeyboardInterrupt()
        return original_process(current_queue)

    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", blocked_sync)
    monkeypatch.setattr(module, "execute_job", execute)
    monkeypatch.setattr(module, "process_next_job", process)
    try:
        module.run_worker(queue)
    finally:
        release.set()

    assert calls == [digest_id]
    assert queue.get(digest_id).state == "succeeded"
    assert finished.is_set()
    assert queue.get_setting("worker")["running"] is False


def test_ten_retrievals_overlap_and_release_lock_only_after_cleanup(queue, monkeypatch):
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Post{i}/",
        )
        for i in range(11)
    ]
    barrier = threading.Barrier(10)
    cleaned = []
    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            cancel_pending_request=lambda i=i: cleaned.append(i),
        )
        for i in range(10)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda job, count: (sessions[:count], ACCOUNT_USERNAME)),
    )

    def retrieve(job, *, session):
        if not job.payload["url"].endswith("/Post10/"):
            barrier.wait(timeout=5)
        with open(module.BROWSER_LOCK_PATH, "a+") as probe:
            with pytest.raises(BlockingIOError):
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return {"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(module, "execute_job", _settling_executor(retrieve))
    assert module.process_next_job(queue)
    assert sum(queue.get(job_id).state == "succeeded" for job_id in ids) == 11
    assert sum(queue.get(job_id).state == "pending" for job_id in ids) == 0
    assert set(cleaned) == set(range(10))
    assert len(cleaned) == 11
    with open(module.BROWSER_LOCK_PATH, "a+") as probe:
        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_parallel_native_challenge_guard_pauses_queue_and_settles_each_tab(queue, monkeypatch):
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Challenge{i}/",
        )
        for i in range(2)
    ]
    cleaned = []

    def guarded_navigation(*args, **kwargs):
        raise module.BrowserSessionError("Instagram browser requires human account recovery")

    sessions = [
        SimpleNamespace(
            cancel_pending_request=lambda: cleaned.append(True),
            navigate=guarded_navigation,
            is_secondary_read_tab=False,
        )
        for _ in ids
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda job, count: (sessions, ACCOUNT_USERNAME)),
    )
    assert module.process_next_job(queue)
    assert all(queue.get(job_id).state == "failed" for job_id in ids)
    assert "human account recovery" in queue.get_setting("paused")
    assert len(cleaned) == 2
    assert not module.process_next_job(queue)


def test_native_rate_limit_holds_browser_without_a_human_pause_or_action_retry(queue, monkeypatch):
    job_id = _engagement(queue, "NativeRateLimited")

    def rate_limited(*args, **kwargs):
        raise BrowserRateLimited("Instagram browser is rate limited (HTTP 429)")

    monkeypatch.setattr(module, "execute_job", rate_limited)
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == 1
    assert queue.is_rate_limited()
    assert not queue.get_setting("paused", False)
    digest_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "wait-for-rate-limit")
    assert not module.process_next_job(queue)
    assert queue.get(digest_id).state == "pending"
    assert queue.get(job_id).state == "failed"


def test_rate_limit_stops_refills_before_failed_operation_cleanup_finishes(queue, monkeypatch):
    from services.instagram_notifications import browser_ingestion

    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_tabs": 3}))
    job_ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Cooldown{index}/",
        )
        for index in range(2)
    ]
    cleanup_started = threading.Event()
    release_cleanup = threading.Event()
    extra = []
    observations = []
    waits = 0

    def cancel():
        cleanup_started.set()
        assert release_cleanup.wait(5), "Coordinator must release the test cleanup"

    sessions = [
        SimpleNamespace(is_secondary_read_tab=True, cancel_pending_request=cancel),
        SimpleNamespace(is_secondary_read_tab=True, cancel_pending_request=lambda: None),
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def retrieve(session, *args, **kwargs):
        if session is sessions[0]:
            raise BrowserRateLimited("Instagram public media request failed with HTTP 429")
        assert cleanup_started.wait(5)
        if not extra:
            extra.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url="https://www.instagram.com/p/DoNotRefillDuringCleanup/",
                )
            )
        return {"account_username": ACCOUNT_USERNAME, "posts": []}

    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda session: SimpleNamespace(
            retrieve=lambda *args, **kwargs: retrieve(session, *args, **kwargs)
        ),
    )

    def wait_and_observe(futures, **kwargs):
        nonlocal waits
        waits += 1
        if waits == 2:
            observations.append(
                (queue.is_rate_limited(), queue.get(extra[0]).attempts, queue.get(job_ids[0]).state)
            )
            release_cleanup.set()
        return wait_for_futures(futures, **kwargs)

    monkeypatch.setattr(module, "wait", wait_and_observe)
    try:
        assert module.process_next_job(queue)
    finally:
        release_cleanup.set()
    assert observations == [(True, 0, "running")]
    assert queue.get(extra[0]).state == "pending"
    assert not queue.get_setting("paused", False)


def test_tab_maintenance_does_not_request_bootstrap_pages_during_cooldown(queue, monkeypatch):
    _engagement(queue, "MaintenanceCooldown")
    job = queue.claim_next()
    queue.defer_for_rate_limit(job, "Instagram browser is rate limited (HTTP 429)")
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: pytest.fail("Cooldown must suppress browser maintenance"),
    )
    maintain_tab_pool(queue)
    assert queue.is_rate_limited()
    assert not queue.get_setting("paused", False)


def test_fresh_maintenance_429_uses_shared_cooldown_without_a_human_pause(queue, monkeypatch):
    def unavailable():
        raise BrowserRateLimited("Instagram browser is rate limited (HTTP 429)")

    monkeypatch.setattr(
        module, "BrowserTabPool", lambda _: SimpleNamespace(ensure_capacity=unavailable)
    )
    maintain_tab_pool(queue)
    assert queue.is_rate_limited()
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("kind", ["retrieval", "digest"])
def test_settled_rate_limited_read_refunds_behind_an_independent_human_pause(
    queue, monkeypatch, kind
):
    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_tabs": 3}))
    job_ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/PausedRateLimit{index}/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"paused-rate-limit-{index}")
        for index in range(2)
    ]
    barrier = threading.Barrier(2)
    paused = threading.Event()
    settlement = []
    human_error = "Instagram browser account requires human reauthorization"
    original_setting = queue.set_setting

    def set_setting(key, value):
        original_setting(key, value)
        if key == "paused" and value == human_error:
            paused.set()

    monkeypatch.setattr(queue, "set_setting", set_setting)

    def settle_rate_limited():
        assert paused.wait(5), "The independent auth failure must pause before read settlement"
        assert queue.get(job_ids[0]).state == "running"
        assert queue.get(job_ids[0]).attempts == 1
        settlement.append("settled")

    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            cancel_pending_request=settle_rate_limited if index == 0 else lambda: None,
        )
        for index in range(2)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def operation(job, **kwargs):
        barrier.wait(timeout=5)
        if job.id == job_ids[0]:
            raise BrowserRateLimited("Instagram browser is rate limited (HTTP 429)")
        raise module.BrowserSessionError(human_error)

    monkeypatch.setattr(module, "execute_job", _settling_executor(operation))
    assert module.process_next_job(queue)
    assert settlement == ["settled"]
    assert queue.get(job_ids[0]).state == "pending"
    assert queue.get(job_ids[0]).attempts == 0
    assert queue.get(job_ids[1]).state == "failed"
    assert queue.get_setting("paused") == human_error
    assert queue.is_rate_limited()
    assert queue.claim_next() is None
    assert queue.claim_companions(queue.get(job_ids[0]), limit=1) == []


@pytest.mark.parametrize("kind", ["retrieval", "digest"])
def test_last_budget_rate_limit_refunds_only_after_cleanup_then_real_failure_exhausts_budget(
    queue, monkeypatch, kind
):
    job_id = (
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/LastBudget429/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "last-budget-429")
    )
    for _ in range(module.CONTROL.ingestion_retry_limit - 1):
        claimed = queue.claim_next()
        queue.finish(claimed.id, error="A previous ordinary read failure", requeue=True)
    attempts_during_cleanup = []
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        cancel_pending_request=lambda: attempts_during_cleanup.append(queue.get(job_id).attempts),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )

    def rate_limited(*args, **kwargs):
        raise BrowserRateLimited("Instagram public media request failed with HTTP 429")

    monkeypatch.setattr(module, "execute_job", _settling_executor(rate_limited))
    assert module.process_next_job(queue)
    assert attempts_during_cleanup == [module.CONTROL.ingestion_retry_limit]
    assert queue.get(job_id).state == "pending"
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit - 1
    assert queue.is_rate_limited()
    queue.set_setting("browser_rate_limit_until", 0)

    def ordinary_failure(*args, **kwargs):
        raise _BrowserPageUnavailable(
            "Instagram public media response did not contain a media list"
        )

    monkeypatch.setattr(module, "execute_job", _settling_executor(ordinary_failure))
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit
    assert not queue.get_setting("paused", False)


def test_source_collectors_continue_while_browser_claims_are_rate_limited(queue, monkeypatch):
    _engagement(queue, "SourcesCooldown")
    queue.defer_for_rate_limit(queue.claim_next(), "Instagram browser is rate limited (HTTP 429)")
    stopping = threading.Event()
    notifications = threading.Event()
    diagnostics = threading.Event()

    def collect_notifications(current):
        assert current.is_rate_limited()
        notifications.set()
        return {}

    def publish_diagnostics(**kwargs):
        assert queue.is_rate_limited()
        diagnostics.set()

    def collect_carousels(current):
        assert current.is_rate_limited()
        assert notifications.wait(5) and diagnostics.wait(5)
        stopping.set()
        return {}

    monkeypatch.setattr(notification_ingestion, "sync_notification_media", collect_notifications)
    monkeypatch.setattr(queue, "publish_diagnostics", publish_diagnostics)
    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", collect_carousels)
    _run_test_source_pollers(queue, stopping)
    assert notifications.is_set() and diagnostics.is_set()


def test_digest_loading_account_route_does_not_pause(queue, monkeypatch):
    ids = [
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, f"transient-login-{i}")
        for i in range(2)
    ]

    def session():
        paths = iter(["/accounts/", "/"])

        def poll(ready):
            assert ready() is False
            assert ready() is True

        return SimpleNamespace(
            current_page_path=lambda **kwargs: next(paths),
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=poll,
            cancel_pending_request=lambda: None,
        )

    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(
            prepare=lambda job, count: ([session() for _ in ids], ACCOUNT_USERNAME)
        ),
    )
    monkeypatch.setattr(module, "execute_job", lambda job, **kw: {"status": "succeeded"})
    assert module.process_next_job(queue)
    assert all(queue.get(i).state == "succeeded" for i in ids)
    assert not queue.get_setting("paused", False)


def test_fast_tab_refills_before_slow_tab_finishes(queue, monkeypatch):
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Stream{i}/",
        )
        for i in range(11)
    ]
    refilled = threading.Event()
    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            cancel_pending_request=lambda: None,
        )
        for _ in range(10)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda job, count: (sessions, ACCOUNT_USERNAME)),
    )

    def retrieve(job, **kwargs):
        if job.id == ids[0]:
            assert refilled.wait(5), "Fast tabs must refill while the first tab remains busy"
        if job.id == ids[10]:
            assert queue.get(ids[0]).state == "running"
            refilled.set()
        return {"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(module, "execute_job", retrieve)
    assert module.process_next_job(queue)
    assert all(queue.get(i).state == "succeeded" for i in ids)


def test_blank_first_target_does_not_prevent_other_slots_visiting_their_own_targets(
    queue, monkeypatch
):
    bad_url = "https://www.instagram.com/p/BlankFirst/"
    good_url = "https://www.instagram.com/p/HealthySecond/"
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=url,
        )
        for url in (bad_url, good_url)
    ]
    navigations = []
    queries = []
    sessions = []

    for index in range(2):
        state = SimpleNamespace(url=bad_url)

        def navigate(url, *, reload=False, state=state, index=index):
            navigations.append((index, url))
            state.url = url

        def poll(ready):
            if not ready():
                raise _BrowserPageUnavailable("The assigned target remains blank")

        def query(source, state=state):
            queries.append(state.url)
            return {
                "state": "succeeded",
                "posts": [
                    {
                        "url": state.url,
                        "ownerUsername": "club",
                        "timestamp": "2026-10-07T12:00:00+00:00",
                        "caption": "Event",
                        "type": "Image",
                        "coauthors": [],
                        "displayUrl": "https://s.cdninstagram.com/fixture.jpg",
                    }
                ],
            }

        sessions.append(
            SimpleNamespace(
                navigate=navigate,
                current_page_path=lambda state=state, **kwargs: urlsplit(state.url).path,
                current_account_username=lambda state=state: (
                    None if state.url == bad_url else ACCOUNT_USERNAME
                ),
                poll_until=poll,
                query=query,
                cancel_pending_request=lambda: None,
                is_secondary_read_tab=False,
            )
        )

    def prepare(job, count):
        # Reproduce the old pool broadcast. A slot must reach its own target
        # before waiting for that target's readiness, even after this stale page.
        for session in sessions:
            session.navigate(job.payload["url"], reload=True)
        return sessions, ACCOUNT_USERNAME

    monkeypatch.setattr(module, "BrowserTabPool", lambda _: SimpleNamespace(prepare=prepare))
    assert module.process_next_job(queue)
    assert queue.get(ids[1]).state == "succeeded"
    assert queue.get(ids[1]).attempts == 1
    assert queue.get(ids[0]).state == "failed"
    assert queue.get(ids[0]).attempts == module.CONTROL.ingestion_retry_limit
    assert good_url in queries
    assert (1, good_url) in navigations
    assert not queue.get_setting("paused", False)


def test_retrieval_refill_reloads_its_exact_target_before_owned_readiness(queue, monkeypatch):
    urls = [f"https://www.instagram.com/p/RefillTarget{index}/" for index in range(2)]
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=urls[0],
        )
    ]
    state = SimpleNamespace(url="https://www.instagram.com/p/Stale/")
    navigations = []
    queries = []

    def navigate(url, *, reload):
        navigations.append((url, reload))
        state.url = url

    def poll(ready):
        assert ready(), "Readiness must inspect the assigned target rather than the stale tab"

    def query(source):
        queries.append(state.url)
        if state.url == urls[0]:
            ids.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url=urls[1],
                )
            )
        return {
            "state": "succeeded",
            "posts": [
                {
                    "url": state.url,
                    "ownerUsername": "club",
                    "timestamp": "2026-10-07T12:00:00+00:00",
                    "caption": "Event",
                    "type": "Image",
                    "coauthors": [],
                    "displayUrl": "https://s.cdninstagram.com/fixture.jpg",
                }
            ],
        }

    session = SimpleNamespace(
        navigate=navigate,
        current_page_path=lambda **kwargs: urlsplit(state.url).path,
        current_account_username=lambda: ACCOUNT_USERNAME if state.url in urls else None,
        poll_until=poll,
        query=query,
        cancel_pending_request=lambda: pytest.fail("Successful query owns settlement"),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    assert module.process_next_job(queue)
    assert navigations == [(url, True) for url in urls]
    assert queries == urls
    assert all(queue.get(job_id).state == "succeeded" for job_id in ids)
    assert all(queue.get(job_id).attempts == 1 for job_id in ids)


@pytest.mark.parametrize(
    "result",
    [
        None,
        {},
        {"account_username": None},
        {"account_username": []},
        {"account_username": "untrusted response text"},
        {"account_username": "wat2do.other"},
    ],
)
def test_unverified_retrieval_identity_never_reaches_queue_results(queue, monkeypatch, result):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/UnverifiedIdentity/",
    )
    queue.set_setting("retrieval_pool_account", ACCOUNT_USERNAME)
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: pytest.fail(
            "Retrieval readiness belongs to its target owner"
        )
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    monkeypatch.setattr(module, "execute_job", lambda *args, **kwargs: result)
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "pending"
    assert queue.get(job_id).result is None
    assert queue.get(job_id).attempts == 1
    assert queue.get_setting("retrieval_pool_account") is None
    assert not queue.get_setting("paused", False)


def test_public_retrieval_keeps_a_verified_personal_account_context(queue, monkeypatch):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/PersonalContext/",
    )
    session = SimpleNamespace()
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], "student.personal")),
    )
    monkeypatch.setattr(
        module,
        "execute_job",
        lambda *args, **kwargs: {"account_username": "student.personal", "posts": []},
    )
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "succeeded"


@pytest.mark.parametrize(
    "redirect", ["/accounts/login/", "/accounts/suspended/", "/challenge/", "/checkpoint/"]
)
def test_target_auth_redirect_pauses_before_any_media_query_or_publication(
    queue, monkeypatch, redirect
):
    from services.instagram_notifications import browser_session

    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/AuthRedirect/",
    )
    state = SimpleNamespace(path=f"/{ACCOUNT_USERNAME}/", navigated=[])
    cancellations = []

    def bridge(source, timeout):
        if source == browser_session._PAGE_RESPONSE_SOURCE:
            return json.dumps({"path": state.path, "rate_limited": False})
        if source == browser_session._cancel_request_source():
            cancellations.append(True)
            return "settled"
        if source.startswith("delete window["):
            return "cleared"
        pytest.fail("An auth redirect must fail before public media queries")

    session = browser_session.BrowserInstagramSession(
        javascript_runner=bridge, sleep=lambda _: None, allow_account_switch=False
    )

    def navigate(url, *, reload):
        state.navigated.append((url, reload))
        state.path = redirect

    monkeypatch.setattr(session, "navigate", navigate)
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    assert module.process_next_job(queue)
    assert state.navigated == [(queue.get(job_id).payload["url"], True)]
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).result is None
    assert "human account recovery" in queue.get_setting("paused")
    assert len(cancellations) == 1


def test_transient_retrieval_timeout_retries_bounded_without_global_pause(queue, monkeypatch):
    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/Retry/",
    )
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        cancel_pending_request=lambda: None,
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda job, count: ([session], ACCOUNT_USERNAME)),
    )

    def timeout(*args, **kwargs):
        raise TimeoutError("temporary response timeout")

    monkeypatch.setattr(module, "execute_job", timeout)
    assert module.process_next_job(queue)
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit
    assert queue.get(job_id).state == "failed"
    assert not queue.get_setting("paused", False)


def test_stream_uses_idle_tabs_for_jobs_arriving_after_start(queue, monkeypatch):
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/First/",
    )
    arrived = threading.Event()
    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            cancel_pending_request=lambda: None,
        )
        for _ in range(13)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def retrieve(job, **kwargs):
        if job.id == first:
            queue.enqueue_retrieval(
                school="ubc",
                recipient_id=RECIPIENT_ID,
                account_username=ACCOUNT_USERNAME,
                url="https://www.instagram.com/p/Arriving/",
            )
            assert arrived.wait(5), "Idle tab must start the arriving job before the first finishes"
        else:
            assert queue.get(first).state == "running"
            arrived.set()
        return {"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(module, "execute_job", retrieve)
    assert module.process_next_job(queue)
    assert arrived.is_set()


def test_collector_feeds_notifications_without_an_import(queue, monkeypatch):
    stopping = threading.Event()
    calls = []
    notified = threading.Event()

    def sync(current):
        assert current is queue
        calls.append("notifications")
        notified.set()
        return {"queued": 140}

    def carousel(current):
        assert notified.wait(5)
        calls.append("carousels")
        stopping.set()
        return {}

    monkeypatch.setattr(notification_ingestion, "sync_notification_media", sync)
    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", carousel)
    _run_test_source_pollers(queue, stopping)
    assert calls == ["notifications", "carousels"]


def test_retrieval_stream_keeps_refilling_past_one_job_timeout(queue, monkeypatch):
    import time

    monkeypatch.setattr(
        module, "CONTROL", module.CONTROL.model_copy(update={"job_timeout_seconds": 0.01})
    )
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/LongStream/",
    )
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        cancel_pending_request=lambda: None,
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(
            prepare=lambda *args: ([session], ACCOUNT_USERNAME),
            settle_registered_tabs=lambda: None,
        ),
    )
    later = []

    def retrieve(job, **kwargs):
        if job.id == first:
            later.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url="https://www.instagram.com/p/AfterTimer/",
                )
            )
            time.sleep(0.02)
        return {"target_url": job.payload["url"], "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(module, "execute_job", retrieve)
    assert module.process_next_job(queue)
    assert queue.get(later[0]).state == "succeeded"


@pytest.mark.parametrize("persistent", [False, True])
@pytest.mark.parametrize("kind", ["retrieval", "digest"])
def test_manual_account_switch_drains_before_bounded_retry(queue, monkeypatch, persistent, kind):
    ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Changed{i}/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(
            RECIPIENT_ID,
            ACCOUNT_USERNAME,
            f"changed-cache-{i}",
        )
        for i in range(2)
    ]
    drained = threading.Event()
    mismatched = threading.Event()
    preparations = []
    executions = []
    original_finish = queue.finish

    def finish(job_id, **kwargs):
        if kwargs.get("requeue"):
            assert drained.is_set(), "Account recovery must wait for every active tab"
        original_finish(job_id, **kwargs)

    monkeypatch.setattr(queue, "finish", finish)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)

    def prepare(job, count):
        preparations.append(job)
        if len(preparations) > 1:
            assert drained.is_set()
            assert queue.get_setting("retrieval_pool_account") is None
        sessions = []
        for i in range(2):

            def current(i=i):
                if persistent or (i == 0 and len(preparations) == 1):
                    mismatched.set()
                    return "wat2do.uwaterloo"
                if len(preparations) == 1:
                    assert mismatched.wait(5)
                return ACCOUNT_USERNAME

            sessions.append(
                SimpleNamespace(
                    current_page_path=lambda **kwargs: "/",
                    current_account_username=current,
                    poll_until=lambda ready: ready(),
                    cancel_pending_request=lambda i=i: drained.set() if i == 1 else None,
                )
            )
        return sessions, ACCOUNT_USERNAME

    monkeypatch.setattr(module, "BrowserTabPool", lambda _: SimpleNamespace(prepare=prepare))
    monkeypatch.setattr(
        module,
        "execute_job",
        _settling_executor(lambda job, **_: executions.append(job.id) or {}),
    )
    assert module.process_next_job(queue)
    assert queue.get(ids[0]).state == "pending"
    assert queue.get(ids[1]).state == ("pending" if persistent else "succeeded")
    assert executions == (ids if kind == "retrieval" else [] if persistent else [ids[1]])
    assert not queue.get_setting("paused", False)
    for _ in range(module.CONTROL.ingestion_retry_limit - 1 if persistent else 1):
        assert module.process_next_job(queue)
    job = queue.get(ids[0])
    assert job.state == ("failed" if persistent else "succeeded")
    if persistent:
        assert job.attempts == module.CONTROL.ingestion_retry_limit
        assert (
            "does not match the verified primary account"
            if kind == "retrieval"
            else "expected ubc.wat2do.io, found wat2do.uwaterloo"
        ) in job.error
    assert not queue.get_setting("paused", False)


def test_transient_tab_inventory_failure_defers_maintenance_without_pausing(queue, monkeypatch):
    from services.instagram_notifications.browser_session import _BrowserAutomationTransient

    calls = 0

    def capacity(self):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _BrowserAutomationTransient(
                "Brave could not run Instagram browser automation (Apple Event -1719)"
            )
        return ["42"]

    monkeypatch.setattr(module, "BrowserTabPool", BrowserTabPool)
    monkeypatch.setattr(BrowserTabPool, "ensure_capacity", capacity)
    maintain_tab_pool(queue)
    assert not queue.get_setting("paused", False)
    maintain_tab_pool(queue)
    assert calls == 2
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("kind", ["retrieval", "digest"])
@pytest.mark.parametrize(
    "failure_type",
    [
        _BrowserAutomationTransient,
        _BrowserPageUnavailable,
        TimeoutError,
    ],
)
def test_safe_read_failure_retries_without_pausing_or_exposing_final_failure(
    queue, monkeypatch, kind, failure_type
):
    job_id = (
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/Recoverable/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "recoverable-cache")
    )
    calls = []
    settlements = []
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        cancel_pending_request=lambda: settlements.append(True),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )

    def operation(job, **_kwargs):
        calls.append(job.id)
        if len(calls) == 1:
            raise failure_type("Recoverable browser read failed")
        return {"status": "succeeded", "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(module, "execute_job", _settling_executor(operation))
    assert module.process_next_job(queue)
    if kind == "digest":
        assert queue.get(job_id).state == "pending"
        assert queue.get(job_id).error is None
        assert module.process_next_job(queue)
    assert queue.get(job_id).state == "succeeded"
    assert queue.get(job_id).attempts == 2
    assert len(settlements) == 2
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("kind", ["retrieval", "digest"])
def test_repeated_bridge_failure_has_a_finite_read_retry_budget(queue, monkeypatch, kind):
    job_id = (
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/Budget/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "budget-cache")
    )

    def failed(*args, **kwargs):
        raise _BrowserAutomationTransient("Brave read bridge timed out")

    monkeypatch.setattr(module, "execute_job", _settling_executor(failed))
    for _ in range(module.CONTROL.ingestion_retry_limit):
        if queue.get(job_id).state == "failed":
            break
        assert module.process_next_job(queue)
    assert queue.get(job_id).state == "failed"
    assert queue.get(job_id).attempts == module.CONTROL.ingestion_retry_limit
    assert not queue.get_setting("paused", False)


def test_digest_mismatch_during_query_stays_running_until_other_tab_settles(queue, monkeypatch):
    first = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "mismatch-query")
    second = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "slow-query")
    mismatched = threading.Event()
    settled = threading.Event()
    session_ids = {}

    def prepare(job, count):
        sessions = [
            SimpleNamespace(
                current_page_path=lambda **kwargs: "/",
                current_account_username=lambda: ACCOUNT_USERNAME,
                poll_until=lambda ready: ready(),
                cancel_pending_request=lambda i=i: settled.set() if i == 1 else None,
            )
            for i in range(2)
        ]
        session_ids.update({id(session): index for index, session in enumerate(sessions)})
        return sessions, ACCOUNT_USERNAME

    def operation(job, *, session):
        if session_ids[id(session)] == 0:
            mismatched.set()
            raise BrowserAccountChanged("Instagram account changed during digest query")
        assert mismatched.wait(5)
        assert queue.get(first).state == "running"
        assert queue.get(first).error is None
        return {"status": "succeeded"}

    monkeypatch.setattr(module, "BrowserTabPool", lambda _: SimpleNamespace(prepare=prepare))
    monkeypatch.setattr(module, "execute_job", _settling_executor(operation))
    assert module.process_next_job(queue)
    assert settled.is_set()
    assert queue.get(first).state == "pending"
    assert queue.get(second).state == "succeeded"
    assert queue.get_setting("retrieval_pool_account") is None
    assert not queue.get_setting("paused", False)


def test_aged_engagement_yields_stream_only_after_active_reads_settle(queue, monkeypatch):
    from services.instagram_notifications import browser_queue as queue_module

    now = [module.time.time()]
    monkeypatch.setattr(queue_module, "time", SimpleNamespace(time=lambda: now[0]))
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/BeforeYield/",
    )
    engagement_ids = []
    later_ids = []
    cleaned = threading.Event()
    session = SimpleNamespace(
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        cancel_pending_request=lambda: cleaned.set(),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(
            prepare=lambda *args: ([session], ACCOUNT_USERNAME),
            settle_registered_tabs=lambda: None,
        ),
    )

    def operation(job, **kwargs):
        if job.id == first:
            engagement_ids.append(_engagement(queue, "WaitingFeatured"))
            later_ids.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url="https://www.instagram.com/p/AfterYield/",
                )
            )
            now[0] += queue_module.CONTROL.engagement_max_wait_seconds
        elif job.kind == "engagement":
            assert cleaned.is_set()
            assert queue.get(first).state == "succeeded"
            assert queue.get(later_ids[0]).state == "pending"
        return {"status": "succeeded"}

    monkeypatch.setattr(module, "execute_job", _settling_executor(operation))
    assert module.process_next_job(queue)
    assert queue.get(later_ids[0]).state == "pending"
    assert module.process_next_job(queue)
    assert queue.get(engagement_ids[0]).state == "succeeded"
    assert module.process_next_job(queue)
    assert queue.get(later_ids[0]).state == "succeeded"


@pytest.mark.parametrize("failed_source", ["notification", "diagnostics"])
def test_source_failure_does_not_prevent_collecting_published_engagement(
    queue, monkeypatch, caplog, failed_source
):
    stopping = threading.Event()
    calls = []
    failed = threading.Event()

    def fail(*args, **kwargs):
        failed.set()
        raise ValueError("Private source credentials must stay sanitized")

    def carousel(current):
        assert current is queue
        assert failed.wait(5)
        calls.append("carousel")
        stopping.set()
        return {"submitted": 1}

    if failed_source == "notification":
        monkeypatch.setattr(notification_ingestion, "sync_notification_media", fail)
    else:
        monkeypatch.setattr(queue, "publish_diagnostics", fail)
    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", carousel)
    _run_test_source_pollers(queue, stopping)
    assert calls == ["carousel"]
    assert queue.get_setting("source_status")["result"] == {"submitted": 1}
    status_key = (
        "notification_source_status" if failed_source == "notification" else "diagnostics_status"
    )
    assert queue.get_setting(status_key)["error"] == "ValueError"
    assert "Private source credentials" not in caplog.text


@pytest.mark.parametrize("stage", ["startup", "maintenance", "prepare"])
def test_worker_heartbeat_continues_while_browser_preparation_blocks(queue, monkeypatch, stage):
    entered = threading.Event()
    release = threading.Event()
    failures = []
    monkeypatch.setattr(
        module, "CONTROL", module.CONTROL.model_copy(update={"worker_poll_interval_seconds": 0.01})
    )

    def blocked():
        entered.set()
        assert release.wait(5)

    if stage == "startup":
        queue.set_setting("browser_tab_ids", ["42"])
        monkeypatch.setattr(
            module,
            "BrowserTabPool",
            lambda _: SimpleNamespace(settle_registered_tabs=blocked),
        )
        monkeypatch.setattr(
            module,
            "BrowserInstagramSession",
            lambda **kwargs: SimpleNamespace(cancel_pending_request=blocked),
        )
    if stage == "maintenance":
        monkeypatch.setattr(module, "maintain_tab_pool", lambda _: blocked())
    if stage == "prepare":
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "blocked-prepare")

        def prepare(job, count):
            blocked()
            return [
                SimpleNamespace(
                    current_page_path=lambda **kwargs: "/",
                    current_account_username=lambda: ACCOUNT_USERNAME,
                    poll_until=lambda ready: ready(),
                    cancel_pending_request=lambda: None,
                )
            ], ACCOUNT_USERNAME

        monkeypatch.setattr(
            module,
            "BrowserTabPool",
            lambda _: SimpleNamespace(prepare=prepare, settle_registered_tabs=lambda: None),
        )
    else:
        _engagement(queue)
    monkeypatch.setattr(module, "execute_job", lambda *args, **kwargs: {"status": "succeeded"})

    def observe_heartbeat():
        try:
            assert entered.wait(5)
            before = queue.get_setting("worker")
            assert before["running"] is True
            assert not release.wait(0.1)
            after = queue.get_setting("worker")
            assert after["running"] is True
            assert after["heartbeat"] > before["heartbeat"]
        except BaseException as exc:
            failures.append(exc)
        finally:
            release.set()

    observer = threading.Thread(target=observe_heartbeat)
    observer.start()
    try:
        module.run_worker(queue, once=True, collect=False)
    finally:
        release.set()
        observer.join(timeout=5)
    assert failures == []
    assert queue.get_setting("worker")["running"] is False
    assert not any(thread.name == "instagram-browser-heartbeat" for thread in threading.enumerate())


@pytest.mark.parametrize("kind", ["retrieval", "digest", "engagement"])
@pytest.mark.parametrize("secondary", [False, True])
def test_uncertain_cleanup_defers_only_secondary_reads(queue, monkeypatch, kind, secondary):
    from services.instagram_notifications import browser_ingestion

    job_id = (
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url="https://www.instagram.com/p/Retire/",
        )
        if kind == "retrieval"
        else queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "retire-cache")
        if kind == "digest"
        else _engagement(queue, "RetirePrimaryForbidden")
    )
    retired = []

    def uncertain_cleanup():
        raise module.BrowserSessionError(
            "Instagram browser request cancellation could not be confirmed"
        )

    session = SimpleNamespace(
        cancel_pending_request=uncertain_cleanup,
        retire_unresponsive_read_tab=lambda: retired.append(True),
        is_secondary_read_tab=secondary,
    )

    def fail(*args, **kwargs):
        raise _BrowserPageUnavailable("The read operation did not finish")

    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda _: SimpleNamespace(retrieve=fail),
    )
    monkeypatch.setattr(
        module,
        "BrowserInstagramDigestResolver",
        lambda **kwargs: SimpleNamespace(resolve=fail),
    )
    monkeypatch.setattr(
        module,
        "BrowserInstagramEngagementExecutor",
        lambda **kwargs: SimpleNamespace(engage_post=fail),
    )
    expected_error = (
        _BrowserReadCleanupPending
        if secondary and kind != "engagement"
        else module.BrowserSessionError
    )
    with pytest.raises(expected_error) as raised:
        module.execute_job(queue.get(job_id), session=session)
    assert isinstance(raised.value, _BrowserReadCleanupPending) == (
        secondary and kind != "engagement"
    )
    assert retired == []


def test_unconfirmed_secondary_retirement_preserves_cancellation_pause(queue, monkeypatch):
    from services.instagram_notifications import browser_ingestion

    job_id = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/UnconfirmedRetirement/",
    )
    cancellation_error = module.BrowserSessionError(
        "Instagram browser request cancellation could not be confirmed"
    )

    def cancel():
        raise cancellation_error

    def retire():
        raise module.BrowserSessionError("Exact tab closure could not be confirmed")

    session = SimpleNamespace(
        cancel_pending_request=cancel,
        retire_unresponsive_read_tab=retire,
        is_secondary_read_tab=True,
        current_page_path=lambda **kwargs: "/",
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
    )

    def fail(*args, **kwargs):
        raise _BrowserPageUnavailable("The read operation did not finish")

    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda _: SimpleNamespace(retrieve=fail),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "failed"
    assert queue.get_setting("paused") == str(cancellation_error)


@pytest.mark.parametrize("retire", [False, True])
@pytest.mark.parametrize("rate_limited", [False, True])
def test_all_fourteen_reads_drain_before_deferred_cleanup_and_no_slots_refill(
    queue, monkeypatch, retire, rate_limited
):
    from services.instagram_notifications import browser_ingestion

    monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update={"parallel_tabs": 15}))
    job_ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/Drain{index}/",
        )
        for index in range(14)
    ]
    barrier = threading.Barrier(14)
    healthy_settled = []
    proof = []
    extra = []
    cancellation_count = 0
    diagnostics = []
    original_diagnostic = queue.record_diagnostic

    def diagnostic(state, job=None, **kwargs):
        diagnostics.append((state, job.id if job else None))
        original_diagnostic(state, job, **kwargs)

    monkeypatch.setattr(queue, "record_diagnostic", diagnostic)

    def cancel_pending():
        nonlocal cancellation_count
        cancellation_count += 1
        if cancellation_count == 1:
            raise module.BrowserSessionError(
                "Instagram browser request cancellation could not be confirmed"
            )
        assert len(healthy_settled) == 13
        assert queue.get(job_ids[0]).state == "running"
        proof.append("cancel")
        if retire:
            raise module.BrowserSessionError(
                "Instagram browser request cancellation could not be confirmed"
            )

    def close_secondary():
        assert len(healthy_settled) == 13
        proof.append("retire")

    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            is_secondary_read_tab=True,
            cancel_pending_request=cancel_pending
            if index == 0
            else lambda i=index: healthy_settled.append(i),
            retire_unresponsive_read_tab=close_secondary,
        )
        for index in range(14)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def retrieve(session, *_args, **_kwargs):
        barrier.wait(timeout=5)
        if session is sessions[0]:
            extra.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url="https://www.instagram.com/p/NoRefill/",
                )
            )
            error_type = BrowserRateLimited if rate_limited else _BrowserPageUnavailable
            raise error_type(
                "Instagram public media request failed with HTTP 429"
                if rate_limited
                else "The read operation did not finish"
            )
        session.cancel_pending_request()
        return {"status": "succeeded", "account_username": ACCOUNT_USERNAME}

    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda session: SimpleNamespace(
            retrieve=lambda *args, **kwargs: retrieve(session, *args, **kwargs)
        ),
    )
    # Deliver healthy and deferred completions together to exercise the refill race.
    monkeypatch.setattr(
        module,
        "wait",
        lambda futures, **kwargs: wait_for_futures(futures, timeout=5, return_when=ALL_COMPLETED),
    )
    assert module.process_next_job(queue)
    assert proof == (["cancel", "retire"] if retire else ["cancel"]), queue.get(job_ids[0])
    assert queue.get(job_ids[0]).state == "pending"
    assert queue.get(job_ids[0]).attempts == (0 if rate_limited else 1)
    assert all(queue.get(job_id).state == "succeeded" for job_id in job_ids[1:])
    assert queue.get(extra[0]).state == "pending"
    assert queue.get(extra[0]).attempts == 0
    assert ("pending", job_ids[0]) in diagnostics
    assert queue.is_rate_limited() is rate_limited
    assert diagnostics.count(("rate_limited", job_ids[0])) == int(rate_limited)
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("auth_source", ["readiness", "digest_payload"])
def test_confirmed_auth_failure_survives_deferred_secondary_cleanup(
    queue, monkeypatch, auth_source
):
    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "auth-with-contention")
    cancel_count = 0
    terminal = []

    def cancel():
        nonlocal cancel_count
        cancel_count += 1
        if auth_source == "readiness" and cancel_count == 1:
            raise module.BrowserSessionError(
                "Instagram browser request cancellation could not be confirmed"
            )

    def query(_source):
        raise _BrowserReadCleanupPending(
            "Instagram browser request cancellation could not be confirmed",
            completed_payload={"state": "failed", "reason": "auth_required"},
        )

    def page_path(**kwargs):
        if auth_source == "readiness":
            raise module.BrowserSessionError("Instagram browser requires human account recovery")
        return "/"

    session = SimpleNamespace(
        current_page_path=page_path,
        current_account_username=lambda: ACCOUNT_USERNAME,
        poll_until=lambda ready: ready(),
        is_secondary_read_tab=True,
        cancel_pending_request=cancel,
        activate_account=lambda *args: ACCOUNT_USERNAME,
        query=query,
        retire_unresponsive_read_tab=lambda: pytest.fail("Settled request must not retire"),
    )
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    original_diagnostic = queue.record_diagnostic

    def diagnostic(state, job=None):
        terminal.append((state, job.id if job else None))
        original_diagnostic(state, job)

    monkeypatch.setattr(queue, "record_diagnostic", diagnostic)
    assert module.process_next_job(queue)
    expected = "human account recovery" if auth_source == "readiness" else "human reauthorization"
    assert expected in queue.get_setting("paused")
    assert queue.get(job_id).state == "failed"
    assert expected in queue.get(job_id).error
    assert ("failed", job_id) in terminal
    assert cancel_count == 2


@pytest.mark.parametrize("interrupt_at", ["wait", "readiness", "settlement"])
def test_interruption_settles_all_unobserved_secondary_cleanup_before_releasing_lock(
    queue, monkeypatch, interrupt_at
):
    from services.instagram_notifications import browser_ingestion

    job_ids = [
        queue.enqueue_retrieval(
            school="ubc",
            recipient_id=RECIPIENT_ID,
            account_username=ACCOUNT_USERNAME,
            url=f"https://www.instagram.com/p/InterruptDrain{index}/",
        )
        for index in range(2)
    ]
    cancel_counts = [0, 0]
    settled = []

    def cancel(index):
        cancel_counts[index] += 1
        if cancel_counts[index] == 1:
            raise module.BrowserSessionError(
                "Instagram browser request cancellation could not be confirmed"
            )
        with open(module.BROWSER_LOCK_PATH, "a+") as lock:
            with pytest.raises(BlockingIOError):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if interrupt_at == "settlement" and index == 0 and cancel_counts[index] == 2:
            raise KeyboardInterrupt()
        settled.append(index)

    def poll(index, ready):
        if interrupt_at == "readiness" and index == 0:
            raise KeyboardInterrupt()
        return ready()

    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready, i=index: poll(i, ready),
            is_secondary_read_tab=True,
            cancel_pending_request=lambda i=index: cancel(i),
            retire_unresponsive_read_tab=lambda: pytest.fail("Settled request must not retire"),
        )
        for index in range(2)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def failed_retrieval(session, *args, **kwargs):
        session.poll_until(lambda: True)
        raise _BrowserPageUnavailable("The read operation did not finish")

    monkeypatch.setattr(
        browser_ingestion,
        "BrowserInstagramRetriever",
        lambda session: SimpleNamespace(
            retrieve=lambda *args, **kwargs: failed_retrieval(session, *args, **kwargs)
        ),
    )

    def wait_then_interrupt(futures, **kwargs):
        completed = wait_for_futures(futures, timeout=5, return_when=ALL_COMPLETED)
        assert len(completed[0]) == 2
        if interrupt_at == "wait":
            raise KeyboardInterrupt()
        return completed

    monkeypatch.setattr(module, "wait", wait_then_interrupt)
    with pytest.raises(KeyboardInterrupt):
        module.process_next_job(queue)
    assert sorted(settled) == [0, 1]
    assert "inspect browser state" in queue.get_setting("paused")
    assert all(queue.get(job_id).state == "failed" for job_id in job_ids)
    with open(module.BROWSER_LOCK_PATH, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_UN)


def test_closed_secondary_stops_refills_and_drains_before_pool_repair(queue, monkeypatch):
    first = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/ClosedTab/",
    )
    second = queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username=ACCOUNT_USERNAME,
        url="https://www.instagram.com/p/HealthyTab/",
    )
    pool_invalidated = threading.Event()
    healthy_settled = threading.Event()
    later = []
    original_set = queue.set_setting

    def set_setting(key, value):
        original_set(key, value)
        if key == "retrieval_pool_account" and value is None:
            pool_invalidated.set()

    monkeypatch.setattr(queue, "set_setting", set_setting)
    sessions = [
        SimpleNamespace(
            current_page_path=lambda **kwargs: "/",
            current_account_username=lambda: ACCOUNT_USERNAME,
            poll_until=lambda ready: ready(),
            cancel_pending_request=lambda i=i: healthy_settled.set() if i == 1 else None,
        )
        for i in range(2)
    ]
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: (sessions, ACCOUNT_USERNAME)),
    )

    def operation(job, **kwargs):
        if job.id == first:
            later.append(
                queue.enqueue_retrieval(
                    school="ubc",
                    recipient_id=RECIPIENT_ID,
                    account_username=ACCOUNT_USERNAME,
                    url="https://www.instagram.com/p/KeepPending/",
                )
            )
            raise _BrowserTabUnavailable("The pinned Instagram tab was closed")
        assert job.id == second, "A closed slot must not claim more queued reads"
        assert pool_invalidated.wait(5)
        assert queue.get(first).state == "running"
        return {"status": "succeeded"}

    monkeypatch.setattr(module, "execute_job", _settling_executor(operation))
    assert module.process_next_job(queue)
    assert healthy_settled.is_set()
    assert queue.get(first).state == "pending"
    assert queue.get(second).state == "succeeded"
    assert queue.get(later[0]).state == "pending"
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize("blocked_source", ["notification", "diagnostics"])
def test_blocked_source_does_not_delay_other_source_pollers(queue, monkeypatch, blocked_source):
    stopping = threading.Event()
    entered = threading.Event()
    release = threading.Event()
    notification_progress = threading.Event()
    diagnostics_progress = threading.Event()
    carousel_progress = threading.Event()

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return {}

    def notifications(current):
        assert current is queue
        notification_progress.set()
        return {}

    def diagnostics(**kwargs):
        diagnostics_progress.set()

    def carousels(current):
        assert current is queue
        carousel_progress.set()
        return {"submitted": 1}

    monkeypatch.setattr(
        notification_ingestion,
        "sync_notification_media",
        blocked if blocked_source == "notification" else notifications,
    )
    monkeypatch.setattr(
        queue,
        "publish_diagnostics",
        blocked if blocked_source == "diagnostics" else diagnostics,
    )
    monkeypatch.setattr(carousel_engagement, "sync_published_carousels", carousels)
    pollers = module._source_pollers(queue, stopping)
    for poller in pollers:
        poller.start()
    try:
        assert entered.wait(5)
        assert carousel_progress.wait(5)
        progress = (
            diagnostics_progress if blocked_source == "notification" else notification_progress
        )
        assert progress.wait(5)
        assert not release.is_set()
    finally:
        stopping.set()
        release.set()
        for poller in pollers:
            poller.join(timeout=5)
    assert all(not poller.is_alive() for poller in pollers)


@pytest.mark.parametrize("failed_read", ["initial_path", "login_recheck"])
def test_digest_transient_pathname_read_recovers_without_spending_another_job_attempt(
    queue, monkeypatch, failed_read
):
    from services.instagram_notifications import browser_session

    job_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "path-read-retry")
    pathname_reads = []

    def bridge(source, _timeout):
        if source == browser_session._PAGE_RESPONSE_SOURCE:
            pathname_reads.append(source)
            attempt = len(pathname_reads)
            if failed_read == "login_recheck" and attempt == 1:
                return json.dumps({"path": "/accounts/login/", "rate_limited": False})
            if attempt == (1 if failed_read == "initial_path" else 2):
                raise _BrowserAutomationTransient("Transient pathname bridge failure")
            return json.dumps({"path": "/", "rate_limited": False})
        if source == browser_session._current_account_username_source():
            return ACCOUNT_USERNAME
        if source == browser_session._cancel_request_source():
            return "settled"
        assert source.startswith("delete window[")
        return "cleared"

    session = browser_session.BrowserInstagramSession(
        javascript_runner=bridge,
        allow_account_switch=False,
        sleep=lambda _: None,
    )
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        module,
        "BrowserTabPool",
        lambda _: SimpleNamespace(prepare=lambda *args: ([session], ACCOUNT_USERNAME)),
    )
    executions = []
    monkeypatch.setattr(
        module,
        "execute_job",
        _settling_executor(
            lambda job, **kwargs: executions.append(job.id) or {"status": "succeeded"}
        ),
    )
    assert module.process_next_job(queue)
    assert queue.get(job_id).state == "succeeded"
    assert queue.get(job_id).attempts == 1
    assert executions == [job_id]
    assert len(pathname_reads) == (2 if failed_read == "initial_path" else 3)
    assert not queue.get_setting("paused", False)
