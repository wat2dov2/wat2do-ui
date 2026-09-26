# Discovery performance and cache reliability

Implementation record: September 26, 2026.
This follows the approved investigation of cold school discovery pages and slow poster delivery.
Western's canonical school slug is `uwo`.

## Implemented design

Events, Positions, Clubs, school branding, and the school directory use complete snapshots in the existing application S3 bucket.
Server rendering and browser directory refreshes read the same published data.
Snapshot ownership lives in `discoverySnapshotStore.ts`; feature server loaders own source assembly; `app/discoveryRefresh.server.ts` composes the all-school worker.
The old directory fetch-cache tags, unconditional five-resource invalidation, and recursive navigation warmer have been removed.
Event and club details use current source reads, memoized within their route render, so task-local detail caches cannot retain another task's stale club fields.

S3 was selected instead of the initially proposed Redis adapter because the application already operates S3 with strongly consistent reads and conditional writes.
It stores a small mutable state record and immutable complete payloads under a versioned school/resource key.
There is one authoritative directory snapshot path, without a second independent Next fetch cache for these datasets.
No new database schema, Redis deployment, or SQS resource is required.
CloudFront is denied access to the internal snapshot prefix; public media delivery retains its existing policy.

A refresh claims a conditional lease, builds all source pages, uploads a complete payload, and conditionally publishes its pointer.
The generation timestamp records when source reads began, so a build that began before a confirmed edit cannot pretend to be newer than it.
Another mutation during construction leaves the previous generation published and requests another build.
An expired worker cannot publish over its replacement.
A failed read, incomplete page set, interrupted upload, or failed publication leaves the last successful generation available.
Empty directories are successful only when the source confirms a complete empty result.

The refresh endpoint returns HTTP 202 only after recording the requested dirty revisions.
The endpoint no longer describes acceptance as completed warming.
Its `after()` callback only expedites the durable work; a continuously running reconciliation loop owns recovery.
Backend notifications are still sent after the database write, so notification delivery and mutation commit are not transactional.
A periodic five-minute refresh repairs missed notifications and date/deadline transitions.
During persistent upstream failure, valid published data remains usable for up to the configured one-day maximum age.
These are explicit freshness limits, not a guarantee of current data during an unlimited outage.

Each task serializes catalog builds and each key has a shared lease across overlapping tasks.
Page reads have bounded fan-out and deadlines.
Pagination requires stable ordering, matching totals, and a complete set of distinct IDs.
This rejects detected offset-pagination drift; it does not claim a transactional database snapshot across multiple HTTP reads.
The current school directory contract supports fewer than 50 returned schools; reaching its limit fails readiness rather than silently excluding additional schools.

The worker enumerates every school from the canonical directory.
Next's instrumentation initialization waits for complete usable coverage before accepting requests, so the existing ALB health check cannot admit a cold new task.
After startup, `/healthz` remains liveness and `/api/discovery/readiness` reports current coverage.
ECS startup grace and the deployment deadline derive from the discovery control box.
CI checks the exact requested task revision, rejects rollout failure or rollback, and verifies coverage after deployment.
Existing healthy tasks continue serving while a new task warms.

## Scoped invalidation and upstream recovery

Event writes refresh Events and club counts.
Position writes refresh Positions and club counts.
Club writes refresh only directories that embed the changed fields, including missing create/delete/import paths.
Moves refresh both affected schools.
School branding and directory changes have explicit resource scopes.
Public detail reads no longer need an independent ID invalidation protocol.

The shared service-role Supabase client now uses HTTP/1.1 pooling with bounded retries for transport failures on table GET/HEAD requests, including interrupted response bodies.
Whole-service retry decorators were removed.
Writes, RPC calls, HTTP error responses, and auth/token rotation are not retried by this transport.
Anonymous auth client behavior remains separately owned.

## Response and navigation changes

Browser discovery queries now use `/api/discovery`, including Clubs' canonical complete-directory query shape.
Hydration preserves the server generation time rather than resetting freshness at mount.
A delayed response cannot overwrite a newer generation or a locally confirmed event edit/deletion.
An existing fresh browser query adopts a new server snapshot through its normal query refresh lifecycle.
Generation comparisons assume reasonably synchronized browser and server clocks.

