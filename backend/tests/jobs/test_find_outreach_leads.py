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


@pytest.mark.parametrize(
    ("research_failed", "pitch_failed", "code"), [(0, 0, 0), (2, 0, 1), (0, 1, 1)]
)
def test_sweep_prints_its_result_and_fails_when_any_agent_failed(
    monkeypatch, capsys, research_failed, pitch_failed, code
):
    from services.outreach import finder

    result = {"page_emails": 4, "research_failed": research_failed, "pitch_failed": pitch_failed}
    monkeypatch.setattr(sys, "argv", ["job", "sweep"])
    monkeypatch.setattr(finder, "sweep", lambda: result)
    assert job.main() == code
    assert json.loads(capsys.readouterr().out) == result


def test_pitch_backfills_the_named_schools(monkeypatch, capsys):
    from services.outreach import pitch

    asked = []
    result = {"pitch_fit": 2, "pitch_not_fit": 1, "pitch_failed": 0}
    monkeypatch.setattr(sys, "argv", ["job", "pitch", "--school", "uwaterloo", "--limit", "5"])
    monkeypatch.setattr(
        pitch, "write_pitches", lambda schools, limit: asked.append((schools, limit)) or result
    )
    assert job.main() == 0
    assert asked == [(["uwaterloo"], 5)]
    assert json.loads(capsys.readouterr().out) == result
