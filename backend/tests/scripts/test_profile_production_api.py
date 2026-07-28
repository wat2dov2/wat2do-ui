from datetime import datetime, timezone

import httpx

from scripts.profile_production_api import (
    DEFAULT_SAMPLES,
    Endpoint,
    _first_id,
    _percentile,
    profile_endpoint,
    render_latency_distribution_svg,
    write_profile_artifacts,
)


def test_percentile_uses_linear_interpolation():
    assert _percentile([10.0, 20.0, 30.0], 0.95) == 29.0
    assert _percentile([10.0], 0.95) == 10.0
    assert _percentile([], 0.95) is None


def test_default_sample_count_is_ten():
    assert DEFAULT_SAMPLES == 10


def test_first_id_supports_paginated_and_list_responses():
    assert _first_id({"items": [{"id": "page-id"}]}) == "page-id"
    assert _first_id([{"id": 42}]) == "42"
    assert _first_id({"items": []}) is None


def test_profile_endpoint_records_metadata_without_response_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(
            200,
            content=b'{"private":"response"}',
            headers={
                "content-type": "application/json",
                "x-cache": "Miss from cloudfront",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = profile_endpoint(
            client,
            "https://example.test/api",
            Endpoint("/users/me", "/users/me", True),
            "secret",
            warmups=1,
            samples=2,
        )

    assert result.statuses == [200, 200]
    assert result.response_bytes == [22, 22]
    assert result.content_types == ["application/json", "application/json"]
    assert result.cache_statuses == [
        "Miss from cloudfront",
        "Miss from cloudfront",
    ]
    assert result.mean_ms is not None
    assert result.median_ms is not None
    assert result.p95_ms is not None
    assert "private" not in repr(result)


def test_profile_endpoint_always_reports_summary_metrics():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"ok")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = profile_endpoint(
            client,
            "https://example.test/api",
            Endpoint("/health", "/health", False),
            None,
            warmups=0,
            samples=1,
        )

    assert result.mean_ms is not None
    assert result.median_ms is not None
    assert result.p95_ms is not None
    assert result.min_ms is not None
    assert result.max_ms is not None


def test_write_profile_artifacts_creates_timestamped_run_directory(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(
        "scripts.profile_production_api.TEMP_OUTPUT_DIR",
        tmp_path,
    )

    started_at = datetime(2026, 7, 28, 18, 29, 21, 551339, tzinfo=timezone.utc)
    output = {
        "run": 1,
        "results": [
            {
                "endpoint": "/health",
                "authenticated": False,
                "samples_ms": [40.0, 50.0, 60.0],
                "median_ms": 50.0,
                "error": None,
            }
        ],
    }

    run_directory = write_profile_artifacts(output, started_at)

    assert run_directory == tmp_path / "20260728T182921.551339Z"
    assert sorted(path.name for path in run_directory.iterdir()) == [
        "latency-distributions.svg",
        "profile.json",
    ]
    assert '"latency_distributions": "latency-distributions.svg"' in (
        run_directory / "profile.json"
    ).read_text(encoding="utf-8")


def test_latency_distribution_svg_contains_samples_and_escaped_endpoint():
    started_at = datetime(2026, 7, 28, 18, 29, 21, tzinfo=timezone.utc)
    svg = render_latency_distribution_svg(
        [
            {
                "endpoint": "/events/?search=<script>",
                "authenticated": False,
                "samples_ms": [100.0, 150.0, 200.0],
                "median_ms": 150.0,
                "error": None,
            }
        ],
        started_at,
    )

    assert "<svg" in svg
    assert svg.count("<circle") == 4
    assert "&lt;script&gt;" in svg
    assert "<script>" not in svg
