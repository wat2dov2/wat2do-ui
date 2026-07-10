/**
 * Saved Events Store (Zustand)
 *
 * Single source of truth for saved event IDs. Optimistic toggle with
 * fire-and-forget backend sync.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import {
  toggleSaveEventAPI,
  fetchSavedEventIdsFromBackend,
  saveEventToBackend,
  unsaveEventFromBackend,
} from "@/features/events/api/events.api";
import { isAuthenticated } from "@/features/auth/api/auth.api";
import { tracker } from "@/shared/services/trackingService";
import { toast } from "@/shared/hooks/use-toast";

interface SavedEventsState {
  savedEventIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  /** Fetch saved event IDs from backend. Idempotent - skips if already loaded successfully. */
  fetchSavedEvents: () => Promise<void>;
  /** Clear per-user state (called on logout / user switch). */
  reset: () => void;
  /** Pure local toggle - no backend sync, no analytics. Useful for hydration and tests. */
  _toggleLocal: (eventId: number) => void;
  /** Full toggle: local mutation + backend sync + analytics. */
  toggleSaveEvent: (eventId: number) => void;
}

let _savedFetchInFlight = false;
let _lastFetchErrored = false;

/**
 * Tracks active in-flight user toggles. If a fetch resolves while a user is actively clicking,
 * the in-flight intent overrides the stale fetch result so the card doesn't visually revert.
 */
const _optimisticToggles = new Map<number, boolean>();

export const useSavedEventsStore = create<SavedEventsState>((set, get) => ({
  savedEventIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchSavedEvents: async () => {
    if (!isAuthenticated()) {
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

      // Apply in-flight overrides to the fetched list
      const merged = new Set(ids.map(Number).filter(Number.isFinite));
      _optimisticToggles.forEach((shouldSave, eventId) => {
        if (shouldSave) {
          merged.add(eventId);
        } else {
          merged.delete(eventId);
        }
      });

      set({
        savedEventIds: Array.from(merged),
        isLoading: false,
        hasLoaded: true,
      });
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
    _optimisticToggles.clear();
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
    const shouldSave = !wasSaved;
    const authenticated = isAuthenticated();

    get()._toggleLocal(eventId);

    if (authenticated) {
      _optimisticToggles.set(eventId, shouldSave);

      const backendCall = shouldSave
        ? saveEventToBackend(eventId)
        : unsaveEventFromBackend(eventId);

      backendCall
        .then(() => {
          _optimisticToggles.delete(eventId);
        })
        .catch((err) => {
          console.error(
            shouldSave ? "Failed to save event:" : "Failed to unsave event:",
            err,
          );
          _optimisticToggles.delete(eventId);
          get()._toggleLocal(eventId);
          toast({
            description: shouldSave
              ? i18n.t("events.savedEvents.saveFailed")
              : i18n.t("events.savedEvents.unsaveFailed"),
            variant: "destructive",
          });
        });
    }

    tracker.track(eventId, shouldSave ? "save" : "unsave");
  },
}));

// Listening to auth broadcasts
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
