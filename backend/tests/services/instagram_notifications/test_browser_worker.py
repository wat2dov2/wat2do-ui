import fcntl
import signal
import threading
from dataclasses import replace
from types import SimpleNamespace

import pytest

from services.instagram_notifications import browser_worker as module
from services.instagram_notifications import carousel_engagement
from services.instagram_notifications.browser_digest import DigestResolution
from services.instagram_notifications.browser_queue import BrowserJobQueue

RECIPIENT_ID = "12342599092"
ACCOUNT_USERNAME = "ubc.wat2do.io"


@pytest.fixture(autouse=True)
def isolated_browser(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "BROWSER_LOCK_PATH", str(tmp_path / "browser.lock"))
    monkeypatch.setattr(
        module,
        "BrowserInstagramSession",
        lambda: pytest.fail("Worker tests must never operate the browser"),
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
        action="like",
    )


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

    def execute(job):
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
    monkeypatch.setattr(module, "execute_job", lambda job: {"status": "succeeded"})

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


def test_known_account_failure_does_not_quarantine_other_notifications(queue, monkeypatch):
    failed_id = queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-missing-account")

    def unavailable(_job):
        raise module.BrowserSessionError("Matching Instagram browser account is unavailable")

    monkeypatch.setattr(module, "execute_job", unavailable)
    assert module.process_next_job(queue) is True

    assert queue.get(failed_id).state == "failed"
    assert not queue.get_setting("paused", False)


@pytest.mark.parametrize(
    "kind,dry_run", [("digest", False), ("engagement", False), ("engagement", True)]
)
def test_execute_job_shares_pinned_session_and_cleans_up_after_success(
    queue,
    monkeypatch,
    kind,
    dry_run,
):
    calls = []
    session = SimpleNamespace(cancel_pending_request=lambda: calls.append("cleanup"))
    monkeypatch.setattr(module, "BrowserInstagramSession", lambda: session)

    def resolver(*, session):
        calls.append(("digest-session", session))
        return SimpleNamespace(
            resolve=lambda *args: DigestResolution(ACCOUNT_USERNAME, ("123",), 1)
        )

    def executor(*, session):
        calls.append(("engagement-session", session))
        return SimpleNamespace(
            execute=lambda *args: calls.append("execute") or {"status": "succeeded"},
            inspect=lambda *args: calls.append("inspect") or {"status": "ready"},
        )

    monkeypatch.setattr(module, "BrowserInstagramDigestResolver", resolver)
    monkeypatch.setattr(module, "BrowserInstagramEngagementExecutor", executor)
    job_id = (
        queue.enqueue_digest(RECIPIENT_ID, ACCOUNT_USERNAME, "cache-session")
        if kind == "digest"
        else _engagement(queue)
    )
    job = queue.get(job_id)
    if dry_run:
        job = replace(job, payload={**job.payload, "dry_run": True})

    result = module.execute_job(job)

    assert calls[0] == (f"{kind}-session", session)
    assert calls[-1] == "cleanup"
    if kind == "digest":
        assert result["media_ids"] == ("123",)
    else:
        assert calls[1] == ("inspect" if dry_run else "execute")


@pytest.mark.parametrize("error", [KeyboardInterrupt, TimeoutError, RuntimeError])
def test_execute_job_cleans_up_on_every_interruption(queue, monkeypatch, error):
    calls = []
    session = SimpleNamespace(cancel_pending_request=lambda: calls.append("cleanup"))
    monkeypatch.setattr(module, "BrowserInstagramSession", lambda: session)

    def fail(*_args):
        raise error()

    monkeypatch.setattr(
        module, "BrowserInstagramEngagementExecutor", lambda **_: SimpleNamespace(execute=fail)
    )

    with pytest.raises(error):
        module.execute_job(queue.get(_engagement(queue)))

    assert calls == ["cleanup"]


def test_failed_cleanup_does_not_swallow_shutdown_interrupt(queue, monkeypatch):
    def fail_cleanup():
        raise module.BrowserSessionError(
            "Instagram browser request cancellation could not be confirmed"
        )

    def interrupted(*_args):
        raise KeyboardInterrupt()

    monkeypatch.setattr(
        module,
        "BrowserInstagramSession",
        lambda: SimpleNamespace(cancel_pending_request=fail_cleanup),
    )
    monkeypatch.setattr(
        module,
        "BrowserInstagramEngagementExecutor",
        lambda **_: SimpleNamespace(execute=interrupted),
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
    monkeypatch.setattr(
        module, "_collect_carousels", lambda *_: pytest.fail("Once must not collect")
    )
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
    monkeypatch.setattr(stopping, "wait", lambda _: stopping.is_set())

    module._collect_carousels(queue, stopping)

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

    def execute(job):
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
