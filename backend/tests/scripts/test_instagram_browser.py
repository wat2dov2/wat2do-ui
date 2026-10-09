import errno
import fcntl
import io
import json
import logging
import os
import plistlib
import stat
from datetime import datetime
from types import SimpleNamespace

import pytest

from core import launch_agents
from scripts import instagram_browser as script
from services.instagram_notifications import carousel_engagement as source
from services.instagram_notifications.browser_queue import BrowserJobQueue


def test_worker_logs_are_bounded_files_and_do_not_stream_to_launchd(tmp_path, monkeypatch, capsys):
    legacy = tmp_path / "worker.stderr.log"
    legacy.write_text("Existing launchd log is preserved.\n")

    def worker(_queue, **_kwargs):
        logging.getLogger("instagram.worker.test").warning("Verified worker diagnostic")

    monkeypatch.setattr(script, "run_worker", worker)
    assert script.main(["--state-directory", str(tmp_path), "worker", "--once"]) == 0
    assert capsys.readouterr().err == ""
    path = tmp_path / "worker.operations.log"
    assert "Verified worker diagnostic" in path.read_text()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert legacy.read_text() == "Existing launchd log is preserved.\n"
    script.logging.basicConfig(level=logging.WARNING, force=True)


def test_worker_log_rotation_survives_real_lazy_source_imports(tmp_path):
    result = script.subprocess.run(
        [
            script.sys.executable,
            "-c",
            """
import logging
import socket
from pathlib import Path
from scripts.instagram_browser import configure_worker_logging

def forbid_network(*args, **kwargs):
    raise AssertionError("Lazy source imports must not access the network")

socket.socket.connect = forbid_network
configure_worker_logging(Path.cwd())
root = logging.getLogger()
handler = root.handlers[0]
handler.maxBytes = 256
from services.instagram_notifications import carousel_engagement, notification_ingestion
assert root.handlers == [handler]
assert root.level == logging.WARNING
logging.getLogger("instagram.worker.test").info("Ignored informational diagnostic")
for index in range(50):
    logging.getLogger("instagram.worker.test").warning("Diagnostic %03d: %s", index, "x" * 70)
handler.close()
""",
        ],
        cwd=tmp_path,
        env={
            **os.environ,
            "PYTHONPATH": str(script.BACKEND_DIRECTORY),
            "ENVIRONMENT": "testing",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_KEY": "test-key",
            "SUPABASE_SECRET_KEY": "test-service-role",
            "DATABASE_URL": "",
            "OPENAI_API_KEY": "",
            "APIFY_API_TOKEN": "",
        },
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    files = list(tmp_path.glob("worker.operations.log*"))
    assert len(files) == 4
    assert all(path.stat().st_size <= 256 for path in files)
    assert all("Ignored informational diagnostic" not in path.read_text() for path in files)


def test_default_application_logs_keep_timestamp_and_level_prefix(tmp_path):
    result = script.subprocess.run(
        [
            script.sys.executable,
            "-c",
            "from core.logging import logger; logger.info('Application diagnostic')",
        ],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(script.BACKEND_DIRECTORY)},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    prefix, message = result.stderr.strip().split(" INFO ", 1)
    datetime.strptime(prefix, "%Y-%m-%d %H:%M:%S,%f")
    assert message == "Application diagnostic"


def test_worker_log_rotation_bounds_utf8_bytes_and_backup_count(tmp_path):
    handler = script._WorkerOperationalLogHandler(
        tmp_path / "worker.operations.log", max_bytes=256, backup_count=3
    )
    handler.setFormatter(logging.Formatter("%(message)s"))
    try:
        for index in range(50):
            handler.emit(logging.makeLogRecord({"msg": f"entry-{index:03}: " + "é" * 70}))
        handler.emit(logging.makeLogRecord({"msg": "oversized:" + "é" * 300}))
    finally:
        handler.close()
    files = list(tmp_path.glob("worker.operations.log*"))
    assert len(files) == 4
    assert all(path.stat().st_size <= 256 for path in files)
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in files)
    assert "[truncated]" in (tmp_path / "worker.operations.log").read_text()


