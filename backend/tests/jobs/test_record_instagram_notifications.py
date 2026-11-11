import logging
import sys
from logging.handlers import RotatingFileHandler

import pytest

from jobs import record_instagram_notifications as job


def test_launch_agent_keeps_the_recorder_alive():
    payload = job.launch_agent_payload()
    assert payload["Label"] == "io.wat2do.notification-recorder"
    assert payload["ProgramArguments"][-1] == "run"
    assert payload["KeepAlive"] is True
    assert "StartInterval" not in payload
    # run writes its own rotated log, so launchd keeps none.
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"


@pytest.fixture
def root_logger():
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield root
    for handler in root.handlers:
        handler.close()
    root.handlers, root.level = handlers, level


def test_run_logs_to_a_rotated_file(monkeypatch, tmp_path, root_logger):
    log_path = tmp_path / "notification-log" / "recorder.log"
    monkeypatch.setattr(job.notification_recording, "LOG_PATH", log_path)
    # pytest's own capture handlers would make basicConfig a no-op.
    root_logger.handlers = []
    job.log_to_file()
    [rotating] = [h for h in root_logger.handlers if isinstance(h, RotatingFileHandler)]
    assert rotating.baseFilename == str(log_path)
    assert rotating.maxBytes == job.CONTROL.log_max_bytes
    assert rotating.backupCount == job.CONTROL.log_backup_count
    logging.getLogger("services.notification_recording").info("The emulator is up")
    assert "The emulator is up" in log_path.read_text()


def test_run_records(monkeypatch):
    runs = []
    monkeypatch.setattr(job, "log_to_file", lambda: None)
    monkeypatch.setattr(job.notification_recording, "run_forever", lambda: runs.append(True))
    monkeypatch.setattr(sys, "argv", ["job", "run"])
    assert job.main() == 0
    assert runs == [True]


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
        ("io.wat2do.notification-recorder.plist", "io.wat2do.notification-recorder")
    ]
    assert capsys.readouterr().out.strip() == "Installed io.wat2do.notification-recorder"
