/**
 * Events Store (Zustand)
 *
 * Client state for the events feature: school filter, feed snapshot for
 * cross-route consumers, and mutations. Server state is cached in TanStack Query
 * via useEventsFeed / usePromotedEvents.
 */

import { create } from "zustand";
import type { InfiniteData } from "@tanstack/react-query";
import type { Event as AppEvent, EventFormData } from "@/shared/types";
import {
  type EventListQuery,
  type LatestAddedEvent,
  type PaginatedEventsResponse,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { EVENTS_PAGE_SIZE } from "@/features/events/constants";
import { getSchoolFetchKey, normalizeEventQuery } from "@/features/events/lib/eventsQuery";
import { getUniqueEvents } from "@/shared/utils/event";
import { isApiError } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL, getCurrentSchool, resolveSchool } from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import { AUTH_STATE_REFRESH_EVENT, loadUserProfile } from "@/features/auth/api/userRepository";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

interface EventsState {
  events: AppEvent[];
  promotedEvents: AppEvent[];
  latestAddedEvent: LatestAddedEvent;
  isLoading: boolean;
  isLoadingMore: boolean;
  isPromotedLoading: boolean;
  error: string | null;
  schoolFilter: string | null;
  eventsPage: number;
  eventsPageSize: number;
  totalEvents: number;
  hasMoreEvents: boolean;
  eventQuery: EventListQuery;

  hydrateInitialFeed: (feed: PaginatedEventsResponse, school: string | null) => void;
  setSchoolFilter: (school: string) => void;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
  incrementClickCount: (eventId: number) => void;
}

const optimisticClickCounts = new Map<number, number>();

function applyOptimisticClickCount(event: AppEvent): AppEvent {
  const optimisticCount = optimisticClickCounts.get(event.id);
  const currentCount = event.click_count ?? 0;
  if (optimisticCount === undefined || currentCount >= optimisticCount) return event;
  return { ...event, click_count: optimisticCount };
}

export function applyOptimisticClickCountsToEvents(events: AppEvent[]): AppEvent[] {
  let changed = false;
  const nextEvents = events.map((event) => {
    const nextEvent = applyOptimisticClickCount(event);
    if (nextEvent !== event) changed = true;
    return nextEvent;
  });

  return changed ? nextEvents : events;
}

function applyOptimisticClickCountsToFeed(
  feed: PaginatedEventsResponse,
): PaginatedEventsResponse {
  const items = applyOptimisticClickCountsToEvents(feed.items);
  return items === feed.items ? feed : { ...feed, items };
}

function applyOptimisticClickCountsToFeedPages(
  pages: PaginatedEventsResponse[],
): PaginatedEventsResponse[] {
  let changed = false;
  const nextPages = pages.map((page) => {
    const nextPage = applyOptimisticClickCountsToFeed(page);
    if (nextPage !== page) changed = true;
    return nextPage;
  });

  return changed ? nextPages : pages;
}

function getEventClickCount(events: AppEvent[], eventId: number): number | null {
  const event = events.find((item) => item.id === eventId);
  return event ? event.click_count ?? 0 : null;
}

function getVisibleClickCount(state: EventsState, eventId: number): number {
  return (
    getEventClickCount(state.events, eventId) ??
    getEventClickCount(state.promotedEvents, eventId) ??
    optimisticClickCounts.get(eventId) ??
    0
  );
}

function patchEventClickCount(
  events: AppEvent[],
  eventId: number,
  clickCount: number,
): AppEvent[] {
  let changed = false;
  const nextEvents = events.map((event) => {
    if (event.id !== eventId) return event;
    const nextClickCount = Math.max(event.click_count ?? 0, clickCount);
    if (nextClickCount === event.click_count) return event;
    changed = true;
    return { ...event, click_count: nextClickCount };
  });

  return changed ? nextEvents : events;
}

function getInitialSchoolFilter(): string {
  if (typeof window !== "undefined") {
    const schoolParam = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (schoolParam) return resolveSchool(schoolParam);
  }

  return resolveSchool(loadUserProfile()?.school || getCurrentSchool());
}

function getCurrentFeedQueryKey(state: EventsState) {
  return queryKeys.events.feed(getSchoolFetchKey(state.schoolFilter), state.eventQuery);
}

function patchFeedCache(
  updater: (pages: PaginatedEventsResponse[]) => PaginatedEventsResponse[],
): void {
  const state = useEventsStore.getState();
  const queryClient = getQueryClient();
  const queryKey = getCurrentFeedQueryKey(state);

  queryClient.setQueryData<InfiniteData<PaginatedEventsResponse>>(queryKey, (current) => {
    if (!current) return current;
    const nextPages = applyOptimisticClickCountsToFeedPages(updater(current.pages));
    return { ...current, pages: nextPages };
  });
}

