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


def test_school_option_preserves_existing_default(monkeypatch):
    from scripts.profile_production_api import parse_args

    monkeypatch.setattr("sys.argv", ["profile_production_api.py", "--email", "admin@example.com"])
    assert parse_args().school == "uwaterloo"
    monkeypatch.setattr(
        "sys.argv", ["profile_production_api.py", "--email", "admin@example.com", "--school", "UWO"]
    )
    assert parse_args().school == "uwo"


def test_school_scoping_reuses_inventory_and_preserves_unscoped_routes():
    from scripts.profile_production_api import PUBLIC_ENDPOINTS, school_endpoints

    default = {endpoint.label: endpoint for endpoint in school_endpoints("uwaterloo")}
    western = {endpoint.label: endpoint for endpoint in school_endpoints("uwo")}
    assert set(default) == set(western) == {endpoint.label for endpoint in PUBLIC_ENDPOINTS}
    assert default["/schools"].path == "/schools?q=waterloo&limit=10"
    for label in ("/events/", "/events/stats", "/positions/", "/clubs/", "/qr/map"):
        assert httpx.URL(western[label].path).params["school"] == "uwo"
    for label in ("/health", "/meta/constants"):
        assert western[label] == default[label]
    assert httpx.URL(western["/schools"].path).params["q"] == "uwo"


def test_dynamic_detail_discovery_stays_in_selected_school():
    from scripts.profile_production_api import discover_dynamic_endpoints

    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path == "/api/events/":
            return httpx.Response(200, json={"items": [{"id": 42}]})
        if request.url.path == "/api/positions/":
            return httpx.Response(200, json={"items": [{"id": 41}]})
        if request.url.path == "/api/clubs/":
            return httpx.Response(200, json={"items": [{"id": 7}]})
        if request.url.path == "/api/clubs/mine":
            return httpx.Response(
                200, json=[{"id": 99, "school": "uwaterloo"}, {"id": 8, "school": "uwo"}]
            )
        return httpx.Response(200, json={"items": []})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        endpoints, _ = discover_dynamic_endpoints(
            client, "https://example.test/api", "secret", "user", school="uwo"
        )
    paths = {endpoint.label: endpoint.path for endpoint in endpoints}
    assert paths["/events/{event_id}"] == "/events/42"
    assert paths["/positions/{position_id}"] == "/positions/41"
    assert paths["/clubs/{club_id}"] == "/clubs/8"
    assert paths["/clubs/{club_id}/members"] == "/clubs/8/members"
    scoped_requests = [
        request
        for request in requests
        if request.url.path in {"/api/events/", "/api/positions/", "/api/clubs/"}
    ]
    assert len(scoped_requests) == 3
    assert all(
        request.method == "GET" and request.url.params["school"] == "uwo"
        for request in scoped_requests
    )
    assert all(request.method == "GET" for request in requests)


def test_profiler_classifies_every_current_get_without_obsolete_routes():
    from scripts.profile_production_api import audit_openapi_coverage

    coverage = audit_openapi_coverage()
    assert coverage["unclassified_get_routes"] == []
    assert coverage["stale_classifications"] == []
    assert coverage["get_route_count"] == coverage["classified_route_count"]


def test_oauth_routes_are_never_profiled_or_discovered():
    from scripts.profile_production_api import SKIPPED_GET_ROUTES, _known_get_paths

    oauth_routes = {"/auth/google", "/auth/google/callback"}
    assert oauth_routes <= set(SKIPPED_GET_ROUTES)
    assert not oauth_routes & _known_get_paths()


def test_incomplete_classification_stops_before_authentication(monkeypatch):
    from unittest.mock import Mock

    import pytest

    from scripts import profile_production_api as profiler

    monkeypatch.setattr("sys.argv", ["profile_production_api.py", "--email", "admin@example.com"])
    monkeypatch.setattr(
        profiler,
        "audit_openapi_coverage",
        lambda: {"unclassified_get_routes": ["/new-read"], "stale_classifications": []},
    )
    authenticate = Mock()
    monkeypatch.setattr(profiler, "authenticate", authenticate)
    with pytest.raises(SystemExit, match="before authentication"):
        profiler.main()
    authenticate.assert_not_called()
