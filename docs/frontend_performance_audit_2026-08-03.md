# Wat2Do Frontend Performance Audit

Status: measurement-only audit.
Date: August 3, 2026.
Scope: `/`, `/events/{id}`, `/organizations`, `/organizations/{id}`, `/contact`, and `/login`.
Commit observed: `660b3275`, with the existing uncommitted workspace changes included.

## Executive summary

Desktop performance is generally strong, but the throttled mobile experience is not.
Median mobile Lighthouse performance scores range from 61 to 85, and every measured route has an LCP above the 2.5 second target.
The event feed is the highest-impact problem at 19.5 MiB transferred, 11.2 seconds LCP, 531 milliseconds TBT, about 3,100 DOM nodes, and 482 inline SVGs after hydration.

The primary bottleneck is not server response time.
Warm local TTFB ranges from 0.8 to 22 milliseconds, while even the static contact page reaches 4.9 seconds median mobile LCP.
The dominant costs are eager full-resolution event images, a broad shared client bundle, large initial lists, per-card SVG measurement and masking, and unnecessary route prefetching.

The highest-ROI sequence is:

1. Add a real responsive event-image delivery path and stop loading below-the-fold posters eagerly.
2. Split the global `client-routes.tsx` client boundary into route-owned entry points.
3. Reduce the root providers and defer PostHog, auth bootstrap, motion, and nonessential client work.
4. Paginate the public feed and directory while preserving crawlable server links.
5. Replace eager embedded maps with a click-to-load or near-viewport path.
6. Fix the event-card intrinsic-size mismatch that causes organization-detail CLS.

The companion visual is [`frontend_performance_breakdown_2026-08-03.svg`](frontend_performance_breakdown_2026-08-03.svg).

## Test environment and method

The audit used an optimized Next.js 16.2.9 production build running locally on port 3100.
The local Docker and Supabase stack was unavailable, so the local frontend used the read-only production API at `https://wat2do.io/api`.
This preserves real entity and image behavior while keeping the frontend server, JavaScript, rendering, and browser work local.

The browser matrix used Google Chrome 151 and Lighthouse 13.4.1 in navigation mode.
Mobile results are the median of three clean-storage simulated-mobile runs per route.
Desktop results are one clean-storage desktop run per route and should be treated as directional.
Lighthouse TBT is a laboratory responsiveness proxy and is not field INP.

Additional evidence came from:

- The Codex in-app browser at a 390 by 844 viewport.
- Next.js `route-bundle-stats.json`.
- Next.js 16 `experimental-analyze --output` Turbopack analysis.
- Ten-request warm local HTTP samples after one first-observed request.
- Raw HTML, compression, response headers, request inventory, main-thread breakdown, LCP element, and CLS culprit audits.

The representative records were event `17938`, Cuban Salsa Classes, and organization `6767`, A Cappella Club.

## Results by route

### Mobile medians

| Route | Score | FCP | LCP | TBT | CLS | Main-thread work | Transfer | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Event feed `/` | 61 | 1.51 s | 11.23 s | 531 ms | 0.000 | 3.75 s | 19.50 MiB | 3,100 |
| Event detail | 73 | 1.36 s | 8.60 s | 146 ms | 0.000 | 1.86 s | 4.57 MiB | 535 |
| Organization directory | 78 | 1.36 s | 4.98 s | 201 ms | 0.000 | 2.88 s | 1.44 MiB | 2,350 |
| Organization detail | 67 | 1.36 s | 10.92 s | 140 ms | 0.157 | 1.59 s | 2.05 MiB | 504 |
| Contact | 81 | 1.36 s | 4.91 s | 126 ms | 0.000 | 1.36 s | 1.49 MiB | 284 |
| Login | 85 | 1.36 s | 4.15 s | 122 ms | 0.000 | 1.05 s | 1.41 MiB | 272 |

All six mobile LCP results exceed 4 seconds, which is the poor range under the current Core Web Vitals guidance.
The feed, event detail, and organization detail are materially worse than the shared baseline because their LCP candidates are event images competing with unnecessary image and JavaScript work.

### Desktop results

