/**
 * Saved Clubs Store (Zustand)
 *
 * Single source of truth for saved/followed club IDs. Optimistic toggle with
 * backend sync.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import {
  fetchSavedOrganizationIdsFromBackend,
  saveOrganizationToBackend,
  unsaveOrganizationToBackend,
} from "@/features/organizations/api/organizations.api";
import { isAuthenticated } from "@/features/auth";
import { toast } from "@/shared/hooks/use-toast";

interface SavedClubsState {
  savedClubIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  /** Fetch saved club IDs from backend. Idempotent — skips if already loaded successfully. */
  fetchSavedClubs: () => Promise<void>;
  /** Clear per-user state (called on logout / user switch). */
  reset: () => void;
  /** Pure local toggle — no backend sync. */
  _toggleLocal: (clubId: number) => void;
  /** Full toggle: local mutation + backend sync. */
  toggleSaveClub: (clubId: number) => void;
}

let _savedFetchInFlight = false;
let _lastFetchErrored = false;

const _optimisticToggles = new Map<number, boolean>();

export const useSavedOrganizationsStore = create<SavedClubsState>((set, get) => ({
  savedClubIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchSavedClubs: async () => {
    if (!isAuthenticated()) {
      set({ savedClubIds: [], isLoading: false, hasLoaded: false });
      return;
    }
    const state = get();
    if (_savedFetchInFlight) return;
    if (state.hasLoaded && !_lastFetchErrored) return;

    _savedFetchInFlight = true;
    set({ isLoading: true });
    try {
      const ids = await fetchSavedOrganizationIdsFromBackend();
      _lastFetchErrored = false;

      // Apply in-flight overrides to the fetched list
      const merged = new Set(ids.map(Number).filter(Number.isFinite));
      _optimisticToggles.forEach((shouldSave, clubId) => {
        if (shouldSave) {
          merged.add(clubId);
        } else {
          merged.delete(clubId);
        }
      });

      set({
        savedClubIds: Array.from(merged),
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err) {
      console.error("Failed to fetch saved club IDs:", err);
      _lastFetchErrored = true;
      set({ isLoading: false });
    } finally {
      _savedFetchInFlight = false;
    }
  },

  reset: () => {
    _lastFetchErrored = false;
    _optimisticToggles.clear();
    set({ savedClubIds: [], isLoading: false, hasLoaded: false });
  },

  _toggleLocal: (clubId) => {
    const prev = get().savedClubIds;
    const newIds = prev.includes(clubId)
      ? prev.filter((id) => id !== clubId)
      : [...prev, clubId];
    set({ savedClubIds: newIds });
  },

  toggleSaveClub: (clubId) => {
    const prev = get().savedClubIds;
    const wasSaved = prev.includes(clubId);
    const shouldSave = !wasSaved;
    const authenticated = isAuthenticated();

    // 1. Optimistic local update
    get()._toggleLocal(clubId);

    if (authenticated) {
      // 2. Register optimistic intent
      _optimisticToggles.set(clubId, shouldSave);

      // 3. Sync to backend
      const backendCall = shouldSave
        ? saveOrganizationToBackend(clubId)
        : unsaveOrganizationToBackend(clubId);

      backendCall
        .then(() => {
          _optimisticToggles.delete(clubId);
        })
        .catch((err) => {
          console.error(
            shouldSave ? "Failed to save club:" : "Failed to unsave club:",
            err,
          );
          _optimisticToggles.delete(clubId);
          // Rollback local change
          get()._toggleLocal(clubId);
          toast({
            description: shouldSave
              ? i18n.t("clubs.savedClubs.saveFailed")
              : i18n.t("clubs.savedClubs.unsaveFailed"),
            variant: "destructive",
          });
        });
    } else {
      // If not authenticated, roll back and show sign-in toast
      get()._toggleLocal(clubId);
      toast({
        description: i18n.t("auth.signInToUnlockFeatures") || "Please sign in to follow clubs",
      });
    }
  },
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSavedOrganizationsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useSavedOrganizationsStore.getState();
    store.reset();
    void store.fetchSavedClubs();
  });
}
