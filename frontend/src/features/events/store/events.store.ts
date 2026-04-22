/**
 * Events Store (Zustand)
 *
 * Single source of truth for all events data. State lives outside React,
 * so every component that imports this store reads the same data — no
 * duplicate fetches, no divergent state.
 */

import { create } from "zustand";
import type { Event, EventFormData } from "@/shared/types";
import {
  fetchAllEvents,
  createEventAPI,
  updateEventAPI,
  deleteEventAPI,
} from "@/features/events/api/events.api";
import { getUniqueEvents } from "@/shared/utils/event";
import { ApiError } from "@/shared/services/apiClient";

interface EventsState {
  events: Event[];
  isLoading: boolean;

  /** Fetch all events from backend. Idempotent — skips if already loaded. */
  fetchEvents: () => Promise<void>;
  addEvent: (data: EventFormData) => Promise<number>;
  updateEvent: (eventId: number, data: EventFormData) => Promise<void>;
  deleteEvent: (eventId: number) => Promise<void>;
}

/** Module-level flag to deduplicate concurrent fetchEvents calls. */
let _fetchInFlight = false;

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  isLoading: true,

  fetchEvents: async () => {
    // Dedup concurrent callers via a module-level flag. We intentionally
    // allow retries after a failure or when the list is empty, so the
    // app self-heals on transient failures.
    if (_fetchInFlight) return;
    _fetchInFlight = true;
    set({ isLoading: true });
    try {
      const events = await fetchAllEvents();
      set({ events, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch events:", err);
      set({ isLoading: false });
    } finally {
      _fetchInFlight = false;
    }
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
        try {
          const events = await fetchAllEvents();
          set({ events });
        } catch (refetchErr) {
          console.error("Failed to refetch events after delete failure:", refetchErr);
        }
      }
      // Re-throw so callers can surface the error (toast, etc.).
      throw err;
    }
  },
}));
