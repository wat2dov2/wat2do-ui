from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from services import ingestion_latency_service as module


def test_report_breaks_catches_down_by_kind_school_and_hour(monkeypatch):
    rows = [
        {
            "school": "uwaterloo",
            "kind": "new",
            "caught_at": "2026-10-10T14:05:00+00:00",
            "latency_seconds": 600,
        },
        {
            "school": "uwaterloo",
            "kind": "new",
            "caught_at": "2026-10-10T14:40:00+00:00",
            "latency_seconds": 1800,
        },
        {
            "school": "uwaterloo",
            "kind": "update",
            "caught_at": "2026-10-10T15:10:00+00:00",
            "latency_seconds": 120,
        },
        {
            "school": "mcgill",
            "kind": "new",
            "caught_at": "2026-10-10T15:20:00+00:00",
            "latency_seconds": 3600,
        },
    ]
    calls = []

    def rpc(name, params):
        calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=rows))

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(rpc=rpc))

    report = module.get_report(7)

    assert calls[0][0] == "ingestion_latencies"
    assert report.new_events.count == 3
    assert report.new_events.mean_minutes == pytest.approx(100 / 3)
    assert report.new_events.median_minutes == 30.0
    assert (report.updates.count, report.updates.median_minutes) == (1, 2.0)
    assert [school.school for school in report.schools] == ["mcgill", "uwaterloo"]
    waterloo = report.schools[1]
    assert (waterloo.new_events.count, waterloo.new_events.mean_minutes) == (2, 20.0)
    assert (waterloo.updates.count, waterloo.updates.mean_minutes) == (1, 2.0)
    assert report.schools[0].updates.count == 0 and report.schools[0].updates.mean_minutes is None
    assert [(hour.hour, hour.count, hour.median_minutes) for hour in report.hourly] == [
        (datetime(2026, 10, 10, 14, tzinfo=UTC), 2, 20.0),
        (datetime(2026, 10, 10, 15, tzinfo=UTC), 2, 31.0),
    ]


def test_report_without_catches_is_empty(monkeypatch):
    monkeypatch.setattr(
        module,
        "get_sb",
        lambda: SimpleNamespace(
            rpc=lambda *_: SimpleNamespace(execute=lambda: SimpleNamespace(data=None))
        ),
    )
    report = module.get_report(1)
    assert report.new_events.count == 0 and report.new_events.mean_minutes is None
    assert report.schools == [] and report.hourly == []
