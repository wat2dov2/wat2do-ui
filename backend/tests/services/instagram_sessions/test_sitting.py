from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from services.claude_code import ClaudeLimited
from services.instagram_sessions import sitting

TORONTO = ZoneInfo("America/Toronto")
MORNING = datetime(2026, 11, 22, 9, 40, tzinfo=TORONTO)
EARLY = datetime(2026, 11, 22, 9, 0, tzinfo=TORONTO)


class _Table:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return SimpleNamespace(data=self.rows)


@pytest.fixture
def state(monkeypatch, tmp_path):
    """Which schools have a carousel waiting and a draft ready; sittings kept in tmp."""
    tables = {"waiting": [], "ready": []}
    monkeypatch.setattr(sitting, "STATE_PATH", tmp_path / "sat.json")
    monkeypatch.setattr(sitting, "_waiting_carousels", lambda moment: list(tables["waiting"]))
    monkeypatch.setattr(sitting, "_ready_drafts", lambda day: set(tables["ready"]))
    return tables


def test_before_the_start_time_only_carousels_posted_outside_a_sitting_are_due(state):
    state["waiting"] = ["uwo"]
    assert sitting.due(EARLY) == ["uwo"]


def test_from_the_start_time_every_school_sits_once_posting_schools_first(state):
    state["ready"] = ["uwo", "carleton"]
    due = sitting.due(MORNING)
    assert due[:2] == ["carleton", "uwo"]
    assert set(due) == set(sitting.EMULATOR.android_user_by_school)
    sitting._mark_sat("carleton", MORNING.date())
    assert sitting.due(MORNING)[0] == "uwo"
    assert "carleton" not in sitting.due(MORNING)


def test_a_waiting_carousel_comes_before_the_morning_round(state):
    state["waiting"] = ["yorku"]
    state["ready"] = ["carleton"]
    assert sitting.due(MORNING)[:2] == ["yorku", "carleton"]


def test_no_sitting_outside_action_hours(state):
    state["waiting"] = ["uwo"]
    assert sitting.due(MORNING.replace(hour=sitting.EMULATOR.action_end_hour)) == []


def test_only_the_last_week_of_sittings_is_kept(state):
    old = MORNING.date() - timedelta(days=8)
    sitting._mark_sat("uwo", old)
    sitting._mark_sat("ubc", MORNING.date())
    assert sitting._sat_on(old) == []
    assert sitting._sat_on(MORNING.date()) == ["ubc"]


class _Device:
    def __init__(self):
        self.released = False

    def release_screen(self):
        self.released = True


def test_a_sitting_runs_claude_with_only_the_ig_command_on_the_second_login(monkeypatch, state):
    seen = {}

    def run_agent(prompt, **options):
        seen.update(options, prompt=prompt)
        return {
            "posted": True,
            "finished": True,
            "stories": "3 of 3",
            "drafts": 2,
            "claim_drafts": 1,
            "problems": "",
        }

    monkeypatch.setattr(sitting, "run_agent", run_agent)
    monkeypatch.setattr(
        sitting.school_service,
        "get_school",
        lambda slug: SimpleNamespace(name="Western University"),
    )
    device = _Device()
    report = sitting.run(device, "uwo", MORNING)
    assert report["drafts"] == 2
    assert device.released
    assert seen["tools"] == ("Bash", "Read")
    assert seen["allowed_tools"] == ("Bash(ig:*)", "Read(./**)")
    env = seen["env"]
    assert env["WAT2DO_SITTING_SCHOOL"] == "uwo"
    assert env["WAT2DO_EMULATOR_HELD"] == "1"
    assert env["PATH"].startswith(str(sitting.HERE))
    assert env["CLAUDE_CONFIG_DIR"].endswith(sitting.CONTROL.claude_config_dir.lstrip("~"))
    # No application secret reaches the sitting.
    assert not any("DATABASE" in key or "KEY" in key for key in env)
    assert "wat2do.uwo" in seen["prompt"] and "Western University" in seen["prompt"]
    assert "{{" not in seen["prompt"]
    assert sitting._sat_on(MORNING.date()) == ["uwo"]


def test_claudes_usage_limit_leaves_the_sitting_due(monkeypatch, state):
    def limited(prompt, **options):
        raise ClaudeLimited("hit Claude's usage limit")

    monkeypatch.setattr(sitting, "run_agent", limited)
    monkeypatch.setattr(sitting.school_service, "get_school", lambda slug: None)
    assert sitting.run(_Device(), "uwo", MORNING) is None
    assert sitting._sat_on(MORNING.date()) == []


def test_a_waiting_carousel_is_retried_only_after_the_retry_gap(monkeypatch):
    moment = datetime(2026, 11, 22, 15, tzinfo=timezone.utc)
    just_tried = (moment - timedelta(minutes=1)).isoformat()
    waited = (moment - timedelta(minutes=sitting.PUBLISHING.music_retry_minutes)).isoformat()
    rows = [
        {
            "music_attempts": 1,
            "updated_at": just_tried,
            "published_at": just_tried,
            "school_record": {"slug": "uwo"},
        },
        {
            "music_attempts": 1,
            "updated_at": waited,
            "published_at": waited,
            "school_record": {"slug": "ubc"},
        },
        {
            "music_attempts": 0,
            "updated_at": just_tried,
            "published_at": just_tried,
            "school_record": {"slug": "sfu"},
        },
    ]
    monkeypatch.setattr(sitting, "get_sb", lambda: SimpleNamespace(table=lambda name: _Table(rows)))
    assert sitting._waiting_carousels(moment) == ["ubc", "sfu"]
