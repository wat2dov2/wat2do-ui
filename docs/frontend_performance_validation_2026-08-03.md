# Wat2Do Frontend Performance Validation

Status: partial pass.
Date: August 3, 2026.
Scope: `/`, `/events/17938`, `/organizations`, `/organizations/6767`, `/contact`, and `/login`.
Commit observed: `fc6ef443`, with the existing uncommitted workspace changes included.

## Outcome

The performance remediation produced large, verified improvements in transfer size, total blocking time, main-thread work, server response time, and desktop rendering.
The strict post-implementation gate is not complete because mobile LCP remains above the 4-second initial budget on every route, organization detail still reports CLS 0.157, the feed and directory remain above their DOM budgets, and most public routes remain above the 500 KiB compressed JavaScript budget.

The event feed is the clearest win.
Its median transfer fell from 19.50 MiB to 1.74 MiB, median TBT fell from 531 milliseconds to 155 milliseconds, median LCP fell from 11.23 seconds to 6.87 seconds, and its performance score rose from 61 to 74.

## Method

The validation used an optimized Next.js 16.2.9 production build running locally on port 3100.
Both `BACKEND_API_URL` and the client-bundled `NEXT_PUBLIC_API_URL` targeted the read-only production API at `https://wat2do.io/api`.
The browser matrix used Google Chrome 151 and Lighthouse 13.4.1 in navigation mode.
Mobile values are the median of three clean-storage simulated-mobile runs per route.
Desktop values are one clean-storage desktop run per route.

An initial matrix was discarded because its client bundle still targeted the unavailable local `/api` proxy after hydration.
The frontend was rebuilt with the production API URL embedded, a fresh browser tab confirmed that local proxy errors stopped, and the complete 24-report matrix was rerun.
Only the corrected matrix is used below.

The corrected raw reports are stored at `/tmp/wat2do-frontend-validation-corrected-20260803T192524Z` for this machine session.
The saved organization-detail trace is stored at `/tmp/wat2do-organization-detail-trace-report-0.trace.json`.

## Mobile medians

| Route | Score | FCP | LCP | TBT | CLS | Main thread | Transfer | DOM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Event feed | 74 | 1.36 s | 6.87 s | 155 ms | 0.000 | 2.43 s | 1.74 MiB | 1,610 |
| Event detail | 76 | 1.21 s | 7.36 s | 79 ms | 0.000 | 1.47 s | 1.25 MiB | 319 |
| Organizations | 81 | 1.21 s | 5.20 s | 53 ms | 0.0003 | 1.53 s | 1.21 MiB | 1,292 |
| Organization detail | 72 | 1.21 s | 6.04 s | 42 ms | 0.157 | 1.45 s | 1.33 MiB | 504 |
| Contact | 81 | 1.21 s | 5.20 s | 44 ms | 0.000 | 1.20 s | 1.20 MiB | 279 |
| Login | 81 | 1.21 s | 5.12 s | 43 ms | 0.000 | 0.80 s | 0.81 MiB | 261 |

## Before and after

| Route | Score | LCP | TBT | Transfer | DOM |
| --- | ---: | ---: | ---: | ---: | ---: |
| Event feed | 61 → 74 | 11.23 → 6.87 s | 531 → 155 ms | 19.50 → 1.74 MiB | 3,100 → 1,610 |
| Event detail | 73 → 76 | 8.60 → 7.36 s | 146 → 79 ms | 4.57 → 1.25 MiB | 535 → 319 |
| Organizations | 78 → 81 | 4.98 → 5.20 s | 201 → 53 ms | 1.44 → 1.21 MiB | 2,350 → 1,292 |
| Organization detail | 67 → 72 | 10.92 → 6.04 s | 140 → 42 ms | 2.05 → 1.33 MiB | 504 → 504 |
| Contact | 81 → 81 | 4.91 → 5.20 s | 126 → 44 ms | 1.49 → 1.20 MiB | 284 → 279 |
| Login | 85 → 81 | 4.15 → 5.12 s | 122 → 43 ms | 1.41 → 0.81 MiB | 272 → 261 |

The feed transfer reduction is 91.1 percent.
Median TBT improved by 46.2 percent to 73.9 percent on every route.
Mobile LCP improved materially on the feed and both detail routes, but regressed on organizations, contact, and login.

## Desktop guard

| Route | Score | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: |
| Event feed | 96 | 1.31 s | 5 ms | 0.000 |
| Event detail | 98 | 1.10 s | 0 ms | 0.000 |
| Organizations | 98 | 1.06 s | 0 ms | 0.00004 |
| Organization detail | 96 | 1.20 s | 0 ms | 0.081 |
| Contact | 99 | 1.04 s | 0 ms | 0.000 |
| Login | 92 | 1.91 s | 0 ms | 0.000 |

Every desktop route stays below 2 seconds LCP.
Organization detail remains the only unstable template on desktop.

## Gate verdict

