/**
 * Search / Filter Store (Zustand)
 *
 * Single source of truth for filter state. Replaces the per-component
 * useReducer so that AppContent (URL hydration, command palette) and
 * EventsPageContainer (filter UI, event list) share one state.
 *
 * Only filter *values* live here. Derived data (filtered event list,
 * pie-menu items, filter counts) stays in useSearch where it can
 * depend on the events array passed in by the caller.
 *
 * Never use `useSearchStore()` without a selector — an unselected
 * subscription re-renders on every keystroke.
 */

import { startTransition } from "react";
import { create } from "zustand";
import type { FilterState } from "@/shared/types/filter.types";

interface FilterValues {
  searchQuery: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  registration: boolean;
  freeFoodFilter: boolean;
  savedFilter: boolean;
}

type FilterArrayKey =
  | "selectedCategories"
  | "selectedLocations"
  | "selectedFoods"
  | "selectedDays";

interface SearchStoreState extends FilterValues {
  // Setters
  setSearchQuery: (value: string) => void;
  setSelectedCategories: (value: string[]) => void;
  setSelectedLocations: (value: string[]) => void;
  setSelectedFoods: (value: string[]) => void;
  setSelectedDays: (value: string[]) => void;
  setPriceRange: (value: { min: string; max: string }) => void;
  setRegistration: (value: boolean) => void;
  setFreeFoodFilter: (value: boolean) => void;
  setSavedFilter: (value: boolean) => void;

  // Single toggle helper for all array-valued filters
  toggleFilter: (key: FilterArrayKey, value: string) => void;

  // Bulk operations
  setFilterStateFromURL: (filters: FilterState) => void;
  clearAllFilters: () => void;
}

const emptyFilters: FilterValues = {
  searchQuery: "",
  selectedCategories: [],
  selectedLocations: [],
  selectedFoods: [],
  selectedDays: [],
  priceRange: { min: "", max: "" },
  registration: false,
  freeFoodFilter: false,
  savedFilter: false,
};

export const useSearchStore = create<SearchStoreState>((set) => ({
  ...emptyFilters,

  // ── Setters ─────────────────────────────────────────────────────
  setSearchQuery: (value) => set({ searchQuery: value }),
  setSelectedCategories: (value) => set({ selectedCategories: value }),
  setSelectedLocations: (value) => set({ selectedLocations: value }),
  setSelectedFoods: (value) => set({ selectedFoods: value }),
  setSelectedDays: (value) => set({ selectedDays: value }),
  setPriceRange: (value) => set({ priceRange: value }),
  setRegistration: (value) => set({ registration: value }),
  setFreeFoodFilter: (value) => set({ freeFoodFilter: value }),
  setSavedFilter: (value) => set({ savedFilter: value }),

  // ── Toggles ─────────────────────────────────────────────────────
  toggleFilter: (key, value) =>
    set((s) => {
      const current = s[key];
      return {
        [key]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      } as Pick<SearchStoreState, FilterArrayKey>;
    }),

  // ── Bulk ────────────────────────────────────────────────────────
  // Full overwrite: every field is named explicitly so callers get a
  // clean slate rather than a half-hydrated mix of URL + prior state.
  setFilterStateFromURL: (filters) =>
    set({
      searchQuery: typeof filters.searchQuery === "string" ? filters.searchQuery : "",
      selectedCategories: Array.isArray(filters.categories) ? filters.categories : [],
      selectedLocations: Array.isArray(filters.locations) ? filters.locations : [],
      selectedFoods: Array.isArray(filters.foods) ? filters.foods : [],
      selectedDays: Array.isArray(filters.days) ? filters.days : [],
      priceRange: filters.priceRange || { min: "", max: "" },
      registration: filters.registration || false,
      freeFoodFilter: false,
      savedFilter: false,
    }),
  // startTransition keeps the UI responsive when clearing — both
  // command-palette and dropdown paths share this one implementation.
  clearAllFilters: () => startTransition(() => set(emptyFilters)),
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSearchStore.getState().clearAllFilters();
  });
}
