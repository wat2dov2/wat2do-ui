# Client-Side Event Feed Plan

## Purpose

This plan removes Google Analytics, uses Microsoft Clarity, and makes the main Wat2Do public event browsing path use the event data embedded into the server-rendered page.
The browser should not refetch the public event feed when a user searches, filters, sorts, opens a public event from the current feed, or changes pagination state.
Filtering should be a single maintainable client-side derivation over the embedded school event snapshot.

## Existing Patterns Matched

- ISR and on-demand revalidation already live in `frontend/src/features/events/api/eventFeed.server.ts`.
- The root and school routes already load an initial feed in `frontend/src/app/page.tsx` and `frontend/src/app/school/[school]/page.tsx`.
- `frontend/src/app/event-route-page.tsx` already hydrates the client store through `useEventsStore.getState().hydrateInitialFeed`.
- `frontend/src/features/events/store/events.store.ts` already owns the browsable event snapshot for cross-route consumers.
- `frontend/src/features/search/store/search.store.ts` already owns filter values.
- `frontend/src/features/search/api/searchService.ts` already contains local `filterEvents` and `sortEvents`.
- `frontend/src/features/search/hooks/useSearch.tsx` already builds the derived filtered event list and filter metadata.
- Clarity is already initialized through `frontend/src/shared/lib/clarity.ts` and `frontend/src/app/client-providers.tsx`.

## Current Problem

The public events UI currently has two competing read paths.
The server embeds an initial feed into the route through ISR, but `useEventsPageData` turns filter state into backend query params and uses TanStack Query to fetch `/events/` from the browser.
This makes the embedded feed less authoritative and creates a second filtering implementation path.

The code also fetches promoted events separately from the browser and falls back to fetching an event by id when a direct event modal URL cannot be resolved from the current list.
Those paths conflict with the new goal that the main public browse UI should operate from the embedded HTML snapshot.

## Target Architecture

The server-rendered route owns the public browse snapshot.
For each school page, Next.js fetches the full browsable school event feed on the server, embeds it into the HTML, and tags the response for on-demand revalidation.
The client hydrates that exact snapshot into the existing events store.
Search, filters, saved-only filtering, sorting, promoted partitioning, latest-added copy, and modal resolution all derive from that hydrated snapshot.

There should be one obvious public browsing flow:

1. Next.js route loads the school event snapshot on the server.
2. `EventRoutePage` hydrates `events.store`.
3. `useSearch` derives filtered and sorted events from `events.store.events`.
4. `EventsPageContainer` renders `filters.filteredEvents`.
5. User interactions update URL-backed filter state, not server query params.

Live API calls remain valid for authenticated and dynamic workflows such as login, saved events sync, credits, event creation, event editing, event deletion, reports, QR dashboards, admin pages, organization pages, and settings.
The "no frontend fetch" goal applies specifically to the public events browse feed.

## Analytics Plan

Remove Google Analytics from the app shell.
Delete the `GoogleAnalytics` import and `NEXT_PUBLIC_GA_MEASUREMENT_ID` branch from `frontend/src/app/layout.tsx`.
Remove `NEXT_PUBLIC_GA_MEASUREMENT_ID` from `frontend/.env.example`.
Remove `@next/third-parties` from `frontend/package.json` and `frontend/package-lock.json` if no other imports remain.

Keep the existing Clarity helper.
Set `NEXT_PUBLIC_CLARITY_PROJECT_ID=wkc45cwmc4` in Vercel for the `wat2do-v2` project.
Keep `@vercel/analytics` unless the explicit product decision is that Clarity must be the only analytics tool.

## Embedded Feed Plan

Change `frontend/src/features/events/api/eventFeed.server.ts` from loading one page to loading the complete public browse snapshot for one school.
The server loader should page through `/events/` using the backend route's maximum page size until all pages are collected.
It should keep using Next.js `fetch` with `revalidate` and the existing school-specific tag from `eventFeedTag`.
It should return the same feed envelope shape expected by the frontend, with all `items` flattened into one array and `latest_added_event` preserved.

This keeps the frontend contract stable while changing the ownership of data freshness.
The browser receives the school snapshot in the page payload.
On-demand revalidation refreshes that snapshot when the scrape or mutation pipeline changes school events.

If promoted events must also avoid browser fetching, the embedded feed should include enough information to derive the promoted section from the same snapshot.
The preferred path is to include promoted event ids or promoted event summaries in the server-loaded snapshot and revalidate the affected school page when promotions change.

## Client Filtering Plan

Update `frontend/src/features/events/hooks/useEventsPageData.ts` so it stops constructing an `EventListQuery`.
It should stop calling `useEventsFeed` and `usePromotedEvents`.
It should read the base event snapshot from `useEventsStore`.
It should call `useSearch` with that snapshot.
It should return `filters.filteredEvents` as the ordered events for the page.

The count shown by `EventCount` should be the filtered count.
When filters are empty, that equals the embedded school snapshot count.
When filters are active, it reflects the visible result set.

