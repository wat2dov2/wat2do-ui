# Unassigned backlog implementation

Base: `origin/main` at `6d9fb8bf`.
Worktree: `wat2do-unassigned`, branch `codex/unassigned-backlog`.
No changes from the stale checkout were carried over.
Issues stay open until their requested work is implemented and verification limitations are recorded.
Browser and server runs require an explicit user request under AGENTS.md.

## Verification

Verification is incomplete and no Linear issue has been marked Done.
The live inventory and this audit each contain exactly 49 unique issue IDs, with no missing or unexpected IDs.
The work remains on `codex/unassigned-backlog`, based on `origin/main` commit `6d9fb8bf`.

### Completed checks

- Selected integration/position Chromium run: **69 passed** in 2.6 minutes.
- Hover, More filters and theme stability checks: **12 passed** across three repetitions.
- Settings/payout regressions after selector and navigation-progress fixes: **3 passed**.
- Navigation regression rerun after the progress fix: **13 passed**.
- Frontend `npm run check`: lint, translation audit and typecheck pass.
- Additional TypeScript compilation includes **all 7 E2E source/helper files**, not only files included by normal frontend typecheck.
- Frontend production `npm run build`: passes with `testProxy` disabled.
- Backend suite: **1,080 passed**, 5 live-model tests deselected, 7 dependency warnings.
- Backend `ruff check .`, `ruff format --check .` (295 files), and configured `mypy .` (42 files): pass.
- `git diff --check`: passes.

The browser harness uses Next.js's test proxy and one shared response factory for browser and server-side fetches.
These mock-backed browser tests do not verify the database or production integrations.
UI fixes stayed in their shared reusable owners: count headings, combobox interaction and navigation progress.
Submission descriptions reuse the existing school-directory query instead of displaying raw school slugs.
The React best-practices review kept these changes in existing owners without adding a second cache or navigation mechanism.

### Known failures and unexecuted checks

The repository currently lists **105 browser tests across 6 suites**.
The other four suites initially produced **4 passes and 13 failures**.
Three of those failures were corrected and rerun successfully.
A separate, deterministic delayed-constants regression fails after the constants response arrives: the UI still shows fallback categories.
Across the recorded runs, **76 unique tests pass, 11 remain known failures, and 18 were not executed in the final verification configuration**.
Repeated navigation/theme runs are not counted as additional unique passes.

Failures from the last browser run:

- Four followed-club cases lack server-side fixtures and fail before their intended flows.
- The older onboarding test assumes obsolete goose text, a six-step flow and a local profile snapshot.
- Two membership cases include missing server fixtures and a removed main-bar club selector assumption.
- Three promoter recruitment/scan cases fail with missing server-side feed fixtures.
- The category test reproduced the non-reactive constants cache; the approved query-ownership fix below has not yet been rerun in a browser.

The 18 unexecuted checks consist of 13 real-backend API/proxy/auth checks, two metadata/render checks requiring runtime configuration, two obsolete route/UTSC-fixture cases, and one overflowing-category-strip case affected by the constants race.
Those exclusions are not passes.
Final runtime logs also showed Radix server/client ID hydration mismatch warnings.
Their root cause has not been resolved, so passing flow assertions are not a clean-runtime guarantee.

The constants ownership change was approved and implemented on September 10, 2026, as recorded below.
Database migration and seed reset remains blocked because the Docker daemon is not running; the daemon was checked again.
Google Analytics needs a measurement ID.
The original posters/events for WAT-270 and WAT-274 are still missing.
WAT-273 requires the account owner to reconnect Meta.
Production OAuth settings, original 502 behavior, deployed schedules and latency remain outside the proven local results.

### Approved constants query ownership change, September 10

TanStack Query now owns `/meta/constants` under `queryKeys.meta.constants()`.
Startup prefetch and all category/interest option consumers share `appConstantsQueryOptions()` and the existing app QueryClient.
`useAppConstants` subscribes rendered options and onboarding topic validation to server updates.
Fallback values remain observer placeholders, not fresh cached server data.
Non-React event mappers read `getAppConstantsSnapshot()` from that same cache.
The mutable module cache, its separate bootstrap function, and the interests/organization-category getter files were removed.
No API contract, backend implementation, or visual styling changed.
The React best-practices review kept derived options dependent on the query data and avoided mirrored state or effects that copy query results.

