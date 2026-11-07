# Frontend tests

Use Node 22, matching CI.

- `npm test` runs every `*.unit.spec.ts` without a browser or server.
- `npm run test:browser` runs the browser journeys against an already-running app at `http://127.0.0.1:3000`.
- `npm run test:browser -- --list` checks browser test collection without launching anything.

- `skeleton-layout.spec.ts` holds each page's data back, measures its loading state, releases the data and checks that every `data-skeleton-key` landmark keeps its box (within 1px) and that no layout shift is recorded, at 390x844 and 1440x900.
  CI runs it in its own job against a `PLAYWRIGHT_TEST=1` build.
  `SKELETON_LAYOUT_REPORT=1` records the numbers and before/after screenshots without failing, and `SKELETON_LAYOUT_BASE_URL` points it at an app on another port.
  When a loading state or the page it stands in for changes, mark the matching boxes on both sides with the same `data-skeleton-key`.

The browser suite uses Next's experimental test mode for server-side API fixtures.
Run it against an app started with `PLAYWRIGHT_TEST=1`, with the local backend available for the API proxy boundary checks.
Agents must follow the browser/server restrictions in `AGENTS.md`.

## Keep tests that catch meaningful regressions

Browser-free checks cover filter composition, school-local dates and DST, cache races and recovery, complete directory loading, request boundaries, image output, initial HTML, and form payload validation.
CI discovers these by filename, so adding coverage does not require editing a script or workflow.

Browser journeys cover actions across the UI: sign-in, onboarding, filtering, navigation, submissions, attendance, club following, and administrative review.
Keep API-origin and authentication checks at the proxy boundary.
The backend suite owns endpoint validation, search, pagination, permissions, and persistence contracts.

Prefer assertions about visible content, actions, data, errors, and accessibility.
Keep layout checks when they protect usability, such as clipping, scrolling, or unreachable controls.
Avoid assertions that merely repeat Tailwind classes, border radii, decorative SVG coordinates, or old copy that must remain absent.
Wait for the expected UI state rather than sleeping for an arbitrary duration.

Do not check in generated screenshots or test-results.
Playwright captures failure screenshots automatically; an image saved without a comparison is not a visual regression test.
