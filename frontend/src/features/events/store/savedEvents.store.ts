/**
 * Saved Events Store (Zustand)
 *
 * Single source of truth for saved event IDs. Optimistic toggle with
 * fire-and-forget backend sync.
 */

import { create } from "zustand";
import {
  toggleSaveEventAPI,
  fetchSavedEventIdsFromBackend,
  saveEventToBackend,
  unsaveEventFromBackend,
} from "@/features/events/api/events.api";
import { isAuthenticated } from "@/features/auth";
import { tracker } from "@/shared/services/trackingService";
import { showToast } from "@/shared/ui/toast";

interface SavedEventsState {
  savedEventIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  /** Fetch saved event IDs from backend. Idempotent — skips if already loaded successfully. */
  fetchSavedEvents: () => Promise<void>;
  /** Clear per-user state (called on logout / user switch). */
  reset: () => void;
  /** Pure local toggle — no backend sync, no analytics. Useful for hydration and tests. */
  _toggleLocal: (eventId: number) => void;
  /** Full toggle: local mutation + backend sync + analytics. */
  toggleSaveEvent: (eventId: number) => void;
}

let _savedFetchInFlight = false;
/** Module-level retry guard: when the prior fetch failed, allow another attempt. */
let _lastFetchErrored = false;

export const useSavedEventsStore = create<SavedEventsState>((set, get) => ({
  savedEventIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchSavedEvents: async () => {
    if (!isAuthenticated()) {
      // Anonymous users have no saved events to fetch, but must NOT poison
      // the guard (hasLoaded=true) — otherwise a later login would see
      // "already loaded" and skip refetching per-user state. Leave
      // hasLoaded=false so the post-login listener triggers a real fetch.
      set({ savedEventIds: [], isLoading: false, hasLoaded: false });
      return;
    }
    const state = get();
    if (_savedFetchInFlight) return;
    if (state.hasLoaded && !_lastFetchErrored) return;
    _savedFetchInFlight = true;
    set({ isLoading: true });
    try {
      const ids = await fetchSavedEventIdsFromBackend();
      _lastFetchErrored = false;
      set({ savedEventIds: ids, isLoading: false, hasLoaded: true });
    } catch (err) {
      console.error("Failed to fetch saved event IDs:", err);
      _lastFetchErrored = true;
      set({ isLoading: false });
    } finally {
      _savedFetchInFlight = false;
    }
  },

  reset: () => {
    _lastFetchErrored = false;
    set({ savedEventIds: [], isLoading: false, hasLoaded: false });
  },

  _toggleLocal: (eventId) => {
    const prev = get().savedEventIds;
    const newIds = toggleSaveEventAPI(eventId, prev);
    set({ savedEventIds: newIds });
  },

  toggleSaveEvent: (eventId) => {
    const prev = get().savedEventIds;
    const wasSaved = prev.includes(eventId);

    // Pure local state mutation (optimistic)
    get()._toggleLocal(eventId);

    // Backend sync — revert local state on failure so UI and server don't drift.
    if (isAuthenticated()) {
      const backendCall = wasSaved
        ? unsaveEventFromBackend(eventId)
        : saveEventToBackend(eventId);
      backendCall.catch((err) => {
        console.error(
          wasSaved ? "Failed to unsave event:" : "Failed to save event:",
          err,
        );
        // Revert the optimistic toggle so UI matches backend truth.
        get()._toggleLocal(eventId);
        // Surface the rollback to the user — silent revert made it look
        // like the save succeeded and left them with incorrect state.
        showToast(
          wasSaved ? "Couldn't unsave this event" : "Couldn't save this event",
          "error",
        );
      });
    }

    tracker.track(eventId, wasSaved ? "unsave" : "save");
  },
}));

// Per-user store listens to auth broadcasts from auth.api:
//  - "auth-user-logout" -> reset so the next user starts clean.
//  - "auth-user-login"  -> reset + refetch so a login after mount
//     (the /login flow) hydrates the new user's saved event IDs
//     without a hard reload. Mirrors promotions.store.
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSavedEventsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useSavedEventsStore.getState();
    store.reset();
    void store.fetchSavedEvents();
  });
}