@pytest.mark.parametrize("error_code", [errno.ENOSPC, errno.EDQUOT, errno.EACCES])
def test_worker_log_write_failure_warns_once_and_recovers_without_tracebacks(
    tmp_path, monkeypatch, capsys, error_code
):
    class FailingStream(io.StringIO):
        failed = True

        def write(self, message):
            if self.failed:
                raise OSError(error_code, "private disk details")
            return super().write(message)

    stream = FailingStream()
    handler = script._WorkerOperationalLogHandler(
        tmp_path / "worker.operations.log", max_bytes=256, backup_count=3
    )
    monkeypatch.setattr(handler, "_open", lambda: stream)
    record = logging.makeLogRecord({"msg": "private diagnostic content"})
    try:
        handler.emit(record)
        handler.emit(record)
        first = capsys.readouterr().err
        assert first.count("Instagram worker operational log is unavailable") == 1
        assert "Traceback" not in first
        assert "private" not in first
        stream.failed = False
        handler.emit(record)
        assert capsys.readouterr().err == ""
        stream.failed = True
        handler.emit(record)
        handler.emit(record)
        assert capsys.readouterr().err.count("Instagram worker operational log is unavailable") == 1
    finally:
        handler.close()


def test_interactive_commands_keep_stream_logging(tmp_path, capsys):
    assert script.main(["--state-directory", str(tmp_path), "pause"]) == 0
    logging.getLogger("instagram.worker.test").warning("Interactive diagnostic")
    assert "Interactive diagnostic" in capsys.readouterr().err
    assert not (tmp_path / "worker.operations.log").exists()


def test_failed_worker_log_does_not_crash_when_launchd_stderr_is_also_full(tmp_path, monkeypatch):
    warning_attempts = []

    def unavailable_file():
        raise OSError(errno.ENOSPC, "private disk details")

    class UnavailableStderr:
        def write(self, message):
            warning_attempts.append(message)
            raise OSError(errno.ENOSPC, "private stderr details")

        def flush(self):
            raise AssertionError("An unsuccessful warning write must not flush")

    handler = script._WorkerOperationalLogHandler(
        tmp_path / "worker.operations.log", max_bytes=256, backup_count=3
    )
    monkeypatch.setattr(handler, "_open", unavailable_file)
    monkeypatch.setattr(script.sys, "stderr", UnavailableStderr())
    try:
        for _ in range(3):
            handler.emit(logging.makeLogRecord({"msg": "private diagnostic content"}))
    finally:
        handler.close()
    assert warning_attempts == [
        "Instagram worker operational log is unavailable; logging will retry.\n"
    ]


