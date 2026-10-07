import errno
import plistlib
import stat
import subprocess
from types import SimpleNamespace

import pytest

from core import launch_agents


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
        launch_agents.install_launch_agent(path, {"Label": "test.worker"}, timeout=3)
    assert path.read_bytes() == b"previous plist"
    assert [command[1] for command in calls] == ["print"]
    assert list(tmp_path.iterdir()) == [path]


def test_failed_replacement_restores_previous_plist_and_service(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    previous = plistlib.dumps({"Label": "test.worker", "ProgramArguments": ["old-worker"]})
    path.write_bytes(previous)
    calls = []
    starts = []

    def run(command, **kwargs):
        calls.append((command, kwargs["timeout"]))
        if command[1] == "bootstrap":
            starts.append(plistlib.loads(path.read_bytes())["ProgramArguments"])
            return SimpleNamespace(returncode=7 if len(starts) == 1 else 0)
        if command[1] == "print" and starts:
            return SimpleNamespace(returncode=3)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="bootstrap failed"):
        launch_agents.install_launch_agent(
            path, {"Label": "test.worker", "ProgramArguments": ["new-worker"]}, timeout=4
        )
    assert starts == [["new-worker"], ["old-worker"]]
    assert path.read_bytes() == previous
    assert all(timeout == 4 for _, timeout in calls)
    assert list(tmp_path.iterdir()) == [path]


def test_install_failure_to_stop_keeps_previous_agent_intact(tmp_path, monkeypatch):
    path = tmp_path / "agent.plist"
    path.write_bytes(b"previous plist")
    calls = []

    def run(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=1 if command[1] == "bootout" else 0)

    monkeypatch.setattr(launch_agents.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="bootout failed"):
        launch_agents.install_launch_agent(path, {"Label": "test.worker"}, timeout=3)
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
        launch_agents.install_launch_agent(path, {"Label": "test.worker"}, timeout=3)
    assert [command[1] for command in calls] == ["print", "enable", "bootout", "print", "bootstrap"]
    assert plistlib.loads(path.read_bytes())["ProgramArguments"] == ["old-worker"]


def test_timed_out_launchctl_does_not_expose_command_output(tmp_path, monkeypatch):
    def timeout(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"], output="private token")

    monkeypatch.setattr(launch_agents.subprocess, "run", timeout)
    with pytest.raises(RuntimeError, match="print failed \\(TimeoutExpired\\)") as failure:
        launch_agents.install_launch_agent(
            tmp_path / "agent.plist", {"Label": "test.worker"}, timeout=3
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
    launch_agents.install_launch_agent(path, payload, timeout=3)
    assert plistlib.loads(path.read_bytes()) == payload
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert [command[1] for command in calls] == ["print", "enable", "bootstrap"]
