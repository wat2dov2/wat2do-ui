/**
 * Promotions Store (Zustand)
 *
 * Single source of truth for the list of currently-active promoted event IDs
 * (used to pin promoted events to the top of the grid).
 *
 * Authenticated and anonymous users both read from /promotions/active-ids,
 * which is a public endpoint. Credit balance is owned by credits.store.
 */

import { create } from "zustand";
import {
  loadActivePromotedEventIds,
  promoteEventAPI,
} from "@/features/credits/api/credits.api";

interface PromotionsState {
  activePromotedEventIds: number[];
  /** Internal load-status guard: "idle" (fresh / retry-ready), "loading" (fetch in-flight), "loaded" (fetched successfully). */
  _loadStatus: "idle" | "loading" | "loaded";

  /** Fetch the current active promoted event IDs from the backend. Idempotent — skips if already loaded. */
  fetchActivePromotedEventIds: () => Promise<void>;
  /** Reset per-user state (called on logout / user switch). */
  reset: () => void;
  promoteEvent: (
    eventId: number,
    packageId: string,
  ) => Promise<{ success: boolean; needsCredits?: boolean }>;
}

export const usePromotionsStore = create<PromotionsState>((set, get) => ({
  activePromotedEventIds: [],
  _loadStatus: "idle",

  fetchActivePromotedEventIds: async () => {
    const status = get()._loadStatus;
    if (status === "loading") return;
    if (status === "loaded") return;

    set({ _loadStatus: "loading" });
    try {
      const ids = await loadActivePromotedEventIds();
      set({ activePromotedEventIds: ids, _loadStatus: "loaded" });
    } catch (err) {
      console.error("Failed to load active promoted event IDs:", err);
      // Reset to "idle" so the next call retries.
      set({ _loadStatus: "idle" });
    }
  },

  reset: () => {
    set({ activePromotedEventIds: [], _loadStatus: "idle" });
  },

  promoteEvent: async (eventId, packageId) => {
    // Optimistic snapshot so the revert path is explicit even though the
    // backend reconcile is the ultimate source of truth.
    const snapshot = get().activePromotedEventIds;

    if (!snapshot.includes(eventId)) {
      set({ activePromotedEventIds: [...snapshot, eventId] });
    }

    try {
      const result = await promoteEventAPI(eventId, packageId);
      if (!result.success) {
        // CRD-003: insufficient_credits (and any other non-success sentinel)
        // must revert the optimistic promotion — otherwise the event stays
        // visually pinned even though the user never paid.
        set({ activePromotedEventIds: snapshot });
      }
      const fresh = await loadActivePromotedEventIds();
      set({ activePromotedEventIds: fresh });
      return result;
    } catch (err) {
      console.error(
        "Failed to promote event, reverting optimistic update and reconciling state:",
        err,
      );
      set({ activePromotedEventIds: snapshot });
      try {
        const fresh = await loadActivePromotedEventIds();
        set({ activePromotedEventIds: fresh });
      } catch (reconcileErr) {
        console.error(
          "Failed to reconcile active promoted event IDs after promoteEvent error:",
          reconcileErr,
        );
      }
      throw err;
    }
  },
}));

// Per-user store listens to auth broadcasts from auth.api:
//  - "auth-user-logout" -> reset so the next user starts clean.
//  - "auth-user-login"  -> reset + refetch so a login after mount
//     (the /login flow) hydrates the new user's promotions without a
//     hard reload. Mirrors savedEvents.store / credits.store.
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    usePromotionsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = usePromotionsStore.getState();
    store.reset();
    void store.fetchActivePromotedEventIds();
  });
}
