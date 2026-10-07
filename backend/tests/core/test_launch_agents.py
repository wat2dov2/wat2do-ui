import errno
import plistlib
import stat
import subprocess
from types import SimpleNamespace

import pytest

from core import launch_agents


@pytest.fixture(autouse=True)
def lifecycle_clock(monkeypatch):
    clock = SimpleNamespace(now=0.0)
    monkeypatch.setattr(launch_agents.time, "monotonic", lambda: clock.now)

    def sleep(seconds):
        clock.now += seconds

    monkeypatch.setattr(launch_agents.time, "sleep", sleep)
    return clock


def test_atomic_write_preserves_existing_file_when_disk_flush_fails(tmp_path, monkeypatch):
    path = tmp_path / "ledger.json"
    path.write_bytes(b"previous durable ledger")

    def disk_full(_descriptor):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(launch_agents.os, "fsync", disk_full)
    with pytest.raises(OSError):
        launch_agents.atomic_write(path, b"replacement")
    assert path.read_bytes() == b"previous durable ledger"
    assert list(tmp_path.iterdir()) == [path]


def test_install_preserves_running_service_when_staging_fails(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    path.write_bytes(b"previous plist")
    calls = []
    monkeypatch.setattr(
        launch_agents.subprocess,
        "run",
        lambda command, **kwargs: calls.append(command) or SimpleNamespace(returncode=0),
    )

    def disk_full(_descriptor):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(launch_agents.os, "fsync", disk_full)
    with pytest.raises(OSError):
        launch_agents.install_launch_agent(
            path, {"Label": "test.worker"}, timeout=3, poll_interval_seconds=0.1
        )
    assert path.read_bytes() == b"previous plist"
    assert [command[1] for command in calls] == ["print"]
    assert list(tmp_path.iterdir()) == [path]


def test_failed_replacement_restores_previous_plist_and_service(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    previous = plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]})
    path.write_bytes(previous)
    calls = []
    starts = []
    registered = True

    def run(command, **kwargs):
        nonlocal registered
        calls.append((command, kwargs["timeout"]))
        if command[1] == "bootstrap":
            starts.append(plistlib.loads(path.read_bytes())["ProgramArguments"])
            return SimpleNamespace(returncode=7 if len(starts) == 1 else 0)
        if command[1] == "bootout":
            registered = False
        if command[1] == "print":
            return SimpleNamespace(returncode=0 if registered else 3)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="bootstrap failed"):
        launch_agents.install_launch_agent(
            path,
            {"Label": "test.worker", "ProgramArguments": ["new-worker"]},
            timeout=4,
            poll_interval_seconds=0.1,
        )
    assert starts == [["new-worker"], ["old-worker"]]
    assert path.read_bytes() == previous
    assert all(0 < timeout <= 4 for _, timeout in calls)
    assert list(tmp_path.iterdir()) == [path]


def test_install_failure_to_stop_keeps_previous_agent_intact(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    path.write_bytes(b"previous plist")
    calls = []

    def run(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1 if command[1] == "bootout" else 0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(launch_agents.LaunchAgentRecoveryError, match="recovery remains uncertain"):
        launch_agents.install_launch_agent(
            path, {"Label": "test.worker"}, timeout=3, poll_interval_seconds=0.1
        )
    assert path.read_bytes() == b"previous plist"
    assert "bootstrap" not in [command[1] for command in calls]


def test_stop_timeout_restores_service_if_launchctl_already_stopped_it(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    path.write_bytes(plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]}))
    calls = []
    stopped = False

    def run(command, **kwargs):
        nonlocal stopped
        calls.append(command)
        if command[1] == "bootout":
            stopped = True
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        if command[1] == "print":
            return SimpleNamespace(returncode=3 if stopped else 0)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="bootout failed"):
        launch_agents.install_launch_agent(
            path, {"Label": "test.worker"}, timeout=3, poll_interval_seconds=0.1
        )
    assert [command[1] for command in calls] == ["print", "enable", "bootout", "print", "bootstrap"]
    assert plistlib.loads(path.read_bytes())["ProgramArguments"] == ["old-worker"]


