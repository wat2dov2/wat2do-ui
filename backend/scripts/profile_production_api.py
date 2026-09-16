"""Low-load latency profiler for the production Wat2Do API.

The profiler only issues GET requests after authentication. It excludes GET
routes with known write side effects and routes requiring private invitation or
unsubscribe tokens.

Usage:
    cd backend
    .venv/bin/python scripts/profile_production_api.py \
        --email you@example.com
"""

from __future__ import annotations

import argparse
import getpass
import html
import json
import math
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://wat2do.io/api"
DEFAULT_SAMPLES = 10
DEFAULT_WARMUPS = 1
REQUEST_TIMEOUT_SECONDS = 30.0
TEMP_OUTPUT_DIR = Path("/tmp")

SKIPPED_GET_ROUTES = {
    "/calendar/feed/{token}.ics": "Requires a private calendar token.",
    "/calendar/token": "GET may create a calendar token, so it is not read-only.",
    "/notification-preferences/unsubscribe": "Requires a private unsubscribe token.",
    "/clubs/invitations/{token}": "Requires a private invitation token.",
    "/qr/{qr_code_id}": "Records a scan and is intentionally excluded from profiling.",
}


@dataclass(frozen=True)
class Endpoint:
    label: str
    path: str
    authenticated: bool


@dataclass(frozen=True)
class EndpointResult:
    endpoint: str
    authenticated: bool
    statuses: list[int]
    samples_ms: list[float]
    mean_ms: float | None
    median_ms: float | None
    p95_ms: float | None
    min_ms: float | None
    max_ms: float | None
    response_bytes: list[int]
    content_types: list[str]
    cache_statuses: list[str]
    server_timings: list[str]
    error: str | None


PUBLIC_ENDPOINTS = (
    Endpoint("/health", "/health", False),
    Endpoint(
        "/events/",
        "/events/?school=uwaterloo&page=1&page_size=20",
        False,
    ),
    Endpoint("/events/stats", "/events/stats?school=uwaterloo", False),
    Endpoint("/meta/constants", "/meta/constants", False),
    Endpoint(
        "/clubs/",
        "/clubs/?school=uwaterloo&page=1&page_size=20",
        False,
    ),
    Endpoint("/qr/map", "/qr/map?school=uwaterloo", False),
    Endpoint("/schools", "/schools?q=waterloo&limit=10", False),
)

AUTHENTICATED_ENDPOINTS = (
    Endpoint("/events/admin", "/events/admin?page=1&page_size=20", True),
    Endpoint("/going-events/", "/going-events/", True),
    Endpoint(
        "/instagram-publishing/batches/",
        "/instagram-publishing/batches/?page=1&page_size=10",
        True,
    ),
    Endpoint("/notification-preferences", "/notification-preferences", True),
    Endpoint("/clubs/claims", "/clubs/claims", True),
    Endpoint(
        "/clubs/integrations/discord/options",
        "/clubs/integrations/discord/options",
        True,
    ),
    Endpoint(
        "/clubs/integrations/{platform}/options",
        "/clubs/integrations/slack/options",
        True,
    ),
    Endpoint("/clubs/mine", "/clubs/mine", True),
    Endpoint(
        "/clubs/review",
        "/clubs/review?page=1&page_size=10",
        True,
    ),
    Endpoint("/payouts/", "/payouts/?page=1&page_size=10", True),
    Endpoint(
        "/payouts/admin",
        "/payouts/admin?page=1&page_size=10",
        True,
    ),
    Endpoint("/qr/", "/qr/?page=1&page_size=10", True),
    Endpoint("/qr/earnings", "/qr/earnings", True),
    Endpoint("/qr/scans", "/qr/scans?page=1&page_size=10", True),
    Endpoint("/reports/", "/reports/?page=1&page_size=10", True),
    Endpoint("/saved-clubs/", "/saved-clubs/", True),
    Endpoint("/submissions/", "/submissions/?page=1&page_size=10", True),
    Endpoint("/users/", "/users/?skip=0&limit=20", True),
    Endpoint("/users/me", "/users/me", True),
)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    if lower_index == upper_index:
        return ordered[lower_index]
    weight = position - lower_index
    return ordered[lower_index] + (ordered[upper_index] - ordered[lower_index]) * weight


