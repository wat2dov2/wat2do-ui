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
  fetchAllEvents,
  fetchPromotedEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";
import { isApiError, getApiErrorMessage } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { QP } from "@/shared/constants/queryParams";
import { AUTH_STATE_REFRESH_EVENT, loadUserProfile } from "@/features/auth/api/userRepository";

interface EventsState {
  events: AppEvent[];
  promotedEvents: AppEvent[];
  isLoading: boolean;
  isPromotedLoading: boolean;
  error: string | null;
  schoolFilter: string | null;

  /** Fetch all events from backend for the current school filter. */
  fetchEvents: () => Promise<void>;
  fetchPromotedEvents: () => Promise<void>;
  setSchoolFilter: (school: string) => void;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
}

/** Deduplicate concurrent fetches for the same school while allowing school switches. */
const _fetchesBySchool = new Map<string, Promise<AppEvent[]>>();
let _latestFetchId = 0;

function getInitialSchoolFilter(): string {
  if (typeof window !== "undefined") {
    const schoolParam = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (schoolParam) return schoolParam;
  }

  return loadUserProfile()?.school?.trim() || DEFAULT_SCHOOL;
}

function getSchoolFetchKey(school: string | null): string {
  return school ?? "__all__";
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  promotedEvents: [],
  isLoading: true,
  isPromotedLoading: false,
  error: null,
  schoolFilter: getInitialSchoolFilter(),

  fetchEvents: async () => {
    const school = get().schoolFilter;
    const schoolKey = getSchoolFetchKey(school);
    const fetchId = ++_latestFetchId;

    set({ isLoading: true, error: null });
    get().fetchPromotedEvents();

    let fetchPromise = _fetchesBySchool.get(schoolKey);
    if (!fetchPromise) {
      fetchPromise = fetchAllEvents(school ?? undefined).finally(() => {
        _fetchesBySchool.delete(schoolKey);
      });
      _fetchesBySchool.set(schoolKey, fetchPromise);
    }

    const isCurrentFetch = () =>
      fetchId === _latestFetchId && getSchoolFetchKey(get().schoolFilter) === schoolKey;

    try {
      const events = await fetchPromise;
      if (!isCurrentFetch()) return;
      set({ events, isLoading: false, error: null });
    } catch (err) {
      if (!isCurrentFetch()) return;
      const message = getApiErrorMessage(err, i18n.t("events.loadFailed"));
      console.error("Failed to fetch events:", err);
      set({ isLoading: false, error: message });
    }
  },

  fetchPromotedEvents: async () => {
    const school = get().schoolFilter;
    set({ isPromotedLoading: true });
    try {
      const promotedEvents = await fetchPromotedEvents(school ?? undefined);
      set({ promotedEvents, isPromotedLoading: false });
    } catch (err) {
      console.error("Failed to fetch promoted events:", err);
      set({ isPromotedLoading: false });
    }
  },

  setSchoolFilter: (school: string) => {
    if (get().schoolFilter === school) return;
    set({ schoolFilter: school });
    get().fetchEvents();
  },

  addEvent: async (data) => {
    const created = await createEventAPI(data);
    set((state) => ({
      events: getUniqueEvents([created, ...state.events]),
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
        await get().fetchEvents();
      }
      // Re-throw so callers can surface the error (toast, etc.).
      throw err;
    }
  },
}));

function getAuthLoginSchool(event: globalThis.Event): string {
  // `Event` here is the browser event type, not the app's event data model.
  if ("detail" in event) {
    const detail = (event as CustomEvent<{ school?: string }>).detail;
    const hintedSchool = detail?.school?.trim();
    if (hintedSchool) return hintedSchool;
  }

  if (typeof window !== "undefined") {
    const routeSchool = new URLSearchParams(window.location.search).get(QP.SCHOOL)?.trim();
    if (routeSchool) return routeSchool;
  }

  return loadUserProfile()?.school?.trim() || DEFAULT_SCHOOL;
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
  const nextSchool = routeSchool || loadUserProfile()?.school?.trim() || DEFAULT_SCHOOL;
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