`refreshEvents` should not refetch `/events/` from the browser.
For the public browse path it can become a no-op, a route refresh, or be removed from the UI if the error state becomes unreachable after successful hydration.

`loadMoreEvents`, `isLoadingMore`, and `hasMoreEvents` should be removed from the public browse path.
Infinite loading no longer applies when the client already has the full snapshot.

## Store Cleanup Plan

Update `frontend/src/features/events/store/events.store.ts` so `hydrateInitialFeed` hydrates the embedded snapshot only.
Remove TanStack Query feed cache writes for the public events feed.
Remove `eventQuery`, `eventsPage`, `eventsPageSize`, and `hasMoreEvents` if no remaining code needs them.
Keep mutation actions such as `addEvent`, `updateEvent`, and `deleteEvent`, but make them patch the store snapshot directly instead of patching a removed query cache.

Keep `schoolFilter` as the current school selection state.
Do not use changing `schoolFilter` alone as a data-loading mechanism for public browse.

## Route And Navigation Plan

School changes from the top nav should navigate to a server-backed route such as `/school/<school>`.
That navigation loads the new school's embedded snapshot.
`?school=` can stay as a legacy hydration signal or be redirected, but it should not be the main public browse data-loading path.

`useAppNavigation` should continue parsing URL filters and event ids.
It should not trigger a browser event feed fetch when a school param changes.

`useEventIdUrl` should resolve detail modals from the embedded snapshot.
Remove the public browse fallback that calls `fetchEventById` for a missing event.
If an event id is not present in the embedded snapshot, the modal should stay closed or show an existing not-found behavior.
Editing flows that need full event data can keep using authenticated or explicit detail fetches.

## API Layer Cleanup Plan

Delete `frontend/src/features/events/hooks/useEventsFeed.ts` after all call sites are removed.
Delete `frontend/src/features/events/lib/eventsQuery.ts` after all call sites are removed.
Remove `fetchEventsPage`, `fetchPromotedEvents`, and `EventListQuery` from `frontend/src/features/events/api/events.api.ts` if no remaining call sites exist.
Remove event feed query keys from `frontend/src/shared/lib/queryKeys.ts`.

Keep API functions for create, update, delete, save, unsave, report, and edit/detail workflows that still require live backend access.

## Event List Cleanup Plan

Update `frontend/src/features/events/components/EventList.tsx` to remove infinite scroll behavior.
Remove `isLoadingMore`, `hasMoreEvents`, and `onLoadMore` props.
Keep the loading skeleton for initial hydration or route-level loading states.
Keep date grouping and promoted partitioning as presentation logic.

## Documentation Update Plan

Rewrite `EVENT_FEED_CACHING.md` so it no longer says search, filters, and pagination stay on the live API for the public browse UI.
The new document should state that the main school event page embeds the full browsable school snapshot and uses client-side filtering over that snapshot.
It should still call out that authenticated workflows and operational dashboards use live APIs.

## Expected Blast Radius

Expected frontend files:

- `frontend/src/app/layout.tsx`
- `frontend/src/app/client-providers.tsx`, only if Clarity env handling is tightened
- `frontend/src/features/events/api/eventFeed.server.ts`
- `frontend/src/app/page.tsx`
- `frontend/src/app/school/[school]/page.tsx`
- `frontend/src/app/event-route-page.tsx`
- `frontend/src/features/events/store/events.store.ts`
- `frontend/src/features/events/hooks/useEventsPageData.ts`
- `frontend/src/features/events/hooks/useEventIdUrl.ts`
- `frontend/src/features/events/components/EventList.tsx`
- `frontend/src/app/TopNav.tsx`
- `frontend/src/app/hooks/useAppNavigation.ts`
- `frontend/src/features/events/api/events.api.ts`
- `frontend/src/shared/lib/queryKeys.ts`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/.env.example`
- `EVENT_FEED_CACHING.md`
- relevant Playwright specs

## Decisions To Confirm Before Implementation

Confirm that embedding all upcoming school events in HTML is acceptable.
This is required for purely client-side public filtering, but it increases the page payload.

Confirm the promoted events strategy.
The cleanest no-browser-event-fetch version embeds promoted state into the server snapshot and revalidates school pages when promotions change.

Confirm whether `@vercel/analytics` should stay.
Removing Google Analytics does not automatically require removing Vercel Analytics.

## Verification Plan

Run frontend checks:

```bash
cd frontend
npm run lint
npm run audit:i18n
npm run type-check
NEXT_PUBLIC_API_URL=/api npm run build
```

Run relevant Playwright coverage for the events page, search, filters, direct event links, and school routing.
Also inspect the browser network panel during public browsing and verify that filter changes do not call `/events/` or `/events/promoted`.

## Deployment Plan

Remove `NEXT_PUBLIC_GA_MEASUREMENT_ID` from the Vercel production environment.
Set `NEXT_PUBLIC_CLARITY_PROJECT_ID=wkc45cwmc4` in the linked Vercel project `wat2do-v2`.
Deploy after checks pass, either through the existing main-branch pipeline or with `cd frontend && vercel deploy --prod`.