def _round_or_none(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def _request_headers(access_token: str | None, authenticated: bool) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/calendar;q=0.9, */*;q=0.8",
        "Cache-Control": "no-cache",
        "User-Agent": "wat2do-production-profiler/1.0",
    }
    if authenticated:
        if not access_token:
            raise RuntimeError("Authenticated endpoint requested without an access token")
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def profile_endpoint(
    client: httpx.Client,
    base_url: str,
    endpoint: Endpoint,
    access_token: str | None,
    warmups: int,
    samples: int,
) -> EndpointResult:
    headers = _request_headers(access_token, endpoint.authenticated)
    url = f"{base_url}{endpoint.path}"

    try:
        for _ in range(warmups):
            client.get(url, headers=headers)

        statuses: list[int] = []
        samples_ms: list[float] = []
        response_bytes: list[int] = []
        content_types: list[str] = []
        cache_statuses: list[str] = []
        server_timings: list[str] = []

        for _ in range(samples):
            started = time.perf_counter()
            response = client.get(url, headers=headers)
            elapsed_ms = (time.perf_counter() - started) * 1000
            statuses.append(response.status_code)
            samples_ms.append(round(elapsed_ms, 1))
            response_bytes.append(len(response.content))
            content_types.append(response.headers.get("content-type", ""))
            cache_statuses.append(
                response.headers.get("cf-cache-status") or response.headers.get("x-cache") or ""
            )
            server_timings.append(response.headers.get("server-timing", ""))

        return EndpointResult(
            endpoint=endpoint.label,
            authenticated=endpoint.authenticated,
            statuses=statuses,
            samples_ms=samples_ms,
            mean_ms=_round_or_none(statistics.fmean(samples_ms)),
            median_ms=_round_or_none(statistics.median(samples_ms)),
            p95_ms=_round_or_none(_percentile(samples_ms, 0.95)),
            min_ms=_round_or_none(min(samples_ms)),
            max_ms=_round_or_none(max(samples_ms)),
            response_bytes=response_bytes,
            content_types=content_types,
            cache_statuses=cache_statuses,
            server_timings=server_timings,
            error=None,
        )
    except Exception as exc:
        return EndpointResult(
            endpoint=endpoint.label,
            authenticated=endpoint.authenticated,
            statuses=[],
            samples_ms=[],
            mean_ms=None,
            median_ms=None,
            p95_ms=None,
            min_ms=None,
            max_ms=None,
            response_bytes=[],
            content_types=[],
            cache_statuses=[],
            server_timings=[],
            error=type(exc).__name__,
        )


def _get_json(
    client: httpx.Client,
    base_url: str,
    path: str,
    access_token: str | None,
    authenticated: bool,
) -> Any:
    response = client.get(
        f"{base_url}{path}",
        headers=_request_headers(access_token, authenticated),
    )
    if not response.is_success:
        return None
    try:
        return response.json()
    except json.JSONDecodeError:
        return None


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        return [item for item in payload["items"] if isinstance(item, dict)]
    return []


def _first_id(payload: Any) -> str | None:
    for item in _items(payload):
        value = item.get("id")
        if value is not None:
            return str(value)
    return None


def discover_dynamic_endpoints(
    client: httpx.Client,
    base_url: str,
    access_token: str,
    auth_user_id: str,
) -> tuple[list[Endpoint], dict[str, str]]:
    skipped: dict[str, str] = {}
    endpoints: list[Endpoint] = []

    events = _get_json(
        client,
        base_url,
        "/events/?school=uwaterloo&page=1&page_size=1",
        access_token,
        False,
    )
    event_id = _first_id(events)
    if event_id:
        endpoints.extend(
            (
                Endpoint("/events/{event_id}", f"/events/{event_id}", False),
                Endpoint(
                    "/going-events/{event_id}/attendees",
                    f"/going-events/{event_id}/attendees",
                    False,
                ),
            )
        )
    else:
        skipped["/events/{event_id}"] = "No event was available for a path parameter."
        skipped["/going-events/{event_id}/attendees"] = (
            "No event was available for a path parameter."
        )

    clubs = _get_json(
        client,
        base_url,
        "/clubs/?school=uwaterloo&page=1&page_size=1",
        access_token,
        False,
    )
    owned_clubs = _get_json(
        client,
        base_url,
        "/clubs/mine",
        access_token,
        True,
    )
    club_id = _first_id(owned_clubs) or _first_id(clubs)
    club_routes = (
        "/clubs/{club_id}",
        "/clubs/{club_id}/integrations/{platform}",
        "/clubs/{club_id}/invitations",
        "/clubs/{club_id}/join-requests",
        "/clubs/{club_id}/members",
        "/clubs/{club_id}/membership",
        "/clubs/{club_id}/memberships",
    )
    if club_id:
        endpoints.extend(
            (
                Endpoint(
                    "/clubs/{club_id}",
                    f"/clubs/{club_id}",
                    False,
                ),
                Endpoint(
                    "/clubs/{club_id}/integrations/{platform}",
                    f"/clubs/{club_id}/integrations/slack",
                    True,
                ),
                Endpoint(
                    "/clubs/{club_id}/invitations",
                    f"/clubs/{club_id}/invitations",
                    True,
                ),
                Endpoint(
                    "/clubs/{club_id}/join-requests",
                    f"/clubs/{club_id}/join-requests",
                    True,
                ),
                Endpoint(
                    "/clubs/{club_id}/members",
                    f"/clubs/{club_id}/members",
                    True,
                ),
                Endpoint(
                    "/clubs/{club_id}/membership",
                    f"/clubs/{club_id}/membership",
                    True,
                ),
                Endpoint(
                    "/clubs/{club_id}/memberships",
                    f"/clubs/{club_id}/memberships",
                    True,
                ),
            )
        )
    else:
        for route in club_routes:
            skipped[route] = "No club was available for a path parameter."

    dynamic_lists = (
        (
            "/instagram-publishing/batches/{batch_id}",
            "/instagram-publishing/batches/?page=1&page_size=1",
            "/instagram-publishing/batches/{id}",
        ),
        (
            "/payouts/admin/{payout_id}",
            "/payouts/admin?page=1&page_size=1",
            "/payouts/admin/{id}",
        ),
        (
            "/submissions/{submission_id}",
            "/submissions/?page=1&page_size=1",
            "/submissions/{id}",
        ),
    )
    for label, discovery_path, resolved_path in dynamic_lists:
        identifier = _first_id(_get_json(client, base_url, discovery_path, access_token, True))
        if identifier:
            endpoints.append(Endpoint(label, resolved_path.format(id=identifier), True))
        else:
            skipped[label] = "No resource was available for a path parameter."

    current_user = _get_json(
        client,
        base_url,
        "/users/me",
        access_token,
        True,
    )
    database_user_id = (
        str(current_user["id"])
        if isinstance(current_user, dict) and current_user.get("id") is not None
        else auth_user_id
    )
    endpoints.append(Endpoint("/users/{user_id}", f"/users/{database_user_id}", True))
    return endpoints, skipped


def authenticate(
    client: httpx.Client,
    base_url: str,
    email: str,
    skip_send_otp: bool,
) -> tuple[str, str]:
    if not skip_send_otp:
        response = client.post(
            f"{base_url}/auth/send-otp",
            json={"email": email},
        )
        response.raise_for_status()
        print(f"OTP sent to {email}")

    otp = getpass.getpass("OTP: ").strip()
    response = client.post(
        f"{base_url}/auth/verify-otp",
        json={"email": email, "token": otp},
    )
    response.raise_for_status()
    payload = response.json()
    access_token = payload.get("access_token")
    user_id = payload.get("user_id")
    if not isinstance(access_token, str) or not isinstance(user_id, str):
        raise RuntimeError("Authentication response did not include the expected credentials")
    return access_token, user_id


def _known_get_paths() -> set[str]:
    return {endpoint.label for endpoint in (*PUBLIC_ENDPOINTS, *AUTHENTICATED_ENDPOINTS)} | {
        "/events/{event_id}",
        "/going-events/{event_id}/attendees",
        "/instagram-publishing/batches/{batch_id}",
        "/clubs/{club_id}",
        "/clubs/{club_id}/integrations/{platform}",
        "/clubs/{club_id}/invitations",
        "/clubs/{club_id}/join-requests",
        "/clubs/{club_id}/members",
        "/clubs/{club_id}/membership",
        "/clubs/{club_id}/memberships",
        "/payouts/admin/{payout_id}",
        "/submissions/{submission_id}",
        "/users/{user_id}",
    }


def audit_openapi_coverage() -> dict[str, Any]:
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    from main import app

    schema = app.openapi()
    get_paths = {
        path
        for path, methods in schema.get("paths", {}).items()
        if isinstance(methods, dict) and "get" in methods
    }
    classified = _known_get_paths() | set(SKIPPED_GET_ROUTES)
    return {
        "schema_source": "FastAPI app.openapi() from the local checkout",
        "get_route_count": len(get_paths),
        "classified_route_count": len(get_paths & classified),
        "unclassified_get_routes": sorted(get_paths - classified),
        "stale_classifications": sorted(classified - get_paths),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--email", required=True)
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLES)
    parser.add_argument("--warmups", type=int, default=DEFAULT_WARMUPS)
    parser.add_argument(
        "--skip-send-otp",
        action="store_true",
        help="Use an OTP that was already sent instead of requesting another.",
    )
    return parser.parse_args()


def _nice_axis_max(value: float) -> float:
    if value <= 0:
        return 1.0
    magnitude = 10 ** math.floor(math.log10(value))
    normalized = value / magnitude
    for ceiling in (1, 2, 5, 10):
        if normalized <= ceiling:
            return float(ceiling * magnitude)
    return float(10 * magnitude)


def render_latency_distribution_svg(
    results: list[dict[str, Any]],
    run_started_at: datetime,
) -> str:
    sorted_results = sorted(
        results,
        key=lambda result: result.get("median_ms") or -1,
        reverse=True,
    )
    samples = [
        float(sample) for result in sorted_results for sample in result.get("samples_ms", [])
    ]
    axis_max = _nice_axis_max(max(samples, default=1.0))

    width = 1600
    label_width = 530
    plot_left = label_width + 40
    plot_right = width - 70
    plot_width = plot_right - plot_left
    top = 150
    row_height = 30
    bottom = 82
    height = top + max(1, len(sorted_results)) * row_height + bottom
    escaped_started_at = html.escape(run_started_at.isoformat())

    def x_position(value: float) -> float:
        return plot_left + min(max(value, 0), axis_max) / axis_max * plot_width

    svg: list[str] = [
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
            f'height="{height}" viewBox="0 0 {width} {height}">'
        ),
        "<style>",
        "text { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
        ".endpoint { fill: #e5e7eb; font-size: 12px; }",
        ".axis { fill: #94a3b8; font-size: 11px; }",
        "</style>",
        f'<rect width="{width}" height="{height}" fill="#0b1020"/>',
        (
            '<text x="24" y="36" fill="#f8fafc" font-size="24" font-weight="700">'
            "Wat2Do endpoint latency distributions</text>"
        ),
        (
            '<text x="24" y="62" fill="#94a3b8" font-size="13">'
            f"Run started {escaped_started_at} · {len(sorted_results)} endpoints</text>"
        ),
        (
            '<text x="24" y="87" fill="#cbd5e1" font-size="12">'
            "Each dot is one measured request · line is observed range · cyan tick is median"
            "</text>"
        ),
        (
            '<text x="24" y="108" fill="#64748b" font-size="11">'
            "Warm-up requests are excluded from this image</text>"
        ),
        f'<circle cx="{plot_left}" cy="102" r="4" fill="#fbbf24"/>',
        (
            f'<text x="{plot_left + 10}" y="106" fill="#cbd5e1" font-size="11">'
            "Measured sample</text>"
        ),
        f'<line x1="{plot_left + 130}" y1="96" x2="{plot_left + 130}" y2="108" '
        'stroke="#22d3ee" stroke-width="3"/>',
        (f'<text x="{plot_left + 140}" y="106" fill="#cbd5e1" font-size="11">Median</text>'),
    ]

    for tick_index in range(6):
        tick_value = axis_max * tick_index / 5
        tick_x = x_position(tick_value)
        svg.extend(
            (
                (
                    f'<line x1="{tick_x:.1f}" y1="{top - 12}" x2="{tick_x:.1f}" '
                    f'y2="{height - bottom + 8}" stroke="#1e293b" stroke-width="1"/>'
                ),
                (
                    f'<text class="axis" x="{tick_x:.1f}" y="{top - 20}" '
                    f'text-anchor="middle">{tick_value:,.0f} ms</text>'
                ),
            )
        )

    for row_index, result in enumerate(sorted_results):
        row_y = top + row_index * row_height
        center_y = row_y + row_height / 2
        if row_index % 2 == 0:
            svg.append(
                f'<rect x="12" y="{row_y}" width="{width - 24}" height="{row_height}" '
                'rx="4" fill="#11182a"/>'
            )

        endpoint = html.escape(str(result.get("endpoint", "unknown")))
        access = "auth" if result.get("authenticated") else "public"
        svg.append(f'<text class="endpoint" x="24" y="{center_y + 4:.1f}">{endpoint}</text>')
        svg.append(
            f'<text class="axis" x="{label_width}" y="{center_y + 4:.1f}" '
            f'text-anchor="end">{access}</text>'
        )

        row_samples = [float(sample) for sample in result.get("samples_ms", [])]
        if not row_samples:
            error = html.escape(str(result.get("error") or "No samples"))
            svg.append(
                f'<text x="{plot_left}" y="{center_y + 4:.1f}" fill="#fb7185" '
                f'font-size="11">{error}</text>'
            )
            continue

        minimum = min(row_samples)
        maximum = max(row_samples)
        median = float(result.get("median_ms") or statistics.median(row_samples))
        svg.append(
            f'<line x1="{x_position(minimum):.1f}" y1="{center_y:.1f}" '
            f'x2="{x_position(maximum):.1f}" y2="{center_y:.1f}" '
            'stroke="#64748b" stroke-width="3" stroke-linecap="round"/>'
        )

        for sample_index, sample in enumerate(row_samples):
            jitter = ((sample_index % 5) - 2) * 2
            svg.append(
                f'<circle cx="{x_position(sample):.1f}" cy="{center_y + jitter:.1f}" '
                'r="4" fill="#fbbf24" fill-opacity="0.82" stroke="#0b1020" '
                'stroke-width="1"/>'
            )

        median_x = x_position(median)
        svg.append(
            f'<line x1="{median_x:.1f}" y1="{center_y - 9:.1f}" '
            f'x2="{median_x:.1f}" y2="{center_y + 9:.1f}" '
            'stroke="#22d3ee" stroke-width="3"/>'
        )
        svg.append(
            f'<text class="axis" x="{plot_right + 8}" y="{center_y + 4:.1f}">{median:,.1f}</text>'
        )

    svg.append("</svg>")
    return "\n".join(svg) + "\n"


def write_profile_artifacts(
    output: dict[str, Any],
    run_started_at: datetime,
) -> Path:
    timestamp = run_started_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    run_directory = TEMP_OUTPUT_DIR / timestamp
    run_directory.mkdir()

    output["artifacts"] = {
        "profile": "profile.json",
        "latency_distributions": "latency-distributions.svg",
    }
    (run_directory / "profile.json").write_text(
        json.dumps(output, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_directory / "latency-distributions.svg").write_text(
        render_latency_distribution_svg(output["results"], run_started_at),
        encoding="utf-8",
    )
    return run_directory


def main() -> int:
    args = parse_args()
    if args.samples < 1 or args.warmups < 0:
        raise SystemExit("--samples must be positive and --warmups cannot be negative")

    base_url = args.base_url.rstrip("/")
    with httpx.Client(
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=True,
    ) as client:
        access_token, current_user_id = authenticate(
            client,
            base_url,
            args.email,
            args.skip_send_otp,
        )
        dynamic_endpoints, dynamic_skips = discover_dynamic_endpoints(
            client,
            base_url,
            access_token,
            current_user_id,
        )
        run_started_at = datetime.now(timezone.utc)
        endpoints = [
            *PUBLIC_ENDPOINTS,
            *AUTHENTICATED_ENDPOINTS,
            *dynamic_endpoints,
        ]

        results: list[EndpointResult] = []
        for index, endpoint in enumerate(endpoints, start=1):
            print(f"[{index}/{len(endpoints)}] {endpoint.label}")
            results.append(
                profile_endpoint(
                    client,
                    base_url,
                    endpoint,
                    access_token,
                    args.warmups,
                    args.samples,
                )
            )

    output = {
        "generated_at": run_started_at.isoformat(),
        "base_url": base_url,
        "methodology": {
            "warmups_per_endpoint": args.warmups,
            "measured_samples_per_endpoint": args.samples,
            "sequential": True,
            "cache_control": "no-cache",
            "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
        },
        "results": [asdict(result) for result in results],
        "skipped_get_routes": {
            **SKIPPED_GET_ROUTES,
            **dynamic_skips,
        },
        "openapi_coverage": audit_openapi_coverage(),
    }
    run_directory = write_profile_artifacts(output, run_started_at)
    print(f"Profile artifacts written to {run_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