Verification for this change:

- `npm run check`: lint, translation audit, and typecheck pass.
- Additional TypeScript compilation includes all seven E2E source/helper files.
- Browser-free checks using the actual query options and TanStack Query observers pass for delayed responses, request deduplication, subscriber updates, shared snapshot reads, fallback cache isolation, and failure recovery.
- Backend suite with CI test credentials: 1,080 passed, five live-model tests deselected, seven dependency deprecation warnings.
- `git diff --check`: passes.

The delayed-response E2E regression additionally asserts that old fallback categories disappear and only one constants request is issued.
It was not executed after this change because AGENTS.md requires a fresh explicit request to start a browser/server.
The earlier browser totals above are historical and are not upgraded to passes by the browser-free checks.
The temporary non-browser verification harness is `/tmp/wat2do-constants-check-JewAaR/check.cjs`.
No browser/server startup, commit, push, deployment, or Linear status change was performed for this ownership change.

### Artifacts and cleanup

The 69-pass browser log and screenshots are preserved at `/tmp/wat2do-verified-browser-3xKdsP/`.
Event and position mobile screenshots were inspected.
Transparent position-image fixtures are not evidence about production poster delivery.
The other-suite failure artifacts are preserved at `/tmp/wat2do-other-suite-failures-AiTPgh/`.
Additional logs are `/tmp/wat2do-browser-final-regressions.log`, `/tmp/wat2do-browser-qr-regressions.log`, `/tmp/wat2do-browser-navigation-final.log`, and `/tmp/wat2do-production-build.log`.
Earlier offline render checks passed for missing configuration, an untrusted image origin, failed image download, and English/French PNG generation.
Normal and maximum-length French covers were inspected.
Earlier browser artifacts remain at `/tmp/wat2do-browser-verification-0s8pnk/`.

All temporary browsers and the Next.js server were stopped.
No listeners remained on ports 3000 or 8000.
No production writes, commit, push, deployment, or Linear status changes were performed.

## Issue-by-issue verification audit

“Pass” below refers only to the stated evidence, not deployed completion.
Remaining local coverage work is distinguished from production, account, asset, or database blockers.