| Route | Score | FCP | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Event feed `/` | 88 | 0.37 s | 2.36 s | 21 ms | 0.002 |
| Event detail | 98 | 0.33 s | 1.01 s | 0 ms | 0.000 |
| Organization directory | 97 | 0.33 s | 1.22 s | 0 ms | 0.000 |
| Organization detail | 90 | 0.33 s | 1.97 s | 0 ms | 0.081 |
| Contact | 98 | 0.33 s | 1.19 s | 0 ms | 0.000 |
| Login | 94 | 0.33 s | 1.68 s | 0 ms | 0.000 |

Desktop results show that the server and first paint path are healthy on fast hardware.
They also show that organization-detail layout movement is real rather than an artifact of mobile throttling.

## Server and document delivery

The following table separates first-observed API-dependent rendering from the warm Next.js data-cache path.

| Route | First-observed TTFB | Warm median TTFB | Warm p95 TTFB | Identity HTML | Gzip transfer |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 218 ms | 22.0 ms | 28.9 ms | 333.6 KiB | 54.4 KiB |
| `/events/17938` | 547 ms | 10.2 ms | 15.4 ms | 114.1 KiB | 30.7 KiB |
| `/organizations` | 37 ms | 14.2 ms | 17.0 ms | 592.6 KiB | 37.4 KiB |
| `/organizations/6767` | 1,264 ms | 8.4 ms | 14.1 ms | 116.6 KiB | 27.6 KiB |
| `/contact` | 2.8 ms | 0.8 ms | 1.3 ms | 95.4 KiB | 19.4 KiB |
| `/login` | 8.9 ms | 6.2 ms | 7.9 ms | 183.5 KiB | 40.5 KiB |

The cache path is excellent.
The first-observed organization detail is expensive because it fetches the organization, school, and all organization-event pages before responding.
The directory identity HTML is large because it server-renders 40 organization cards, including repeated SVG markup.
The login response serializes the full event feed even though the UI selects only four preview events and hides the preview panel on mobile.

## Bundle findings

Next.js reports 3,103,915 bytes of uncompressed first-load JavaScript for contact, event detail, login, organization directory, and organization detail.
The event feed is slightly smaller at 2,499,824 bytes.
The smallest application route group is still about 1,487,286 bytes, which establishes a high shared-provider floor.

Lighthouse observes about 940 to 1,370 KiB of transferred JavaScript depending on the route.
It estimates 435 to 475 KiB of compressed JavaScript is unused on every scoped page.
On the mobile event feed, JavaScript evaluation, parsing, style, and layout account for roughly 3.75 seconds of main-thread work.

The Next.js Turbopack analyzer confirms the import-chain cause.
Every route importing `frontend/src/app/client-routes.tsx` inherits admin, Instagram, poster, organization-panel, marketing, design-system, onboarding, QR, and settings code from one client module.
The analyzer also shows Mapbox, QR, Instagram, Framer Motion, and other feature code in the contact-route graph.

The root `ClientProviders` boundary imports Framer Motion `domMax`, i18n installation, auth initialization, runtime constants, PostHog identity helpers, TanStack Query, and tooltips for every route.
The production instrumentation and `shared/lib/posthog.ts` both import `posthog-js` eagerly.
Lighthouse attributes 400 to 1,250 milliseconds of mobile script evaluation to the shared chunk containing PostHog and core client runtime code.

## Image findings

The event feed transfers 18,375 KiB across 68 image requests.
Images account for about 94 percent of the entire 19.5 MiB feed transfer.
The eight largest posters range from about 701 KiB to 2,575 KiB each.
Several are source PNGs above 1 MiB and are displayed in cards only about 194 by 208 CSS pixels.

`EventImageCutout` first exposes every poster as a CSS background and then replaces the face with an SVG `<image>` after per-card measurement.
The browser therefore cannot use native `loading`, `srcset`, `sizes`, or Next.js image optimization for the grid artwork.
`content-visibility: auto` skips some layout and paint work but does not stop those background and SVG resources from downloading.

The first visible event poster is the LCP element on the feed and event detail.
Lighthouse reports that it is discoverable and eager but is not given high fetch priority.
At the same time, dozens of offscreen posters compete for bandwidth.

The top-navigation raster logo is 115,781 bytes but is displayed around 34 by 24 pixels.
Lighthouse estimates about 115 KiB of that request is avoidable.
The `/wat2do-logo.svg` public asset is 574,282 bytes, transfers at roughly 227 KiB with compression, and currently returns `Cache-Control: public, max-age=0`.
Hashed Next.js chunks correctly return one-year immutable caching, so the logo path is the caching exception.

