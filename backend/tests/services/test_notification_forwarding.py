import json
import logging
import re
import subprocess
from pathlib import Path

import pytest

from services import notification_forwarding as module
from services.instagram_emulator.device import EmulatorError
from services.instagram_emulator.notification_reader import (
    PUSH_CATEGORY,
    PUSH_ID,
    RECIPIENT_ID,
    Notification,
    NotificationReaderError,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
USERS = sorted(set(module.EMULATOR.android_user_by_school.values()))


def _notification(push_id="65fc29b1e2462H11beb7f373H65fc2e4b42734H49", category="post"):
    return Notification(
        {
            PUSH_CATEGORY: category,
            PUSH_ID: push_id,
            RECIPIENT_ID: "76214170483",
            "android.title": "Waterloo Warriors Ringette",
            "android.subText": "wat2do.uwaterloo",
        }
    )


class _Device:
    def __init__(self, *, up=True, uptime=10_000.0, running=USERS):
        self.up = up
        self.uptime = uptime
        self.running = set(running)
        self.started = []
        self.start_fails = False

    def is_online(self):
        return self.up

    def booted(self):
        return self.up

    def uptime_seconds(self):
        return self.uptime

    def user_running(self, user):
        return user in self.running

    def start_user(self, user):
        if self.start_fails:
            raise EmulatorError("adb shell did not complete")
        self.started.append(user)
        self.running.add(user)


class _Reader:
    """Hands out one queued batch of notifications per listen; a queued error is raised,
    and so is the one a reader on a device that went away raises."""

    def __init__(self, *batches, device=None):
        self.batches = list(batches)
        self.device = device
        self.running = False
        self.starts = 0

    def start(self):
        self.running = True
        self.starts += 1

    def stop(self):
        self.running = False

    def notifications(self, seconds):
        batch = self.batches.pop(0) if self.batches else []
        if self.device is not None and not self.device.up:
            batch = NotificationReaderError("The notification reader stopped")
        if isinstance(batch, Exception):
            self.running = False
            raise batch
        yield from batch


class _Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _forwarder(device, reader, outbox, *, send=None, dry_run=False, clock=None):
    sent = []

    def record(notification):
        sent.append(notification.push_id)
        if send is not None:
            send(notification)

    forwarder = module.Forwarder(
        device,
        reader,
        outbox,
        dry_run=dry_run,
        send=record,
        sleep=lambda _seconds: None,
        monotonic=clock or _Clock(),
    )
    return forwarder, sent


def test_each_notification_is_forwarded_once_even_after_a_restart(tmp_path) -> None:
    state = tmp_path / "state.json"
    first = _notification()
    forwarder, sent = _forwarder(_Device(), _Reader([first], [first]), module.Outbox(state))
    forwarder.step()
    forwarder.step()
    assert sent == [first.push_id]
    # A forwarder started again remembers it, as a reader started again shows it again.
    forwarder, sent = _forwarder(_Device(), _Reader([first]), module.Outbox(state))
    forwarder.step()
    assert sent == []


def test_a_notification_the_workflow_cannot_route_is_skipped(tmp_path, caplog) -> None:
    unroutable = Notification({PUSH_CATEGORY: "post", PUSH_ID: "abc"})
    forwarder, sent = _forwarder(_Device(), _Reader([unroutable]), module.Outbox(None))
    forwarder.step()
    assert sent == []
    assert "Skipped a post notification" in caplog.text


def test_a_failed_dispatch_waits_on_disk_and_is_tried_again_after_a_doubling_pause(
    tmp_path, caplog
) -> None:
    state = tmp_path / "state.json"
    clock = _Clock()
    failures = iter([True, True, False, False])

    def send(_notification):
        if next(failures):
            raise module.DispatchError("HTTP 502")

    older, newer = _notification("older"), _notification("newer")
    reader = _Reader([older], [newer], [], [], [], [])
    forwarder, sent = _forwarder(_Device(), reader, module.Outbox(state), send=send, clock=clock)
    forwarder.step()
    first = module.CONTROL.retry_first_seconds
    assert sent == ["older"]
    assert "Could not forward a post notification for 76214170483 (HTTP 502)" in caplog.text
    assert len(json.loads(state.read_text())["waiting"]) == 1
    # Nothing is sent again until the pause is over.
    clock.now = first - 1
    forwarder.step()
    assert sent == ["older"]
    clock.now = first
    forwarder.step()
    assert sent == ["older", "older"]
    # The second failure in a row pauses twice as long; then both go, oldest first.
    clock.now = 3 * first - 1
    forwarder.step()
    assert sent == ["older", "older"]
    clock.now = 3 * first
    forwarder.step()
    assert sent == ["older", "older", "older", "newer"]
    assert json.loads(state.read_text())["waiting"] == []
    # Logs never carry the notification's text.
    assert "Ringette" not in caplog.text


def test_the_pause_between_tries_stops_growing_at_its_longest() -> None:
    clock = _Clock()

    def fail(_notification):
        raise module.DispatchError("HTTP 502")

    forwarder, _ = _forwarder(
        _Device(), _Reader([_notification()]), module.Outbox(None), send=fail, clock=clock
    )
    for _ in range(30):
        forwarder.step()
        clock.now = forwarder._retry_at
    assert forwarder._retry_seconds == module.CONTROL.retry_longest_seconds


def test_a_dispatch_github_refuses_is_dropped_and_holds_nothing_up(caplog) -> None:
    def send(notification):
        if notification.push_id == "refused":
            raise module.DispatchRefused("HTTP 422")

    outbox = module.Outbox(None)
    reader = _Reader([_notification("refused"), _notification("fine")])
    forwarder, sent = _forwarder(_Device(), reader, outbox, send=send)
    forwarder.step()
    assert sent == ["refused", "fine"]
    assert len(outbox) == 0
    assert "GitHub refused a post notification" in caplog.text


def test_a_restarting_emulator_is_waited_for_and_heard_again_once_it_is_up(caplog) -> None:
    caplog.set_level(logging.INFO)
    device = _Device()
    reader = _Reader(device=device)
    forwarder, _ = _forwarder(device, reader, module.Outbox(None))
    forwarder.step()
    assert reader.running and reader.starts == 1
    # The worker restarts the emulator: the reader stops with it.
    device.up = False
    with pytest.raises(NotificationReaderError):
        forwarder.step()
    forwarder.step()
    assert not reader.running and reader.starts == 1
    assert "The emulator is down; waiting for it" in caplog.text
    device.up = True
    forwarder.step()
    assert reader.running and reader.starts == 2
    assert caplog.text.count("Listening for Instagram notifications") == 2


def test_a_reader_that_stops_is_started_again_on_the_next_step(caplog) -> None:
    caplog.set_level(logging.INFO)
    reader = _Reader(NotificationReaderError("The notification reader stopped"), [])
    forwarder, _ = _forwarder(_Device(), reader, module.Outbox(None))
    sleeps = []
    forwarder._sleep = sleeps.append
    steps = iter([True, True])

    def step():
        if next(steps, False) is False:
            raise KeyboardInterrupt
        module.Forwarder.step(forwarder)

    forwarder.step = step
    with pytest.raises(KeyboardInterrupt):
        forwarder.run_forever()
    assert reader.starts == 2
    assert sleeps == [module.CONTROL.check_seconds]
    assert "The notification reader stopped; checking again" in caplog.text


def test_stopped_users_start_once_the_emulator_has_settled_after_its_boot() -> None:
    device = _Device(uptime=module.CONTROL.boot_settle_seconds - 1, running=[0])
    forwarder, _ = _forwarder(device, _Reader(), module.Outbox(None))
    forwarder.step()
    assert device.started == []
    device.uptime = module.CONTROL.boot_settle_seconds
    forwarder.step()
    assert device.started == [user for user in USERS if user != 0]


def test_a_user_a_switch_stopped_is_started_again_on_the_next_check(caplog) -> None:
    caplog.set_level(logging.INFO)
    clock = _Clock()
    device = _Device()

    def start_user(user):
        clock.now += 7.25
        device.running.add(user)

    device.start_user = start_user
    forwarder, _ = _forwarder(device, _Reader(), module.Outbox(None), clock=clock)
    forwarder.step()
    # Android stops the least recently used background user when the worker switches.
    device.running.discard(USERS[-1])
    forwarder.step()
    assert USERS[-1] in device.running
    assert f"Started Android user {USERS[-1]} in 7.2 s" in caplog.text


def test_a_user_that_will_not_start_leaves_the_reader_listening(caplog) -> None:
    device = _Device(running=[0])
    device.start_fails = True
    reader = _Reader([_notification()])
    forwarder, sent = _forwarder(device, reader, module.Outbox(None))
    forwarder.step()
    assert reader.running and sent == [_notification().push_id]
    assert "Could not start the stopped Android users" in caplog.text


def test_a_dry_run_prints_what_it_would_send_and_changes_nothing(tmp_path, capsys) -> None:
    device = _Device(running=[0])
    notification = _notification()
    forwarder, sent = _forwarder(
        device, _Reader([notification, notification]), module.Outbox(None), dry_run=True
    )
    forwarder.step()
    assert sent == [] and device.started == []
    assert capsys.readouterr().out == (
        f"Would forward post for 76214170483 ({notification.push_id})\n"
    )


def test_handled_notifications_are_forgotten_after_the_remembered_days(tmp_path) -> None:
    now = [0.0]
    outbox = module.Outbox(tmp_path / "state.json", now=lambda: now[0])
    old = _notification("old")
    assert outbox.add(old)
    outbox.handled(old)
    assert not outbox.add(old)
    now[0] = module.CONTROL.remember_days * 86_400 + 1
    outbox.handled(_notification("new"))
    assert outbox.add(old)


def test_the_forwarder_sends_exactly_the_categories_the_workflow_processes() -> None:
    source = (REPO_ROOT / "rust/src/instagram_notifications/process_notification.rs").read_text()
    declared = re.search(r"const ACTIONABLE_CATEGORIES: \[&str; \d+\] = \[([^\]]*)\]", source)
    assert declared is not None
    assert set(re.findall(r'"([^"]+)"', declared.group(1))) == set(module.CONTROL.push_categories)


def _completed(returncode, stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout="", stderr=stderr)


def test_a_dispatch_starts_the_workflow_the_way_the_phones_did(monkeypatch) -> None:
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return _completed(0)

    monkeypatch.setattr(module.subprocess, "run", run)
    notification = _notification()
    module.dispatch(notification)
    command, kwargs = calls[0]
    assert command == [
        "gh",
        "api",
        f"repos/{module.CONTROL.github_repo}/dispatches",
        "--method",
        "POST",
        "--input",
        "-",
    ]
    assert json.loads(kwargs["input"]) == {
        "event_type": "new_instagram_post",
        "client_payload": {"notification_dict": notification.extras},
    }


@pytest.mark.parametrize(
    ("result", "error", "message"),
    [
        (_completed(1, "gh: Invalid request. (HTTP 422)\n"), module.DispatchRefused, "HTTP 422"),
        (_completed(1, "gh: Server Error (HTTP 502)\n"), module.DispatchError, "HTTP 502"),
        (
            _completed(1, "error connecting to api.github.com\ncheck your internet connection\n"),
            module.DispatchError,
            "error connecting to api.github.com",
        ),
        (_completed(4), module.DispatchError, "gh exited 4"),
        (subprocess.TimeoutExpired("gh", 30), module.DispatchError, "TimeoutExpired"),
        (FileNotFoundError("gh"), module.DispatchError, "FileNotFoundError"),
    ],
)
def test_a_dispatch_that_fails_says_why_without_quoting_the_payload(
    monkeypatch, result, error, message
) -> None:
    def run(*_args, **_kwargs):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(module.subprocess, "run", run)
    with pytest.raises(error) as raised:
        module.dispatch(_notification())
    assert message in str(raised.value)
    assert type(raised.value) is error


def test_only_one_forwarder_runs_at_a_time(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(module, "STATE_DIRECTORY", tmp_path)
    monkeypatch.setattr(module, "_LOCK_PATH", tmp_path / "forwarder.lock")
    with module._only_forwarder():
        with pytest.raises(SystemExit, match="Another notification forwarder is running"):
            with module._only_forwarder():
                pass
    with module._only_forwarder():
        pass