def test_install_uses_stable_checkout_and_shared_spool(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    calls = []
    monkeypatch.setattr(
        script.subprocess,
        "run",
        lambda command, **kwargs: (
            calls.append(command) or SimpleNamespace(returncode=3 if command[1] == "print" else 0)
        ),
    )
    result = script.install(queue)
    payload = plistlib.loads(script.Path(result["plist"]).read_bytes())
    assert payload["ProgramArguments"] == [
        script.sys.executable,
        str(script.Path(script.__file__).resolve()),
        "--state-directory",
        str(queue.state_directory),
        "worker",
    ]
    assert payload["WorkingDirectory"] == str(script.BACKEND_DIRECTORY)
    assert payload["KeepAlive"] and payload["RunAtLoad"]
    assert [call[1] for call in calls] == ["print", "enable", "bootstrap"]
    assert queue.get_setting("paused") is False
    assert "SUPABASE_SECRET_KEY" not in payload["EnvironmentVariables"]


def test_install_reports_failed_bootstrap(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(
        script.subprocess,
        "run",
        lambda command, **kwargs: SimpleNamespace(
            returncode=7 if command[1] == "bootstrap" else 3 if command[1] == "print" else 0
        ),
    )
    with pytest.raises(RuntimeError, match="bootstrap"):
        script.install(queue)
    assert queue.get_setting("paused") is False
    assert not (tmp_path / "Library/LaunchAgents" / f"{script.LAUNCH_AGENT_LABEL}.plist").exists()


def test_install_refuses_to_interrupt_running_browser_work(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    queue.enqueue_engagement(
        school="ubc",
        recipient_id="123",
        account_username="ubc.wat2do.io",
        post_url="https://www.instagram.com/p/abc/",
    )
    queue.claim_next()
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(
        launch_agents.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("must keep worker alive"),
    )
    with pytest.raises(RuntimeError, match="current browser jobs"):
        script.install(queue)
    assert queue.get_setting("paused") is False


def test_concurrent_installs_cannot_overwrite_pause_ownership(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.sys, "platform", "darwin")
    with (queue.state_directory / "worker-install.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match="installation is still running"):
            script.install(queue)
    assert queue.get_setting("paused", False) is False


def test_install_refuses_to_interrupt_an_active_media_import(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.sys, "platform", "darwin")
    with (queue.state_directory / "ingestion.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match="current browser media import"):
            script.install(queue)
    assert queue.get_setting("paused", False) is False


def test_install_cannot_erase_a_new_runtime_safety_pause(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)

    def bootstrap(*_args, **_kwargs):
        queue.set_setting("paused", "Instagram account requires reauthentication")

    monkeypatch.setattr(script, "install_launch_agent", bootstrap)
    script.install(queue)
    assert queue.get_setting("paused") == "Instagram account requires reauthentication"


@pytest.mark.parametrize("prior_pause", [False, "Instagram account requires reauthentication"])
def test_install_preserves_a_recovery_pause_when_service_restoration_is_uncertain(
    tmp_path, monkeypatch, prior_pause
):
    queue = BrowserJobQueue(tmp_path / "state")
    queue.set_setting("paused", prior_pause)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)

    def bootstrap(*_args, **_kwargs):
        raise script.LaunchAgentRecoveryError("previous service recovery remains uncertain")

    monkeypatch.setattr(script, "install_launch_agent", bootstrap)
    with pytest.raises(script.LaunchAgentRecoveryError):
        script.install(queue)
    assert queue.get_setting("paused") == (
        prior_pause or "Browser worker installation recovery is uncertain; inspect before resuming"
    )


def test_install_acquisition_cannot_replace_an_auth_hold_written_after_its_read(
    tmp_path, monkeypatch
):
    queue = BrowserJobQueue(tmp_path / "state")
    newer = BrowserJobQueue(queue.state_directory)
    auth_hold = "Instagram account requires reauthentication"
    compare = queue.compare_set_pause
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)

    def race(expected, value):
        newer.set_setting("paused", auth_hold)
        return compare(expected, value)

    monkeypatch.setattr(queue, "compare_set_pause", race)

    monkeypatch.setattr(
        script,
        "install_launch_agent",
        lambda *_args, **_kwargs: pytest.fail("must preserve the newly acquired auth hold"),
    )
    with pytest.raises(RuntimeError, match="pause changed during setup"):
        script.install(queue)
    assert queue.get_setting("paused") == auth_hold


def test_install_lost_acquisition_fails_before_service_changes_if_pause_is_false(
    tmp_path, monkeypatch
):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(queue, "compare_set_pause", lambda *_args: False)
    monkeypatch.setattr(
        script,
        "install_launch_agent",
        lambda *_args, **_kwargs: pytest.fail("must not replace an unpaused worker"),
    )
    with pytest.raises(RuntimeError, match="pause changed during setup"):
        script.install(queue)
    assert queue.get_setting("paused", False) is False


def test_install_exclusively_holds_admission_and_restores_an_existing_pause(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    prior = "Browser storage recovery is pending"
    queue.set_setting("paused", prior)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)

    def bootstrap(*_args, **_kwargs):
        assert queue.get_setting("paused") == "Browser worker installation in progress"
        assert queue.compare_set_pause(prior, False) is False

    monkeypatch.setattr(script, "install_launch_agent", bootstrap)
    script.install(queue)
    assert queue.get_setting("paused") == prior


def test_inspect_only_enqueues_read_only_jobs_with_enabled_account(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        source,
        "get_engagement_account",
        lambda school: source.EngagementAccount(school, "123", "ubc.wat2do.io"),
    )
    assert (
        script.main(
            [
                "--state-directory",
                str(tmp_path),
                "inspect",
                "--school",
                "ubc",
                "--url",
                "https://www.instagram.com/p/abc/",
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    queue = BrowserJobQueue(tmp_path)
    jobs = [queue.get(job_id) for job_id in result["jobs"]]
    assert len(jobs) == 1
    assert "action" not in jobs[0].payload
    assert all(job.payload["dry_run"] and job.state == "pending" for job in jobs)
    assert all(job.recipient_id == "123" and job.school == "ubc" for job in jobs)


def test_once_cannot_start_collector(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(script, "run_worker", lambda queue, **kwargs: calls.append(kwargs))
    assert script.main(["--state-directory", str(tmp_path), "worker", "--once"]) == 0
    assert calls == [{"once": True, "collect": False}]


def test_operator_can_pause_inspect_retry_and_cancel(tmp_path, capsys):
    args = ["--state-directory", str(tmp_path)]
    queue = BrowserJobQueue(tmp_path)
    job_id = queue.enqueue_engagement(
        school="ubc",
        recipient_id="123",
        account_username="ubc.wat2do.io",
        post_url="https://www.instagram.com/p/abc/",
    )
    assert script.main(args + ["pause"]) == 0
    assert queue.get_setting("paused") is True
    assert script.main(args + ["cancel", "--job-id", job_id]) == 0
    assert queue.get(job_id).state == "cancelled"
    assert script.main(args + ["retry", "--job-id", job_id]) == 0
    assert queue.get(job_id).state == "pending"
    assert script.main(args + ["resume"]) == 0
    assert queue.get_setting("paused") is False
    capsys.readouterr()
    assert script.main(args + ["status", "--job-id", job_id]) == 0
    assert json.loads(capsys.readouterr().out)["id"] == job_id


def test_unknown_job_returns_failure(tmp_path, capsys):
    assert script.main(["--state-directory", str(tmp_path), "cancel", "--job-id", "missing"]) == 1
    assert "does not exist" in capsys.readouterr().err


@pytest.mark.parametrize("outcome", ["failed", "blocked", "invalid", "busy"])
def test_import_reports_incomplete_outcomes_as_failure(tmp_path, monkeypatch, capsys, outcome):
    from services.instagram_notifications import notification_ingestion

    monkeypatch.setattr(notification_ingestion, "import_retrieved_media", lambda _: {outcome: 1})

    assert script.main(["--state-directory", str(tmp_path), "ingestion-import"]) == 1
    assert json.loads(capsys.readouterr().out) == {outcome: 1}


def test_ingestion_ready_prints_review_targets_without_starting_work(tmp_path, monkeypatch, capsys):
    from services.instagram_notifications import notification_ingestion

    preview = {
        "targets": [{"school": "mun", "job_id": "public-read"}],
        "suggested_next_cursor": {"last_school": "mun", "next_newest": {"mun": False}},
        "totals": {"ready": 136, "selected": 1},
    }
    monkeypatch.setattr(notification_ingestion, "ready_review_targets", lambda queue: preview)
    monkeypatch.setattr(
        script, "run_worker", lambda *_, **__: pytest.fail("Preview cannot start work")
    )

    assert script.main(["--state-directory", str(tmp_path), "ingestion-ready"]) == 0
    assert json.loads(capsys.readouterr().out) == preview
    assert BrowserJobQueue(tmp_path).get_setting(notification_ingestion._REVIEW_CURSOR) is None


def test_resume_preserves_installer_owned_pause(tmp_path, capsys):
    queue = BrowserJobQueue(tmp_path)
    queue.set_setting("paused", script.WORKER_INSTALLATION_PAUSE)

    assert script.main(["--state-directory", str(tmp_path), "resume"]) == 1
    assert queue.get_setting("paused") == script.WORKER_INSTALLATION_PAUSE
    assert "installation before resuming" in capsys.readouterr().err


def test_resume_cannot_erase_a_concurrent_safety_hold(tmp_path, monkeypatch, capsys):
    original = BrowserJobQueue.compare_set_pause
    hold = "Instagram requires human account recovery"

    def acquire_safety_hold(queue, expected, value):
        queue.set_setting("paused", hold)
        return original(queue, expected, value)

    monkeypatch.setattr(BrowserJobQueue, "compare_set_pause", acquire_safety_hold)

    assert script.main(["--state-directory", str(tmp_path), "resume"]) == 1
    assert BrowserJobQueue(tmp_path).get_setting("paused") == hold
    assert "pause changed" in capsys.readouterr().err
