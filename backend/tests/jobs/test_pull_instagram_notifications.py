import sys

from core.controlbox import controlbox
from jobs import pull_instagram_notifications as job


def test_launch_agent_runs_every_two_hours_through_the_day():
    payload = job.launch_agent_payload()
    assert payload["Label"] == "io.wat2do.notification-pull"
    assert payload["ProgramArguments"][-1] == "run"
    assert [entry["Hour"] for entry in payload["StartCalendarInterval"]] == [
        9,
        11,
        13,
        15,
        17,
        19,
        21,
        23,
    ]
    assert {entry["Minute"] for entry in payload["StartCalendarInterval"]} == {20}
    # It drives the emulator: a Background job and its children are starved.
    assert payload["ProcessType"] == "Standard"
    # gh, which sends the dispatches, lives in Homebrew's bin.
    assert "/opt/homebrew/bin" in payload["EnvironmentVariables"]["PATH"].split(":")


def test_the_watchdog_checks_the_launch_agent():
    assert job.LAUNCH_AGENT_LABEL in controlbox.maintenance.scheduled_agents


def test_run_prints_one_line_per_account(monkeypatch, capsys):
    asked = []

    def run(*, schools):
        asked.append(schools)
        return [{"school": "mit", "outcome": "read", "dispatched": 1}]

    monkeypatch.setattr(job.pull, "run", run)
    monkeypatch.setattr(sys, "argv", ["job", "run", "--school", "mit"])
    assert job.main() == 0
    assert asked == [["mit"]]
    assert '"dispatched": 1' in capsys.readouterr().out


def test_install_schedule_installs_the_launch_agent(monkeypatch, tmp_path, capsys):
    installed = []
    monkeypatch.setattr(job.pull, "STATE_DIR", tmp_path / "pull")
    monkeypatch.setattr(
        job,
        "install_launch_agent",
        lambda path, payload, **_kwargs: installed.append((path.name, payload["Label"])),
    )
    monkeypatch.setattr(sys, "argv", ["job", "install-schedule"])
    assert job.main() == 0
    assert installed == [("io.wat2do.notification-pull.plist", "io.wat2do.notification-pull")]
