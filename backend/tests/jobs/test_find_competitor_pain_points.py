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


@pytest.mark.parametrize(("failed", "code"), [([], 0), (["meetup"], 1)])
def test_sweep_prints_its_result_and_fails_when_a_competitor_failed(
    monkeypatch, capsys, failed, code
):
    from services.competitor_pain_points import finder

    monkeypatch.setattr(sys, "argv", ["job", "sweep"])
    monkeypatch.setattr(finder, "sweep", lambda: {"saved": 2, "failed": failed})
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == {"saved": 2, "failed": failed}
