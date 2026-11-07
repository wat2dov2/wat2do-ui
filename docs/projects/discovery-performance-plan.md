# Discovery performance and cache reliability

Implementation record: September 26, 2026.
This follows the approved investigation of cold school discovery pages and slow poster delivery.
Western's canonical school slug is `uwo`.

## Implemented design

Events, Positions, Clubs, school branding, the school directory, and the site-wide banner use complete snapshots kept in Next's data cache.
Server rendering and browser directory refreshes read the same published data.
Snapshot caching lives in `shared/services/discoveryCache.server.ts`; feature server loaders own source assembly.
The old directory fetch-cache tags, unconditional five-resource invalidation, and recursive navigation warmer have been removed.
Event and club details use current source reads, memoized within their route render, so task-local detail caches cannot retain another task's stale club fields.

Snapshots were first kept in S3, then (on the Mac mini) as files written by a worker inside the one Next process.
Since 2026-11-05 the website runs on AWS Lambda (OpenNext), where no process lives long and no disk is shared, so each snapshot is one `unstable_cache` entry in Next's data cache, which OpenNext keeps in S3 (tags in DynamoDB) for every instance and deployment.
Its tag is `discovery:v<schema_version>:<school>:<resource>` (`_global` for the school directory and banner).
The refresh endpoint checks the shared secret and the school, marks the named tags stale with `revalidateTag(tag, "max")` and returns HTTP 202.
A stale snapshot is still served; the next read rebuilds it in the background, and so does any read once it is older than `refresh_interval_seconds`.
A build reads every source page or throws, and a throwing rebuild leaves the last complete snapshot in place, so a failed read, incomplete page set or upstream outage never publishes a partial catalog.
`generated_at` is when the rebuild's source reads began.
There is no startup readiness gate, background worker or image warmer any more: a snapshot nobody reads is never rebuilt, and the first read of a cold one waits for its build.

Page reads have bounded fan-out and deadlines.
Pagination requires stable ordering, matching totals, and a complete set of distinct IDs.
This rejects detected offset-pagination drift; it does not claim a transactional database snapshot across multiple HTTP reads.
The current school directory contract supports fewer than 50 returned schools; reaching its limit fails the directory build rather than silently excluding additional schools.

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
Since 2026-11-07 the events page's HTML carries only its first screen of the feed, not the feed itself (`getEventFeedFirstScreen`, `features/events/lib/eventFeedFirstScreen.ts`).
The server cuts it at render time through the same steps the page takes for the default list: the first `initial_render_count` cards, the count, the newest-added line, and when the varsity and campus season chips stop having events (`FeedFilterAvailability`).
The browser loads the complete feed from `/api/discovery` once the page is up and lists from it; until it arrives, a search, filter, sort or other view shows its loading state rather than a partial answer.
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

About (`/about`) and plain `/login` also use that full-payload navigation cache, including their navigation and banner links.
Only exact public route URLs are warmed; login links carrying email, invitation tokens, or redirect parameters remain separate requests.
About's content is already bundled, and its banner shares the global banner snapshot.
The root layout passes its school name into the banner, and a dismissed banner skips the snapshot read entirely.
Banner refresh failures preserve the last good generation; a confirmed disabled banner is a valid cached null.
Login selects four distinct active or upcoming events from the same school Events snapshot and reuses one request-scoped lookup for metadata and page rendering.
There is no independent preview cache to invalidate or rebuild.
These changes cache public data and browser navigation payloads; document rendering still respects request-specific login parameters and banner cookies.

## Images and Instagram

The shared poster owner renders responsive native image URLs before hydration and uses the existing Next optimizer for owned media.
The first six cards load eagerly; subsequent posters use native lazy loading.
The transparent cutout artwork remains owned by the existing mask primitive.
Source changes reset loading/error state, tiny badges request small candidates, and fullscreen posters retain their larger source.

Optimized posters are no longer warmed ahead of visitors; the image optimizer function makes each variant on first request and CloudFront caches it.

Instagram rendering retains PNG normalization before Resvg, including for WebP sources.
Poster preparation resizes to the template's actual region before embedding, and repeated cover posters share one download/preparation.
Admin previews use responsive smaller images while exported slides remain 1080 by 1350.
Publishing concurrency and a separate render worker remain contingent on measuring CPU contention on the shared task; speculative parallel rendering was not introduced.

## Operations and verification

Feature settings live in `backend/controlbox/database.json`, `discovery_cache.json`, `image_delivery.json`, and their existing feature control files.
Snapshot schema changes require a `schema_version` bump, which starts a new set of cache tags and keys.
The discovery endpoint includes generation and Server-Timing headers.

The existing production profiler supports an explicit school selection and retains its classified OpenAPI inventory.
Use the profiling runbook for authenticated measurements, deployment alignment, and first-observed versus steady-state sampling.
API latency, document/RSC latency, image transfer, and browser paint need separate measurements.
No production latency or LCP improvement is claimed from unit tests or build success.

Browser-free regressions cover cache tags and refresh scope, school isolation, incomplete pagination, confirmed edits, navigation scheduling, responsive image markup, and real Sharp/Satori/Resvg output.
Browser integration regressions are authored but remain unrun under the repository's no-browser/no-server rule.
The release gates include frontend lint/i18n/type checks/build, backend formatting/lint/types/tests, generated API contracts, and migration alignment.

Remaining release validation is an end-user pass across Western, Waterloo, an empty school, and the largest catalog on desktop and mobile, followed by like-for-like production measurements.
The initial performance targets remain targets until measured: lower first-screen image transfer, smaller compressed discovery responses, fast navigation, and timely refresh across all enrolled schools.

## Pre-push verification

- Backend: `ruff format --check .`, `ruff check .`, `mypy .`, and the testing-environment `pytest -q` gate passed with 1,789 tests.
- Frontend: `npm run check`, `npm test` (59 browser-free tests), and `NEXT_PUBLIC_API_URL=/api npm run build` passed.
- Terraform: recursive formatting, initialization without the backend, and validation passed for both roots using CI's Terraform 1.9.6.
- Workflow YAML parsed and all 34 shell blocks passed `bash -n`; mocked deployment success/failure/rollback/deadline cases passed.
- All 120 linked database migrations match production; this change adds no migration.
- The compiled standalone artifact contains the instrumentation dependencies and SDK.
- Browser E2E, visual/mobile verification, and production performance profiling were not run.
- TFLint and Actionlint are not installed locally; Terraform CI owns TFLint.

## References

- [Next instrumentation lifecycle](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Production API profiling runbook](../production_api_profiling_runbook.md)
