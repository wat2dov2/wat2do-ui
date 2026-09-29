"""Single browser executor with bounded jobs and independent carousel polling."""

from __future__ import annotations

import fcntl
import logging
import signal
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict
from typing import Iterator

from services.instagram_notifications.browser_digest import BrowserInstagramDigestResolver
from services.instagram_notifications.browser_engagement import BrowserInstagramEngagementExecutor
from services.instagram_notifications.browser_queue import CONTROL, BrowserJob, BrowserJobQueue
from services.instagram_notifications.browser_session import (
    BrowserInstagramSession,
    BrowserSessionError,
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


def execute_job(job: BrowserJob) -> dict:
    session = BrowserInstagramSession()
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
        executor = BrowserInstagramEngagementExecutor(session=session)
        operation = executor.inspect if job.payload.get("dry_run") else executor.execute
        return operation(
            job.recipient_id,
            job.account_username,
            job.payload["post_url"],
            job.payload["action"],
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
            try:
                with job_deadline():
                    result = execute_job(job)
                queue.finish(job.id, result=result)
            except (BrowserSessionError, TimeoutError) as exc:
                if "cancellation could not be confirmed" in str(exc):
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
                if job.kind == "engagement" and not job.payload.get("dry_run"):
                    queue.set_setting(
                        "next_engagement_at", time.time() + CONTROL.engagement_interval_seconds
                    )
            return True
        finally:
            fcntl.flock(browser_lock, fcntl.LOCK_UN)


def _collect_carousels(queue: BrowserJobQueue, stopping: threading.Event) -> None:
    from services.instagram_notifications.carousel_engagement import sync_published_carousels

    while not stopping.is_set():
        try:
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
                queue.recover_interrupted()
            if collect and not once:
                collector = threading.Thread(
                    target=_collect_carousels,
                    args=(queue, stopping),
                    daemon=True,
                )
                collector.start()
            while True:
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
