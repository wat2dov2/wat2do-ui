"""Forward Instagram's notifications from the Mac's emulator to the notification workflow.

The school accounts are active in the Instagram app on the Mac's Android emulator, so
Instagram pushes their notifications there. The forwarder listens on the device through
``NotificationReader``, which prints only the push categories in
``controlbox/notification_forwarding.json`` (posts and daily digests, never a direct
message), and sends each new one as the ``new_instagram_post`` repository dispatch the
phones' Automate flow used to send, which starts the ``process-notification`` workflow.

A stopped Android user gets no pushes, and Android stops one whenever the worker switches
users, since it keeps at most three running. The forwarder starts such a user again once
it has stayed stopped a while, one at a time and only while the emulator is calm, since
starting users on a busy emulator froze Android; Instagram then delivers what it held.

A notification is sent once per intended recipient and push ID. One that cannot be sent
waits on disk and is tried again, oldest first, after a pause that doubles while sending
keeps failing, so a GitHub or network outage loses nothing. The forwarder never taps the
emulator and never holds its lock: when the worker restarts the emulator, the reader
stops with it, and the forwarder takes what it printed last, waits for the boot and
listens again. Logs name push categories, recipients and counts, never a notification's
text.
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
# The Android users holding school accounts that Android can stop; the system user, 0,
# always runs.
_STOPPABLE_USERS = sorted(set(EMULATOR.android_user_by_school.values()) - {0})


class DispatchError(RuntimeError):
    """The dispatch did not reach GitHub, or GitHub did not take it this time."""


class DispatchRefused(DispatchError):
    """GitHub answered 422: it refused the payload, or took a burst of dispatches for spam."""


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
        state = _load(path) if path is not None else _EMPTY
        self._handled: dict[str, float] = dict(state["handled"])
        # Oldest first.
        self._waiting: list[dict[str, Any]] = list(state["waiting"])

    def __len__(self) -> int:
        return len(self._waiting)

    def add(self, notification: Notification) -> bool:
        """Queue a notification seen for the first time; False when it was seen before."""
        key = _key(notification)
        if key in self._handled or any(item["key"] == key for item in self._waiting):
            return False
        self._waiting.append({"key": key, "extras": notification.extras, "refusals": 0})
        self._save()
        return True

    def waiting(self) -> list[Notification]:
        return [Notification(item["extras"]) for item in self._waiting]

    def refused(self, notification: Notification) -> int:
        """Count a refusal of a waiting notification; returns how many it has had."""
        key = _key(notification)
        refusals = 0
        for item in self._waiting:
            if item["key"] == key:
                item["refusals"] += 1
                refusals = item["refusals"]
        self._save()
        return refusals

    def handled(self, notification: Notification) -> None:
        """Take a notification off the queue for good: it was sent, or never can be."""
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
        state = {"handled": self._handled, "waiting": self._waiting}
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            atomic_write(self._path, json.dumps(state, sort_keys=True).encode())
        except OSError as exc:
            # A full disk: the queue stays in memory, and the next change saves it again.
            log.error("Could not save the forwarder's state (%s)", exc.strerror or exc)


_EMPTY: dict[str, Any] = {"handled": {}, "waiting": []}


def _key(notification: Notification) -> str:
    return f"{notification.recipient_id}:{notification.push_id}"


def _load(path: Path) -> dict[str, Any]:
    """The saved state, or an empty one. A state that cannot be read is moved aside, so
    the forwarder starts afresh instead of failing every time it starts."""
    try:
        state = json.loads(path.read_text())
    except FileNotFoundError:
        return _EMPTY
    except (OSError, ValueError):
        state = None
    if _readable(state):
        return state
    aside = path.with_name(f"{path.name}.unreadable-{int(time.time())}")
    try:
        path.replace(aside)
    except OSError as exc:
        log.error("Could not move the forwarder's unreadable state aside (%s)", exc.strerror)
    else:
        log.warning("The forwarder's state was unreadable; moved it to %s", aside.name)
    return _EMPTY


def _readable(state: Any) -> bool:
    return (
        isinstance(state, dict)
        and isinstance(state.get("handled"), dict)
        and all(isinstance(at, int | float) for at in state["handled"].values())
        and isinstance(state.get("waiting"), list)
        and all(
            isinstance(item, dict)
            and isinstance(item.get("key"), str)
            and isinstance(item.get("extras"), dict)
            and isinstance(item.get("refusals"), int)
            for item in state["waiting"]
        )
    )


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
        self._foreground: int | None = None
        self._foreground_since = 0.0
        self._stopped_since: dict[int, float] = {}
        self._sent_at: float | None = None
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
        """Listen for ``check_seconds``, or wait that long for the emulator, then send
        what waits."""
        if self._listening():
            if not self._dry_run:
                self._keep_users_running()
            for notification in self._reader.notifications(CONTROL.check_seconds):
                self._receive(notification)
        else:
            self._sleep(CONTROL.check_seconds)
        self._send_waiting()

    def _listening(self) -> bool:
        """Whether the reader runs, starting it once the emulator has booted.

        A reader that ended, as it does when the emulator restarts, may have printed a
        notification just before, so what it printed is taken first.
        """
        if self._reader.running:
            return True
        try:
            for notification in self._reader.notifications(CONTROL.check_seconds):
                self._receive(notification)
        except NotificationReaderError:
            pass
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
        """Start one Android user holding school accounts that has stayed stopped.

        Android keeps at most three users running and stops the least recently used one in
        the background whenever the worker switches users; a stopped user gets no pushes
        until it runs again, when Instagram delivers what it held. Starting users on a busy
        emulator froze Android, so a user starts again only once it has been stopped
        ``restart_after_stopped_minutes``, at most one per check, after the emulator has
        been up ``boot_settle_seconds``, while the foreground user has stayed the same for
        ``quiet_foreground_seconds`` and the emulator's load and free memory are in bounds.
        """
        now = self._monotonic()
        try:
            current = self._device.current_user()
        except EmulatorError as exc:
            log.warning("Could not read the foreground Android user (%s)", exc)
            return
        if current != self._foreground:
            self._foreground, self._foreground_since = current, now
        for user in _STOPPABLE_USERS:
            try:
                stopped = user != current and not self._device.user_running(user)
            except EmulatorError as exc:
                log.warning("Could not read Android user %d's state (%s)", user, exc)
                continue
            if stopped:
                self._stopped_since.setdefault(user, now)
            else:
                self._stopped_since.pop(user, None)
        due = [
            user
            for user, since in self._stopped_since.items()
            if now - since >= CONTROL.restart_after_stopped_minutes * 60
        ]
        if not due or now - self._foreground_since < CONTROL.quiet_foreground_seconds:
            return
        try:
            if not self._settled:
                self._settled = self._device.uptime_seconds() >= CONTROL.boot_settle_seconds
            if not self._settled:
                return
            load, available = self._device.load()
        except EmulatorError as exc:
            log.warning("Could not read the emulator's load (%s)", exc)
            return
        if load > CONTROL.max_load_average or available < CONTROL.min_available_megabytes:
            return
        user = min(due, key=self._stopped_since.__getitem__)
        stopped_minutes = (now - self._stopped_since[user]) / 60
        try:
            self._device.start_user(user)
        except EmulatorError as exc:
            # It waits its turn again, so another stopped user goes first.
            self._stopped_since[user] = now
            log.warning(
                "Android user %d, stopped %.0f min, did not start (%s)", user, stopped_minutes, exc
            )
            return
        del self._stopped_since[user]
        log.info(
            "Started Android user %d, stopped %.0f min, in %.1f s",
            user,
            stopped_minutes,
            self._monotonic() - now,
        )

    def _receive(self, notification: Notification) -> None:
        if notification.category not in CONTROL.push_categories:
            # The reader prints only these, so this is a fault; whatever it printed, a
            # direct message above all, goes no further, and nothing of it is logged.
            log.warning("Dropped a notification in a category that is not forwarded")
            return
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
        """Send what waits, oldest first, dispatches ``send_spacing_seconds`` apart.

        A failed dispatch ends the pass, and sending waits a pause that doubles while
        failures go on. GitHub answers 422 both to a payload it refuses and to a burst it
        takes for spam, so a notification is dropped only once refused on
        ``refusals_before_drop`` separate passes.
        """
        if self._dry_run or self._monotonic() < self._retry_at:
            return
        for notification in self._outbox.waiting():
            self._space_out()
            try:
                self._send(notification)
            except DispatchError as exc:
                self._pause_after(notification, exc)
                return
            self._outbox.handled(notification)
            self._retry_seconds = 0
            log.info(
                "Forwarded a %s notification for %s (%d waiting)",
                notification.category,
                notification.recipient_id,
                len(self._outbox),
            )

    def _space_out(self) -> None:
        if self._sent_at is not None:
            wait = self._sent_at + CONTROL.send_spacing_seconds - self._monotonic()
            if wait > 0:
                self._sleep(wait)
        self._sent_at = self._monotonic()

    def _pause_after(self, notification: Notification, exc: DispatchError) -> None:
        self._retry_seconds = min(
            max(self._retry_seconds * 2, CONTROL.retry_first_seconds),
            CONTROL.retry_longest_seconds,
        )
        self._retry_at = self._monotonic() + self._retry_seconds
        refusals = self._outbox.refused(notification) if isinstance(exc, DispatchRefused) else 0
        if refusals >= CONTROL.refusals_before_drop:
            self._outbox.handled(notification)
            log.error(
                "GitHub refused a %s notification for %s %d times; dropped it",
                notification.category,
                notification.recipient_id,
                refusals,
            )
            return
        log.warning(
            "Could not forward a %s notification for %s (%s); %d waiting, trying again in %d s",
            notification.category,
            notification.recipient_id,
            exc,
            len(self._outbox),
            self._retry_seconds,
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