def test_timed_out_launchctl_does_not_expose_command_output(tmp_path, monkeypatch):
    def timeout(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"], output="private token")

    monkeypatch.setattr(launch_agents.subprocess, "run", timeout)
    with pytest.raises(RuntimeError, match="print failed \\(TimeoutExpired\\)") as failure:
        launch_agents.install_launch_agent(
            tmp_path / "agent.plist", {"Label": "test.worker"}, timeout=3, poll_interval_seconds=0.1
        )
    assert "private token" not in str(failure.value)


def test_first_install_writes_private_plist_without_stopping_another_service(tmp_path, monkeypatch):
    path = tmp_path / "agents" / "agent.plist"
    calls = []

    def run(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=3 if command[1] == "print" else 0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    payload = {"Label": "test.worker", "ProgramArguments": ["worker"]}
    launch_agents.install_launch_agent(path, payload, timeout=3, poll_interval_seconds=0.1)
    assert plistlib.loads(path.read_bytes()) == payload
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert [command[1] for command in calls] == ["print", "enable", "bootstrap"]


def test_replacement_waits_for_the_previous_service_to_disappear(
    tmp_path, monkeypatch, lifecycle_clock
):
    path = tmp_path / "agent.plist"
    path.write_bytes(plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]}))
    pending_prints = None
    starts = []

    def run(command, **_kwargs):
        nonlocal pending_prints
        if command[1] == "bootout":
            pending_prints = 2
        if command[1] == "print":
            if pending_prints is None:
                return SimpleNamespace(returncode=0)
            if pending_prints:
                pending_prints -= 1
                return SimpleNamespace(returncode=0)
            return SimpleNamespace(returncode=3)
        if command[1] == "bootstrap":
            assert pending_prints == 0
            starts.append(
                (lifecycle_clock.now, plistlib.loads(path.read_bytes())["ProgramArguments"])
            )
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    launch_agents.install_launch_agent(
        path,
        {"Label": "test.worker", "ProgramArguments": ["new-worker"]},
        timeout=3,
        poll_interval_seconds=0.1,
    )
    assert starts == [(0.2, ["new-worker"])]


def test_failed_bootstrap_waits_for_its_late_entry_before_restoring_old_service(
    tmp_path, monkeypatch, lifecycle_clock
):
    path = tmp_path / "agent.plist"
    previous = plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]})
    path.write_bytes(previous)
    pending_prints = None
    starts = []

    def run(command, **_kwargs):
        nonlocal pending_prints
        if command[1] == "bootout":
            pending_prints = 2
        if command[1] == "print":
            if pending_prints is None:
                return SimpleNamespace(returncode=0)
            if pending_prints:
                pending_prints -= 1
                return SimpleNamespace(returncode=0)
            return SimpleNamespace(returncode=3)
        if command[1] == "bootstrap":
            assert pending_prints == 0
            starts.append(
                (lifecycle_clock.now, plistlib.loads(path.read_bytes())["ProgramArguments"])
            )
            return SimpleNamespace(returncode=5 if len(starts) == 1 else 0)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="bootstrap failed"):
        launch_agents.install_launch_agent(
            path,
            {"Label": "test.worker", "ProgramArguments": ["new-worker"]},
            timeout=3,
            poll_interval_seconds=0.1,
        )
    assert starts == [(0.2, ["new-worker"]), (0.4, ["old-worker"])]
    assert path.read_bytes() == previous


def test_unload_poll_uses_one_deadline_and_sanitizes_stalled_launchctl(
    monkeypatch, lifecycle_clock
):
    timeouts = []

    def run(command, **kwargs):
        assert command[1] == "print"
        timeouts.append(kwargs["timeout"])
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="unload timed out"):
        launch_agents._wait_for_unload("gui/123/test.worker", timeout=1, poll_interval_seconds=0.4)
    assert lifecycle_clock.now == 1
    assert timeouts == [1, 0.6, pytest.approx(0.2)]


def test_unsettled_failed_replacement_still_restores_previous_plist(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    previous = plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]})
    path.write_bytes(previous)
    replaced = False
    stopped = False

    def run(command, **_kwargs):
        nonlocal replaced, stopped
        if command[1] == "bootout":
            stopped = True
        if command[1] == "print":
            return SimpleNamespace(returncode=0 if replaced or not stopped else 3)
        if command[1] == "bootstrap":
            replaced = True
            return SimpleNamespace(returncode=5)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(launch_agents.LaunchAgentRecoveryError, match="recovery remains uncertain"):
        launch_agents.install_launch_agent(
            path,
            {"Label": "test.worker", "ProgramArguments": ["new-worker"]},
            timeout=1,
            poll_interval_seconds=0.4,
        )
    assert path.read_bytes() == previous
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("interruption", [KeyboardInterrupt, SystemExit])
def test_interrupted_replacement_restores_old_agent_before_propagating(
    tmp_path, monkeypatch, interruption
):
    path = tmp_path / "agent.plist"
    previous = plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]})
    path.write_bytes(previous)
    registered = True
    starts = []

    def run(command, **_kwargs):
        nonlocal registered
        if command[1] == "bootout":
            registered = False
        if command[1] == "print":
            return SimpleNamespace(returncode=0 if registered else 3)
        if command[1] == "bootstrap":
            starts.append(plistlib.loads(path.read_bytes())["ProgramArguments"])
            registered = True
            if len(starts) == 1:
                raise interruption
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(interruption):
        launch_agents.install_launch_agent(
            path,
            {"Label": "test.worker", "ProgramArguments": ["new-worker"]},
            timeout=1,
            poll_interval_seconds=0.1,
        )
    assert starts == [["new-worker"], ["old-worker"]]
    assert registered is True
    assert path.read_bytes() == previous
    assert list(tmp_path.iterdir()) == [path]
