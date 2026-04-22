/**
 * App Preferences Store (Zustand)
 *
 * Cross-feature UI preferences persisted to localStorage:
 *   - viewMode (grid / calendar / map) — events page default view
 *   - filterViewMode (visual / json)   — filter editor layout
 *
 * Subscribers read via selectors, so only components that depend on
 * the changed slice re-render. Replaces the old UIContext plumbing
 * for these two slots.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ViewMode, FilterViewMode } from "@/shared/types";

interface AppPrefsState {
  viewMode: ViewMode;
  filterViewMode: FilterViewMode;
  setViewMode: (mode: ViewMode) => void;
  setFilterViewMode: (mode: FilterViewMode) => void;
}

// Version 1: Initial schema with viewMode and filterViewMode.
// Bump when the persisted shape changes and supply `migrate` to transform
// old payloads. Persist key "wat2do-app-prefs" must NOT change — renaming
// it silently loses every user's saved preference.
export const useAppPrefsStore = create<AppPrefsState>()(
  persist(
    (set) => ({
      viewMode: "grid",
      filterViewMode: "visual",
      setViewMode: (mode) => set({ viewMode: mode }),
      setFilterViewMode: (mode) => set({ filterViewMode: mode }),
    }),
    {
      name: "wat2do-app-prefs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
