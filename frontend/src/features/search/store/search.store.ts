/**
 * Search / Filter Store (Zustand)
 *
 * Single source of truth for filter state. Replaces the per-component
 * useReducer so that App Router pages (URL hydration, command palette) and
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
import {
  DEFAULT_FILTER_SORT_BY,
  DEFAULT_FILTER_SORT_ORDER,
  normalizeFilterState,
} from "@/features/search/api/filterService";

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
  selectedOrganizations: string[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedWithin24h: boolean;
}

interface SearchStoreState extends FilterValues {
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
  selectedOrganizations: [],
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedWithin24h: false,
};

export const useSearchStore = create<SearchStoreState>((set) => ({
  ...emptyFilters,

  // ── Bulk ────────────────────────────────────────────────────────
  // Full overwrite: every field is named explicitly so callers get a
  // clean slate rather than a half-hydrated mix of URL + prior state.
  setFilterStateFromURL: (filters) => {
    const normalized = normalizeFilterState(filters);
    set({
      searchQuery: normalized.searchQuery,
      selectedCategories: normalized.categories,
      selectedLocations: normalized.locations,
      selectedFoods: normalized.foods,
      selectedDays: normalized.days,
      selectedOrganizations: normalized.organizations,
      priceRange: normalized.priceRange,
      registration: normalized.registration,
      freeFoodFilter: normalized.freeFood,
      savedFilter: normalized.saved,
      sortBy: normalized.sortBy,
      sortOrder: normalized.sortOrder,
      addedWithin24h: normalized.addedWithin24h,
    });
  },
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
