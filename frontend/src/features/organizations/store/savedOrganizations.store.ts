/**
 * Saved Organizations Store (Zustand)
 *
 * Single source of truth for saved/followed organization IDs. Optimistic toggle with
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

interface SavedOrganizationsState {
  savedOrganizationIds: number[];
  isLoading: boolean;
  hasLoaded: boolean;

  /** Fetch saved organization IDs from backend. Idempotent — skips if already loaded successfully. */
  fetchSavedOrganizations: () => Promise<void>;
  /** Clear per-user state (called on logout / user switch). */
  reset: () => void;
  /** Pure local toggle — no backend sync. */
  _toggleLocal: (organizationId: number) => void;
  /** Full toggle: local mutation + backend sync. */
  toggleSaveOrganization: (organizationId: number) => void;
}

let _savedFetchInFlight = false;
let _lastFetchErrored = false;

const _optimisticToggles = new Map<number, boolean>();

export const useSavedOrganizationsStore = create<SavedOrganizationsState>((set, get) => ({
  savedOrganizationIds: [],
  isLoading: true,
  hasLoaded: false,

  fetchSavedOrganizations: async () => {
    if (!isAuthenticated()) {
      if (get().isLoading) {
        set({ isLoading: false });
      }
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
      _optimisticToggles.forEach((shouldSave, organizationId) => {
        if (shouldSave) {
          merged.add(organizationId);
        } else {
          merged.delete(organizationId);
        }
      });

      set({
        savedOrganizationIds: Array.from(merged),
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err) {
      console.error("Failed to fetch saved organization IDs:", err);
      _lastFetchErrored = true;
      set({ isLoading: false });
    } finally {
      _savedFetchInFlight = false;
    }
  },

  reset: () => {
    _lastFetchErrored = false;
    _optimisticToggles.clear();
    set({ savedOrganizationIds: [], isLoading: false, hasLoaded: false });
  },

  _toggleLocal: (organizationId) => {
    const prev = get().savedOrganizationIds;
    const newIds = prev.includes(organizationId)
      ? prev.filter((id) => id !== organizationId)
      : [...prev, organizationId];
    set({ savedOrganizationIds: newIds });
  },

  toggleSaveOrganization: (organizationId) => {
    const prev = get().savedOrganizationIds;
    const wasSaved = prev.includes(organizationId);
    const shouldSave = !wasSaved;
    const authenticated = isAuthenticated();

    // 1. Optimistic local update
    get()._toggleLocal(organizationId);

    if (authenticated) {
      // 2. Register optimistic intent
      _optimisticToggles.set(organizationId, shouldSave);

      // 3. Sync to backend
      const backendCall = shouldSave
        ? saveOrganizationToBackend(organizationId)
        : unsaveOrganizationToBackend(organizationId);

      backendCall
        .then(() => {
          _optimisticToggles.delete(organizationId);
        })
        .catch((err) => {
          console.error(
            shouldSave ? "Failed to save organization:" : "Failed to unsave organization:",
            err,
          );
          _optimisticToggles.delete(organizationId);
          // Rollback local change
          get()._toggleLocal(organizationId);
          toast({
            description: shouldSave
              ? i18n.t("organizations.savedClubs.saveFailed")
              : i18n.t("organizations.savedClubs.unsaveFailed"),
            variant: "destructive",
          });
        });
    } else {
      // If not authenticated, roll back and show sign-in toast
      get()._toggleLocal(organizationId);
      toast({
        description: i18n.t("auth.signInToUnlockFeatures") || "Please sign in to follow organizations",
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
    void store.fetchSavedOrganizations();
  });
}
