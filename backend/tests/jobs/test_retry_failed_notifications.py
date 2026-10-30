import json
import sys

import services.notification_retry as service
from jobs import retry_failed_notifications as job


def test_launch_agent_runs_daily_at_three():
    payload = job.launch_agent_payload()
    assert payload["Label"] == "io.wat2do.notification-retry"
    assert payload["StartCalendarInterval"] == {"Hour": 3, "Minute": 0}
    assert payload["ProgramArguments"][-1] == "run"
    assert "StartInterval" not in payload


def test_run_command_prints_result_and_exits_zero(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["job", "run"])
    monkeypatch.setattr(
        service, "retry_failed_notifications", lambda: {"failed_runs": 0, "reran": []}
    )

    assert job.main() == 0
    assert json.loads(capsys.readouterr().out) == {"failed_runs": 0, "reran": []}


def test_run_command_exits_nonzero_on_error(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["job", "run"])
    monkeypatch.setattr(
        service, "retry_failed_notifications", lambda: {"failed_runs": 0, "error": "gh failed"}
    )

    assert job.main() == 1
