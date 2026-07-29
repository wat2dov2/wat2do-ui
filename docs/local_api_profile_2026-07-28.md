# Local API and Query Profile - 2026-07-28

## Outcome

The local Supabase database now replays the complete migration history and loads deterministic synthetic data at the same current Waterloo cardinalities as production.

The final API profile executed 39 safe GET route templates with one warm-up and ten measured requests per endpoint.
All 390 measured responses returned HTTP 200, and the profiler reported no request errors.
The OpenAPI audit classified all 47 GET route templates, with eight intentionally skipped because they have a read-side effect, require a private action token, or lacked a local resource for a path parameter.

`GET /events/` was the slowest endpoint in the final local run at a 44.1 ms median and 106.4 ms p95.
Every other profiled endpoint had a median of 29.9 ms or less.

The database work inside one isolated events-feed request took approximately 0.5 ms across five PostgREST queries.
This strongly suggests the production events latency is dominated by remote round trips and application or hosting overhead, not PostgreSQL execution at the current data scale.

## Artifacts

- Final profile JSON: `/tmp/20260728T210943.061310Z/profile.json`
- Final latency distribution: `/tmp/20260728T210943.061310Z/latency-distributions.svg`
- Earlier successful repeat: `/tmp/20260728T210520.450725Z`
- Initial diagnostic run: `/tmp/20260728T210428.377742Z`

The initial run is retained because it correctly exposed that the first local administrator fixture was not enrolled in the promoter program.
After fixing only that local fixture state, the final run returned HTTP 200 for `/qr/earnings` and every other executed endpoint.

## Environment and data parity

- FastAPI ran through the repository's existing `main:app` entry point on `127.0.0.1:8000`.
- Supabase CLI ran the repository's migration history against local PostgreSQL 17.
- The API, PostgREST, Auth, and PostgreSQL traffic stayed on loopback.
- OpenAI and outbound email were disabled.
- Authentication used a local GoTrue user, the application's OTP verification path, and an administrator row in `public.users`.
- No production records, credentials, tokens, or personally identifiable data were copied.

| Waterloo data | Production | Local synthetic |
|---|---:|---:|
| Organizations | 398 | 398 |
| All-time events | 117 | 117 |
| Upcoming events | 45 | 45 |
| Events without an organization | Not inspected | 0 |
| Events without an image URL | Not inspected | 0 |

The production cardinalities came from public, read-only API requests on 2026-07-28.
The local seed uses deterministic generated names, descriptions, links, and image URLs.

## Method

- The final run started at `2026-07-28T21:09:43.061310Z`.
- The target was `http://127.0.0.1:8000`.
- Each endpoint received one warm-up request followed by ten measured sequential requests.
- Warm-up observations were excluded from every reported statistic and artifact.
- Requests sent `Cache-Control: no-cache`.
- The request timeout was 30 seconds.
- Mean, median, p95, minimum, and maximum were reported for every endpoint.
- A shared HTTP client allowed connection reuse.
- This was a latency baseline, not a concurrency or load test.

## Coverage

- OpenAPI GET route templates: 47.
- Safely executed route templates: 39.
- Warm-up requests: 39.
- Measured requests: 390.
- HTTP 200 measured responses: 390.
- Profiler request errors: 0.
- Unclassified OpenAPI GET routes: 0.
- Stale profiler classifications: 0.

The following routes were skipped:

- `/calendar/feed/{token}.ics` requires a private calendar token.
- `/calendar/token` can create a calendar token despite using GET.
- `/notification-preferences/unsubscribe` requires a private unsubscribe token.
- `/organizations/invitations/{token}` requires a private invitation token.
- `/qr/{qr_code_id}` records a scan.
- `/instagram-publishing/batches/{batch_id}` had no local batch resource.
- `/payouts/admin/{payout_id}` had no local payout resource.
- `/submissions/{submission_id}` had no local submission resource.

## Slowest local endpoints

| Endpoint | Access | Median ms | Mean ms | p95 ms | Min ms | Max ms |
|---|---:|---:|---:|---:|---:|---:|
| `/events/` | Public | 44.1 | 54.1 | 106.4 | 20.6 | 108.6 |
| `/organizations/{organization_id}/membership` | Auth | 29.9 | 55.1 | 169.4 | 14.1 | 209.0 |
| `/organizations/{organization_id}/members` | Auth | 22.5 | 21.7 | 30.5 | 12.7 | 31.3 |
| `/organizations/{organization_id}/memberships` | Auth | 14.3 | 15.3 | 18.7 | 11.7 | 19.0 |
| `/events/stats` | Public | 12.6 | 13.1 | 18.5 | 9.0 | 21.7 |
| `/organizations/{organization_id}/join-requests` | Auth | 11.8 | 24.6 | 73.0 | 9.3 | 92.1 |
| `/going-events/{event_id}/attendees` | Public | 11.8 | 11.8 | 12.8 | 11.1 | 12.8 |
| `/organizations/{organization_id}/integrations/{platform}` | Auth | 11.6 | 11.6 | 12.2 | 10.7 | 12.2 |
| `/credits/` | Auth | 11.2 | 12.8 | 21.9 | 7.3 | 22.2 |
| `/organizations/review` | Auth | 11.1 | 11.6 | 14.2 | 9.9 | 15.1 |

