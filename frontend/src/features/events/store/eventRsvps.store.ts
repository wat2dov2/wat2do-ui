/**
 * Event RSVPs Store (Zustand)
 *
 * Single source of truth for RSVP'd ("I'm Going") event IDs. Mirrors
 * savedEvents.store: optimistic toggle with fire-and-forget backend sync.
 */

import { create } from "zustand";
import {
  toggleRsvpEventAPI,
  fetchRsvpEventIdsFromBackend,
  rsvpEventToBackend,
  unrsvpEventFromBackend,
} from "@/features/events/api/events.api";
import { isAuthenticated } from "@/features/auth";
import { tracker } from "@/shared/services/trackingService";
import { showToast } from "@/shared/ui/toast";

interface EventRsvpsState {
  rsvpEventIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  fetchRsvps: () => Promise<void>;
  reset: () => void;
  _toggleLocal: (eventId: number) => void;
  toggleRsvp: (eventId: number) => void;
}

let _rsvpFetchInFlight = false;
let _lastFetchErrored = false;

export const useEventRsvpsStore = create<EventRsvpsState>((set, get) => ({
  rsvpEventIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchRsvps: async () => {
    if (!isAuthenticated()) {
      set({ rsvpEventIds: [], isLoading: false, hasLoaded: false });
      return;
    }
    const state = get();
    if (_rsvpFetchInFlight) return;
    if (state.hasLoaded && !_lastFetchErrored) return;
    _rsvpFetchInFlight = true;
    set({ isLoading: true });
    try {
      const ids = await fetchRsvpEventIdsFromBackend();
      _lastFetchErrored = false;
      set({ rsvpEventIds: ids, isLoading: false, hasLoaded: true });
    } catch (err) {
      console.error("Failed to fetch RSVP event IDs:", err);
      _lastFetchErrored = true;
      set({ isLoading: false });
    } finally {
      _rsvpFetchInFlight = false;
    }
  },

  reset: () => {
    _lastFetchErrored = false;
    set({ rsvpEventIds: [], isLoading: false, hasLoaded: false });
  },

  _toggleLocal: (eventId) => {
    const prev = get().rsvpEventIds;
    const newIds = toggleRsvpEventAPI(eventId, prev);
    set({ rsvpEventIds: newIds });
  },

  toggleRsvp: (eventId) => {
    const prev = get().rsvpEventIds;
    const wasGoing = prev.includes(eventId);

    get()._toggleLocal(eventId);

    if (isAuthenticated()) {
      const backendCall = wasGoing
        ? unrsvpEventFromBackend(eventId)
        : rsvpEventToBackend(eventId);
      backendCall.catch((err) => {
        console.error(
          wasGoing ? "Failed to cancel RSVP:" : "Failed to RSVP:",
          err,
        );
        get()._toggleLocal(eventId);
        showToast(
          wasGoing ? "Couldn't cancel your RSVP" : "Couldn't RSVP to this event",
          "error",
        );
      });
    }

    tracker.track(eventId, wasGoing ? "rsvp_cancel" : "rsvp_going");
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useEventRsvpsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useEventRsvpsStore.getState();
    store.reset();
    void store.fetchRsvps();
  });
}
