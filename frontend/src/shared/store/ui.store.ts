/**
 * UI Store (Zustand)
 *
 * Consolidated store for global UI preferences and states:
 *   - Persisted preferences: viewMode, filterViewMode (backed by localStorage).
 *   - Ephemeral states: modal and dropdown toggles.
 *
 * Utilizes Zustand's persist partialize option so ephemeral properties are
 * never written to localStorage, avoiding schema pollution.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ViewMode, FilterViewMode, Event } from "@/shared/types";

interface UIState {
  // Preferences (persisted)
  viewMode: ViewMode;
  filterViewMode: FilterViewMode;
  setViewMode: (mode: ViewMode) => void;
  setFilterViewMode: (mode: FilterViewMode) => void;

  // Modals & Dropdowns (ephemeral)
  showSubmitChoice: boolean;
  showSubmitEvent: boolean;
  showCommandPalette: boolean;
  showFilterDropdown: boolean;
  setShowSubmitChoice: (show: boolean) => void;
  setShowSubmitEvent: (show: boolean) => void;
  setShowCommandPalette: (show: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;

  // Event editing (ephemeral)
  editingEvent: Event | null;
  setEditingEvent: (event: Event | null) => void;
  clearEditingEvent: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Preferences default state
      viewMode: "grid",
      filterViewMode: "visual",
      setViewMode: (mode) => set({ viewMode: mode }),
      setFilterViewMode: (mode) => set({ filterViewMode: mode }),

      // Modals & Dropdowns default state
      showSubmitChoice: false,
      showSubmitEvent: false,
      showCommandPalette: false,
      showFilterDropdown: false,
      setShowSubmitChoice: (show) => set({ showSubmitChoice: show }),
      setShowSubmitEvent: (show) => set({ showSubmitEvent: show }),
      setShowCommandPalette: (show) => set({ showCommandPalette: show }),
      setShowFilterDropdown: (show) => set({ showFilterDropdown: show }),

      // Event editing default state
      editingEvent: null,
      setEditingEvent: (event) => set({ editingEvent: event }),
      clearEditingEvent: () => set({ editingEvent: null }),
    }),
    {
      name: "wat2do-app-prefs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only persist view preferences
      partialize: (state) => ({
        viewMode: state.viewMode,
        filterViewMode: state.filterViewMode,
      }),
    }
  )
);

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useUIStore.setState({
      showSubmitChoice: false,
      showSubmitEvent: false,
      showCommandPalette: false,
      showFilterDropdown: false,
      editingEvent: null,
    });
  });
}
