import json
import sys

import pytest

from jobs import find_outreach_leads as job


def test_launch_agent_sweeps_on_the_control_box_interval_without_logs():
    payload = job.launch_agent_payload()
    assert payload["ProgramArguments"][-1] == "sweep"
    assert payload["StartInterval"] == job.controlbox.outreach.sweep_interval_hours * 3600
    assert payload["StandardOutPath"] == payload["StandardErrorPath"] == "/dev/null"
    assert ".local/bin" in payload["EnvironmentVariables"]["PATH"]


@pytest.mark.parametrize(("failed", "code"), [([], 0), (["campaign/uwaterloo"], 1)])
def test_sweep_prints_its_result_and_fails_when_a_search_failed(monkeypatch, capsys, failed, code):
    from services.outreach import finder

    monkeypatch.setattr(sys, "argv", ["job", "sweep"])
    monkeypatch.setattr(finder, "sweep", lambda: {"saved": 4, "failed": failed})
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == {"saved": 4, "failed": failed}
