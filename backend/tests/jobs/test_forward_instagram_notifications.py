import logging
import sys
from logging.handlers import RotatingFileHandler

import pytest

from jobs import forward_instagram_notifications as job


def test_launch_agent_keeps_the_forwarder_alive_and_finds_gh():
    payload = job.launch_agent_payload()
    assert payload["Label"] == "io.wat2do.notification-forwarding"
    assert payload["ProgramArguments"][-1] == "run"
    assert payload["KeepAlive"] is True
    assert "StartInterval" not in payload
    # run writes its own rotated log, so launchd keeps none.
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"
    assert "/opt/homebrew/bin" in payload["EnvironmentVariables"]["PATH"].split(":")


@pytest.fixture
def root_logger():
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    root.handlers = []
    yield root
    for handler in root.handlers:
        handler.close()
    root.handlers, root.level = handlers, level


def test_a_real_run_logs_to_a_rotated_file_and_a_dry_run_changes_nothing(
    monkeypatch, tmp_path, root_logger
):
    log_path = tmp_path / "notification-forwarding" / "forwarder.log"
    monkeypatch.setattr(job.notification_forwarding, "LOG_PATH", log_path)
    job.log_to(dry_run=True)
    assert not log_path.parent.exists()
    assert not any(isinstance(handler, RotatingFileHandler) for handler in root_logger.handlers)
    root_logger.handlers = []
    job.log_to(dry_run=False)
    [rotating] = [h for h in root_logger.handlers if isinstance(h, RotatingFileHandler)]
    assert rotating.baseFilename == str(log_path)
    assert rotating.maxBytes == job.CONTROL.log_max_bytes
    assert rotating.backupCount == job.CONTROL.log_backup_count
    logging.getLogger("services.notification_forwarding").info("Forwarded a post notification")
    assert "Forwarded a post notification" in log_path.read_text()


def test_run_forwards_and_a_dry_run_only_listens(monkeypatch):
    runs = []
    monkeypatch.setattr(job, "log_to", lambda *, dry_run: None)
    monkeypatch.setattr(
        job.notification_forwarding, "run_forever", lambda *, dry_run: runs.append(dry_run)
    )
    for argv in (["job", "run"], ["job", "run", "--dry-run"]):
        monkeypatch.setattr(sys, "argv", argv)
        assert job.main() == 0
    assert runs == [False, True]


def test_install_schedule_installs_the_launch_agent(monkeypatch, capsys):
    installed = []
    monkeypatch.setattr(
        job,
        "install_launch_agent",
        lambda path, payload, **_kwargs: installed.append((path.name, payload["Label"])),
    )
    monkeypatch.setattr(sys, "argv", ["job", "install-schedule"])
    assert job.main() == 0
    assert installed == [
        ("io.wat2do.notification-forwarding.plist", "io.wat2do.notification-forwarding")
    ]
    assert capsys.readouterr().out.strip() == "Installed io.wat2do.notification-forwarding"
