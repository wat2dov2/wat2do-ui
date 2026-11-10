"""Forward Instagram's notifications from the Mac's emulator to the notification workflow.

The school accounts are active in the Instagram app on the Mac's Android emulator, so
Instagram pushes their notifications there. The forwarder keeps every Android user that
holds a school account running, since a stopped user gets no pushes and Android stops one
whenever the worker switches users, and listens on the device through
``NotificationReader``, which prints only the push categories in
``controlbox/notification_forwarding.json``: posts and daily digests, never a direct
message. Each new one becomes the ``new_instagram_post`` repository dispatch the phones'
Automate flow used to send, which starts the ``process-notification`` workflow.

A notification is sent once per intended recipient and push ID. One that cannot be sent
waits on disk and is tried again, oldest first, after a pause that doubles while sending
keeps failing, so a GitHub or network outage loses nothing. The forwarder never taps the
emulator and never holds its lock: when the worker restarts the emulator, the reader
stops with it, and the forwarder waits for the boot, then starts the reader and the users
again. Logs name push categories, recipients and counts, never a notification's text.
"""

from __future__ import annotations

import fcntl
import json
import logging
import re
import subprocess
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from core.controlbox import controlbox
from core.launch_agents import atomic_write
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, adb_path
from services.instagram_emulator.notification_reader import (
    Notification,
    NotificationReader,
    NotificationReaderError,
)

log = logging.getLogger(__name__)
CONTROL = controlbox.notification_forwarding
STATE_DIRECTORY = Path.home() / ".local/state/wat2do/notification-forwarding"
STATE_PATH = STATE_DIRECTORY / "state.json"
LOG_PATH = STATE_DIRECTORY / "forwarder.log"
_LOCK_PATH = STATE_DIRECTORY / "forwarder.lock"
# gh ends an API error with GitHub's status, as in "gh: Not Found (HTTP 404)".
_HTTP_STATUS = re.compile(r"\(HTTP (\d{3})\)")
# GitHub refuses a dispatch whose payload it cannot accept with this status.
_REFUSED = "422"
# The Android users holding school accounts, each of which must run to get its pushes.
_ACCOUNT_USERS = sorted(set(EMULATOR.android_user_by_school.values()))


class DispatchError(RuntimeError):
    """The dispatch did not reach GitHub, or GitHub did not take it this time."""


class DispatchRefused(DispatchError):
    """GitHub refused this notification's dispatch, so sending it again cannot help."""


