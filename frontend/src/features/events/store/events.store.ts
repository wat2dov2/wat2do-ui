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
    const nextPages = updater(current.pages);
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
    const nextSchool = school ? resolveSchool(school) : get().schoolFilter;
    const eventQuery = normalizeEventQuery(undefined);
    const queryKey = queryKeys.events.feed(getSchoolFetchKey(nextSchool), eventQuery);

    getQueryClient().setQueryData<InfiniteData<PaginatedEventsResponse>>(queryKey, {
      pages: [feed],
      pageParams: [1],
    });

    set({
      events: feed.items,
      latestAddedEvent: feed.latest_added_event ?? null,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      schoolFilter: nextSchool,
      eventsPage: feed.page,
      eventsPageSize: feed.page_size,
      totalEvents: feed.total,
      hasMoreEvents: feed.page < feed.total_pages,
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

    patchFeedCache((pages) =>
      pages.map((page) => ({
        ...page,
        items: page.items.map((event) => (event.id === eventId ? updated : event)),
      })),
    );

    set((state) => ({
      events: state.events.map((event) => (event.id === eventId ? updated : event)),
      latestAddedEvent:
        state.latestAddedEvent?.added_at === updated.added_at
          ? { title: updated.title, added_at: updated.added_at }
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
    set((state) => ({
      events: state.events.map((event) =>
        event.id === eventId ? { ...event, click_count: (event.click_count ?? 0) + 1 } : event,
      ),
      promotedEvents: state.promotedEvents.map((event) =>
        event.id === eventId ? { ...event, click_count: (event.click_count ?? 0) + 1 } : event,
      ),
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
