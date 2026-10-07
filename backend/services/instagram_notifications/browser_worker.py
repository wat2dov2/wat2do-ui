"""Single browser executor with bounded jobs and independent carousel polling."""

from __future__ import annotations

import fcntl
import logging
import signal
import sqlite3
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import asdict
from typing import Callable, Iterator

from services.instagram_notifications.browser_digest import BrowserInstagramDigestResolver
from services.instagram_notifications.browser_engagement import BrowserInstagramEngagementExecutor
from services.instagram_notifications.browser_queue import CONTROL, BrowserJob, BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserAccountChanged,
    BrowserInstagramSession,
    BrowserRateLimited,
    BrowserSessionError,
    BrowserTabPool,
    _BrowserAutomationTransient,
    _BrowserPageUnavailable,
    _BrowserReadCleanupPending,
    _BrowserTabUnavailable,
    _PinnedBraveJavascriptRunner,
)

log = logging.getLogger(__name__)
# The old notification workflows use this same lock until their code is deployed.
BROWSER_LOCK_PATH = "/tmp/wat2do_instagram_browser.lock"


def _storage_failure_reason(error: BaseException) -> str | None:
    """Classify queue failures by SQLite's code without exposing SQL or file paths."""
    if not isinstance(error, sqlite3.Error):
        return None
    code = getattr(error, "sqlite_errorcode", None)
    code = code & 0xFF if type(code) is int else None
    if code == sqlite3.SQLITE_FULL:
        return "Browser queue storage is full; free disk space before resuming"
    if code in {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}:
        return "Browser queue storage is locked; inspect competing queue writers before resuming"
    if code == sqlite3.SQLITE_READONLY:
        return "Browser queue storage is read-only; restore write access before resuming"
    return "Browser queue storage is unavailable; inspect before resuming"


def _requires_human_recovery(error: BaseException) -> bool:
    return any(
        reason in str(error)
        for reason in (
            "cancellation could not be confirmed",
            "human account recovery",
            "human reauthorization",
            "Bring the registered Instagram window to the foreground briefly",
        )
    )


@contextmanager
def job_deadline() -> Iterator[None]:
    def expired(_signum: int, _frame: object) -> None:
        raise TimeoutError("Instagram browser job exceeded its deadline")

    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, CONTROL.job_timeout_seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def execute_job(
    job: BrowserJob,
    *,
    session: BrowserInstagramSession | None = None,
    on_rate_limit: Callable[[BrowserRateLimited], None] | None = None,
) -> dict:
    session = session or BrowserInstagramSession()
    operation_error: BaseException | None = None
    try:
        if job.kind == "digest":
            return asdict(
                BrowserInstagramDigestResolver(session=session).resolve(
                    job.recipient_id,
                    job.account_username,
                    job.payload["cache_ent_id"],
                )
            )
        if job.kind == "retrieval":
            from services.instagram_notifications.browser_ingestion import BrowserInstagramRetriever

            return BrowserInstagramRetriever(session).retrieve(
                job.payload["url"],
                cutoff_days=job.payload["cutoff_days"],
            )
        executor = BrowserInstagramEngagementExecutor(session=session)
        return executor.engage_post(
            job.recipient_id,
            job.account_username,
            job.payload["post_url"],
            inspect=bool(job.payload.get("dry_run")),
        )
    except BaseException as exc:
        operation_error = exc
        rate_error = exc.operation_error if isinstance(exc, _BrowserReadCleanupPending) else exc
        if isinstance(rate_error, BrowserRateLimited) and on_rate_limit is not None:
            on_rate_limit(rate_error)
        if isinstance(exc, BrowserSessionError):
            deferred = _deferred_read_cleanup(job, session, exc)
            if deferred is not None:
                operation_error = deferred
                raise deferred from None
        raise
    finally:
        # Query returns only after its own settlement proof. Native engagement
        # starts by settling the previous request and creates no worker fetch.
        # Keep exact-tab cleanup for every failure, including navigation and clicks.
        if operation_error is not None:
            _settle_job(job, session, operation_error=operation_error)