def dispatch(notification: Notification) -> None:
    """Start the process-notification workflow for the notification, as the phones did.

    ``gh`` carries the Mac user's own GitHub login, so no token is kept here.
    """
    body = {
        "event_type": CONTROL.dispatch_event_type,
        "client_payload": {"notification_dict": notification.extras},
    }
    try:
        completed = subprocess.run(
            [
                "gh",
                "api",
                f"repos/{CONTROL.github_repo}/dispatches",
                "--method",
                "POST",
                "--input",
                "-",
            ],
            input=json.dumps(body),
            capture_output=True,
            text=True,
            timeout=CONTROL.dispatch_timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DispatchError(f"gh did not complete ({type(exc).__name__})") from exc
    if completed.returncode == 0:
        return
    status = _HTTP_STATUS.search(completed.stderr)
    if status is None:
        # GitHub never answered: gh, its login or the network failed. gh's own message
        # names which, and it never quotes the payload.
        lines = completed.stderr.strip().splitlines()
        raise DispatchError(lines[0][:200] if lines else f"gh exited {completed.returncode}")
    if status.group(1) == _REFUSED:
        raise DispatchRefused(f"HTTP {_REFUSED}")
    raise DispatchError(f"HTTP {status.group(1)}")


class Outbox:
    """Notifications waiting to be sent, and those handled lately, kept in ``path``.

    A notification counts once per intended recipient and push ID; a handled one is
    remembered for ``remember_days``. A dry run passes no path and keeps them in memory.
    """

    def __init__(self, path: Path | None, *, now: Callable[[], float] = time.time) -> None:
        self._path = path
        self._now = now
        state = _load(path) if path is not None else {}
        self._handled: dict[str, float] = state.get("handled", {})
        # Oldest first.
        self._waiting: list[dict[str, Any]] = state.get("waiting", [])

    def __len__(self) -> int:
        return len(self._waiting)

    def add(self, notification: Notification) -> bool:
        """Queue a notification seen for the first time; False when it was seen before."""
        key = _key(notification)
        if key in self._handled or any(item["key"] == key for item in self._waiting):
            return False
        self._waiting.append({"key": key, "extras": notification.extras})
        self._save()
        return True

    def waiting(self) -> list[Notification]:
        return [Notification(item["extras"]) for item in self._waiting]

    def handled(self, notification: Notification) -> None:
        """Take a notification off the queue for good: it was sent, or can never be."""
        key = _key(notification)
        now = self._now()
        horizon = now - CONTROL.remember_days * 86_400
        self._waiting = [item for item in self._waiting if item["key"] != key]
        self._handled = {seen: at for seen, at in self._handled.items() if at >= horizon}
        self._handled[key] = now
        self._save()

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        state = {"handled": self._handled, "waiting": self._waiting}
        atomic_write(self._path, json.dumps(state, sort_keys=True).encode())


def _key(notification: Notification) -> str:
    return f"{notification.recipient_id}:{notification.push_id}"


def _load(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}


class Forwarder:
    """Keeps the emulator's school accounts reachable and forwards their notifications.

    A dry run only listens: it prints what it would forward, starts no Android user and
    sends nothing.
    """

    def __init__(
        self,
        device: EmulatorDevice,
        reader: NotificationReader,
        outbox: Outbox,
        *,
        dry_run: bool = False,
        send: Callable[[Notification], None] = dispatch,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._device = device
        self._reader = reader
        self._outbox = outbox
        self._dry_run = dry_run
        self._send = send
        self._sleep = sleep
        self._monotonic = monotonic
        self._up: bool | None = None
        self._settled = False
        self._retry_at = 0.0
        self._retry_seconds = 0.0

    def run_forever(self) -> None:
        while True:
            try:
                self.step()
            except NotificationReaderError as exc:
                # Usually the emulator restarting, as the worker has it do every day; the
                # next step waits for it.
                log.info("%s; checking again in %d s", exc, CONTROL.check_seconds)
                self._sleep(CONTROL.check_seconds)
            except Exception:
                log.exception("The notification forwarder failed a step")
                self._reader.stop()
                self._sleep(CONTROL.check_seconds)

    def step(self) -> None:
        """Listen for ``check_seconds``, after starting the reader and any stopped user."""
        if not self._reader.running and not self._start_reader():
            self._sleep(CONTROL.check_seconds)
            return
        if not self._dry_run:
            self._keep_users_running()
        for notification in self._reader.notifications(CONTROL.check_seconds):
            self._receive(notification)
        self._send_waiting()

    def _start_reader(self) -> bool:
        """Start listening once the emulator has booted; False while it has not."""
        up = self._device.is_online() and self._device.booted()
        if up != self._up:
            log.info("The emulator is up" if up else "The emulator is down; waiting for it")
            self._up = up
        if not up:
            return False
        self._reader.start()
        self._settled = False
        log.info("Listening for Instagram notifications on the emulator")
        return True

    def _keep_users_running(self) -> None:
        """Start each Android user holding school accounts that is not running.

        Android keeps at most three users running and stops the least recently used one
        in the background whenever the worker switches users. A stopped user gets no
        pushes; Instagram delivers the ones it held once the user is up again. After a
        boot, the users wait until the emulator has been up ``boot_settle_seconds``.
        """
        try:
            if not self._settled:
                if self._device.uptime_seconds() < CONTROL.boot_settle_seconds:
                    return
                self._settled = True
            for user in _ACCOUNT_USERS:
                if not self._device.user_running(user):
                    started = self._monotonic()
                    self._device.start_user(user)
                    log.info("Started Android user %d in %.1f s", user, self._monotonic() - started)
        except EmulatorError as exc:
            log.warning("Could not start the stopped Android users (%s); trying again", exc)

    def _receive(self, notification: Notification) -> None:
        if not (notification.recipient_id and notification.push_id):
            # The workflow cannot route or record it.
            log.warning(
                "Skipped a %s notification with no recipient or push ID", notification.category
            )
            return
        if self._outbox.add(notification) and self._dry_run:
            print(
                f"Would forward {notification.category} for {notification.recipient_id} "
                f"({notification.push_id})",
                flush=True,
            )

    def _send_waiting(self) -> None:
        """Send what waits, oldest first; a failure pauses sending for a doubling pause."""
        if self._dry_run or self._monotonic() < self._retry_at:
            return
        for notification in self._outbox.waiting():
            try:
                self._send(notification)
            except DispatchRefused as exc:
                log.error(
                    "GitHub refused a %s notification for %s (%s); dropped it",
                    notification.category,
                    notification.recipient_id,
                    exc,
                )
            except DispatchError as exc:
                self._retry_seconds = min(
                    max(self._retry_seconds * 2, CONTROL.retry_first_seconds),
                    CONTROL.retry_longest_seconds,
                )
                self._retry_at = self._monotonic() + self._retry_seconds
                log.warning(
                    "Could not forward a %s notification for %s (%s); %d waiting, "
                    "trying again in %d s",
                    notification.category,
                    notification.recipient_id,
                    exc,
                    len(self._outbox),
                    self._retry_seconds,
                )
                return
            self._outbox.handled(notification)
            self._retry_seconds = 0
            log.info(
                "Forwarded a %s notification for %s (%d waiting)",
                notification.category,
                notification.recipient_id,
                len(self._outbox),
            )


def run_forever(*, dry_run: bool = False) -> None:
    with _only_forwarder():
        device = EmulatorDevice()
        reader = NotificationReader(
            adb_path(),
            EMULATOR.serial,
            device.adb,
            package=EMULATOR.instagram_package,
            categories=CONTROL.push_categories,
            timeout_seconds=EMULATOR.adb_timeout_seconds,
        )
        outbox = Outbox(None if dry_run else STATE_PATH)
        try:
            Forwarder(device, reader, outbox, dry_run=dry_run).run_forever()
        finally:
            reader.stop()


@contextmanager
def _only_forwarder() -> Iterator[None]:
    """Hold the forwarders' lock: two would send every notification twice, and each
    would end the other's reader on the device."""
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with _LOCK_PATH.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("Another notification forwarder is running") from exc
        yield