| Issue | Acceptance | Evidence | Remaining gap or qualification |
| --- | --- | --- | --- |
| WAT-213 | Position extraction excludes elections and nominations | Prompt regression tests pass. | Live-model evaluation not run. |
| WAT-225 | Restore All and retain events until their effective end | All reset and effective-end browser regressions pass. | Original missing UofT event not checked against production data. |
| WAT-226 | Keyboard option selection | Shared combobox keyboard selection passes in position submission. | School/club combobox owner reused. |
| WAT-227 | Exclude closure-only notices | Prompt regression tests pass. | Original TMU event and live-model extraction not replayed. |
| WAT-228 | Keep added-time visible beside truncated titles | Mobile long-title browser regression passes. | Non-English longest-label layout not separately exercised. |
| WAT-229 | Hover dropdowns | Date hover/menu entry and school-combobox hover-then-click pass; targeted disclosure checks repeated three times. | Touch and every disclosure surface not exhaustively checked; runtime hydration-ID warnings remain unresolved. |
| WAT-231 | Google login | Browser verifies same-origin OAuth callback. | Production Supabase Site URL/redirect allowlist and real Google login require owner verification. |
| WAT-232 | Remove view/category from More filters | Isolated More filters drawer regression passes, including three repeated runs. | Approved category-loading query fix passes non-browser checks; browser rerun remains pending. |
| WAT-233 | Minimum attendee filter | Numeric threshold and All-reset browser regression passes. | Superseded slider interaction follows WAT-252. |
| WAT-234 | Position filters, latest item, and submission | Paid/New/latest filters, poster drop, submission and admin approval pass in browser; backend tests pass. | Atomic approval migration and real database concurrency await local reset. |
| WAT-235 | Intersect filter selections | Backend club-category intersection regression passes. | Approved constants query fix is implemented; category combinations still require a browser rerun. |
| WAT-236 | School-specific faculties | Backend validation and McMaster onboarding browser regression pass; all 37 schools have faculty arrays. | Migration/seed reset and authoritative catalog validation for every school remain. |
| WAT-237 | Generated default avatars | Deterministic generation and existing-image preservation backend tests pass. | Real generated-image delivery not browser-verified. |
| WAT-238 | Attendee images on page and drawer | Mobile drawer image loading and attendee names on both surfaces pass in browser. | Image test uses a local fixture, not production delivery. |
| WAT-239 | Brock canonical slug brocku | Migration and seed updated. | Local migration reset and deployed domain routing unverified. |
| WAT-240 | UQAM blue branding | Migration and seed updated. | Local migration reset and deployed branding unverified. |
| WAT-241 | Remove main-bar club selector | Desktop/mobile navigation browser regression passes. | Club selection remains in existing sidecar. |
| WAT-242 | Admin contrast and appearance | Shared status, table-header and card changes implemented; frontend checks pass. | Measured contrast and full admin visual review not complete. |
| WAT-243 | School-agnostic admin queries | Source and backend regression coverage implemented. | Multi-school browser/data integration not complete. |
| WAT-244 | Global recent admin activity | Merged source and backend regression coverage implemented. | Every activity navigation target and production data not browser-verified. |
| WAT-245 | Admin positions section | Submission review and approval browser flow passes. | Multi-school published-position pagination not separately browser-verified. |
| WAT-246 | Mobile account actions in sidecar | Compact admin/club/logout placement and desktop navigation browser regressions pass. | Uses existing origin/main sidecar, no parallel drawer. |
| WAT-247 | Pointing-hand carousel cover | Offline English/French PNGs visually inspected. | Deployed editor/render verification outstanding. |
| WAT-248 | Smaller poster fan and dominant count | Offline normal and maximum-length French covers inspected without overlap. | Deployed editor/render verification outstanding. |
| WAT-249 | School-language cover and caption | French caption backend tests and offline French rendering pass. | Language migration and deployed pipeline unverified. |
| WAT-250 | Default school site language | UQAM defaults to French and explicit English survives reload in browser. | UdeM/Laval not independently browser-tested; migration reset required. |
| WAT-251 | Western carousel club prepopulation | Waterloo and Western editor regressions pass club prepopulation and save-before-add. | Original Western production batch not changed. |
| WAT-252 | Minimum-going number input | Browser threshold/filter/reset regression passes. | No slider path retained. |
| WAT-253 | Shared hover-triggered disclosure | Shared date hover and combobox hover/click regressions pass repeatedly. | Touch and every disclosure surface not exhaustively checked; runtime hydration-ID warnings remain unresolved. |
| WAT-254 | Theme reveal origin | Exact button-center origin, reveal radius, reduced-motion bypass and theme persistence pass; targeted checks repeated three times. | No production verification claimed. |
| WAT-255 | Event/position drawer navigation | Both browser flows pass keyboard/button navigation; position scroll reset passes. | Keyboard focus guarded through shared navigation. |
| WAT-256 | Cheaper Gemini OCR investigation | Official pricing comparison and benchmark criteria documented below. | No representative model benchmark or production model switch performed. |
| WAT-257 | Minimum club-event filter | Browser request/filter/reset and backend regressions pass. | SQL computed-count migration not integration-tested without local reset. |
| WAT-258 | Instagram batch PATCH 502 | Bulk reads/redundant-write fixes, backend tests and mocked editor save pass. | Original production 502 not reproduced or demonstrated fixed. |
| WAT-259 | Background Instagram publishing | HTTP 202 claim/poll implementation and backend success/failure tests pass. | Deployed worker execution and restart durability not proven; BackgroundTasks is not a durable queue. |
| WAT-260 | Today/tomorrow occurrence matching | Preset/custom-date and effective-end browser regressions pass. | Production data behavior not replayed. |
| WAT-261 | Replace PostHog with Google Analytics | PostHog removed; gated GA integration implemented. | Measurement ID missing, so analytics remains inactive. |
| WAT-262 | Rename organization wording to clubs | English UI/metadata/slide wording changed; internal contract names retained. | Multilingual terminology audit found remaining generic organization wording; not complete. |
| WAT-263 | Fixed scrolling sections | Mobile events, clubs and positions retain fixed controls while their lists scroll in browser. | Original attachment-specific visual matching was not completed. |
| WAT-266 | Automatic six-digit OTP submission | Browser verifies no request before six digits, one attempt, and retry after code change. | Real OTP delivery/account login not exercised. |
| WAT-267 | 8 AM Toronto daily batches | Workflow source and backend tests updated. | Deployed schedule not verified. |
| WAT-268 | All candidates, chronological order, simpler captions | Backend all-page/>9-event regressions and browser select/reorder/save-before-add pass. | Migration and deployed platform publish-limit behavior unverified. |
| WAT-269 | Event/position image upload | Shared image field used; position drag/drop-to-approval and event upload/parse browser tests pass. | Event drag/drop gesture and live extraction/storage not independently verified. |
| WAT-270 | Broken event poster extraction | Field preservation, nonempty validation and nonblocking extraction implemented/tested. | Original affected poster/event missing, so original failure not established fixed. |
| WAT-271 | Club required despite typed club | Browser verifies case-insensitive typed event-club name and @handle save canonical organization_id; Western prepopulation and position keyboard selection also pass. | Original attachment case and new-event creation with typed club not independently replayed. |
| WAT-272 | Add existing event by ID to batch | Browser verifies add-by-ID, duplicate prevention and no event-creation flow. | Original UAlberta production batch not modified or replayed. |
| WAT-273 | McMaster failed publishing | Failure identified as revoked/invalid Meta session. | Account owner must reconnect Meta; not fixable by a local code assertion. |
| WAT-274 | Blank event/poster images | Fail-closed image renderer offline checks pass; event poster fixture loads in browser. | Original affected event/poster missing; production root cause not proven. |
| WAT-275 | Slow Instagram admin rows | Bulk hydration/concurrency/prefetch and mocked row-opening regression pass. | Production latency not profiled; no production speedup claim. |