Browse occurrence payloads retain their ID, start, and end while full detail responses retain event ID, duration, and time zone.
Search descriptions and every locally filtered record remain available.
A representative fixture fell from 1,381 to 1,057 JSON bytes, a 23.5% reduction for that fixture, not a production transfer measurement.
Latest-added metadata is queried only on the first Events/Positions source page.
Route metadata and initial rendering reuse request-scoped loaders.
School theme tokens are included in initial HTML, replacing the separate stylesheet API request.

Adjacent-route prefetch waits for initial loading and idle time, with one request scheduled per idle pass.
Hover, focus, and touch intent can prefetch immediately.
Hidden/offline/data-saver contexts avoid unsolicited background work.
The perpetual invalidation/prefetch loop was removed.

## Images and Instagram

The shared poster owner renders responsive native image URLs before hydration and uses the existing Next optimizer for owned media.
The first six cards load eagerly; subsequent posters use native lazy loading.
The transparent cutout artwork remains owned by the existing mask primitive.
Source changes reset loading/error state, tiny badges request small candidates, and fullscreen posters retain their larger source.

Canonical first-screen poster variants are warmed serially through the existing public image cache after snapshot publication.
CloudFront normalizes image format negotiation so browser requests can reuse the same warmed variant.
Warming failures do not block or discard catalog snapshots.
This primes the reached CDN path and does not claim to prepopulate every worldwide cache location.

Instagram rendering retains PNG normalization before Resvg, including for WebP sources.
Poster preparation resizes to the template's actual region before embedding, and repeated cover posters share one download/preparation.
Admin previews use responsive smaller images while exported slides remain 1080 by 1350.
Publishing concurrency and a separate render worker remain contingent on measuring CPU contention on the shared task; speculative parallel rendering was not introduced.

## Operations and verification

Feature settings live in `backend/controlbox/database.json`, `discovery_cache.json`, `image_delivery.json`, and their existing feature control files.
Snapshot schema changes require a version bump and readiness warming before traffic.
Immutable generations expire after the retention window; state pointers do not expire independently.
Structured refresh logs identify school, resource, success/failure, duration, and bytes.
The discovery endpoint includes generation and Server-Timing headers; readiness identifies missing school/resource coverage.

The existing production profiler supports an explicit school selection and retains its classified OpenAPI inventory.
Use the profiling runbook for authenticated measurements, deployment alignment, and first-observed versus steady-state sampling.
API latency, document/RSC latency, image transfer, and browser paint need separate measurements.
No production latency or LCP improvement is claimed from unit tests or build success.

Browser-free regressions cover retained data on failures, competing/expired workers, changes during a build, school isolation, incomplete pagination, readiness recovery, confirmed edits, navigation scheduling, responsive image markup, and real Sharp/Satori/Resvg output.
Browser integration regressions are authored but remain unrun under the repository's no-browser/no-server rule.
The release gates include frontend lint/i18n/type checks/build, backend formatting/lint/types/tests, generated API contracts, Terraform validation, and migration alignment.

Remaining release validation is an end-user pass across Western, Waterloo, an empty school, and the largest catalog on desktop and mobile, followed by like-for-like production measurements.
The initial performance targets remain targets until measured: lower first-screen image transfer, smaller compressed discovery responses, fast navigation, and timely refresh across all enrolled schools.

## Pre-push verification

- Backend: `ruff format --check .`, `ruff check .`, `mypy .`, and the testing-environment `pytest -q` gate passed with 1,789 tests.
- Frontend: `npm run check`, `npm run test:discovery` (59 browser-free tests), and `NEXT_PUBLIC_API_URL=/api npm run build` passed.
- Terraform: recursive formatting, initialization without the backend, and validation passed for both roots using CI's Terraform 1.9.6.
- Workflow YAML parsed and all 34 shell blocks passed `bash -n`; mocked deployment success/failure/rollback/deadline cases passed.
- All 120 linked database migrations match production; this change adds no migration.
- The compiled standalone artifact contains the instrumentation dependencies and SDK.
- Browser E2E, visual/mobile verification, and production performance profiling were not run.
- TFLint and Actionlint are not installed locally; Terraform CI owns TFLint.

## References

- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [S3 strong consistency](https://aws.amazon.com/s3/consistency/)
- [Next instrumentation lifecycle](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Production API profiling runbook](../production_api_profiling_runbook.md)
