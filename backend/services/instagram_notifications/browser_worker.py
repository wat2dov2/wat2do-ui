"""Single browser executor with bounded jobs and independent carousel polling."""

from __future__ import annotations

import fcntl
import logging
import signal
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import asdict
from typing import Iterator

from services.instagram_notifications.browser_digest import BrowserInstagramDigestResolver
from services.instagram_notifications.browser_engagement import BrowserInstagramEngagementExecutor
from services.instagram_notifications.browser_queue import CONTROL, BrowserJob, BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserInstagramSession,
    BrowserSessionError,
    BrowserTabPool,
    _PinnedBraveJavascriptRunner,
)

log = logging.getLogger(__name__)
# The old notification workflows use this same lock until their code is deployed.
BROWSER_LOCK_PATH = "/tmp/wat2do_instagram_browser.lock"


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


def execute_job(job: BrowserJob, *, session: BrowserInstagramSession | None = None) -> dict:
    session = session or BrowserInstagramSession()
    interruption: BaseException | None = None
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
    except (KeyboardInterrupt, SystemExit) as exc:
        interruption = exc
        raise
    finally:
        # Cover every exit, including interruption during navigation or after a click.
        # Cleanup uses the exact same pinned tab as the operation it is settling.
        try:
            session.cancel_pending_request()
        except BaseException:
            if interruption is not None:
                raise interruption
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
            companions = queue.claim_companions(job, limit=CONTROL.parallel_tabs - 1)
            if companions or job.kind == "retrieval":
                _process_batch(queue, [job, *companions])
                return True
            try:
                with job_deadline():
                    ids = queue.get_setting("browser_tab_ids", [])
                    for tab_id in ids:
                        BrowserInstagramSession(
                            javascript_runner=_PinnedBraveJavascriptRunner(tab_id)
                        ).cancel_pending_request()
                    result = (
                        execute_job(
                            job,
                            session=BrowserInstagramSession(
                                javascript_runner=_PinnedBraveJavascriptRunner(ids[0])
                            ),
                        )
                        if ids
                        else execute_job(job)
                    )
                queue.finish(job.id, result=result)
            except (BrowserSessionError, TimeoutError) as exc:
                if any(
                    reason in str(exc)
                    for reason in (
                        "cancellation could not be confirmed",
                        "human account recovery",
                        "human reauthorization",
                    )
                ):
                    queue.set_setting("paused", str(exc))
                queue.finish(job.id, error=str(exc))
            except (KeyboardInterrupt, SystemExit):
                queue.set_setting(
                    "paused", "Worker interrupted; inspect browser state before resuming"
                )
                queue.finish(job.id, error="Worker stopped during job; inspect before retrying")
                raise
            except Exception as exc:
                # Never persist raw library exceptions that may include request credentials.
                error = f"Browser job failed ({type(exc).__name__}); inspect before retrying"
                queue.set_setting("paused", error)
                queue.finish(job.id, error=error)
                log.error("Browser job %s failed (%s)", job.id, type(exc).__name__)
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


def _process_batch(queue: BrowserJobQueue, jobs: list[BrowserJob]) -> None:
    """Drain the bounded tab batch before releasing ownership or switching accounts."""
    unfinished = {job.id for job in jobs}

    def execute(job, session, username):
        reset_deadline = getattr(session, "reset_job_deadline", None)
        if reset_deadline is not None:
            reset_deadline(CONTROL.job_timeout_seconds)

        def ready():
            path = session.run("window.location.pathname")
            if path.startswith(("/accounts/suspended", "/challenge", "/checkpoint")):
                raise BrowserSessionError("Instagram browser requires human account recovery")
            if path.startswith("/accounts/login"):
                # Recheck after the redirect settles before pausing the shared session.
                time.sleep(2)
                if not session.run("window.location.pathname").startswith("/accounts/login"):
                    return False
                raise BrowserSessionError("Instagram browser requires human account recovery")
            active_username = session.current_account_username()
            if active_username is None or path.startswith("/accounts/"):
                return False
            if active_username != username:
                time.sleep(2)
                confirmed = session.current_account_username()
                if confirmed is None or confirmed == username:
                    return False
                raise BrowserSessionError("Instagram browser account changed during parallel work")
            return True

        try:
            session.poll_until(ready)
            return execute_job(job, session=session)
        finally:
            session.cancel_pending_request()

    def failed(job, exc):
        if isinstance(exc, (BrowserSessionError, TimeoutError)):
            error = str(exc)
            if any(
                reason in error
                for reason in (
                    "cancellation could not be confirmed",
                    "human account recovery",
                    "human reauthorization",
                    "account changed",
                )
            ):
                queue.set_setting("paused", error)
        else:
            error = f"Browser job failed ({type(exc).__name__}); inspect before retrying"
            queue.set_setting("paused", error)
        queue.finish(job.id, error=error)
        if (
            job.kind == "retrieval"
            and job.attempts < CONTROL.ingestion_retry_limit
            and not queue.get_setting("paused", False)
            and (
                isinstance(exc, TimeoutError)
                or error == "Instagram public media retrieval failed; inspect login or retry"
            )
        ):
            queue.retry(job.id)
        unfinished.discard(job.id)

    try:
        with job_deadline():
            sessions, username = BrowserTabPool(queue).prepare(
                jobs[0], CONTROL.parallel_tabs if jobs[0].kind == "retrieval" else len(jobs)
            )
        refill_until = time.monotonic() + CONTROL.job_timeout_seconds
        # Keep each completed slot busy while retaining digest priority and bounded ownership.
        with ThreadPoolExecutor(max_workers=len(sessions)) as executor:
            idle_sessions = sessions[len(jobs) :]
            futures = {
                executor.submit(execute, job, session, username): (job, session)
                for job, session in zip(jobs, sessions[: len(jobs)], strict=True)
            }
            while futures:
                if jobs[0].kind == "retrieval" and time.monotonic() < refill_until:
                    while idle_sessions:
                        replacements = queue.claim_companions(jobs[0], limit=1)
                        if not replacements:
                            break
                        replacement = replacements[0]
                        session = idle_sessions.pop()
                        jobs.append(replacement)
                        unfinished.add(replacement.id)
                        queue.record_diagnostic("running", replacement)
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
                    except Exception as exc:
                        failed(job, exc)
                    finished = queue.get(job.id)
                    if finished:
                        queue.record_diagnostic(finished.state, finished)
                    if jobs[0].kind != "retrieval" or time.monotonic() >= refill_until:
                        continue
                    replacements = queue.claim_companions(jobs[0], limit=1)
                    if not replacements:
                        idle_sessions.append(session)
                        continue
                    replacement = replacements[0]
                    jobs.append(replacement)
                    unfinished.add(replacement.id)
                    queue.record_diagnostic("running", replacement)
                    futures[executor.submit(execute, replacement, session, username)] = (
                        replacement,
                        session,
                    )
    except (KeyboardInterrupt, SystemExit):
        queue.set_setting("paused", "Worker interrupted; inspect browser state before resuming")
        for job in jobs:
            if job.id in unfinished:
                queue.finish(job.id, error="Worker stopped during job; inspect before retrying")
        raise
    except Exception as exc:
        for job in jobs:
            if job.id in unfinished:
                failed(job, exc)


