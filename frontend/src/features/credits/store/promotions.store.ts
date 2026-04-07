/**
 * Promotions Store (Zustand)
 *
 * Single source of truth for user credits and promoted events.
 */

import { create } from "zustand";
import type { PromotedEvent } from "@/shared/types";
import {
  loadCredits,
  loadPromotedEvents,
  addCredits as addCreditsAPI,
  promoteEventAPI,
  isEventPromoted as isEventPromotedCheck,
} from "@/features/credits/api/credits.api";

interface PromotionsState {
  userCredits: number;
  promotedEvents: PromotedEvent[];
  activePromotedEventIds: number[];
  isLoading: boolean;

  /** Fetch credits and promotions from backend. Idempotent — skips if already loaded. */
  fetchPromotions: () => Promise<void>;
  addCredits: (amount: number) => Promise<void>;
  promoteEvent: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number,
  ) => Promise<{ success: boolean; needsCredits?: boolean }>;
  isEventPromoted: (eventId: number) => boolean;
}

function deriveActiveIds(promotedEvents: PromotedEvent[]): number[] {
  const now = new Date().toISOString();
  return promotedEvents.filter((p) => p.endDate > now).map((p) => p.eventId);
}

export const usePromotionsStore = create<PromotionsState>((set, get) => ({
  userCredits: 0,
  promotedEvents: [],
  activePromotedEventIds: [],
  isLoading: true,

  fetchPromotions: async () => {
    // Already loaded — skip
    if (!get().isLoading) return;
    try {
      const [balance, promos] = await Promise.all([
        loadCredits(),
        loadPromotedEvents(),
      ]);
      set({
        userCredits: balance,
        promotedEvents: promos,
        activePromotedEventIds: deriveActiveIds(promos),
        isLoading: false,
      });
    } catch (err) {
      console.error("Failed to load credits/promotions:", err);
      set({ isLoading: false });
    }
  },

  addCredits: async (amount) => {
    const newBalance = await addCreditsAPI(amount);
    set({ userCredits: newBalance });
  },

  promoteEvent: async (eventId, packageId, credits, duration) => {
    const result = await promoteEventAPI(eventId, packageId, credits, duration);
    if (result.success) {
      // Refresh state from backend
      const [balance, promos] = await Promise.all([
        loadCredits(),
        loadPromotedEvents(),
      ]);
      set({
        userCredits: balance,
        promotedEvents: promos,
        activePromotedEventIds: deriveActiveIds(promos),
      });
    }
    return result;
  },

  isEventPromoted: (eventId) => {
    return isEventPromotedCheck(eventId, get().promotedEvents);
  },
}));
