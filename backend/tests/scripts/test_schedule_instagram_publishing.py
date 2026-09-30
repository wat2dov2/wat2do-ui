from datetime import datetime, timezone

import pytest

from scripts import schedule_instagram_publishing as scheduler


def moment(value):
    return datetime.fromisoformat(value).astimezone(timezone.utc)


@pytest.fixture
def dispatches(monkeypatch):
    result = []
    monkeypatch.setattr(scheduler, "_runs", lambda: [])
    monkeypatch.setattr(scheduler, "_dispatch", lambda: result.append(True))
    return result


@pytest.mark.parametrize(
    "before,due",
    [
        ("2026-09-30T12:59:59+00:00", "2026-09-30T13:00:00+00:00"),
        ("2026-12-01T13:59:59+00:00", "2026-12-01T14:00:00+00:00"),
    ],
)
def test_dispatches_at_nine_toronto_in_both_dst_seasons(tmp_path, dispatches, before, due):
    assert scheduler.check(tmp_path, moment(before))["status"] == "before_generation_time"
    assert scheduler.check(tmp_path, moment(due))["status"] == "dispatched"
    assert dispatches == [True]


def test_recovers_after_missed_start_without_dispatching_twice(tmp_path, dispatches):
    now = moment("2026-09-30T15:00:00+00:00")
    assert scheduler.check(tmp_path, now)["status"] == "dispatched"
    assert scheduler.check(tmp_path, now)["status"] == "retry_wait"
    assert dispatches == [True]


def test_skips_successful_daily_run(tmp_path, dispatches, monkeypatch):
    monkeypatch.setattr(
        scheduler,
        "_runs",
        lambda: [
            {"status": "completed", "conclusion": "success", "createdAt": "2026-09-30T13:00:00Z"}
        ],
    )
    assert scheduler.check(tmp_path, moment("2026-09-30T13:01:00Z"))["status"] == "complete"
    assert not dispatches


def test_prior_days_active_run_prevents_overlap(tmp_path, dispatches, monkeypatch):
    monkeypatch.setattr(
        scheduler,
        "_runs",
        lambda: [{"status": "in_progress", "conclusion": "", "createdAt": "2026-09-29T13:00:00Z"}],
    )
    assert scheduler.check(tmp_path, moment("2026-09-30T13:01:00Z"))["status"] == "workflow_active"
    assert not dispatches


def test_retries_are_bounded_and_reset_the_next_day(tmp_path, dispatches):
    for minute in [0, 10, 20]:
        assert (
            scheduler.check(tmp_path, moment(f"2026-09-30T13:{minute:02}:00Z"))["status"]
            == "dispatched"
        )
    assert (
        scheduler.check(tmp_path, moment("2026-09-30T13:30:00Z"))["status"] == "attempts_exhausted"
    )
    assert scheduler.check(tmp_path, moment("2026-10-01T13:00:00Z"))["status"] == "dispatched"
    assert len(dispatches) == 4


def test_failed_dispatch_is_recorded_before_retry(tmp_path, dispatches, monkeypatch):
    def fail():
        raise TimeoutError("dispatch response timed out")

    monkeypatch.setattr(scheduler, "_dispatch", fail)
    now = moment("2026-09-30T13:00:00Z")
    with pytest.raises(TimeoutError):
        scheduler.check(tmp_path, now)
    assert scheduler.check(tmp_path, now)["status"] == "retry_wait"


def test_launchd_uses_calendar_trigger_and_recovery_checks(tmp_path):
    payload = scheduler.launch_agent_payload(tmp_path)
    assert payload["StartCalendarInterval"] == {"Hour": 9, "Minute": 0}
    assert payload["StartInterval"] == 60
    assert payload["RunAtLoad"] is True
