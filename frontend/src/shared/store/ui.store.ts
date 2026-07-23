/**
 * Global UI preferences and ephemeral modal/dropdown state.
 * Persist partialize keeps only viewMode/filterViewMode in localStorage.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ViewMode, FilterViewMode, Event } from "@/shared/types";

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function getPreferenceStorage() {
  return typeof document === "undefined" ? noopStorage : window.localStorage;
}

interface UIState {
  viewMode: ViewMode;
  filterViewMode: FilterViewMode;
  setViewMode: (mode: ViewMode) => void;
  setFilterViewMode: (mode: FilterViewMode) => void;

  showCommandPalette: boolean;
  showFilterDropdown: boolean;
  setShowCommandPalette: (show: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;

  editingEvent: Event | null;
  setEditingEvent: (event: Event | null) => void;
  clearEditingEvent: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: "grid",
      filterViewMode: "visual",
      setViewMode: (mode) => set({ viewMode: mode }),
      setFilterViewMode: (mode) => set({ filterViewMode: mode }),

      showCommandPalette: false,
      showFilterDropdown: false,
      setShowCommandPalette: (show) => set({ showCommandPalette: show }),
      setShowFilterDropdown: (show) => set({ showFilterDropdown: show }),

      editingEvent: null,
      setEditingEvent: (event) => set({ editingEvent: event }),
      clearEditingEvent: () => set({ editingEvent: null }),
    }),
    {
      name: "wat2do-app-prefs",
      storage: createJSONStorage(getPreferenceStorage),
      version: 1,
      partialize: (state) => ({
        viewMode: state.viewMode,
        filterViewMode: state.filterViewMode,
      }),
    }
  )
);

if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useUIStore.setState({
      showCommandPalette: false,
      showFilterDropdown: false,
      editingEvent: null,
    });
  });
}
