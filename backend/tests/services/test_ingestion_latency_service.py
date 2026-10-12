from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from services import ingestion_latency_service as module


def test_report_breaks_delays_down_by_school_and_hour(monkeypatch):
    rows = [
        {"school": "uwaterloo", "added_at": "2026-10-10T14:05:00+00:00", "latency_seconds": 600},
        {"school": "uwaterloo", "added_at": "2026-10-10T14:40:00+00:00", "latency_seconds": 1800},
        {"school": "mcgill", "added_at": "2026-10-10T15:20:00+00:00", "latency_seconds": 3600},
    ]
    calls = []

    def rpc(name, params):
        calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=rows))

    monkeypatch.setattr(module, "get_sb", lambda: SimpleNamespace(rpc=rpc))

    report = module.get_report(7)

    assert calls[0][0] == "ingestion_latencies"
    assert report.overall.count == 3
    assert report.overall.mean_minutes == pytest.approx(100 / 3)
    assert report.overall.median_minutes == 30.0
    assert [school.school for school in report.schools] == ["mcgill", "uwaterloo"]
    waterloo = report.schools[1]
    assert (waterloo.count, waterloo.mean_minutes, waterloo.median_minutes) == (2, 20.0, 20.0)
    assert [(hour.hour, hour.count, hour.median_minutes) for hour in report.hourly] == [
        (datetime(2026, 10, 10, 14, tzinfo=UTC), 2, 20.0),
        (datetime(2026, 10, 10, 15, tzinfo=UTC), 1, 60.0),
    ]


def test_report_without_events_is_empty(monkeypatch):
    monkeypatch.setattr(
        module,
        "get_sb",
        lambda: SimpleNamespace(
            rpc=lambda *_: SimpleNamespace(execute=lambda: SimpleNamespace(data=None))
        ),
    )
    report = module.get_report(1)
    assert report.overall.count == 0 and report.overall.mean_minutes is None
    assert report.schools == [] and report.hourly == []
