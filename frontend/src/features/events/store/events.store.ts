/**
 * Events Store (Zustand)
 *
 * Single source of truth for all events data. State lives outside React,
 * so every component that imports this store reads the same data — no
 * duplicate fetches, no divergent state.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import type { Event as AppEvent, EventFormData } from "@/shared/types";
import {
  type EventListQuery,
  type LatestAddedEvent,
  type PaginatedEventsResponse,
  fetchEventsPage,
  fetchPromotedEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { EVENTS_PAGE_SIZE } from "@/features/events/constants";
import { getUniqueEvents } from "@/shared/utils/event";
import { isApiError, getApiErrorMessage } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL, getCurrentSchool, resolveSchool } from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import { AUTH_STATE_REFRESH_EVENT, loadUserProfile } from "@/features/auth/api/userRepository";

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

  /** Fetch the first page of events for the current school + filter query. */
  hydrateInitialFeed: (feed: PaginatedEventsResponse, school: string | null) => void;
  fetchEvents: (query?: EventListQuery) => Promise<void>;
  loadMoreEvents: () => Promise<void>;
  fetchPromotedEvents: () => Promise<void>;
  setSchoolFilter: (school: string) => void;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
  incrementClickCount: (eventId: number) => void;
}

/** Deduplicate concurrent fetches for the same school/filter/page query. */
const _fetchesByQuery = new Map<string, Promise<PaginatedEventsResponse>>();
const _promotedFetchesBySchool = new Map<string, Promise<AppEvent[]>>();
let _latestFetchId = 0;
let _latestLoadMoreFetchId = 0;
let _latestPromotedFetchId = 0;
let _loadedEventsQueryKey: string | null = null;
let _loadedPromotedSchoolKey: string | null = null;
let _skipNextEventsFetchQueryKey: string | null = null;

function getInitialSchoolFilter(): string {
  if (typeof window !== "undefined") {
    const schoolParam = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (schoolParam) return resolveSchool(schoolParam);
  }

  return resolveSchool(loadUserProfile()?.school || getCurrentSchool());
}

function getSchoolFetchKey(school: string | null): string {
  return school ?? "__all__";
}

function normalizeEventQuery(query: EventListQuery | undefined): EventListQuery {
  return {
    search: query?.search?.trim() || undefined,
    categories: query?.categories?.filter(Boolean) ?? [],
    locations: query?.locations?.filter(Boolean) ?? [],
    foods: query?.foods?.filter(Boolean) ?? [],
    days: query?.days?.filter(Boolean) ?? [],
    minPrice: query?.minPrice,
    maxPrice: query?.maxPrice,
    registration: query?.registration,
    organizations: query?.organizations?.filter(Boolean) ?? [],
    freeFood: query?.freeFood === true,
    ids: query?.ids,
    sortBy: query?.sortBy || "date",
    sortOrder: query?.sortOrder === "desc" ? "desc" : "asc",
    startUtc: query?.startUtc,
    endUtc: query?.endUtc,
  };
}

function buildRequestQuery(
  school: string | null,
  query: EventListQuery,
  page: number,
  pageSize: number,
): EventListQuery {
  return {
    ...query,
    school: school ?? undefined,
    page,
    pageSize,
  };
}

function getEventsQueryKey(school: string | null, query: EventListQuery): string {
  return JSON.stringify({
    school: getSchoolFetchKey(school),
    search: query.search ?? "",
    categories: query.categories ?? [],
    locations: query.locations ?? [],
    foods: query.foods ?? [],
    days: query.days ?? [],
    minPrice: query.minPrice ?? null,
    maxPrice: query.maxPrice ?? null,
    registration: query.registration ?? null,
    organizations: query.organizations ?? [],
    freeFood: query.freeFood === true,
    ids: query.ids ?? null,
    sortBy: query.sortBy ?? "date",
    sortOrder: query.sortOrder ?? "asc",
    startUtc: query.startUtc ?? null,
    endUtc: query.endUtc ?? null,
  });
}