The immediately preceding successful repeat measured `/events/` at a 24.5 ms median and 28.9 ms p95.
The final run's isolated tail spikes on membership and join-request routes show that ten local samples still capture workstation scheduling noise.
The ranking and database-call conclusions are more reliable than any single local p95.

## Events query profile

PostgreSQL statement statistics were reset immediately before one default Waterloo events request.
The request made five PostgREST database calls.

| Database work | Calls | PostgreSQL execution ms |
|---|---:|---:|
| Event summary hydration with organization fields | 1 | 0.207 |
| Ordered upcoming occurrence and event ID page | 1 | 0.181 |
| Page occurrence hydration | 1 | 0.065 |
| Exact upcoming event count | 1 | 0.040 |
| Latest-added event lookup | 1 | 0.024 |
| Total application query execution | 5 | 0.517 |

PostgREST session setup added another 0.108 ms across the five calls.
Every observed database block was a shared-buffer hit, and no disk reads occurred.

Representative `EXPLAIN (ANALYZE, BUFFERS)` results were:

- Exact upcoming count: 0.236 ms execution.
- Ordered page IDs: 0.173 ms execution.
- Event and organization hydration: 0.290 ms execution.
- Page occurrence hydration: 0.097 ms execution.
- Latest-added lookup: 0.026 ms execution.

The count used `ix_events_school_id`.
The page query used `ix_event_dates_dtstart` and `ix_events_school_id` when the planner optimized for the first 20 records.
The latest-added lookup used `ix_events_school_added_at_desc`.
Sequential scans over `event_dates` also appeared in the exact-count and 250-row page forms because the local table had only 118 rows, making that plan cheaper than an index scan.

## Production comparison

The earlier production profile measured `/events/` at a 616.1 ms median with three measured requests.
The final local profile measured it at a 44.1 ms median with ten measured requests, approximately 14 times faster.
The immediately preceding local repeat measured 24.5 ms, approximately 25 times faster than production.

This comparison is directional.
Production includes workstation-to-origin network time, hosted application overhead, and remote database calls, while local traffic stays on loopback.
The production run also had too few samples for a stable p95.

The key evidence is the combination of five database round trips and sub-millisecond local database execution.
At current cardinality, adding another feed index is unlikely to materially improve production latency.
The highest-value next change is to consolidate the exact count, ordered page, event hydration, occurrence hydration, and latest-added lookup into one database call, provided production tracing confirms the same round-trip pattern.

## Recommended optimization order

1. Add coarse application and database timing to production responses or traces.
2. Confirm the number and duration of production Supabase calls for `/events/`.
3. If round trips dominate, replace the five-call default feed path with one set-based database function returning the page, exact total, occurrences, organization fields, and latest-added event.
4. Preserve the existing response contract and compare the same production endpoint with the standard profiler.
5. Revisit indexes only if production query plans show database execution, reads, or row counts that differ materially from this production-scale local dataset.

## Repeat the local profile

From `backend/`:

1. Start Docker Desktop.
2. Run `supabase start`.
3. Run `supabase db reset` to replay migrations and load `supabase/seed.sql`.
4. Create a local GoTrue user and matching administrator row in `public.users`.
5. Start `main:app` with `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY`, and `DATABASE_URL` sourced from `supabase status -o env`.
6. Keep `OPENAI_API_KEY` and `EMAIL_PROVIDER` empty for a read-only profiling run.
7. Run `.venv/bin/python scripts/profile_production_api.py --base-url http://127.0.0.1:8000 --email <local-allowed-email>`.
8. Stop the FastAPI process and run `supabase stop` when profiling is complete.

Each profiler invocation creates a new UTC timestamped folder under `/tmp` containing `profile.json` and `latency-distributions.svg`.
The production profiling runbook remains the source of truth for profiler flags, warm-ups, sampling, route safety, and artifact interpretation.

## Limits

The synthetic dataset matches current public cardinalities and schema shape, not production value distributions.
Empty local batch, payout, submission, scan, promotion, and membership collections make their list endpoints useful for fixed-cost measurement but not for production-volume hydration analysis.
Loopback timing cannot reproduce CDN, TLS, network, hosted runtime, connection-pool, or remote Supabase latency.
The results should guide the next trace and optimization experiment, not define an SLO.
