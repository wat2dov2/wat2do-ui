# Production API Profile - 2026-07-28

## Outcome

The production pass classified all 47 GET route templates in the generated OpenAPI schema.
It safely executed 41 route templates and skipped six routes because they have side effects, require private action tokens, or had no available resource.
All 123 measured requests returned HTTP 200.
No production response bodies or credentials were retained.

The clearest bottleneck is `GET /instagram-publishing/batches/`, with a 1,219.5 ms median.
The public events feed was second at 616.1 ms.
A group of organization-management routes returned tiny payloads but still took roughly 535 to 613 ms, which points to fixed server or database work rather than transfer size.

## Method

- The run started at 2026-07-28 14:29 America/Toronto.
- The target was `https://wat2do.io/api`.
- Authentication used the production OTP flow and an admin Bearer token held only in process memory.
- Each endpoint received one warm-up followed by three measured sequential requests.
- The warm-up used the same URL, authentication, and headers as its measured requests.
- Warm-up timing, status, response size, and headers were excluded from the calculated metrics and were not retained.
- The shared HTTP client allowed connection reuse, so the warm-up should not be interpreted as a controlled cold-start measurement.
- Requests sent `Cache-Control: no-cache`.
- The profiler used a 30-second request timeout.
- The measurements include workstation-to-production network latency.
- Three samples cannot support a meaningful p95 estimate.
- Values previously calculated by nearest-rank p95 are presented below as observed maximum latency because they select the slowest of the three samples.

## Coverage

- OpenAPI GET route templates: 47.
- Safely executed route templates: 41.
- Warm-up endpoint requests: 41.
- Measured requests: 123.
- Total profiled endpoint requests, excluding authentication and discovery: 164.
- HTTP 200 responses: 123.
- Unclassified OpenAPI GET routes: 0.
- Stale profiler classifications: 0.

The following routes were skipped:

- `/calendar/feed/{token}.ics` requires a private calendar token.
- `/calendar/token` can create a token despite using GET.
- `/notification-preferences/unsubscribe` requires a private unsubscribe token.
- `/organizations/invitations/{token}` requires a private invitation token.
- `/qr/{qr_code_id}` records a scan.
- `/payouts/admin/{payout_id}` had no payout resource available for a path parameter.

## Highest-priority findings

### 1. Instagram batch listing is the dominant outlier

`GET /instagram-publishing/batches/` measured 1,219.5 ms median and 1,262.9 ms observed maximum for a 5,366-byte response.
Its detail endpoint measured 477.4 ms median, so the list-specific hydration work is material.
Code inspection shows that `list_batches()` calls `_hydrate_batches()`, which attaches items and then calculates `new_event_count` once per batch.
`_count_new_events()` can issue two exact-count event queries per batch, producing a likely N+1 query pattern for a page of batches.
This is a code-based hypothesis because production did not emit server timing or database traces.

Recommended next investigation:

1. Add query-count tracing around `list_batches()` in a non-production environment with production-like data.
2. Replace per-batch count queries with one set-based query or a database function that returns counts for the page.
3. Measure the same endpoint again with the standard profiler.

### 2. The public events feed is slow and payload-heavy

`GET /events/` measured 616.1 ms median and 693.0 ms observed maximum for a 29,174-byte response.
The current lightweight path still performs separate work for the exact total, page event IDs, event rows, and occurrences.
The response size contributes to latency, but the multi-query read path is also a plausible contributor.

Recommended next investigation:

1. Capture query timing for the exact count, ID page, event hydration, and occurrence hydration separately.
2. Run `EXPLAIN ANALYZE` against the production-like event-date query with the Waterloo filters.
3. Evaluate a single database function or view only if tracing confirms round-trip time dominates.
4. Review whether every event summary field is needed by the first page before changing the API contract.

### 3. Organization-management reads have high fixed cost

The organization join-request, integration, membership, review, invitation, member, and owned-organization routes measured roughly 535 to 613 ms median.
Several of those responses were only 2 to 375 bytes.
The weak relationship between payload size and latency suggests authorization and database round trips dominate the response time.

Recommended next investigation:

1. Trace organization authorization separately from the resource query.
2. Count database calls for each route.
3. Consolidate repeated organization existence, role, and resource lookups only after tracing confirms duplication.
4. Check indexes on organization IDs, user IDs, membership status, invitation status, and join-request status.