function hasMore(response: PaginatedEventsResponse): boolean {
  return response.items.length > 0 && response.page < response.total_pages;
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
    const queryKey = getEventsQueryKey(nextSchool, eventQuery);
    _loadedEventsQueryKey = queryKey;
    _skipNextEventsFetchQueryKey = queryKey;

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
      hasMoreEvents: hasMore(feed),
      eventQuery,
    });
  },

  fetchEvents: async (query) => {
    const school = get().schoolFilter;
    const eventQuery = normalizeEventQuery(query);
    const queryKey = getEventsQueryKey(school, eventQuery);
    const fetchId = ++_latestFetchId;
    const hasLoadedCurrentQuery = _loadedEventsQueryKey === queryKey;

    set({
      eventQuery,
      isLoading: hasLoadedCurrentQuery ? get().isLoading : true,
      isLoadingMore: false,
      error: null,
    });
    get().fetchPromotedEvents();

    if (_skipNextEventsFetchQueryKey === queryKey) {
      _skipNextEventsFetchQueryKey = null;
      set({ isLoading: false, isLoadingMore: false, error: null });
    }

    const request = buildRequestQuery(school, eventQuery, 1, get().eventsPageSize);
    const requestKey = JSON.stringify(request);
    let fetchPromise = _fetchesByQuery.get(requestKey);
    if (!fetchPromise) {
      fetchPromise = fetchEventsPage(request).finally(() => {
        _fetchesByQuery.delete(requestKey);
      });
      _fetchesByQuery.set(requestKey, fetchPromise);
    }

    const isCurrentFetch = () =>
      fetchId === _latestFetchId &&
      getEventsQueryKey(get().schoolFilter, get().eventQuery) === queryKey;

    try {
      const response = await fetchPromise;
      if (!isCurrentFetch()) return;
      _loadedEventsQueryKey = queryKey;
      set({
        events: response.items,
        latestAddedEvent: response.latest_added_event ?? null,
        eventsPage: response.page,
        totalEvents: response.total,
        hasMoreEvents: hasMore(response),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (!isCurrentFetch()) return;
      const message = getApiErrorMessage(err, i18n.t("events.loadFailed"));
      console.error("Failed to fetch events:", err);
      set({ isLoading: false, hasMoreEvents: false, error: message });
    }
  },

  loadMoreEvents: async () => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasMoreEvents) return;

    const school = state.schoolFilter;
    const eventQuery = state.eventQuery;
    const queryKey = getEventsQueryKey(school, eventQuery);
    const fetchId = ++_latestLoadMoreFetchId;
    const nextPage = state.eventsPage + 1;

    set({ isLoadingMore: true, error: null });

    const request = buildRequestQuery(school, eventQuery, nextPage, state.eventsPageSize);
    const requestKey = JSON.stringify(request);
    let fetchPromise = _fetchesByQuery.get(requestKey);
    if (!fetchPromise) {
      fetchPromise = fetchEventsPage(request).finally(() => {
        _fetchesByQuery.delete(requestKey);
      });
      _fetchesByQuery.set(requestKey, fetchPromise);
    }

    const isCurrentFetch = () =>
      fetchId === _latestLoadMoreFetchId &&
      getEventsQueryKey(get().schoolFilter, get().eventQuery) === queryKey;

    try {
      const response = await fetchPromise;
      if (!isCurrentFetch()) return;
      set((current) => ({
        events: getUniqueEvents([...current.events, ...response.items]),
        latestAddedEvent: response.latest_added_event ?? null,
        eventsPage: response.page,
        totalEvents: response.total,
        hasMoreEvents: hasMore(response),
        isLoadingMore: false,
        error: null,
      }));
    } catch (err) {
      if (!isCurrentFetch()) return;
      const message = getApiErrorMessage(err, i18n.t("events.loadFailed"));
      console.error("Failed to fetch more events:", err);
      set({ isLoadingMore: false, error: message });
    }
  },

  fetchPromotedEvents: async () => {
    const school = get().schoolFilter;
    const schoolKey = getSchoolFetchKey(school);
    const fetchId = ++_latestPromotedFetchId;
    const hasLoadedCurrentSchool = _loadedPromotedSchoolKey === schoolKey;

    set({
      isPromotedLoading: hasLoadedCurrentSchool ? get().isPromotedLoading : true,
    });

    let fetchPromise = _promotedFetchesBySchool.get(schoolKey);
    if (!fetchPromise) {
      fetchPromise = fetchPromotedEvents(school ?? undefined).finally(() => {
        _promotedFetchesBySchool.delete(schoolKey);
      });
      _promotedFetchesBySchool.set(schoolKey, fetchPromise);
    }

    const isCurrentFetch = () =>
      fetchId === _latestPromotedFetchId && getSchoolFetchKey(get().schoolFilter) === schoolKey;

    try {
      const promotedEvents = await fetchPromise;
      if (!isCurrentFetch()) return;
      _loadedPromotedSchoolKey = schoolKey;
      set({ promotedEvents, isPromotedLoading: false });
    } catch (err) {
      if (!isCurrentFetch()) return;
      console.error("Failed to fetch promoted events:", err);
      set({ isPromotedLoading: false });
    }
  },

  setSchoolFilter: (school: string) => {
    const nextSchool = resolveSchool(school);
    if (get().schoolFilter === nextSchool) return;
    set({ schoolFilter: nextSchool });
    get().fetchEvents(get().eventQuery);
  },

  addEvent: async (data) => {
    const created = await createEventAPI(data);
    set((state) => ({
      events: getUniqueEvents([created, ...state.events]),
      latestAddedEvent: { title: created.title, added_at: created.added_at },
    }));
    return created.id;
  },

  updateEvent: async (eventId, data) => {
    // Always call the backend — don't silently no-op when the id isn't in
    // the local list. The backend is the source of truth; if the event was
    // deleted elsewhere, the PATCH will surface the error to the caller.
    const updated = await updateEventAPI(eventId, data);
    set((state) => ({
      events: state.events.map((e) => (e.id === eventId ? updated : e)),
      latestAddedEvent:
        state.latestAddedEvent?.added_at === updated.added_at
          ? { title: updated.title, added_at: updated.added_at }
          : state.latestAddedEvent,
    }));
  },

  deleteEvent: async (eventId) => {
    try {
      await deleteEventAPI(eventId);
      set((state) => ({
        events: state.events.filter((e) => e.id !== eventId),
      }));
    } catch (err) {
      console.error("Failed to delete event:", err);
      // Sync local state with backend when 404/403: the event either no
      // longer exists or the caller can no longer touch it. Refetching
      // ensures UI matches the authoritative backend state.
      if (isApiError(err) && (err.status === 404 || err.status === 403)) {
        await get().fetchEvents(get().eventQuery);
      }
      // Re-throw so callers can surface the error (toast, etc.).
      throw err;
    }
  },

  incrementClickCount: (eventId) => {
    set((state) => ({
      events: state.events.map((e) =>
        e.id === eventId ? { ...e, click_count: (e.click_count ?? 0) + 1 } : e
      ),
      promotedEvents: state.promotedEvents.map((e) =>
        e.id === eventId ? { ...e, click_count: (e.click_count ?? 0) + 1 } : e
      ),
    }));
  },
}));

function getAuthLoginSchool(event: globalThis.Event): string {
  // `Event` here is the browser event type, not the app's event data model.
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
