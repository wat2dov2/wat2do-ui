import subprocess

import pytest

from scripts import instagram_emulator as keep_alive


class _Stop(Exception):
    pass


class _Device:
    """An emulator that answers or not, check by check."""

    def __init__(self, answers):
        self._answers = iter(answers)
        self.online = True
        self.commands = []

    def answers(self):
        return next(self._answers)

    def is_online(self):
        return self.online

    def adb(self, *args):
        self.commands.append(args)
        return "OK"


class _Emulator:
    def __init__(self, *args, **kwargs):
        self.killed = False

    def poll(self):
        return None

    def wait(self, timeout=None):
        if not self.killed:
            raise subprocess.TimeoutExpired("emulator", timeout)

    def kill(self):
        self.killed = True


@pytest.fixture
def clock(monkeypatch, tmp_path):
    """Each check moves the clock on by the keep-alive interval; the run stops after the
    device's last answer."""
    now = [0.0]
    monkeypatch.setattr(keep_alive.time, "monotonic", lambda: now[0])

    def sleep(seconds):
        now[0] += seconds

    monkeypatch.setattr(keep_alive.time, "sleep", sleep)
    monkeypatch.setattr("services.instagram_emulator.device.RESTART_LOG", tmp_path / "restarts.log")
    return tmp_path / "restarts.log"


def _run(monkeypatch, device):
    started = []

    def popen(command, **kwargs):
        emulator = _Emulator()
        started.append(emulator)
        return emulator

    monkeypatch.setattr(keep_alive, "EmulatorDevice", lambda: device)
    monkeypatch.setattr(keep_alive.subprocess, "Popen", popen)
    with pytest.raises(StopIteration):
        keep_alive.run()
    return started


def test_an_android_that_stops_answering_is_stopped_once_the_wait_is_over(monkeypatch, clock):
    checks = keep_alive.CONTROL.unresponsive_restart_seconds // (
        keep_alive.CONTROL.keep_alive_check_seconds
    )
    device = _Device([True] + [False] * (checks - 1))
    _run(monkeypatch, device)
    assert device.commands == []
    device = _Device([True] + [False] * (checks + 1))
    _run(monkeypatch, device)
    assert device.commands == [("emu", "kill")]
    (line,) = clock.read_text().splitlines()
    assert "Android answered no adb shell command for" in line


def test_a_missing_emulator_is_booted_and_a_hung_child_is_killed(monkeypatch, clock):
    checks = keep_alive.CONTROL.unresponsive_restart_seconds // (
        keep_alive.CONTROL.keep_alive_check_seconds
    )
    device = _Device([False] * (checks + 2))
    device.online = False
    started = _run(monkeypatch, device)
    # Booted once; a boot that never answers is stopped, and the console not
    # stopping it kills the child.
    assert started[0].killed
    assert device.commands == [("emu", "kill")]