### 4. Production exposes no server timing

No measured response included a `Server-Timing` header.
CloudFront reported `Miss from cloudfront` for all 123 measured requests, which is expected for this no-cache baseline but does not identify origin time.

Recommended next investigation:

1. Add a request ID and coarse `Server-Timing` values for application and database work.
2. Keep timing values free of user data and SQL details.
3. Run a separate cache-enabled public-route pass before making CDN-cache decisions.

## Complete measurements

| Endpoint | Access | Median ms | Observed max ms | Max bytes |
|---|---:|---:|---:|---:|
| `/instagram-publishing/batches/` | Auth | 1,219.5 | 1,262.9 | 5,366 |
| `/events/` | Public | 616.1 | 693.0 | 29,174 |
| `/organizations/{organization_id}/join-requests` | Auth | 612.7 | 662.6 | 2 |
| `/organizations/{organization_id}/integrations/{platform}` | Auth | 582.4 | 601.4 | 104 |
| `/organizations/{organization_id}/memberships` | Auth | 577.1 | 616.0 | 2 |
| `/organizations/review` | Auth | 568.7 | 617.8 | 4,254 |
| `/organizations/{organization_id}/invitations` | Auth | 568.5 | 614.7 | 2 |
| `/organizations/{organization_id}/members` | Auth | 558.9 | 564.2 | 173 |
| `/organizations/mine` | Auth | 535.5 | 579.2 | 375 |
| `/instagram-publishing/batches/{batch_id}` | Auth | 477.4 | 685.2 | 523 |
| `/qr/earnings` | Auth | 424.3 | 615.3 | 542 |
| `/organizations/{organization_id}/membership` | Auth | 411.1 | 451.7 | 4 |
| `/going-events/{event_id}/attendees` | Public | 386.3 | 387.8 | 28 |
| `/events/stats` | Public | 312.9 | 320.1 | 3,640 |
| `/credits/` | Auth | 255.6 | 260.4 | 15 |
| `/organizations/` | Public | 255.4 | 426.4 | 7,739 |
| `/submissions/{submission_id}` | Auth | 239.6 | 317.4 | 392 |
| `/submissions/` | Auth | 238.2 | 453.2 | 1,934 |
| `/qr/scans` | Auth | 236.4 | 371.0 | 1,606 |
| `/saved-organizations/` | Auth | 234.8 | 532.3 | 26 |
| `/promotions/` | Auth | 233.7 | 264.2 | 2 |
| `/qr/` | Auth | 232.3 | 232.8 | 3,033 |
| `/notification-preferences` | Auth | 230.4 | 330.3 | 230 |
| `/users/{user_id}` | Auth | 229.7 | 256.6 | 435 |
| `/reports/` | Auth | 228.3 | 478.7 | 62 |
| `/organizations/claims` | Auth | 227.5 | 228.0 | 2 |
| `/payouts/admin` | Auth | 226.4 | 367.1 | 62 |
| `/payouts/` | Auth | 225.5 | 235.9 | 62 |
| `/users/` | Auth | 224.9 | 529.1 | 7,739 |
| `/organizations/{organization_id}` | Public | 224.6 | 309.7 | 373 |
| `/events/{event_id}` | Public | 224.1 | 259.2 | 821 |
| `/going-events/` | Auth | 220.3 | 446.7 | 301 |
| `/events/promoted` | Public | 158.1 | 167.5 | 2 |
| `/users/me` | Auth | 144.4 | 177.1 | 435 |
| `/promotions/active-ids` | Public | 141.0 | 143.8 | 2 |
| `/qr/map` | Public | 131.6 | 147.7 | 191 |
| `/organizations/integrations/{platform}/options` | Auth | 69.6 | 78.2 | 514 |
| `/meta/constants` | Public | 64.1 | 64.1 | 932 |
| `/organizations/integrations/discord/options` | Auth | 60.1 | 66.8 | 541 |
| `/schools` | Public | 50.3 | 60.9 | 13 |
| `/health` | Public | 48.3 | 56.1 | 15 |

## Interpretation limits

This run is a low-sample latency baseline, not a load test or SLO.
It cannot distinguish CDN, network, application, and database time without additional production tracing.
The hypotheses above come from matching the measured shapes to the current code paths and should be confirmed before implementation.