def maintain_tab_pool(queue: BrowserJobQueue) -> None:
    """Restore the configured idle tab count without changing an account or pause."""
    if queue.get_setting("paused", False):
        return
    with open(BROWSER_LOCK_PATH, "a+") as browser_lock:
        try:
            fcntl.flock(browser_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            if not queue.get_setting("paused", False):
                BrowserTabPool(queue).ensure_capacity()
        except BrowserSessionError as exc:
            queue.set_setting("paused", str(exc))
        except Exception as exc:
            queue.set_setting(
                "paused",
                f"Worker tab maintenance failed ({type(exc).__name__}); inspect before retrying",
            )


def _collect_carousels(queue: BrowserJobQueue, stopping: threading.Event) -> None:
    from services.instagram_notifications.carousel_engagement import sync_published_carousels
    from services.instagram_notifications.notification_ingestion import sync_notification_media

    while not stopping.is_set():
        try:
            sync_notification_media(queue)
            queue.publish_diagnostics()
            result = sync_published_carousels(queue)
            queue.set_setting("source_status", {"checked_at": time.time(), "result": result})
        except Exception as exc:
            try:
                queue.set_setting(
                    "source_status",
                    {"checked_at": time.time(), "error": type(exc).__name__},
                )
            except Exception:
                log.error("Could not record carousel collection failure")
            log.error("Carousel collection failed (%s)", type(exc).__name__)
        stopping.wait(CONTROL.source_poll_interval_seconds)


def run_worker(queue: BrowserJobQueue, *, once: bool = False, collect: bool = True) -> None:
    """Run the singleton; once processes existing queue work without collecting."""
    with (queue.state_directory / "worker.lock").open("a+") as worker_lock:
        try:
            fcntl.flock(worker_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Instagram browser worker is already running") from None
        stopping = threading.Event()
        collector: threading.Thread | None = None
        previous_term = signal.signal(
            signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt())
        )
        try:
            with open(BROWSER_LOCK_PATH, "a+") as browser_lock:
                fcntl.flock(browser_lock, fcntl.LOCK_EX)
                for tab_id in queue.get_setting("browser_tab_ids", []):
                    try:
                        BrowserInstagramSession(
                            javascript_runner=_PinnedBraveJavascriptRunner(tab_id)
                        ).cancel_pending_request()
                    except BrowserSessionError as exc:
                        if "pinned Instagram tab was closed" not in str(exc):
                            queue.set_setting("paused", str(exc))
                queue.recover_interrupted()
            if collect and not once:
                collector = threading.Thread(
                    target=_collect_carousels,
                    args=(queue, stopping),
                    daemon=True,
                )
                collector.start()
            next_tab_check = 0.0
            while True:
                if time.monotonic() >= next_tab_check:
                    maintain_tab_pool(queue)
                    next_tab_check = time.monotonic() + CONTROL.tab_health_interval_seconds
                queue.set_setting("worker", {"running": True, "heartbeat": time.time()})
                worked = process_next_job(queue)
                if once:
                    break
                if not worked:
                    stopping.wait(CONTROL.worker_poll_interval_seconds)
        except KeyboardInterrupt:
            pass
        finally:
            stopping.set()
            try:
                if collector is not None:
                    collector.join(timeout=CONTROL.request_timeout_seconds)
                queue.set_setting("worker", {"running": False, "heartbeat": time.time()})
            finally:
                signal.signal(signal.SIGTERM, previous_term)