| Gate | Budget | Result | Verdict |
| --- | ---: | ---: | --- |
| Mobile LCP | Below 4.0 s on every route | 5.12 to 7.36 s | Fail, 0 of 6 routes |
| Mobile TBT | Below 200 ms | 42 to 155 ms | Pass, 6 of 6 routes |
| CLS | Below 0.05 | Five routes below 0.001; organization detail 0.157 | Fail, 5 of 6 routes |
| Initial compressed JavaScript | Below 500 KiB | 499 KiB on login; 851 to 895 KiB elsewhere | Fail, 1 of 6 routes |
| Feed initial transfer | Below 2 MiB | 1.74 MiB | Pass |
| Feed initial DOM | Below 1,000 nodes | 1,610 | Fail |
| Directory initial DOM | Below 1,000 nodes | 1,292 | Fail |
| Largest first-viewport event image | Below 150 KiB | 41 KiB on the feed; 51 KiB on event detail | Pass |
| Below-fold initial image requests | Zero | 18 low-priority event posters on the feed | Fail |
| Unexpected route prefetches | Zero | 12 to 15 RSC requests on five routes; zero on login | Fail |
| Event map before interaction | Zero map requests | Zero | Pass |
| Event map after interaction | Map renders on demand | Google Maps iframe rendered after one click | Pass |
| First-observed organization-detail TTFB | Below 500 ms | 160 ms | Pass |
| Warm organization-detail p95 | Below 50 ms | 16.2 ms | Pass |

## Verified server response

A clean optimized rebuild was started and organization detail was requested before any browser visit.
The first-observed organization-detail TTFB was 160 milliseconds, down from the 1.26-second baseline.
The following ten warm requests produced a 10.6-millisecond median and 16.2-millisecond p95.

All warm local p95 values stayed below 18 milliseconds in the earlier six-route sample.

## Verified browser behavior

The 390 by 844 event feed rendered 24 crawlable event links.
The first four posters used responsive `srcset` sources with `fetchpriority="high"` and eager loading.
Later posters used low priority and native lazy loading.
The DOM emitted no `link[rel="prefetch"]` elements.

Lighthouse still observed 22 event poster requests on the feed.
Four were high priority and 18 were low priority, which means native lazy loading alone does not meet the zero below-fold request budget.

The event detail page emitted zero Google Maps requests before interaction.
The page exposed one `Load location map` button.
After one click, the Google Maps iframe rendered successfully.

## Remaining root causes

### 1. Organization-detail reordering causes the persistent CLS

The saved trace records one shift with score 0.156802.
The affected element is the first event card at `div.space-y-5 > section.space-y-2.5 > div.grid > div.min-w-0`.
Its trace rectangle changes from zero size to 194 by 332 pixels.

`OrganizationEventsGrid` renders the server order while `useCurrentTime()` is `null`.
Immediately after mount, `useCurrentTime()` sets `Date.now()` and the component reorders upcoming and historical events.
That post-hydration reorder is the remaining CLS source.

### 2. Shared navigation still causes unexpected RSC prefetching

Lighthouse records 12 to 15 `_rsc` requests on every scoped route except login.
The requests target shared destinations such as `/promote`, `/contact`, `/organizations`, `/`, and the page-header back destination.

Event card links already disable prefetch.
The shared floating-dock links and `PageHeader` back link still use Next's default prefetch behavior.

### 3. The shared JavaScript floor remains too high

Median transferred JavaScript is about 851 to 895 KiB on five routes and 499 KiB on login.
Lighthouse still estimates about 375 to 384 KiB of unused transferred JavaScript on the five non-login routes.
The same 222 KiB uncompressed shared chunk owns every remaining mobile long task in the corrected reports.

The corrected Next route graph contains 1.56 to 1.68 MB of uncompressed first-load JavaScript across the six routes.
The generated analyzer output is at `frontend/.next/diagnostics/analyze`.
The generated route inventory is at `frontend/.next/diagnostics/route-bundle-stats.json`.

### 4. Native poster lazy loading is too permissive for the strict image budget

The responsive image path solved the byte problem.
The 22 requested event posters transfer about 503 KiB in the median feed run instead of the previous 18.38 MiB image payload.

Chrome's native lazy-loading threshold still requests posters well below the first viewport.
A stricter near-viewport image activation path or a smaller initial rendered list is required to reach zero below-fold requests.

### 5. Feed and directory card DOM remain expensive

The feed DOM fell by 48.1 percent and the directory DOM fell by 45.0 percent.
They still exceed their 1,000-node budgets because each rendered card carries a substantial masked-SVG and badge subtree.

Reaching the budget requires fewer initial cards, a simpler card image mask, or both.

## Next implementation order

1. Make the organization event order deterministic on the server and first client render so hydration does not reorder cards.
2. Disable automatic prefetch in the shared floating dock and page-header back link unless a navigation has a measured reason to prefetch.
3. Reduce the shared provider and client-runtime floor until non-login routes are below 500 KiB transferred JavaScript.
4. Replace native-only poster lazy loading with a stricter near-viewport activation path.
5. Reduce the initial feed and directory card counts or simplify the shared card SVG structure until both DOM budgets pass.
6. Re-run the same 24-report matrix after those changes.
7. Validate one low-end physical Android device after deployment.
8. Compare field LCP, INP, and CLS at p75 after sufficient production traffic accumulates.

## Checks that remain external

No physical Android device was connected to this workspace, so the physical-device gate was not run.
The changes are not yet deployed with sufficient traffic, so production p75 field data cannot be evaluated in this local validation.
