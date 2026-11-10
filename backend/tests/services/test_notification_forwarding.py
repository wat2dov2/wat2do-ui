import json
import logging
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

from services import notification_forwarding as module
from services.instagram_emulator.device import EmulatorError
from services.instagram_emulator.notification_reader import (
    PUSH_CATEGORY,
    PUSH_ID,
    READY,
    RECIPIENT_ID,
    Notification,
    NotificationReader,
    NotificationReaderError,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTROL = module.CONTROL
STOPPED_LONG_ENOUGH = CONTROL.restart_after_stopped_minutes * 60
SECONDARY_USERS = sorted(set(module.EMULATOR.android_user_by_school.values()) - {0})


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


class _Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class _Device:
    """An emulator whose users, load and memory a test sets."""

    def __init__(self, clock, *, running=SECONDARY_USERS, current=0):
        self.clock = clock
        self.up = True
        self.uptime = 10_000.0
        self.current = current
        self.running = set(running)
        self.load_average = 2.0
        self.available = 1500
        self.started = []
        self.failing = set()

    def is_online(self):
        return self.up

    def booted(self):
        return self.up

    def uptime_seconds(self):
        return self.uptime

    def current_user(self):
        return self.current

    def user_running(self, user):
        assert user not in (0, self.current), "user 0 and the foreground user always run"
        return user in self.running

    def load(self):
        return self.load_average, self.available

    def start_user(self, user):
        if user in self.failing:
            raise EmulatorError("Android user did not start")
        self.clock.now += 7.25
        self.started.append(user)
        self.running.add(user)


class _Reader:
    """Hands out one queued batch of notifications per listen; a queued error is raised,
    and so is the error a reader raises once its device has gone away."""

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
        if not self.running:
            raise NotificationReaderError("The notification reader stopped")
        batch = self.batches.pop(0) if self.batches else []
        if self.device is not None and not self.device.up:
            batch = NotificationReaderError("The notification reader stopped")
        if isinstance(batch, Exception):
            self.running = False
            raise batch
        yield from batch


def _forwarder(reader, outbox, *, device=None, send=None, dry_run=False, clock=None):
    clock = clock or _Clock()
    device = device or _Device(clock)
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
        sleep=clock.sleep,
        monotonic=clock,
    )
    return forwarder, sent


def test_each_notification_is_forwarded_once_even_after_a_restart(tmp_path) -> None:
    state = tmp_path / "state.json"
    first = _notification()
    forwarder, sent = _forwarder(_Reader([first], [first]), module.Outbox(state))
    forwarder.step()
    forwarder.step()
    assert sent == [first.push_id]
    # A forwarder started again remembers it, as a reader started again shows it again.
    forwarder, sent = _forwarder(_Reader([first]), module.Outbox(state))
    forwarder.step()
    assert sent == []


def test_a_notification_the_workflow_cannot_route_is_skipped(caplog) -> None:
    unroutable = Notification({PUSH_CATEGORY: "post", PUSH_ID: "abc"})
    forwarder, sent = _forwarder(_Reader([unroutable]), module.Outbox(None))
    forwarder.step()
    assert sent == []
    assert "Skipped a post notification" in caplog.text


def test_a_direct_message_the_reader_printed_is_dropped_and_never_logged(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    message = Notification(
        {
            PUSH_CATEGORY: "direct_v2_text",
            PUSH_ID: "65fe1H2H3",
            RECIPIENT_ID: "76214170483",
            "android.title": "wat2do.uwaterloo: someone",
            "android.text": "my private message",
        }
    )
    state = tmp_path / "state.json"
    forwarder, sent = _forwarder(_Reader([message]), module.Outbox(state))
    forwarder.step()
    assert sent == []
    assert not state.exists()
    assert "Dropped a notification" in caplog.text
    for secret in ("my private message", "someone", "direct_v2_text", "65fe1H2H3"):
        assert secret not in caplog.text


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
    forwarder, sent = _forwarder(reader, module.Outbox(state), send=send, clock=clock)
    forwarder.step()
    first = CONTROL.retry_first_seconds
    assert sent == ["older"]
    assert "Could not forward a post notification for 76214170483 (HTTP 502)" in caplog.text
    assert len(json.loads(state.read_text())["waiting"]) == 1
    tried_at = clock.now
    # Nothing is sent again until the pause is over.
    clock.now = tried_at + first - 1
    forwarder.step()
    assert sent == ["older"]
    clock.now = tried_at + first
    forwarder.step()
    assert sent == ["older", "older"]
    # The second failure in a row pauses twice as long; then both go, oldest first.
    tried_at = clock.now
    clock.now = tried_at + 2 * first - 1
    forwarder.step()
    assert sent == ["older", "older"]
    clock.now = tried_at + 2 * first
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
        _Reader([_notification()]), module.Outbox(None), send=fail, clock=clock
    )
    for _ in range(30):
        forwarder.step()
        clock.now = forwarder._retry_at
    assert forwarder._retry_seconds == CONTROL.retry_longest_seconds


