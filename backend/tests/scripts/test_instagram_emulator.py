import itertools
import signal
import subprocess
from contextlib import contextmanager

import pytest

from scripts import instagram_emulator as keep_alive


class _Stop(Exception):
    pass


class _Device:
    """An emulator that answers or not, check by check, and whose Android has used
    ``android_busy`` of its four cores (1.0 is one core) since the last check."""

    def __init__(self, answers, *, android_busy=0.5):
        self._answers = iter(answers)
        self.online = True
        self.commands = []
        self.android_busy = android_busy
        self._busy = 0.0
        self._total = 0

    def answers(self):
        return next(self._answers)

    def is_online(self):
        return self.online

    def adb(self, *args):
        if args == ("shell", "cat", "/proc/stat"):
            # 100 ticks a second on each of four cores, over one check.
            ticks = 100 * keep_alive.CONTROL.keep_alive_check_seconds
            self._total += 4 * ticks
            self._busy += self.android_busy * ticks
            busy, idle = round(self._busy), self._total - round(self._busy)
            return (
                f"cpu  {busy} 0 0 {idle} 0 0 0 0 0 0\n"
                + "".join(f"cpu{core} 0 0 0 0 0 0 0 0 0 0\n" for core in range(4))
                + "intr 1 2 3\n"
            )
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
    monkeypatch.setattr(keep_alive, "emulator_process", lambda: None)
    return tmp_path / "restarts.log"


class _Qemu:
    """A qemu process that uses ``cores`` of the Mac's CPU (1.0 is one core) between
    checks, either always or check by check, under one pid or a pid per check."""

    def __init__(self, cores, pids=None):
        self._cores = iter(cores) if isinstance(cores, list) else itertools.repeat(cores)
        self._pids = iter(pids) if pids else itertools.repeat(4242)
        self._cpu_seconds = 0.0

    def __call__(self):
        process = keep_alive.EmulatorProcess(next(self._pids), self._cpu_seconds)
        self._cpu_seconds += next(self._cores) * keep_alive.CONTROL.keep_alive_check_seconds
        return process


@pytest.fixture
def held(monkeypatch):
    """Records each restart's hold on the emulator's lock and what happened inside it."""
    holds = []

    @contextmanager
    def exclusive():
        holds.append("held")
        yield
        holds.append("released")

    monkeypatch.setattr(keep_alive, "exclusive", exclusive)
    return holds


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


def _spin_checks():
    return keep_alive.CONTROL.spin_restart_seconds // keep_alive.CONTROL.keep_alive_check_seconds


def test_qemu_spinning_while_android_idles_is_restarted_under_the_lock(monkeypatch, clock, held):
    monkeypatch.setattr(keep_alive, "emulator_process", _Qemu(cores=5.5))
    monkeypatch.setattr(keep_alive, "_running", lambda pid: False)
    # The first check only takes a sample; a spin shorter than the wait is left alone.
    device = _Device([True] * _spin_checks())
    _run(monkeypatch, device)
    assert device.commands == []
    assert held == []
    device = _Device([True] * (_spin_checks() + 1))
    _run(monkeypatch, device)
    assert device.commands == [("emu", "kill")]
    assert held == ["held", "released"]
    (line,) = clock.read_text().splitlines()
    assert "qemu used 550% CPU while Android used 50% for 15 min" in line


def test_a_busy_android_or_a_quiet_qemu_never_counts_as_a_spin(monkeypatch, clock, held):
    monkeypatch.setattr(keep_alive, "emulator_process", _Qemu(cores=5.5))
    device = _Device([True] * (_spin_checks() * 2), android_busy=3.5)
    _run(monkeypatch, device)
    monkeypatch.setattr(keep_alive, "emulator_process", _Qemu(cores=0.6))
    device_quiet = _Device([True] * (_spin_checks() * 2))
    _run(monkeypatch, device_quiet)
    assert device.commands == device_quiet.commands == []
    assert held == []
    assert not clock.exists()


def test_one_quiet_check_starts_the_spin_wait_over(monkeypatch, clock, held):
    half = _spin_checks() // 2
    cores = [5.5] * half + [0.5] + [5.5] * (_spin_checks() - half + 1)
    monkeypatch.setattr(keep_alive, "emulator_process", _Qemu(cores))
    device = _Device([True] * (_spin_checks() + 2))
    _run(monkeypatch, device)
    assert device.commands == []
    assert held == []


def test_a_new_qemu_process_starts_the_spin_wait_over(monkeypatch, clock, held):
    half = _spin_checks() // 2
    pids = [1] * half + [2] * (_spin_checks() - half + 2)
    monkeypatch.setattr(keep_alive, "emulator_process", _Qemu(5.5, pids))
    device = _Device([True] * (_spin_checks() + 2))
    _run(monkeypatch, device)
    assert device.commands == []
    assert held == []


def test_a_console_kill_that_leaves_qemu_running_is_followed_by_sigkill(monkeypatch, clock):
    monkeypatch.setattr(keep_alive, "emulator_process", lambda: keep_alive.EmulatorProcess(77, 1))
    signals = []

    def kill(pid, sent):
        signals.append((pid, sent))

    monkeypatch.setattr(keep_alive.os, "kill", kill)
    device = _Device([])
    keep_alive.stop(device, None)
    assert device.commands == [("emu", "kill")]
    # Polled every second until the wait is over, then killed outright.
    assert signals[-1] == (77, signal.SIGKILL)
    assert signals[:-1] == [(77, 0)] * keep_alive.CONTROL.stop_wait_seconds


def test_a_qemu_that_exits_after_the_console_kill_is_not_signalled(monkeypatch, clock):
    monkeypatch.setattr(keep_alive, "emulator_process", lambda: keep_alive.EmulatorProcess(77, 1))
    signals = []

    def kill(pid, sent):
        signals.append((pid, sent))
        if len(signals) == 3:
            raise ProcessLookupError

    monkeypatch.setattr(keep_alive.os, "kill", kill)
    keep_alive.stop(_Device([]), None)
    assert signals == [(77, 0)] * 3


def test_the_emulator_process_is_found_by_its_virtual_device(monkeypatch):
    avd = keep_alive.CONTROL.avd_name
    port = keep_alive.CONTROL.serial.removeprefix("emulator-")
    listing = (
        "  1   397:33.44 /sbin/launchd\n"
        f" 90 0:01.00 /sdk/emulator/emulator -avd {avd} -port {port}\n"
        f" 91 1:00:00 /sdk/qemu/qemu-system-aarch64-headless -avd other -port {port}\n"
        f" 96450   537:12.50 /sdk/qemu/darwin-aarch64/qemu-system-aarch64-headless -avd {avd}"
        f" -port {port} -no-window -gpu host\n"
    )
    monkeypatch.setattr(
        keep_alive.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, listing, ""),
    )
    assert keep_alive.emulator_process() == keep_alive.EmulatorProcess(96450, 537 * 60 + 12.5)


@pytest.mark.parametrize(
    ("cpu_time", "seconds"),
    [("2:26.23", 146.23), ("397:33.44", 23853.44), ("01:02:03", 3723), ("2-00:00:01", 172801)],
)
def test_ps_cpu_times_are_read_as_seconds(cpu_time, seconds):
    assert keep_alive._cpu_seconds(cpu_time) == pytest.approx(seconds)