def _deferred_read_cleanup(
    job: BrowserJob,
    session: BrowserInstagramSession,
    error: BrowserSessionError,
    *,
    operation_error: BaseException | None = None,
) -> _BrowserReadCleanupPending | None:
    if (
        job.kind not in {"digest", "retrieval"}
        or not session.is_secondary_read_tab
        or "cancellation could not be confirmed" not in str(error)
    ):
        return None
    if isinstance(operation_error, _BrowserReadCleanupPending):
        return operation_error
    if isinstance(error, _BrowserReadCleanupPending):
        return error
    return _BrowserReadCleanupPending(str(error), operation_error=operation_error)


def _settle_job(
    job: BrowserJob,
    session: BrowserInstagramSession,
    *,
    operation_error: BaseException | None = None,
) -> None:
    """Keep uncertain actions paused; defer secondary proof until other reads drain."""
    try:
        try:
            session.cancel_pending_request()
        except BrowserSessionError as exc:
            deferred = _deferred_read_cleanup(job, session, exc, operation_error=operation_error)
            if deferred is not None:
                raise deferred from None
            raise
    except _BrowserReadCleanupPending:
        raise
    except BaseException:
        if isinstance(operation_error, (KeyboardInterrupt, SystemExit)):
            raise operation_error
        raise


