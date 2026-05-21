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
let _savedMutationVersion = 0;
type SavedMutationIntent = { shouldSave: boolean; version: number };
/**
 * Saved-events fetches can overlap with an optimistic save click, especially
 * right after login/reset when hydration is still running. Keep in-flight local
 * intent here so stale fetch responses don't flip the card back.
 */
const _pendingSavedMutations = new Map<number, SavedMutationIntent>();
const _recentSavedMutations = new Map<number, SavedMutationIntent>();

function normalizeSavedIds(ids: number[]) {
  return Array.from(new Set(ids.map(Number).filter(Number.isFinite)));
}

function applyMutationIntent(ids: Set<number>, eventId: number, intent: SavedMutationIntent) {
  if (intent.shouldSave) {
    ids.add(eventId);
  } else {
    ids.delete(eventId);
  }
}

function applyLocalSavedMutations(ids: number[], fetchStartedAtMutationVersion: number) {
  const merged = new Set(normalizeSavedIds(ids));
  _recentSavedMutations.forEach((intent, eventId) => {
    if (intent.version > fetchStartedAtMutationVersion) {
      applyMutationIntent(merged, eventId, intent);
    }
  });
  _pendingSavedMutations.forEach((intent, eventId) => {
    applyMutationIntent(merged, eventId, intent);
  });
  return Array.from(merged);
}

function pruneRecentSavedMutations(upToVersion: number) {
  _recentSavedMutations.forEach((intent, eventId) => {
    if (intent.version <= upToVersion && !_pendingSavedMutations.has(eventId)) {
      _recentSavedMutations.delete(eventId);
    }
  });
}

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
    const fetchStartedAtMutationVersion = _savedMutationVersion;
    set({ isLoading: true });
    try {
      const ids = await fetchSavedEventIdsFromBackend();
      _lastFetchErrored = false;
      set({
        savedEventIds: applyLocalSavedMutations(ids, fetchStartedAtMutationVersion),
        isLoading: false,
        hasLoaded: true,
      });
      pruneRecentSavedMutations(fetchStartedAtMutationVersion);
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
    _pendingSavedMutations.clear();
    _recentSavedMutations.clear();
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
    const mutationIntent: SavedMutationIntent = {
      shouldSave,
      version: ++_savedMutationVersion,
    };

    // Pure local state mutation (optimistic)
    if (authenticated) {
      _pendingSavedMutations.set(eventId, mutationIntent);
      _recentSavedMutations.set(eventId, mutationIntent);
    }
    get()._toggleLocal(eventId);

    // Backend sync — revert local state on failure so UI and server don't drift.
    if (authenticated) {
      const backendCall = wasSaved
        ? unsaveEventFromBackend(eventId)
        : saveEventToBackend(eventId);
      backendCall
        .then(() => {
          if (_pendingSavedMutations.get(eventId) === mutationIntent) {
            _pendingSavedMutations.delete(eventId);
          }
        })
        .catch((err) => {
          console.error(
            wasSaved ? "Failed to unsave event:" : "Failed to save event:",
            err,
          );
          if (_pendingSavedMutations.get(eventId) !== mutationIntent) {
            return;
          }
          _pendingSavedMutations.delete(eventId);
          if (_recentSavedMutations.get(eventId) === mutationIntent) {
            _recentSavedMutations.delete(eventId);
          }
          // Revert the optimistic toggle so UI matches backend truth.
          get()._toggleLocal(eventId);
          // Surface the rollback to the user — silent revert made it look
          // like the save succeeded and left them with incorrect state.
          showToast(
            wasSaved ? i18n.t("events.savedEvents.unsaveFailed") : i18n.t("events.savedEvents.saveFailed"),
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