## Approved position and club-filter implementation

The user approved extending the existing moderation pattern, explicit paid data, shared heading consolidation, and SQL-owned club event counts.
Position creation now goes through authenticated submissions and admin approval rather than a second direct-write path.
The backend derives school ownership from the selected club and does not trust a client-supplied school ID.
Position image parsing uses the selected browsing school.
The approval function locks the submission and inserts the published position in the same transaction; repeated approval returns the existing review result.
Paid status is explicitly true, false, or unknown; existing rows are not guessed from role type or compensation prose.
The existing event latest-added wrapper was removed, and both directories use the shared heading and shared newly-added filter.
Generic filter translations moved to common locale ownership, and obsolete source-link wording was removed across all 20 locales.
Seed fixtures cover paid, unpaid, unknown, and pending-review positions.
The count implementation follows PostgREST's [computed-field filtering](https://docs.postgrest.org/en/latest/references/api/computed_fields.html) and counts all club events, matching the previous display semantics.
`supabase db reset` was attempted but failed because the Docker daemon is not running at the configured socket.
This implementation section predates the subsequently authorized browser/server verification above.
No Docker daemon startup, migration deployment, commit, push, or Linear Done transition was performed.

## WAT-256: OCR cost investigation

The checked-in extraction default is `gpt-5-nano` in `backend/core/config.py`.
The shared extractor accepts ordered poster images and a structured event/position prompt, so evaluate complete extraction rather than text transcription alone.

| Model | Standard input / million tokens | Standard output / million tokens |
| --- | ---: | ---: |
| GPT-5 nano | $0.05 | $0.40 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 |

