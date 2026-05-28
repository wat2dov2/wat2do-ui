/**
 * Events Store (Zustand)
 *
 * Single source of truth for all events data. State lives outside React,
 * so every component that imports this store reads the same data — no
 * duplicate fetches, no divergent state.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import type { Event, EventFormData } from "@/shared/types";
import {
  fetchAllEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";
import { ApiError } from "@/shared/services/apiClient";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";

interface EventsState {
  events: Event[];
  isLoading: boolean;
  error: string | null;
  schoolFilter: string | null;

  /** Fetch all events from backend for the current school filter. */
  fetchEvents: () => Promise<void>;
  setSchoolFilter: (school: string) => void;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
}

/** Deduplicate concurrent fetches for the same school while allowing school switches. */
const _fetchesBySchool = new Map<string, Promise<Event[]>>();
let _latestFetchId = 0;

function getSchoolFetchKey(school: string | null): string {
  return school ?? "__all__";
}

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  isLoading: true,
  error: null,
  schoolFilter: DEFAULT_SCHOOL,

  fetchEvents: async () => {
    const school = get().schoolFilter;
    const schoolKey = getSchoolFetchKey(school);
    const fetchId = ++_latestFetchId;

    set({ isLoading: true, error: null });

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
      const message = err instanceof ApiError ? err.message : i18n.t("events.loadFailed");
      console.error("Failed to fetch events:", err);
      set({ isLoading: false, error: message });
    }
  },

  setSchoolFilter: (school: string) => {
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
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        await get().fetchEvents();
      }
      // Re-throw so callers can surface the error (toast, etc.).
      throw err;
    }
  },
}));