## Rendering and layout findings

The hydrated event feed contains roughly 3,100 DOM nodes and 482 inline SVGs for 52 event cards.
Each `EventCardImage` creates measurement state, callback refs, a `ResizeObserver`, mask markup, and nested SVG fillets.
That architecture turns a simple card grid into substantial layout, rendering, and garbage-collection work on a low-end mobile profile.

The organization directory contains roughly 2,350 DOM nodes for 40 cards.
Its mobile main-thread work is 2.88 seconds even though its image transfer is only about 122 KiB.
This makes list size and component complexity, rather than images, the directory's dominant bottleneck.

Organization detail repeatedly produces CLS 0.157 on mobile and 0.081 on desktop.
Lighthouse identifies event-list items using `content-visibility: auto` and `contain-intrinsic-size: auto 20rem` as the shifting elements.
The placeholder block does not match the rendered event-card height, so content moves when cards become visible.

## Request and third-party findings

Event detail triggers 33 Google Maps requests, about 481 KiB transferred, and about 3.35 MiB decoded resources.
The iframe has `loading="lazy"`, but browser lazy-load distance is generous enough that the embed still initializes during the audit.
The full interactive map is not needed for initial event comprehension.

Next.js link prefetching creates 15 to 27 background fetches on several routes.
High-cardinality event and organization card links prefetch detail RSC payloads as they approach the viewport.
Repeated navigation and footer links also request routes such as contact, promote, organizations, and home during the initial load.
These transfers are individually small, but they create avoidable browser, server, and API work during the critical window.

No console errors or warnings were observed on the inspected event-feed and organization-detail browser sessions.

## Prioritized remediation plan

### P0: responsive event-image pipeline

Owner: the lowest shared image owner, currently `EventImageCutout` and the event-image serving path.

Required behavior:

- Produce stable AVIF or WebP card renditions near the rendered dimensions while retaining an appropriate full-size source for detail and sharing.
- Render an actual `<img>` or Next.js `Image` with `srcset`, `sizes`, intrinsic dimensions, and native lazy loading.
- Keep only the first likely LCP poster eager and high priority.
- Prevent all other posters from receiving a URL until native lazy loading or a bounded near-viewport observer makes them eligible.
- Preserve the visible poster, alt text, source-image link, and SEO image contract.
- Rework the cutout effect at the shared primitive so it does not require a unique measured SVG tree and observer for every card.

Expected impact:

- Remove more than 17 MiB from the current first feed load if the feed is held near a 2 MiB total budget.
- Reduce bandwidth contention for the LCP poster.
- Reduce per-card observer, layout, SVG, and hydration work.

Acceptance criteria:

- Mobile feed transfer is at or below 2 MiB for the initial page.
- No below-the-fold poster begins downloading during the initial viewport trace.
- The first visible poster is available in initial HTML and receives high priority.
- Google Images still receives a standard crawlable image element and useful alt text.

### P0: split client route ownership

Owner: `frontend/src/app/client-routes.tsx` and the individual App Router pages.

Required behavior:

- Replace the single global client route registry with one route-owned client entry per page family, following the existing thin route-shell convention.
- Do not import admin, marketing, posters, QR, onboarding, design-system, or organization-panel code from public discovery routes.
- Keep shared route wrappers small and server-compatible where possible.
- Run the built-in Turbopack analyzer after every split and remove the old aggregate path in the same change.

Expected impact:

- Remove up to 1.6 MiB of uncompressed route graph from simple public routes before route-specific dependencies are counted.
- Capture much of Lighthouse's 435 to 475 KiB estimated compressed unused-JavaScript opportunity.
- Reduce parse and evaluation time across every scoped route.

Acceptance criteria:

- Contact and login do not include admin, Mapbox, Instagram, poster-generation, QR, or design-system modules in their route analyzer graph.
- Each scoped route has an explicit first-load JavaScript budget and fails CI when it regresses materially.
- Initial compressed JavaScript is below 500 KiB as the first milestone, with a later target below 300 KiB for contact and login.

### P0: reduce the global provider floor

Owner: `frontend/src/app/client-providers.tsx`, `frontend/src/instrumentation-client.ts`, and route layouts.

Required behavior:

