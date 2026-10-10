from datetime import UTC, datetime
from unittest.mock import Mock

from schemas.ingestion_latency import IngestionLatencyResponse, LatencyStats
from services import ingestion_latency_service

_EMPTY = LatencyStats(count=0, mean_minutes=None, median_minutes=None)


def test_latency_report_is_admin_only(authenticated_client):
    assert authenticated_client.get("/ingestion-latency/").status_code == 403


def test_latency_report_reads_the_requested_window(admin_client, monkeypatch):
    report = IngestionLatencyResponse(
        since=datetime(2026, 10, 3, tzinfo=UTC),
        new_events=_EMPTY,
        updates=_EMPTY,
        schools=[],
        hourly=[],
    )
    read = Mock(return_value=report)
    monkeypatch.setattr(ingestion_latency_service, "get_report", read)

    response = admin_client.get("/ingestion-latency/", params={"days": 30})

    assert response.status_code == 200
    read.assert_called_once_with(30)
    assert response.json()["new_events"] == {
        "count": 0,
        "mean_minutes": None,
        "median_minutes": None,
    }
    assert admin_client.get("/ingestion-latency/", params={"days": 31}).status_code == 422
