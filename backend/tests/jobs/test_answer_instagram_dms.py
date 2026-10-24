import json
import sys

import pytest

from jobs import answer_instagram_dms as job


def test_launch_agent_wakes_run_often_without_logs():
    payload = job.launch_agent_payload()
    assert payload["ProgramArguments"][-1] == "run"
    assert payload["StartInterval"] == job.controlbox.instagram_dms.sweep_check_interval_seconds
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"


@pytest.mark.parametrize(
    ("command", "result", "code"),
    [
        ("run", {"status": "waiting", "next_run_at": 1.0}, 0),
        ("sweep", {"status": "swept", "replied": 1, "failed": []}, 0),
        ("sweep", {"status": "swept", "failed": ["ubc"]}, 1),
        ("run", {"status": "paused", "reason": "check the thread"}, 1),
    ],
)
def test_commands_print_their_result_and_fail_on_pauses_or_failures(
    monkeypatch, capsys, command, result, code
):
    monkeypatch.setattr(sys, "argv", ["job", command])
    monkeypatch.setattr(job.sweep, "sweep", lambda: result)
    monkeypatch.setattr(job.sweep, "run_if_due", lambda: result)
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == result