- Separate essential hydration from authenticated application bootstrap.
- Dynamically import PostHog after the page is interactive or during idle time.
- Load auth/session, runtime constants, and authenticated query behavior only on routes that need them or after useful public content is stable.
- Replace global Framer Motion `domMax` with the smallest feature set and scope motion providers to routes that render motion.
- Keep public server content visible and functional before optional providers resolve.

Expected impact:

- Lower the current 1.45 MiB minimum application-route bundle floor.
- Remove hundreds of milliseconds of mobile parse and evaluation work from static pages.
- Improve contact and login LCP even though their server responses are already fast.

Acceptance criteria:

- Contact performs no auth profile or runtime-constant fetch before interaction unless a visible feature requires it.
- PostHog is absent from the critical JavaScript dependency chain.
- Static contact mobile TBT remains below 100 milliseconds in three-run medians.

### P0: paginate public lists without sacrificing SEO

Owner: `getSchoolBrowseSnapshot`, the organization-directory server loader, and their page containers.

Required behavior:

- Stop flattening every event page into one initial feed payload.
- Server-render a useful first page of approximately 12 to 20 cards.
- Provide crawlable, canonical pagination for additional event and organization results.
- Preserve one server source of truth for metadata, initial HTML, links, and hydration.
- Avoid rendering cards that are not in the active page or bounded viewport window.

Expected impact:

- Reduce root HTML, inline React payload, DOM nodes, observers, SVGs, and image requests together.
- Reduce the directory's 2.88 seconds of mobile main-thread work.
- Reduce first-observed server work for organization detail when history is large.

Acceptance criteria:

- Initial feed DOM is below 1,000 nodes.
- Initial organization-directory DOM is below 1,000 nodes.
- Every eligible detail remains reachable through finite crawlable pagination.
- Hydration does not refetch or replace the server page with a conflicting list.

### P1: make maps opt-in

Owner: `EventLocationMap`.

Required behavior:

- Render the location text and a normal Google Maps link initially.
- Load the embedded interactive map only after an explicit action or a tightly bounded near-viewport condition.
- Avoid loading both Maps JavaScript and multiple embedded map documents for one event view.

Expected impact:

- Avoid up to 33 initial requests and roughly 481 KiB transferred on the measured event detail.
- Avoid about 3.35 MiB of decoded third-party resources.

Acceptance criteria:

- No Google Maps resource appears in an event-detail navigation trace before the map is requested.
- The location remains usable and indexable without JavaScript.

### P1: eliminate organization-detail CLS

Owner: the shared event-list item layout in `EventList`.

Required behavior:

- Do not apply the current approximate `20rem` intrinsic placeholder to above-the-fold cards.
- Reserve the actual responsive card block size for deferred cards, or render a bounded first viewport without `content-visibility`.
- Keep one shared card-height contract tied to the real image and content layout.

Expected impact:

- Remove the repeatable 0.157 mobile CLS and 0.081 desktop CLS on organization detail.

Acceptance criteria:

- Three mobile and desktop runs remain below CLS 0.02 on organization detail.

### P1: remove waste from logos and static images

Owner: the shared brand-image primitive and application metadata icons.

Required behavior:

- Replace the 713 by 509 raster used at 34 by 24 and 40 by 28 with a correctly sized imported asset or optimized vector.
- Optimize the 574 KiB public logo SVG and serve it through a content-hashed immutable path.
- Use dedicated favicon and Apple-touch assets rather than the full illustration.
- Give contact and login responsive image dimensions and preload only the actual LCP candidate.

Expected impact:

- Save about 115 KiB on every scoped route from the navigation or auth logo alone.
- Remove a 227 KiB compressed, non-cacheable fallback-logo request when it appears.

Acceptance criteria:

- No logo request wastes more than 10 KiB at its rendered size.
- All repeated brand assets use immutable caching.

### P1: control Next.js prefetch

Owner: shared card title links and repeated navigation links.

Required behavior:

- Set `prefetch={false}` or use plain crawlable anchors for high-cardinality event and organization grids.
- Keep prefetch only for a small number of high-confidence next actions.
- Consolidate repeated links to the same route where the page currently schedules duplicate RSC prefetches.

Expected impact:

- Remove 15 to 27 avoidable background requests from sampled initial loads.
- Reduce server rendering and production API amplification caused by detail-route prefetch.

Acceptance criteria:

- Initial directory and feed traces contain no detail RSC requests until navigation intent is expressed.

### P1: bound login preview data

Owner: `frontend/src/app/login/page.tsx` and `AuthHeroPanel`.

