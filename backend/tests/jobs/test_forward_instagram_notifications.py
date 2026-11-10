import sys

from jobs import forward_instagram_notifications as job


def test_launch_agent_keeps_the_forwarder_alive_with_a_log_and_finds_gh():
    payload = job.launch_agent_payload()
    assert payload["Label"] == "io.wat2do.notification-forwarding"
    assert payload["ProgramArguments"][-1] == "run"
    assert payload["KeepAlive"] is True
    assert "StartInterval" not in payload
    log = str(job.notification_forwarding.LOG_PATH)
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == log
    assert "/opt/homebrew/bin" in payload["EnvironmentVariables"]["PATH"].split(":")


def test_run_forwards_and_a_dry_run_only_listens(monkeypatch):
    runs = []
    monkeypatch.setattr(
        job.notification_forwarding, "run_forever", lambda *, dry_run: runs.append(dry_run)
    )
    for argv in (["job", "run"], ["job", "run", "--dry-run"]):
        monkeypatch.setattr(sys, "argv", argv)
        assert job.main() == 0
    assert runs == [False, True]


def test_install_schedule_makes_the_log_folder_before_installing(monkeypatch, tmp_path, capsys):
    installed = []
    folder = tmp_path / "notification-forwarding"
    monkeypatch.setattr(job.notification_forwarding, "LOG_PATH", folder / "forwarder.log")
    monkeypatch.setattr(
        job,
        "install_launch_agent",
        lambda path, payload, **_kwargs: installed.append((path.name, folder.is_dir())),
    )
    monkeypatch.setattr(sys, "argv", ["job", "install-schedule"])
    assert job.main() == 0
    assert installed == [("io.wat2do.notification-forwarding.plist", True)]
    assert capsys.readouterr().out.strip() == "Installed io.wat2do.notification-forwarding"
