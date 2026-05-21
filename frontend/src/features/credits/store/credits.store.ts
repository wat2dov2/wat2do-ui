/**
 * Credits Store (Zustand)
 *
 * Single source of truth for the authenticated user's credit balance.
 * Anonymous users keep userCredits = 0 (no fetch, no listeners wake it).
 *
 * Backend is authoritative — per AGENTS.md, credits are never persisted
 * to localStorage.
 */

import { create } from "zustand";
import i18n from "@/shared/lib/i18n";
import { loadCredits, addCreditsAPI } from "@/features/credits/api/credits.api";
import { isAuthenticated, getUserId } from "@/features/auth";

interface CreditsState {
  userCredits: number;
  /** Internal load-status guard: "idle" (fresh / retry-ready), "loading" (fetch in-flight), "loaded" (fetched successfully). */
  _loadStatus: "idle" | "loading" | "loaded";

  /** Fetch the current balance from the backend. Idempotent — skips if already loaded. */
  fetchBalance: () => Promise<void>;
  /** Reset per-user state (called on logout / user switch). */
  reset: () => void;
  /** Grant credits (admin-only on the backend). Resolves with the new balance committed to state. */
  addCredits: (amount: number) => Promise<void>;
}

export const useCreditsStore = create<CreditsState>((set, get) => ({
  userCredits: 0,
  _loadStatus: "idle",

  fetchBalance: async () => {
    const status = get()._loadStatus;
    if (status === "loading") return;
    if (status === "loaded") return;
    if (!isAuthenticated()) return;

    set({ _loadStatus: "loading" });
    try {
      const balance = await loadCredits();
      set({ userCredits: balance, _loadStatus: "loaded" });
    } catch (err) {
      console.error("Failed to load credit balance:", err);
      // Reset to "idle" so the next call retries.
      set({ _loadStatus: "idle" });
    }
  },

  reset: () => {
    set({ userCredits: 0, _loadStatus: "idle" });
  },

  addCredits: async (amount) => {
    // CRD-001: backend /credits/add is admin-only and requires both
    // user_id and amount. Send both so the request passes Pydantic
    // validation; non-admin callers will receive a 403 which the
    // modal surfaces as an error banner.
    const userId = getUserId();
    if (!userId) {
      const err = new Error(i18n.t("credits.loginRequired"));
      console.error("addCredits called without an authenticated user");
      throw err;
    }
    try {
      const newBalance = await addCreditsAPI(userId, amount);
      set({ userCredits: newBalance });
    } catch (err) {
      console.error("Failed to add credits:", err);
      // Reconcile so the UI falls back to backend truth rather than any
      // stale optimistic value.
      if (isAuthenticated()) {
        try {
          const balance = await loadCredits();
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
}));

// Per-user store listens to auth broadcasts from auth.api:
//  - "auth-user-logout" -> reset so the next user starts clean.
//  - "auth-user-login"  -> reset + refetch so a login after mount
//     (the /login flow) hydrates the new user's balance without a
//     hard reload. Mirrors savedEvents.store / promotions.store.
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useCreditsStore.getState().reset();
  });
  window.addEventListener("auth-user-login", () => {
    const store = useCreditsStore.getState();
    store.reset();
    void store.fetchBalance();
  });
}