Required behavior:

- Select the four distinct preview events on the server instead of serializing the complete school feed.
- Do not load desktop-only preview imagery on mobile.
- Reuse the selected event for metadata without keeping the full feed in the React payload.

Expected impact:

- Reduce the measured 146.3 KiB of login inline script data.
- Reduce the 183.5 KiB identity HTML response and unnecessary server serialization.

Acceptance criteria:

- Login serializes no more than four event previews.
- Mobile login downloads no preview-event poster.

### P2: improve first-observed dynamic rendering

Owner: public detail server loaders and cache policy.

Required behavior:

- Return only the event subset needed for the initial organization page.
- Load history through crawlable pagination rather than all pages in the first response.
- Add explicit detail cache tags so updates can invalidate event and organization detail data precisely.
- Measure cold and warm TTFB separately after every server-data change.

Expected impact:

- Reduce the current 1.26 second first-observed organization-detail TTFB.
- Keep the already excellent warm path.

Acceptance criteria:

- First-observed organization-detail TTFB is below 500 milliseconds in the same local-plus-production-API setup.
- Warm p95 remains below 50 milliseconds locally.

## Performance budgets

These are regression budgets, not promises of field outcomes.

| Metric | Initial budget | Longer-term target |
| --- | ---: | ---: |
| Mobile LCP | below 4.0 s on every route | at or below 2.5 s at field p75 |
| Mobile TBT | below 200 ms | below 100 ms on simple routes |
| CLS | below 0.05 | below 0.02 on stable templates |
| Initial compressed JavaScript | below 500 KiB | below 300 KiB on contact and login |
| Feed initial transfer | below 2 MiB | below 1 MiB when image renditions permit |
| Feed initial DOM | below 1,000 nodes | below 800 nodes |
| Directory initial DOM | below 1,000 nodes | below 800 nodes |
| Largest first-viewport card image | below 150 KiB | below 100 KiB |
| Below-fold initial image requests | zero | zero |
| Unexpected route prefetches | zero | zero |

## Recommended implementation order

1. Add measurement budgets and preserve this audit as the baseline.
2. Split `client-routes.tsx` and prove route graphs are isolated with the Turbopack analyzer.
3. Defer PostHog and optional global provider work.
4. Introduce the responsive image source and shared card-image primitive.
5. Limit and paginate the feed and organization directory.
6. Disable high-cardinality prefetch.
7. Make Google Maps opt-in.
8. Correct intrinsic card sizing and remeasure CLS.
9. Bound login preview serialization.
10. Re-run three mobile samples and one desktop sample per route, then verify field data after deployment.

Bundle splitting and image delivery should be measured independently before combining them.
That makes regressions attributable and avoids declaring success from a score that improved for the wrong reason.

## Validation after implementation

Run the optimized production build with the same API and environment contract.
Generate `route-bundle-stats.json` and `next experimental-analyze --output` results.
Run three clean-storage mobile Lighthouse samples for every scoped route.
Run one desktop sample as a fast-hardware guard.
Inspect the browser network panel for poster lazy loading, Maps deferral, and route prefetch.
Inspect the Performance panel with JavaScript sampling for the remaining longest tasks.
Verify one low-end physical Android device before treating the laboratory improvements as user outcomes.
Compare field LCP, INP, and CLS at p75 after sufficient production traffic accumulates.

## Limitations

This is a local laboratory baseline, not Chrome UX Report field data.
The frontend was local while API and event-image requests crossed the network to production.
The event inventory and image mix will change, so byte totals are a template-risk sample rather than a permanent constant.
Desktop results are single samples.
Mobile results are three-run medians and were stable enough to reproduce the major bottlenecks.
The Lighthouse CLI emitted a Node engine warning in this workspace but completed all reports successfully.
No authenticated flows, interaction INP traces, memory-growth sessions, or long-lived navigation sessions were profiled.

## References

- [Next.js package and bundle analysis](https://nextjs.org/docs/pages/guides/package-bundling)
- [Next.js Image component](https://nextjs.org/docs/app/api-reference/components/image)
- [Chrome Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)
- [Chrome DevTools Lighthouse workflow](https://developer.chrome.com/docs/devtools/lighthouse/)
- [web.dev LCP optimization](https://web.dev/articles/optimize-lcp)
- [web.dev responsive image preload guidance](https://web.dev/articles/preload-responsive-images)