async function invalidateCurrentFeed(): Promise<void> {
  const state = useEventsStore.getState();
  await getQueryClient().invalidateQueries({
    queryKey: getCurrentFeedQueryKey(state),
  });
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  promotedEvents: [],
  latestAddedEvent: null,
  isLoading: true,
  isLoadingMore: false,
  isPromotedLoading: false,
  error: null,
  schoolFilter: getInitialSchoolFilter(),
  eventsPage: 0,
  eventsPageSize: EVENTS_PAGE_SIZE,
  totalEvents: 0,
  hasMoreEvents: false,
  eventQuery: normalizeEventQuery(undefined),

  hydrateInitialFeed: (feed, school) => {
    const hydratedFeed = applyOptimisticClickCountsToFeed(feed);
    const nextSchool = school ? resolveSchool(school) : get().schoolFilter;
    const eventQuery = normalizeEventQuery(undefined);
    const queryKey = queryKeys.events.feed(getSchoolFetchKey(nextSchool), eventQuery);

    getQueryClient().setQueryData<InfiniteData<PaginatedEventsResponse>>(queryKey, {
      pages: [hydratedFeed],
      pageParams: [1],
    });

    set({
      events: hydratedFeed.items,
      latestAddedEvent: hydratedFeed.latest_added_event ?? null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      schoolFilter: nextSchool,
      eventsPage: hydratedFeed.page,
      eventsPageSize: hydratedFeed.page_size,
      totalEvents: hydratedFeed.total,
      hasMoreEvents: hydratedFeed.page < hydratedFeed.total_pages,
      eventQuery,
    });
  },

  setSchoolFilter: (school: string) => {
    const nextSchool = resolveSchool(school);
    if (get().schoolFilter === nextSchool) return;
    set({ schoolFilter: nextSchool });
  },

  addEvent: async (data) => {
    const created = await createEventAPI(data);
    patchFeedCache((pages) => {
      if (pages.length === 0) {
        return [
          {
            items: [created],
            total: 1,
            page: 1,
            page_size: EVENTS_PAGE_SIZE,
            total_pages: 1,
            latest_added_event: { title: created.title, added_at: created.added_at },
          },
        ];
      }

      const [firstPage, ...rest] = pages;
      return [
        {
          ...firstPage,
          items: getUniqueEvents([created, ...firstPage.items]),
          total: firstPage.total + 1,
          latest_added_event: { title: created.title, added_at: created.added_at },
        },
        ...rest,
      ];
    });

    set((state) => ({
      events: getUniqueEvents([created, ...state.events]),
      latestAddedEvent: { title: created.title, added_at: created.added_at },
    }));
    return created.id;
  },

  updateEvent: async (eventId, data) => {
    const updated = await updateEventAPI(eventId, data);
    const visibleUpdated = applyOptimisticClickCount(updated);

    patchFeedCache((pages) =>
      pages.map((page) => ({
        ...page,
        items: page.items.map((event) => (event.id === eventId ? visibleUpdated : event)),
      })),
    );

    set((state) => ({
      events: state.events.map((event) => (event.id === eventId ? visibleUpdated : event)),
      latestAddedEvent:
        state.latestAddedEvent?.added_at === visibleUpdated.added_at
          ? { title: visibleUpdated.title, added_at: visibleUpdated.added_at }
          : state.latestAddedEvent,
    }));
  },

  deleteEvent: async (eventId) => {
    try {
      await deleteEventAPI(eventId);

      patchFeedCache((pages) =>
        pages.map((page) => ({
          ...page,
          items: page.items.filter((event) => event.id !== eventId),
          total: Math.max(0, page.total - 1),
        })),
      );

      set((state) => ({
        events: state.events.filter((event) => event.id !== eventId),
      }));
    } catch (err) {
      console.error("Failed to delete event:", err);
      if (isApiError(err) && (err.status === 404 || err.status === 403)) {
        await invalidateCurrentFeed();
      }
      throw err;
    }
  },

  incrementClickCount: (eventId) => {
    const nextClickCount = Math.max(
      getVisibleClickCount(get(), eventId),
      optimisticClickCounts.get(eventId) ?? 0,
    ) + 1;
    optimisticClickCounts.set(eventId, nextClickCount);

    patchFeedCache((pages) =>
      pages.map((page) => {
        const items = patchEventClickCount(page.items, eventId, nextClickCount);
        return items === page.items ? page : { ...page, items };
      }),
    );

    set((state) => ({
      events: patchEventClickCount(state.events, eventId, nextClickCount),
      promotedEvents: patchEventClickCount(state.promotedEvents, eventId, nextClickCount),
    }));
  },
}));

function getAuthLoginSchool(event: globalThis.Event): string {
  if ("detail" in event) {
    const detail = (event as CustomEvent<{ school?: string }>).detail;
    const hintedSchool = detail?.school?.trim();
    if (hintedSchool) return resolveSchool(hintedSchool);
  }

  if (typeof window !== "undefined") {
    const routeSchool = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (routeSchool) return resolveSchool(routeSchool);
  }

  return resolveSchool(loadUserProfile()?.school || getCurrentSchool());
}

function syncSchoolFilterFromLogin(event: globalThis.Event): void {
  const nextSchool = getAuthLoginSchool(event);
  const currentSchool = useEventsStore.getState().schoolFilter;
  if (currentSchool !== nextSchool) {
    useEventsStore.getState().setSchoolFilter(nextSchool);
  }
}

function syncSchoolFilterFromProfile(): void {
  const routeSchool =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim()
      : "";
  const nextSchool = resolveSchool(routeSchool || loadUserProfile()?.school || getCurrentSchool());
  const currentSchool = useEventsStore.getState().schoolFilter;
  if (currentSchool !== nextSchool) {
    useEventsStore.getState().setSchoolFilter(nextSchool);
  }
}

function resetSchoolFilterOnLogout(): void {
  if (useEventsStore.getState().schoolFilter !== DEFAULT_SCHOOL) {
    useEventsStore.getState().setSchoolFilter(DEFAULT_SCHOOL);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-login", syncSchoolFilterFromLogin);
  window.addEventListener(AUTH_STATE_REFRESH_EVENT, syncSchoolFilterFromProfile);
  window.addEventListener("auth-user-logout", resetSchoolFilterOnLogout);
}