def process_next_job(queue: BrowserJobQueue, *, allow_engagement: bool = True) -> bool:
    """Claim only after browser ownership; a waiting digest can overtake any like."""
    if queue.get_setting("paused", False):
        return False
    with open(BROWSER_LOCK_PATH, "a+") as browser_lock:
        try:
            fcntl.flock(browser_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        try:
            next_engagement = queue.get_setting("next_engagement_at", 0)
            job = queue.claim_next(
                allow_engagement=allow_engagement and time.time() >= next_engagement
            )
            if job is None:
                return False
            queue.record_diagnostic("running", job)
            if queue.storage_unavailable:
                return False
            companions = queue.claim_companions(
                job,
                limit=max(0, CONTROL.parallel_tabs - 2),
                allow_engagement=allow_engagement,
            )
            if companions or job.kind in {"retrieval", "digest"}:
                _process_batch(queue, [job, *companions], allow_engagement=allow_engagement)
                return True
            try:
                with job_deadline():
                    pool = BrowserTabPool(queue)
                    try:
                        pool.settle_registered_tabs()
                    except _BrowserTabUnavailable:
                        pool.ensure_capacity()
                        pool.settle_registered_tabs()
                    ids = queue.get_setting("browser_tab_ids", [])
                    result = (
                        execute_job(
                            job,
                            session=BrowserInstagramSession(
                                javascript_runner=_PinnedBraveJavascriptRunner(
                                    ids[0], window_id=queue.get_setting("browser_window_id")
                                )
                            ),
                        )
                        if ids
                        else execute_job(job)
                    )
                queue.finish(job.id, result=result)
            except BrowserRateLimited as exc:
                queue.defer_for_rate_limit(job, str(exc))
                queue.finish(job.id, error=str(exc))
            except (BrowserSessionError, TimeoutError) as exc:
                if _requires_human_recovery(exc):
                    queue.set_setting("paused", str(exc))
                queue.finish(job.id, error=str(exc))
            except (KeyboardInterrupt, SystemExit):
                queue.set_setting(
                    "paused", "Worker interrupted; inspect browser state before resuming"
                )
                queue.finish(job.id, error="Worker stopped during job; inspect before retrying")
                raise
            except sqlite3.Error:
                queue.storage_unavailable = True
                if job.kind == "engagement" and not job.payload.get("dry_run"):
                    try:
                        queue.set_setting(
                            "paused",
                            "Engagement completion could not be stored; inspect browser state before resuming",
                        )
                    except sqlite3.Error:
                        pass  # set_setting retains this safety hold until storage returns.
                log.warning("Browser job %s is waiting for queue storage", job.id)
                raise
            except Exception as exc:
                # Never persist raw library exceptions that may include request credentials.
                error = _storage_failure_reason(exc) or (
                    f"Browser job failed ({type(exc).__name__}); inspect before retrying"
                )
                log.error("Browser job %s failed: %s", job.id, error)
                queue.set_setting("paused", error)
                queue.finish(job.id, error=error)
            finally:
                completed = queue.get(job.id)
                if completed:
                    queue.record_diagnostic(completed.state, completed)
                if job.kind == "engagement" and not job.payload.get("dry_run"):
                    queue.set_setting(
                        "next_engagement_at", time.time() + CONTROL.engagement_interval_seconds
                    )
            return True
        finally:
            fcntl.flock(browser_lock, fcntl.LOCK_UN)


def _process_batch(
    queue: BrowserJobQueue, jobs: list[BrowserJob], *, allow_engagement: bool = True
) -> None:
    """Drain the bounded tab batch before releasing ownership or switching accounts."""
    unfinished = {job.id for job in jobs}
    pool_changed = threading.Event()
    pool_retries: list[tuple[BrowserJob, str]] = []
    cleanup_pending: dict[
        str, tuple[BrowserJob, BrowserInstagramSession, _BrowserReadCleanupPending]
    ] = {}
    cleanup_lock = threading.Lock()
    rate_limit_deferred: set[str] = set()
    interruption: BaseException | None = None
    storage_error: sqlite3.Error | None = None
    futures: dict = {}

    def defer_storage(error):
        nonlocal storage_error
        if storage_error is None:
            log.warning("Browser batch waiting for storage: %s", _storage_failure_reason(error))
        storage_error = storage_error or error
        queue.storage_unavailable = True
        pool_changed.set()

    def persist(operation, *args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except sqlite3.Error as exc:
            defer_storage(exc)
            return None

    def defer_rate_limit(job, error):
        # Announce the hold before failed-operation cleanup can block healthy completions.
        pool_changed.set()
        with cleanup_lock:
            if job.id not in rate_limit_deferred:
                persist(queue.defer_for_rate_limit, job, str(error))
                rate_limit_deferred.add(job.id)

    def execute(job, session, username):
        reset_deadline = getattr(session, "reset_job_deadline", None)
        if reset_deadline is not None:
            reset_deadline(CONTROL.job_timeout_seconds)

        def ready():
            path = session.current_page_path(check_response=True)
            active_username = session.current_account_username()
            if active_username is None or path.startswith("/accounts/"):
                return False
            if active_username != username:
                time.sleep(CONTROL.account_transition_grace_seconds)
                confirmed = session.current_account_username()
                if confirmed is None or confirmed == username:
                    return False
                pool_changed.set()
                raise BrowserAccountChanged(
                    f"Instagram browser account changed during parallel work: "
                    f"expected {username}, found {confirmed}"
                )
            return True

        try:
            if job.kind != "retrieval":
                try:
                    session.poll_until(ready)
                except BaseException as exc:
                    if isinstance(exc, BrowserRateLimited):
                        defer_rate_limit(job, exc)
                    _settle_job(job, session, operation_error=exc)
                    raise
            # Successful operations settle themselves; execute_job covers every failed exit.
            result = execute_job(
                job, session=session, on_rate_limit=lambda error: defer_rate_limit(job, error)
            )
            if job.kind == "retrieval" and (
                not isinstance(result, dict) or result.get("account_username") != username
            ):
                raise BrowserAccountChanged(
                    "Instagram retrieval account does not match the verified primary account"
                )
            return result
        except _BrowserReadCleanupPending as exc:
            with cleanup_lock:
                cleanup_pending[job.id] = (job, session, exc)
            pool_changed.set()
            if isinstance(exc.operation_error, BrowserRateLimited):
                defer_rate_limit(job, exc.operation_error)
            raise
        except (BrowserAccountChanged, _BrowserTabUnavailable, BrowserRateLimited):
            pool_changed.set()
            raise

    def failed(job, exc):
        if isinstance(exc, sqlite3.Error):
            defer_storage(exc)
            return
        if isinstance(exc, BrowserRateLimited):
            defer_rate_limit(job, exc)
        if isinstance(exc, (BrowserAccountChanged, _BrowserTabUnavailable)):
            pool_changed.set()
            persist(queue.set_setting, "retrieval_pool_account", None)
        if isinstance(exc, (BrowserSessionError, TimeoutError)):
            error = str(exc)
            if _requires_human_recovery(exc):
                persist(queue.set_setting, "paused", error)
        else:
            error = _storage_failure_reason(exc) or (
                f"Browser job failed ({type(exc).__name__}); inspect before retrying"
            )
            log.error("Browser job %s failed: %s", job.id, error)
            persist(queue.set_setting, "paused", error)
        retryable = (
            job.kind in {"digest", "retrieval"}
            and (
                isinstance(exc, BrowserRateLimited) or job.attempts < CONTROL.ingestion_retry_limit
            )
            and (
                isinstance(exc, BrowserRateLimited)
                or not persist(queue.get_setting, "paused", False)
            )
            and (
                isinstance(
                    exc,
                    (
                        BrowserAccountChanged,
                        BrowserRateLimited,
                        _BrowserAutomationTransient,
                        _BrowserPageUnavailable,
                        _BrowserTabUnavailable,
                        TimeoutError,
                    ),
                )
            )
        )
        if isinstance(exc, (BrowserAccountChanged, _BrowserTabUnavailable)) and retryable:
            # Keep the caller waiting until all requests have settled.
            pool_retries.append((job, error))
        else:
            persist(
                queue.finish,
                job.id,
                error=error,
                requeue=retryable,
                rate_limited_claim=job
                if retryable and isinstance(exc, BrowserRateLimited)
                else None,
            )
        unfinished.discard(job.id)

    try:
        with job_deadline():
            sessions, username = BrowserTabPool(queue).prepare(
                jobs[0], CONTROL.parallel_tabs if jobs[0].kind == "retrieval" else len(jobs)
            )
        # Keep slots busy until the queue empties, a digest arrives, or work is paused.
        with ThreadPoolExecutor(max_workers=len(sessions)) as executor:
            idle_sessions = sessions[len(jobs) :]
            futures = {
                executor.submit(execute, job, session, username): (job, session)
                for job, session in zip(jobs, sessions[: len(jobs)], strict=True)
            }
            while futures:
                if jobs[0].kind == "retrieval":
                    while idle_sessions and not pool_changed.is_set():
                        replacements = queue.claim_companions(
                            jobs[0], limit=1, allow_engagement=allow_engagement
                        )
                        if not replacements:
                            break
                        replacement = replacements[0]
                        session = idle_sessions.pop()
                        jobs.append(replacement)
                        unfinished.add(replacement.id)
                        queue.record_diagnostic("running", replacement)
                        if queue.storage_unavailable:
                            pool_changed.set()
                            break
                        futures[executor.submit(execute, replacement, session, username)] = (
                            replacement,
                            session,
                        )
                completed, _ = wait(futures, timeout=1, return_when=FIRST_COMPLETED)
                for future in completed:
                    job, session = futures.pop(future)
                    try:
                        queue.finish(job.id, result=future.result())
                        unfinished.discard(job.id)
                    except _BrowserReadCleanupPending:
                        persist(queue.set_setting, "retrieval_pool_account", None)
                        unfinished.discard(job.id)
                    except Exception as exc:
                        failed(job, exc)
                    finished = persist(queue.get, job.id)
                    if finished and finished.state != "running":
                        queue.record_diagnostic(finished.state, finished)
                    if jobs[0].kind != "retrieval" or pool_changed.is_set():
                        continue
                    replacements = queue.claim_companions(
                        jobs[0], limit=1, allow_engagement=allow_engagement
                    )
                    if not replacements:
                        idle_sessions.append(session)
                        continue
                    replacement = replacements[0]
                    jobs.append(replacement)
                    unfinished.add(replacement.id)
                    queue.record_diagnostic("running", replacement)
                    if queue.storage_unavailable:
                        pool_changed.set()
                        continue
                    futures[executor.submit(execute, replacement, session, username)] = (
                        replacement,
                        session,
                    )
    except (KeyboardInterrupt, SystemExit) as exc:
        interruption = exc
        persist(
            queue.set_setting,
            "paused",
            "Worker interrupted; inspect browser state before resuming",
        )
        for job in jobs:
            if job.id in unfinished and job.id not in cleanup_pending:
                persist(
                    queue.finish,
                    job.id,
                    error="Worker stopped during job; inspect before retrying",
                )
    except sqlite3.Error as exc:
        defer_storage(exc)
    except Exception as exc:
        for job in jobs:
            if job.id in unfinished and job.id not in cleanup_pending:
                failed(job, exc)

    finally:
        # Exiting the executor drains every active tab. Observe failures that a
        # queue write interrupted, so auth and cancellation holds are never lost.
        for future, (job, _session) in futures.items():
            try:
                result = future.result()
            except _BrowserReadCleanupPending:
                continue
            except Exception as exc:
                failed(job, exc)
            except (KeyboardInterrupt, SystemExit) as exc:
                interruption = interruption or exc
            else:
                persist(queue.finish, job.id, result=result)
        # Every future and its cancellation has settled before any retry can switch accounts.
        for job, session, pending in cleanup_pending.values():
            recovered_error: BaseException | None = None
            for _ in range(CONTROL.bridge_retry_limit):
                try:
                    try:
                        session.cancel_pending_request()
                    except BrowserSessionError as cleanup_error:
                        try:
                            session.retire_unresponsive_read_tab()
                        except Exception:
                            recovered_error = cleanup_error
                        else:
                            recovered_error = pending.operation_error or _BrowserTabUnavailable(
                                "The unresponsive secondary Instagram tab was closed"
                            )
                    else:
                        recovered_error = pending.operation_error or _BrowserPageUnavailable(
                            "Secondary read cleanup recovered after draining active jobs"
                        )
                    break
                except (KeyboardInterrupt, SystemExit) as exc:
                    interruption = interruption or exc
                    persist(
                        queue.set_setting,
                        "paused",
                        "Worker interrupted; inspect browser state before resuming",
                    )
                except Exception as cleanup_error:
                    recovered_error = cleanup_error
                    break
            if recovered_error is None:
                recovered_error = BrowserSessionError(
                    "Instagram browser request cancellation could not be confirmed after interruption"
                )
            if isinstance(recovered_error, (KeyboardInterrupt, SystemExit)):
                interruption = interruption or recovered_error
                persist(
                    queue.set_setting,
                    "paused",
                    "Worker interrupted; inspect browser state before resuming",
                )
                recovered_error = BrowserSessionError(
                    "Worker stopped during job; inspect before retrying"
                )
            failed(job, recovered_error)
            finished = persist(queue.get, job.id)
            if finished and finished.state != "running":
                queue.record_diagnostic(finished.state, finished)
        for job, error in pool_retries:
            persist(
                queue.finish,
                job.id,
                error=error,
                requeue=not persist(queue.get_setting, "paused", False),
            )
            finished = persist(queue.get, job.id)
            if finished:
                queue.record_diagnostic(finished.state, finished)
        if interruption is not None:
            raise interruption
        if storage_error is not None:
            raise storage_error


def maintain_tab_pool(queue: BrowserJobQueue) -> None:
    """Restore the configured idle tab count without changing an account or pause."""
    if queue.get_setting("paused", False) or queue.is_rate_limited():
        return
    with open(BROWSER_LOCK_PATH, "a+") as browser_lock:
        try:
            fcntl.flock(browser_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            if not queue.get_setting("paused", False) and not queue.is_rate_limited():
                BrowserTabPool(queue).ensure_capacity()
        except BrowserRateLimited as exc:
            queue.defer_for_rate_limit(None, str(exc))
        except (TimeoutError, _BrowserAutomationTransient):
            log.warning(
                "Tab maintenance deferred: browser bridge or account identity is temporarily unavailable"
            )
        except BrowserSessionError as exc:
            queue.set_setting("paused", str(exc))
        except sqlite3.Error:
            queue.storage_unavailable = True
            raise
        except Exception as exc:
            error = _storage_failure_reason(exc) or (
                f"Worker tab maintenance failed ({type(exc).__name__}); inspect before retrying"
            )
            log.error("%s", error)
            queue.set_setting(
                "paused",
                error,
            )


def _poll_source(
    queue: BrowserJobQueue,
    status_key: str,
    collect: Callable[[], object],
    stopping: threading.Event,
) -> None:
    """Each source progresses independently of another source's HTTP calls."""
    while not stopping.is_set():
        try:
            collect()
        except Exception as exc:
            error = _storage_failure_reason(exc) or type(exc).__name__
            try:
                queue.set_setting(status_key, {"checked_at": time.time(), "error": error})
            except Exception as storage_error:
                log.error(
                    "Could not record browser source collection failure: %s",
                    _storage_failure_reason(storage_error) or type(storage_error).__name__,
                )
            log.error("Browser source %s failed (%s)", status_key, error)
        stopping.wait(CONTROL.source_poll_interval_seconds)


def _source_pollers(queue: BrowserJobQueue, stopping: threading.Event) -> list[threading.Thread]:
    from services.instagram_notifications.carousel_engagement import sync_published_carousels
    from services.instagram_notifications.notification_ingestion import sync_notification_media

    def collect_carousels() -> None:
        result = sync_published_carousels(queue)
        queue.set_setting("source_status", {"checked_at": time.time(), "result": result})

    sources = (
        ("notification_source_status", lambda: sync_notification_media(queue)),
        ("diagnostics_status", lambda: queue.publish_diagnostics(should_stop=stopping.is_set)),
        ("source_status", collect_carousels),
    )
    return [
        threading.Thread(
            target=_poll_source,
            args=(queue, status_key, collect, stopping),
            name=f"instagram-browser-{status_key}",
            daemon=True,
        )
        for status_key, collect in sources
    ]


def _keep_worker_alive(queue: BrowserJobQueue, stopping: threading.Event) -> None:
    """Browser preparation and source HTTP calls cannot delay worker liveness."""
    while not stopping.wait(CONTROL.worker_poll_interval_seconds):
        try:
            queue.set_setting("worker", {"running": True, "heartbeat": time.time()})
        except Exception as exc:
            log.error(
                "Could not refresh browser worker heartbeat (%s)",
                _storage_failure_reason(exc) or type(exc).__name__,
            )


def _recover_worker_queue(queue: BrowserJobQueue) -> None:
    """Prove tab settlement and durable storage before any interrupted read can retry."""
    with open(BROWSER_LOCK_PATH, "a+") as browser_lock:
        fcntl.flock(browser_lock, fcntl.LOCK_EX)
        try:
            BrowserTabPool(queue).settle_registered_tabs()
        except _BrowserTabUnavailable:
            log.warning("Retired unavailable secondary tabs before worker recovery")
        except BrowserSessionError as exc:
            queue.set_setting("paused", str(exc))
        queue.recover_interrupted()


def run_worker(queue: BrowserJobQueue, *, once: bool = False, collect: bool = True) -> None:
    """Run the singleton; once processes existing queue work without collecting."""
    with (queue.state_directory / "worker.lock").open("a+") as worker_lock:
        try:
            fcntl.flock(worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Instagram browser worker is already running") from None
        stopping = threading.Event()
        collectors: list[threading.Thread] = []
        heartbeat: threading.Thread | None = None
        previous_term = signal.signal(
            signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt())
        )
        try:
            heartbeat = threading.Thread(
                target=_keep_worker_alive,
                args=(queue, stopping),
                name="instagram-browser-heartbeat",
                daemon=True,
            )
            heartbeat.start()
            next_tab_check = 0.0
            needs_recovery = True
            while True:
                try:
                    if needs_recovery or queue.storage_unavailable:
                        queue.set_setting("worker", {"running": True, "heartbeat": time.time()})
                        _recover_worker_queue(queue)
                        needs_recovery = False
                        if collect and not once and not collectors:
                            collectors = _source_pollers(queue, stopping)
                            for collector in collectors:
                                collector.start()
                    if time.monotonic() >= next_tab_check:
                        maintain_tab_pool(queue)
                        next_tab_check = time.monotonic() + CONTROL.tab_health_interval_seconds
                    worked = process_next_job(queue)
                except sqlite3.Error as exc:
                    # Storage pressure is an admission hold, never an auth pause.
                    # Existing engagements recover as uncertain and require inspection.
                    needs_recovery = True
                    queue.storage_unavailable = True
                    log.warning(
                        "Browser worker waiting for storage: %s", _storage_failure_reason(exc)
                    )
                    if once:
                        raise
                    stopping.wait(CONTROL.storage_retry_interval_seconds)
                    continue
                if once:
                    break
                if not worked:
                    stopping.wait(CONTROL.worker_poll_interval_seconds)
        except KeyboardInterrupt:
            pass
        finally:
            stopping.set()
            try:
                shutdown_deadline = time.monotonic() + CONTROL.request_timeout_seconds
                for thread in [heartbeat, *collectors]:
                    if thread is not None and thread.ident is not None:
                        thread.join(timeout=max(0, shutdown_deadline - time.monotonic()))
                try:
                    queue.set_setting("worker", {"running": False, "heartbeat": time.time()})
                except sqlite3.Error as exc:
                    log.warning(
                        "Could not record browser worker shutdown: %s", _storage_failure_reason(exc)
                    )
            finally:
                signal.signal(signal.SIGTERM, previous_term)