def test_a_refused_dispatch_pauses_sending_and_is_dropped_only_after_separate_refusals(
    tmp_path, caplog
) -> None:
    caplog.set_level(logging.INFO)
    clock = _Clock()

    def send(notification):
        if notification.push_id == "refused":
            raise module.DispatchRefused("HTTP 422")

    outbox = module.Outbox(tmp_path / "state.json")
    reader = _Reader([_notification("refused"), _notification("fine")])
    forwarder, sent = _forwarder(reader, outbox, send=send, clock=clock)
    passes = 0
    while "fine" not in sent:
        forwarder.step()
        passes += 1
        # GitHub may have taken a burst for spam: the pass ends there and sending pauses.
        assert sent.count("fine") == 0 or sent.count("refused") == CONTROL.refusals_before_drop
        clock.now = max(clock.now, forwarder._retry_at)
        assert passes < 10
    assert sent.count("refused") == CONTROL.refusals_before_drop
    assert sent[-1] == "fine" and len(outbox) == 0
    assert "refused a post notification" in caplog.text
    # A refusal is never reported as forwarded.
    assert caplog.text.count("Forwarded a post notification") == 1


def test_a_refusal_does_not_reset_the_pause_between_tries() -> None:
    clock = _Clock()
    answers = iter(
        [
            module.DispatchError("HTTP 502"),
            module.DispatchRefused("HTTP 422"),
            module.DispatchRefused("HTTP 422"),
        ]
    )

    def send(_notification):
        raise next(answers)

    forwarder, _ = _forwarder(
        _Reader([_notification()]), module.Outbox(None), send=send, clock=clock
    )
    pauses = []
    for _ in range(3):
        forwarder.step()
        pauses.append(forwarder._retry_seconds)
        clock.now = forwarder._retry_at
    first = CONTROL.retry_first_seconds
    assert pauses == [first, 2 * first, 4 * first]


def test_dispatches_start_at_least_the_spacing_apart() -> None:
    clock = _Clock()
    started = []
    batch = [_notification(f"push-{index}") for index in range(4)]
    forwarder, _ = _forwarder(
        _Reader(batch),
        module.Outbox(None),
        send=lambda _notification: started.append(clock.now),
        clock=clock,
    )
    forwarder.step()
    assert len(started) == 4
    gaps = [later - earlier for earlier, later in zip(started, started[1:])]
    assert all(gap >= CONTROL.send_spacing_seconds for gap in gaps)


def test_a_restarting_emulator_is_waited_for_and_heard_again_once_it_is_up(caplog) -> None:
    caplog.set_level(logging.INFO)
    clock = _Clock()
    device = _Device(clock)
    reader = _Reader(device=device)
    forwarder, _ = _forwarder(reader, module.Outbox(None), device=device, clock=clock)
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


def test_a_notification_printed_just_before_the_reader_ended_is_still_forwarded() -> None:
    # The device-side reader prints a notification, then the emulator goes away.
    notification = _notification()
    script = (
        f"print({READY.decode().strip()!r}, flush=True)\n"
        f"print({json.dumps(notification.extras)!r}, flush=True)\n"
    )
    reader = NotificationReader(
        "adb",
        "emulator-5554",
        lambda *_args: "",
        package="com.instagram.android",
        categories=CONTROL.push_categories,
        timeout_seconds=10,
        popen=lambda _command, **kwargs: subprocess.Popen([sys.executable, "-c", script], **kwargs),
    )
    clock = _Clock()
    device = _Device(clock)
    forwarder, sent = _forwarder(reader, module.Outbox(None), device=device, clock=clock)
    reader.start()
    deadline = time.monotonic() + 10
    while reader.running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not reader.running
    device.up = False
    forwarder.step()
    assert sent == [notification.push_id]


def test_a_reader_that_stops_is_started_again_on_the_next_step(caplog) -> None:
    caplog.set_level(logging.INFO)
    clock = _Clock()
    reader = _Reader(NotificationReaderError("The notification reader stopped"), [])
    forwarder, _ = _forwarder(reader, module.Outbox(None), clock=clock)
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
    assert sleeps == [CONTROL.check_seconds]
    assert "The notification reader stopped; checking again" in caplog.text


def _settled_forwarder(*, stopped, current=0):
    """A forwarder whose emulator has been up and on one foreground user for long enough."""
    clock = _Clock()
    running = [user for user in SECONDARY_USERS if user not in stopped]
    device = _Device(clock, running=running, current=current)
    forwarder, _ = _forwarder(_Reader(), module.Outbox(None), device=device, clock=clock)
    return forwarder, device, clock


def test_a_stopped_user_starts_again_once_it_has_stayed_stopped_long_enough(caplog) -> None:
    caplog.set_level(logging.INFO)
    user = SECONDARY_USERS[-1]
    forwarder, device, clock = _settled_forwarder(stopped=[user])
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH - 1
    forwarder.step()
    assert device.started == []
    clock.now = STOPPED_LONG_ENOUGH
    forwarder.step()
    assert device.started == [user]
    minutes = CONTROL.restart_after_stopped_minutes
    assert f"Started Android user {user}, stopped {minutes} min, in 7.2 s" in caplog.text


