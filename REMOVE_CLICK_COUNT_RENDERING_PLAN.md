# Remove Click Count Rendering Plan

## Purpose

This plan removes visible "x clicks" text from event cards while preserving interaction tracking.
Users should no longer see click popularity on public event cards.
The app should still send click, view, save, share, and detail interaction events where those signals are product-relevant.

## Existing Patterns Matched

- `frontend/src/features/events/components/EventCard.tsx` passes a translated click label into the card content shell.
- `frontend/src/shared/ui/event-card-content.tsx` renders the optional `clickLabel` next to the event title.
- `frontend/src/shared/services/trackingService.ts` owns interaction batching and should remain the tracking path.
- `frontend/src/features/events/hooks/useViewTracking.ts` tracks view impressions and should remain unchanged.
- `frontend/src/features/events/store/events.store.ts` currently contains optimistic click-count plumbing that exists to support visible click-count updates.

## Current Problem

The UI renders public popularity as `events.clickCount`.
That makes the event cards noisier and exposes a metric that is not necessary for browsing.
The visible count also forces frontend state to maintain optimistic `click_count` patches after a card click.

Click tracking itself is separate from click rendering.
The render path can be removed without removing interaction analytics.

## Target Behavior

Event cards should no longer render a click-count label.
Clicking an event card should still call `tracker.track(event.id, "click")`.
Opening an event detail modal should still track `detail_view` and dwell-time click metadata.
View impressions, saves, unsaves, and shares should continue using the existing tracker.

## Implementation Plan

Remove the `clickLabel` prop from `EventCardContentProps`.
Remove the `clickLabel` parameter from `EventCardContent`.
Delete the conditional `<span>` that renders the click label next to the title.
Stop passing `clickLabel={t("events.clickCount", { count: event.click_count ?? 0 })}` from `EventCard`.

Remove frontend optimistic count plumbing if no remaining call sites need it.
Delete `incrementClickCount` from the events store interface and implementation.
Delete `optimisticClickCounts`.
Delete `applyOptimisticClickCountsToEvents` and related helpers if they become unused after the client-side feed plan is implemented.
Delete `patchEventClickCount`, `getEventClickCount`, and `getVisibleClickCount` if they become unused.

Keep `tracker.track(event.id, "click")` in card activation.
Do not remove interaction batching from `trackingService`.

Remove stale locale keys:

- `events.clickCount`
- `events.clickCount_other`

from:

- `frontend/src/features/events/locales/en.json`
- `frontend/src/features/events/locales/zh.json`

## Optional Backend Contract Cleanup

The minimal UI cleanup leaves backend `click_count` fields in API responses.
That avoids expanding the scope into backend schemas, generated OpenAPI files, and backend tests.

The cleaner contract cleanup removes `click_count` from public event response shapes too.
That would require changes in:

- `backend/schemas/event.py`
- `backend/services/event_query.py`
- `backend/tests/services/test_event_service.py`
- regenerated `frontend/src/shared/generated/openapi.json`
- regenerated `frontend/src/shared/generated/api-types.ts`

Treat backend contract cleanup as a separate scope-expanding decision unless explicitly approved.

## Expected Blast Radius

Expected frontend files for the minimal implementation:

- `frontend/src/features/events/components/EventCard.tsx`
- `frontend/src/shared/ui/event-card-content.tsx`
- `frontend/src/features/events/store/events.store.ts`
- `frontend/src/features/events/locales/en.json`
- `frontend/src/features/events/locales/zh.json`

Possible backend files only if full contract cleanup is approved:

- `backend/schemas/event.py`
- `backend/services/event_query.py`
- `backend/tests/services/test_event_service.py`
- generated frontend API files

## Verification Plan

Run frontend checks:

```bash
cd frontend
npm run lint
npm run audit:i18n
npm run type-check
NEXT_PUBLIC_API_URL=/api npm run build
```

Run or inspect relevant events-page coverage.
Verify event cards no longer show click counts.
Verify clicking a card still opens the detail modal.
Verify no missing i18n keys remain.
Verify interaction POSTs still occur for tracked events when the tracker flushes.
