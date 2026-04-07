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

interface SavedEventsState {
  savedEventIds: number[];
  isLoading: boolean;

  /** Fetch saved event IDs from backend. Idempotent — skips if already loaded. */
  fetchSavedEvents: () => Promise<void>;
  toggleSaveEvent: (eventId: number, onConversionAction?: (eventId: number) => void) => void;
}

export const useSavedEventsStore = create<SavedEventsState>((set, get) => ({
  savedEventIds: [],
  isLoading: true,

  fetchSavedEvents: async () => {
    if (!isAuthenticated()) {
      set({ isLoading: false });
      return;
    }
    // Already loaded — skip
    if (get().savedEventIds.length > 0 || !get().isLoading) return;
    try {
      const ids = await fetchSavedEventIdsFromBackend();
      set({ savedEventIds: ids, isLoading: false });
    } catch (err) {
      console.error("Failed to fetch saved event IDs:", err);
      set({ isLoading: false });
    }
  },

  toggleSaveEvent: (eventId, onConversionAction) => {
    const prev = get().savedEventIds;
    const wasSaved = prev.includes(eventId);
    const newIds = toggleSaveEventAPI(eventId, prev);
    set({ savedEventIds: newIds });

    // Backend sync (fire-and-forget)
    if (isAuthenticated()) {
      if (wasSaved) {
        unsaveEventFromBackend(eventId).catch((err) =>
          console.error("Failed to unsave event:", err),
        );
      } else {
        saveEventToBackend(eventId).catch((err) =>
          console.error("Failed to save event:", err),
        );
      }
    }

    tracker.track(eventId, wasSaved ? "unsave" : "save");

    if (!wasSaved && onConversionAction) {
      onConversionAction(eventId);
    }
  },
}));
