import json
import plistlib
from types import SimpleNamespace

import pytest

from scripts import instagram_browser as script
from services.instagram_notifications import carousel_engagement as source
from services.instagram_notifications.browser_queue import BrowserJobQueue


def test_install_uses_stable_checkout_and_shared_spool(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    calls = []
    monkeypatch.setattr(
        script.subprocess,
        "run",
        lambda command, **kwargs: calls.append(command) or SimpleNamespace(returncode=0),
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
    assert [call[1] for call in calls] == ["bootout", "enable", "bootstrap"]
    assert "SUPABASE_SECRET_KEY" not in payload["EnvironmentVariables"]


def test_install_reports_failed_bootstrap(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(script.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(script.sys, "platform", "darwin")
    monkeypatch.setattr(
        script.subprocess,
        "run",
        lambda command, **kwargs: SimpleNamespace(returncode=7 if command[1] == "bootstrap" else 0),
    )
    with pytest.raises(RuntimeError, match="bootstrap"):
        script.install(queue)


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
    assert {job.payload["action"] for job in jobs} == {"like", "save", "repost"}
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
        action="save",
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
