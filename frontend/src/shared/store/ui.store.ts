/** Global ephemeral modal, dropdown, and event-editing state. */

import { create } from "zustand";
import type { Event } from "@/shared/types";

interface UIState {
  showCommandPalette: boolean;
  showFilterDropdown: boolean;
  setShowCommandPalette: (show: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;

  editingEvent: Event | null;
  setEditingEvent: (event: Event | null) => void;
  clearEditingEvent: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  showCommandPalette: false,
  showFilterDropdown: false,
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowFilterDropdown: (show) => set({ showFilterDropdown: show }),

  editingEvent: null,
  setEditingEvent: (event) => set({ editingEvent: event }),
  clearEditingEvent: () => set({ editingEvent: null }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useUIStore.setState({
      showCommandPalette: false,
      showFilterDropdown: false,
      editingEvent: null,
    });
  });
}