def test_a_user_that_runs_again_meanwhile_is_left_alone() -> None:
    user = SECONDARY_USERS[-1]
    forwarder, device, clock = _settled_forwarder(stopped=[user])
    forwarder.step()
    # The worker switched to it, which started it.
    device.running.add(user)
    clock.now = STOPPED_LONG_ENOUGH
    forwarder.step()
    device.running.discard(user)
    clock.now = STOPPED_LONG_ENOUGH + 60
    forwarder.step()
    assert device.started == []


def test_users_start_one_per_check_and_the_longest_stopped_first() -> None:
    first, second = SECONDARY_USERS[-1], SECONDARY_USERS[-2]
    forwarder, device, clock = _settled_forwarder(stopped=[first])
    forwarder.step()
    clock.now = 60
    device.running.discard(second)
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH + 60
    forwarder.step()
    assert device.started == [first]
    forwarder.step()
    assert device.started == [first, second]


def test_no_user_starts_until_the_foreground_user_has_stayed_put() -> None:
    user = SECONDARY_USERS[-1]
    forwarder, device, clock = _settled_forwarder(stopped=[user])
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH
    # The worker has just switched users.
    device.current = SECONDARY_USERS[0]
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH + CONTROL.quiet_foreground_seconds - 1
    forwarder.step()
    assert device.started == []
    clock.now = STOPPED_LONG_ENOUGH + CONTROL.quiet_foreground_seconds
    forwarder.step()
    assert device.started == [user]


@pytest.mark.parametrize(
    "busy",
    [
        {"load_average": CONTROL.max_load_average + 0.5},
        {"available": CONTROL.min_available_megabytes - 1},
        {"uptime": CONTROL.boot_settle_seconds - 1},
    ],
)
def test_no_user_starts_on_a_busy_or_freshly_booted_emulator(busy) -> None:
    user = SECONDARY_USERS[-1]
    forwarder, device, clock = _settled_forwarder(stopped=[user])
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH
    for name, value in busy.items():
        setattr(device, name, value)
    forwarder.step()
    assert device.started == []


def test_the_foreground_user_and_user_0_are_never_started() -> None:
    current = SECONDARY_USERS[0]
    forwarder, device, clock = _settled_forwarder(stopped=[], current=current)
    device.running.discard(current)
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH * 2
    forwarder.step()
    assert device.started == []


def test_a_user_that_will_not_start_lets_the_others_go_first(caplog) -> None:
    bad, good = SECONDARY_USERS[-1], SECONDARY_USERS[-2]
    forwarder, device, clock = _settled_forwarder(stopped=[bad])
    device.failing.add(bad)
    forwarder.step()
    clock.now = 60
    device.running.discard(good)
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH + 60
    forwarder.step()
    assert f"Android user {bad}, stopped" in caplog.text and "did not start" in caplog.text
    forwarder.step()
    assert device.started == [good]


def test_a_dry_run_prints_what_it_would_send_and_changes_nothing(capsys) -> None:
    clock = _Clock()
    device = _Device(clock, running=[])
    notification = _notification()
    forwarder, sent = _forwarder(
        _Reader([notification, notification]),
        module.Outbox(None),
        device=device,
        dry_run=True,
        clock=clock,
    )
    forwarder.step()
    clock.now = STOPPED_LONG_ENOUGH * 2
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
    now[0] = CONTROL.remember_days * 86_400 + 1
    outbox.handled(_notification("new"))
    assert outbox.add(old)


def test_a_state_that_cannot_be_saved_is_logged_and_forwarding_goes_on(
    tmp_path, monkeypatch, caplog
) -> None:
    def full_disk(_path, _payload):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(module, "atomic_write", full_disk)
    forwarder, sent = _forwarder(_Reader([_notification()]), module.Outbox(tmp_path / "s.json"))
    forwarder.step()
    assert sent == [_notification().push_id]
    assert "Could not save the forwarder's state (No space left on device)" in caplog.text


@pytest.mark.parametrize("saved", ["{not json", "[]", '{"handled": {}, "waiting": [{"key": "a"}]}'])
def test_an_unreadable_state_is_moved_aside_and_the_forwarder_starts_afresh(
    tmp_path, caplog, saved
) -> None:
    state = tmp_path / "state.json"
    state.write_text(saved)
    outbox = module.Outbox(state)
    assert len(outbox) == 0 and outbox.add(_notification())
    aside = list(tmp_path.glob("state.json.unreadable-*"))
    assert [path.read_text() for path in aside] == [saved]
    assert "unreadable; moved it to state.json.unreadable-" in caplog.text


def test_the_forwarder_sends_exactly_the_categories_the_workflow_processes() -> None:
    source = (REPO_ROOT / "rust/src/instagram_notifications/process_notification.rs").read_text()
    declared = re.search(r"const ACTIONABLE_CATEGORIES: \[&str; \d+\] = \[([^\]]*)\]", source)
    assert declared is not None
    assert set(re.findall(r'"([^"]+)"', declared.group(1))) == set(CONTROL.push_categories)


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
        f"repos/{CONTROL.github_repo}/dispatches",
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
