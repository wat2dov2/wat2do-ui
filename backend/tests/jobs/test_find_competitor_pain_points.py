import json
import sys

import pytest

from jobs import find_competitor_pain_points as job


def test_launch_agent_sweeps_every_few_hours_without_logs():
    payload = job.launch_agent_payload()
    assert payload["ProgramArguments"][-1] == "sweep"
    assert (
        payload["StartInterval"]
        == job.controlbox.competitor_pain_points.sweep_interval_hours * 3600
    )
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"
    assert ".local/bin" in payload["EnvironmentVariables"]["PATH"]


@pytest.mark.parametrize(
    ("failed", "report", "code"),
    [([], "written", 0), (["meetup/x"], "written", 1), ([], "failed", 1)],
)
def test_sweep_then_reports_and_fails_when_either_part_failed(
    monkeypatch, capsys, failed, report, code
):
    from services.competitor_pain_points import finder

    monkeypatch.setattr(sys, "argv", ["job", "sweep"])
    monkeypatch.setattr(finder, "sweep", lambda: {"saved": 2, "failed": failed})
    monkeypatch.setattr(job, "_report", lambda: report)
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == {"saved": 2, "failed": failed, "report": report}


def test_report_command_writes_only_the_report(monkeypatch, capsys):
    from services.claude_code import ClaudeCodeError
    from services.competitor_pain_points import finder, report

    def fail():
        raise ClaudeCodeError("failed (exit 1)")

    monkeypatch.setattr(sys, "argv", ["job", "report"])
    monkeypatch.setattr(finder, "sweep", lambda: pytest.fail("report must not sweep"))
    monkeypatch.setattr(report, "write_daily_report", fail)
    assert job.main() == 1
    assert json.loads(capsys.readouterr().out) == {"failed": [], "report": "failed"}
