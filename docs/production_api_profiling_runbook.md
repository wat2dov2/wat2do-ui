# Production API Profiling Runbook

## Purpose

Use this runbook to collect a low-load, authenticated latency baseline for every safely callable production GET route.
The profiler records only status codes, timings, response byte counts, content types, and cache metadata.
It does not store access tokens, OTPs, response bodies, resource IDs, email addresses, or other production data.

## Safety boundary

The profiler sends only GET requests after authentication.
It deliberately excludes these routes:

- `/qr/{qr_code_id}` because calling it records a scan.
- `/calendar/token` because its GET handler can create a calendar token.
- `/calendar/feed/{token}.ics` because it requires that private calendar token.
- `/clubs/invitations/{token}` because it requires a private invitation token.
- `/notification-preferences/unsubscribe` because it requires a private unsubscribe token.

The profiler also skips a parameterized detail route when no corresponding resource exists.
Do not add POST, PUT, PATCH, or DELETE routes to this tool.
Do not add upload, AI-generation, Instagram-publishing, OTP, logout, or payment mutations to this tool.

## Prerequisites

- Run from a trusted workstation with the repository checked out.
- Use an account with the roles needed for the admin GET routes.
- Install the backend dependencies in `backend/.venv`.
- Confirm `frontend/src/shared/generated/openapi.json` is current.
- Choose a quiet period and tell the team before running a larger sample count.

## Standard baseline

Run this from `backend/`:

```bash
.venv/bin/python scripts/profile_production_api.py \
  --email your-account@example.com
```

The script sends a fresh OTP, prompts for it without echoing, and keeps the returned access token only in process memory.
The default run executes one warm-up and ten measured requests per endpoint, sequentially.
The default workload is intended for a directional baseline, not load testing.
Every successful run creates a UTC-timestamped directory such as `/tmp/20260728T182921.551339Z`.
The directory contains `profile.json` and `latency-distributions.svg`.
The script prints the exact run-directory path after writing both artifacts.
There is no output-path option, so one run cannot accidentally overwrite another run.

If an OTP was already sent immediately before the run, add `--skip-send-otp`:

```bash
.venv/bin/python scripts/profile_production_api.py \
  --email your-account@example.com \
  --skip-send-otp
```

## Warm-up request behavior

The profiler sends the warm-up request to the same URL with the same authentication and request headers as the measured requests that follow it.
The warm-up exists to make before-and-after code comparisons less sensitive to first-request setup noise.
It gives endpoint-level application and database paths one request before steady-state sampling.
Because one shared HTTP client profiles every endpoint, only the earliest requests are likely to include fresh DNS, TLS, and connection setup.
The warm-up therefore does not represent a controlled cold-start measurement.
It is useful for a regression baseline but is not inherently more representative of a real user's first request.

Warm-up latency, status, response size, and headers are deliberately excluded from `samples_ms`, `statuses`, percentile calculations, and the output report.
A network exception during warm-up marks that endpoint as errored and prevents its measured requests.
A non-2xx warm-up response does not stop the measured requests because a transient first response may recover.

Use `--warmups 0` when intentionally measuring the first observed request.
Label that result as a first-request baseline rather than comparing it directly with the standard warmed baseline.
Keep the warm-up count identical across before-and-after runs.

## More stable sampling

Use a larger sample count when a more stable distribution is required and the production traffic window is suitable:

```bash
.venv/bin/python scripts/profile_production_api.py \
  --email your-account@example.com \
  --warmups 1 \
  --samples 30
```

Keep requests sequential so the profiler does not create artificial contention.
Use the same workstation, network, sample count, school query, and approximate time window when comparing runs.
The measured duration includes network latency between the workstation and production.

## Coverage check

Every run calls FastAPI's `app.openapi()` from the local checkout and compares its route classifications with that runtime-generated schema.
FastAPI includes every GET route registered on the application when the schema is generated.
This includes parameterized GET routes and GET routes added through included routers.
It does not prove that the deployed production application is running the same commit as the local checkout.
Confirm deployment alignment before calling the coverage production-complete.
Stop and update the profiler when `unclassified_get_routes` or `stale_classifications` is non-empty.
Review new GET handlers for side effects before classifying them as safe.
Do not assume a GET route is read-only solely because of its HTTP method.

## Reading the output

Every successful endpoint reports `mean_ms`, `median_ms`, `p95_ms`, `min_ms`, and `max_ms`.
`mean_ms` is the arithmetic mean of the measured requests after warm-up.
`median_ms` is the middle measured latency after warm-up.
`p95_ms` is the linearly interpolated 95th percentile of the measured samples.
These metrics are populated for every successful endpoint regardless of the configured sample count.
An endpoint with no measured samples reports `null` metrics alongside its error.
The output does not contain warm-up timing because warm-up requests are preparation rather than measured samples.
`response_bytes` measures the downloaded response body size.
`cache_statuses` records `cf-cache-status` or `x-cache` when present.
`server_timings` records the `Server-Timing` header when present.
`latency-distributions.svg` sorts endpoints by median latency and gives every endpoint one row.
Each gold dot is a measured request, the gray line is its observed range, and the cyan tick is its median.
The visualization uses one shared millisecond axis so endpoint distributions are directly comparable.
Warm-up requests are excluded from the visualization.

List the slowest endpoints:

```bash
RUN_DIR="/tmp/20260728T182921.551339Z"
PROFILE_FILE="$RUN_DIR/profile.json"
jq -r '
  .results
  | sort_by(-.median_ms)
  | .[]
  | [.endpoint, .mean_ms, .median_ms, .p95_ms, .min_ms, .max_ms, (.response_bytes | max)]
  | @tsv
' "$PROFILE_FILE"
```

List errors and non-2xx responses:

```bash
RUN_DIR="/tmp/20260728T182921.551339Z"
PROFILE_FILE="$RUN_DIR/profile.json"
jq '
  .results[]
  | select(.error != null or (.statuses | any(. < 200 or . >= 300)))
  | {endpoint, statuses, error}
' "$PROFILE_FILE"
```

## Investigation sequence

Start with routes whose median exceeds the product's interaction budget.
Separate payload cost from server cost by comparing latency with response bytes.
Treat a slow tiny response as evidence of fixed server work or database round trips rather than serialization.
Inspect route orchestration and query count before changing indexes or caching.
Use database query plans and application tracing to confirm the suspected bottleneck.
Re-run the exact same profiler settings after a change and compare the full distribution.

## Reporting template

Record the production timestamp, workstation region, warm-up count, measured sample count, cache-control behavior, and route coverage.
State explicitly that warm-up requests were excluded from latency calculations.
Report the slowest endpoints with mean, median, p95, minimum, maximum, payload size, and status.
List every excluded route and its reason.
Separate measured facts from code-based hypotheses.
Record which tracing or database evidence is still needed before implementation.

## Known limitations

This profiler is not a concurrency, throughput, saturation, or soak test.
It does not establish an SLO from the default ten samples.
It does not retain warm-up latency, so it cannot compare first-request and steady-state behavior in one run.
It does not separate CDN, network, application, and database time unless production emits useful `Server-Timing` values.
It does not exercise mutations because doing so would change production state.