Prices checked against the [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5-nano) and [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) on September 9, 2026.
Gemini Flash-Lite batch pricing is $0.05 input and $0.20 output per million tokens, but batch processing is not equivalent to the synchronous poster-upload experience.
Google documents image tiling and resolution-dependent token costs in its [image-understanding guide](https://ai.google.dev/gemini-api/docs/image-understanding).

Recommendation: do not switch based on token prices alone.
Benchmark the same English and French posters, including dense schedules, elections, closure notices, and multi-image posts.
Compare accepted-event accuracy, date/time and school correctness, image-index attribution, total billed tokens including reasoning, latency, and cost per correctly extracted event.
No Gemini benchmark or production model switch was performed, so no per-poster savings are claimed.

## Issue checklist

- [ ] WAT-274: event images keepshowing up blank
- [ ] WAT-273: mcmaster 2026-09-08 failed to publish not sure why
- [ ] WAT-272: ualberta 2026-09-08 run it wont let me add event id
- [ ] WAT-268: update batch processing so its actually gonna show all events not just llm selected ones. simplify the code by just removign that filter feature and prmopt. sort them by their start dates
- [ ] WAT-271: organization is reuqired error when i provided organization
- [ ] WAT-270: event image processing doesnt work,
- [ ] WAT-269: dragging image into event uplaod and position upload is broken
- [ ] WAT-267: update batch processing to happen at 8am not 1pm
- [ ] WAT-266: once you enter 6 digits for email otp instnatly process
- [ ] WAT-263: these sections should be fixed.
- [ ] WAT-262: rename organizations to clubs eveyrwhere semantically without breaking app
- [ ] WAT-261: delete post hog and add google anlaytics
- [ ] WAT-260: date filters like today, tomorrow arent matching whats showing up for events like we see things happen tomorrow despite filteirng for today
- [ ] WAT-259: instagram publishing should be a backgrouhnd job, not blocknig the ui
- [ ] WAT-258: instagram-publishing returning 502
- [ ] WAT-249: Use school language as source of truth for cover images
- [ ] WAT-250: Default school site language from school language setting
- [ ] WAT-245: Add a positions section to the admin page
- [ ] WAT-225: Add all button back
- [ ] WAT-233: Add minimum attendee filter to event filter bar
- [ ] WAT-232: Remove view and category from More filters
- [ ] WAT-231: fix google login
- [ ] WAT-229: make dropdowns hover based, not click based
- [ ] WAT-228: the new event added x ago button; on mobile we want to always see the 'added x ago' part of the text ,making the event text itself like ellipsis earlier while unaffecting hte 'added x ago' text
- [ ] WAT-227: update event prompt, an event (https://tmu.wat2do.io/events/20897) about club being closed for labour day is not an event but got created as one
- [ ] WAT-226: in input option select compennt, let arrows like keyboard arrows change seleciton
- [ ] WAT-213: fix positions prompt, it counted exec elections as a position
- [ ] WAT-251: Prepopulate organization in Western Instagram carousel batch
- [ ] WAT-256: look into using gemini models for cheaper ocr
- [ ] WAT-252: Replace X going slider with number input
- [ ] WAT-253: Use hover-triggered dropdowns in shared UI component
- [ ] WAT-254: radial light/dark mode animation starts from top center of screen instead of the button being clicked/cursor
- [ ] WAT-255: at the top left of events nad positions drawres have left and right arrow button side by isde to chagne the event/position in view. also let keyboard left adn right arrow change too
- [ ] WAT-257: add filter in organization page for '>0 events' and have dropdown similar to that of events '>0 going' number input
- [ ] WAT-248: Refine Instagram carousel cover event layout
- [ ] WAT-247: Replace carousel swipe chevron with pointing-right emoji
- [ ] WAT-246: Move mobile admin, organization, and logout actions into sidecar
- [ ] WAT-244: Show global recent activity in the admin page
- [ ] WAT-243: Make admin data queries school-agnostic
- [ ] WAT-242: Improve admin interface color contrast and visual design
- [ ] WAT-241: Hide organization dropdown from the main navigation
- [ ] WAT-240: update school colours (uqam green -> blue,
- [ ] WAT-239: brock.wat2do.io -> brocku.wat2do.io
- [ ] WAT-238: Show attendee profile images on event pages and drawers
- [ ] WAT-237: Provide generated default profile images for all users
- [ ] WAT-236: Make onboarding faculty selection school-specific
- [ ] WAT-235: Make filter selections use intersection logic
- [ ] WAT-234: Redesign position filters and add-position control
- [ ] WAT-275: clicking on rows in /admin/instagram table take forever
