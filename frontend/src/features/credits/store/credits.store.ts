/**
 * Credits & Promotions Store (Zustand)
 *
 * Single source of truth for:
 *   - Authenticated user's credit balance (credits.store)
 *   - Currently-active promoted event IDs (promotions.store)
 *
 * Anonymous users keep userCredits = 0.
 * Active promoted event IDs are loaded from a public endpoint for all users.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import {
  loadCredits,
  addCreditsAPI,
  loadActivePromotedEventIds,
  promoteEventAPI,
} from "@/features/credits/api/credits.api";
import { isAuthenticated, getUserId } from "@/features/auth";

interface CreditsState {
  userCredits: number;
  activePromotedEventIds: number[];

  /** Fetch the current balance from the backend. Idempotent - skips if already loaded. */
  fetchBalance: () => Promise<void>;
  /** Reset per-user state (called on logout / user switch). */
  reset: () => void;
  /** Grant credits (admin-only on the backend). Resolves with the new balance committed to state. */
  addCredits: (amount: number) => Promise<void>;
  /** Fetch the current active promoted event IDs from the backend. Idempotent - skips if already loaded. */
  fetchActivePromotedEventIds: () => Promise<void>;
  /** Promote an event using credits. */
  promoteEvent: (eventId: number) => Promise<{ success: boolean; needsCredits?: boolean }>;
}

let balanceLoadStatus: "idle" | "loading" | "loaded" = "idle";
let promoLoadStatus: "idle" | "loading" | "loaded" = "idle";

export const useCreditsStore = create<CreditsState>((set, get) => ({
  userCredits: 0,
  activePromotedEventIds: [],

  fetchBalance: async () => {
    if (balanceLoadStatus === "loading") return;
    if (balanceLoadStatus === "loaded") return;
    if (!isAuthenticated()) return;

    balanceLoadStatus = "loading";
    try {
      const balance = await loadCredits();
      balanceLoadStatus = "loaded";
      set({ userCredits: balance });
    } catch (err) {
      console.error("Failed to load credit balance:", err);
      balanceLoadStatus = "idle";
    }
  },

  reset: () => {
    balanceLoadStatus = "idle";
    promoLoadStatus = "idle";
    set({ userCredits: 0, activePromotedEventIds: [] });
  },

  addCredits: async (amount) => {
    const userId = getUserId();
    if (!userId) {
      const err = new Error(i18n.t("credits.loginRequired"));
      console.error("addCredits called without an authenticated user");
      throw err;
    }
    try {
      const newBalance = await addCreditsAPI(userId, amount);
      balanceLoadStatus = "loaded";
      set({ userCredits: newBalance });
    } catch (err) {
      console.error("Failed to add credits:", err);
      if (isAuthenticated()) {
        try {
          const balance = await loadCredits();
          balanceLoadStatus = "loaded";
          set({ userCredits: balance });
        } catch (reconcileErr) {
          console.error(
            "Failed to reconcile credit balance after addCredits error:",
            reconcileErr,
          );
        }
      }
      throw err;
    }
  },

  fetchActivePromotedEventIds: async () => {
    if (promoLoadStatus === "loading") return;
    if (promoLoadStatus === "loaded") return;

    promoLoadStatus = "loading";
    try {
      const ids = await loadActivePromotedEventIds();
      promoLoadStatus = "loaded";
      set({ activePromotedEventIds: ids });
    } catch (err) {
      console.error("Failed to load active promoted event IDs:", err);
      promoLoadStatus = "idle";
    }
  },

  promoteEvent: async (eventId) => {
    const snapshot = get().activePromotedEventIds;

    if (!snapshot.includes(eventId)) {
      set({ activePromotedEventIds: [...snapshot, eventId] });
    }

    try {
      const result = await promoteEventAPI(eventId);
      if (!result.success) {
        set({ activePromotedEventIds: snapshot });
      }
      const fresh = await loadActivePromotedEventIds();
      promoLoadStatus = "loaded";
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
        promoLoadStatus = "loaded";
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

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useCreditsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useCreditsStore.getState();
    store.reset();
    void store.fetchBalance();
    void store.fetchActivePromotedEventIds();
  });
}
