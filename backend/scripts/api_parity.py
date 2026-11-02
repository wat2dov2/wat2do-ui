"""Compare FastAPI and the Rust API on the same requests, with no servers.

Runs every case in a JSON file through FastAPI's ``TestClient`` in process and
through ``wat2do-api replay`` (the Rust router, in process), then compares the
status, the headers and the body of each response. A case's ``identity``
stands in for a verified access token on both sides (``dependency_overrides``
here, a fixed identity in Rust), since Supabase-signed tokens cannot be minted.

Usage (see docs/rust_api.md):
    cd backend && .venv/bin/python scripts/api_parity.py ../rust/parity/pilot.json \\
        --python-backend /path/to/checkout-with-the-python-route/backend

Only GET, HEAD and OPTIONS cases (or cases marked ``"safe": true``, such as a
POST that must be refused with 405) run unless ``--allow-writes`` is given, which
is refused unless ``SUPABASE_URL`` points at a local Supabase. The Rust side's
database session is read-only unless ``--allow-writes`` is given. The FastAPI
lifespan (the map-location thread) is never started.
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
RUST = BACKEND.parent / "rust"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "host.docker.internal"}
# Set by the HTTP layer rather than the application; bodies are compared instead.
IGNORED_HEADERS = {"content-length", "date", "server"}


def _latency(samples: list[float]) -> dict[str, float]:
    ordered = sorted(samples)

    def rank(fraction: float) -> float:
        return ordered[min(max(math.ceil(fraction * len(ordered)), 1), len(ordered)) - 1]

    return {
        "iterations": len(ordered),
        "mean": sum(ordered) / len(ordered),
        "median": rank(0.5),
        "p95": rank(0.95),
        "min": ordered[0],
        "max": ordered[-1],
    }


def run_python(cases: list[dict[str, Any]], backend: Path, iterations: int) -> list[dict[str, Any]]:
    """Run each case through the FastAPI app of *backend* in this process."""
    sys.path.insert(0, str(backend))
    os.chdir(backend)
    from fastapi.testclient import TestClient

    from core.auth import get_current_user, get_optional_user
    from main import app

    # No `with`: the lifespan (and its background thread) must not start.
    client = TestClient(app, raise_server_exceptions=False)
    outcomes = []
    for case in cases:
        identity = case.get("identity")
        if identity is not None:
            user = {"email": None, "aud": None, "role": None, **identity}
            app.dependency_overrides[get_current_user] = lambda user=user: user
            app.dependency_overrides[get_optional_user] = lambda user=user: user
        samples = []
        for _ in range(iterations):
            started = time.perf_counter()
            response = client.request(
                case.get("method", "GET"),
                case["path"],
                headers=case.get("headers") or {},
                json=case.get("json"),
                content=case.get("body"),
                follow_redirects=False,
            )
            samples.append((time.perf_counter() - started) * 1000)
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_optional_user, None)
        headers: dict[str, list[str]] = {}
        for name, value in response.headers.multi_items():
            headers.setdefault(name.lower(), []).append(value)
        outcomes.append(
            {
                "name": case["name"],
                "status": response.status_code,
                "headers": headers,
                "body": response.text,
                "latency_ms": _latency(samples),
            }
        )
    return outcomes


def run_rust(
    cases_path: Path, binary: str | None, allow_writes: bool, iterations: int
) -> list[dict[str, Any]]:
    """Run each case through `wat2do-api replay`."""
    command = (
        [binary]
        if binary
        else ["cargo", "run", "--quiet", "--release", "--bin", "wat2do-api", "--"]
    )
    command += ["replay", str(cases_path.resolve()), "--iterations", str(iterations)]
    if allow_writes:
        command.append("--allow-writes")
    result = subprocess.run(
        command, cwd=RUST, check=True, capture_output=True, text=True, env=os.environ
    )
    return json.loads(result.stdout)


def _body(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def compare(python: dict[str, Any], rust: dict[str, Any]) -> list[str]:
    """Every difference a client could observe between the two responses."""
    if not rust.get("served_by_rust", True):
        return ["not served by Rust (the route is not registered in rust_routes)"]
    differences = []
    if python["status"] != rust["status"]:
        differences.append(f"status: python {python['status']} rust {rust['status']}")
    names = (set(python["headers"]) | set(rust["headers"])) - IGNORED_HEADERS
    for name in sorted(names):
        left, right = python["headers"].get(name), rust["headers"].get(name)
        if left != right:
            differences.append(f"header {name}: python {left} rust {right}")
    if _body(python["body"]) != _body(rust["body"]):
        differences.append(f"body: python {python['body'][:300]!r} rust {rust['body'][:300]!r}")
    elif python["body"] != rust["body"]:
        differences.append("body: same JSON, different bytes (key order or spacing)")
    return differences


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("cases", type=Path, help="JSON list of cases")
    parser.add_argument(
        "--python-backend",
        type=Path,
        default=BACKEND,
        help="backend/ of a checkout that still has the Python routes (default: this one)",
    )
    parser.add_argument("--rust-binary", help="a built wat2do-api (default: cargo run --release)")
    parser.add_argument("--allow-writes", action="store_true")
    parser.add_argument("--iterations", type=int, default=1, help="repeat each case to time it")
    parser.add_argument("--json-out", type=Path, help="write both stacks' outcomes here")
    args = parser.parse_args()

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    writes = [
        case["name"]
        for case in cases
        if case.get("method", "GET").upper() not in READ_METHODS and not case.get("safe")
    ]
    if writes and not args.allow_writes:
        parser.error(f"cases that may write need --allow-writes: {writes}")
    if (
        args.allow_writes
        and urlparse(os.environ.get("SUPABASE_URL", "")).hostname not in LOCAL_HOSTS
    ):
        parser.error("--allow-writes runs only against a local Supabase")

    rust = run_rust(args.cases, args.rust_binary, args.allow_writes, args.iterations)
    python = run_python(cases, args.python_backend.resolve(), args.iterations)
    if args.json_out:
        args.json_out.write_text(json.dumps({"python": python, "rust": rust}, indent=2) + "\n")

    failed = 0
    for left, right in zip(python, rust, strict=True):
        differences = compare(left, right)
        latency = ""
        if args.iterations > 1:
            latency = (
                f"  python median {left['latency_ms']['median']:.3f} ms,"
                f" rust median {right['latency_ms']['median']:.3f} ms"
            )
        if differences:
            failed += 1
            print(f"DIFF {left['name']} ({left['status']}){latency}")
            for difference in differences:
                print(f"     {difference}")
        else:
            print(f"SAME {left['name']} ({left['status']}){latency}")
    print(f"{len(cases) - failed}/{len(cases)} cases identical")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
