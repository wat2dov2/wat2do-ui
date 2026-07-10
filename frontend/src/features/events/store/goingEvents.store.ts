/**
 * Going Events Store (Zustand)
 *
 * Single source of truth for going event IDs. Optimistic toggle with
 * backend sync that returns `{ status, going_count }` for cache patching.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import {
  toggleGoingEventAPI,
  fetchGoingEventIdsFromBackend,
  markGoingOnBackend,
  unmarkGoingOnBackend,
  type GoingEventStatusResponse,
} from "@/features/events/api/events.api";
import { isAuthenticated } from "@/features/auth/api/auth.api";
import { tracker } from "@/shared/services/trackingService";
import { toast } from "@/shared/hooks/use-toast";

interface GoingEventsState {
  goingEventIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  /** Fetch going event IDs from backend. Idempotent - skips if already loaded successfully. */
  fetchGoingEvents: () => Promise<void>;
  /** Clear per-user state (called on logout / user switch). */
  reset: () => void;
  /** Pure local toggle - no backend sync, no analytics. Useful for hydration and tests. */
  _toggleLocal: (eventId: number) => void;
  /**
   * Full toggle: optimistic local mutation + backend sync + analytics.
   * Returns the backend Promise (with going_count) when authenticated so callers
   * can patch counts cache; resolves to undefined when unauthenticated.
   */
  toggleGoingEvent: (
    eventId: number,
  ) => Promise<GoingEventStatusResponse | undefined>;
}

let _goingFetchInFlight = false;
let _lastFetchErrored = false;

/**
 * Tracks active in-flight user toggles. If a fetch resolves while a user is actively clicking,
 * the in-flight intent overrides the stale fetch result so the card doesn't visually revert.
 */
const _optimisticToggles = new Map<number, boolean>();

export const useGoingEventsStore = create<GoingEventsState>((set, get) => ({
  goingEventIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchGoingEvents: async () => {
    if (!isAuthenticated()) {
      set({ goingEventIds: [], isLoading: false, hasLoaded: false });
      return;
    }
    const state = get();
    if (_goingFetchInFlight) return;
    if (state.hasLoaded && !_lastFetchErrored) return;

    _goingFetchInFlight = true;
    set({ isLoading: true });
    try {
      const ids = await fetchGoingEventIdsFromBackend();
      _lastFetchErrored = false;

      // Apply in-flight overrides to the fetched list
      const merged = new Set(ids.map(Number).filter(Number.isFinite));
      _optimisticToggles.forEach((shouldMark, eventId) => {
        if (shouldMark) {
          merged.add(eventId);
        } else {
          merged.delete(eventId);
        }
      });

      set({
        goingEventIds: Array.from(merged),
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err) {
      console.error("Failed to fetch going event IDs:", err);
      _lastFetchErrored = true;
      set({ isLoading: false });
    } finally {
      _goingFetchInFlight = false;
    }
  },

  reset: () => {
    _lastFetchErrored = false;
    _optimisticToggles.clear();
    set({ goingEventIds: [], isLoading: false, hasLoaded: false });
  },

  _toggleLocal: (eventId) => {
    const prev = get().goingEventIds;
    const newIds = toggleGoingEventAPI(eventId, prev);
    set({ goingEventIds: newIds });
  },

  toggleGoingEvent: (eventId) => {
    const prev = get().goingEventIds;
    const wasGoing = prev.includes(eventId);
    const shouldMark = !wasGoing;
    const authenticated = isAuthenticated();

    get()._toggleLocal(eventId);
    tracker.track(eventId, shouldMark ? "going" : "ungoing");

    if (!authenticated) {
      return Promise.resolve(undefined);
    }

    _optimisticToggles.set(eventId, shouldMark);

    const backendCall = shouldMark
      ? markGoingOnBackend(eventId)
      : unmarkGoingOnBackend(eventId);

    return backendCall
      .then((response) => {
        _optimisticToggles.delete(eventId);
        return response;
      })
      .catch((err) => {
        console.error(
          shouldMark ? "Failed to mark going:" : "Failed to unmark going:",
          err,
        );
        _optimisticToggles.delete(eventId);
        get()._toggleLocal(eventId);
        toast({
          description: shouldMark
            ? i18n.t("events.goingEvents.markFailed")
            : i18n.t("events.goingEvents.unmarkFailed"),
          variant: "destructive",
        });
        throw err;
      });
  },
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useGoingEventsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useGoingEventsStore.getState();
    store.reset();
    void store.fetchGoingEvents();
  });
}
