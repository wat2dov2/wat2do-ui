/**
 * Search / Filter Store (Zustand)
 *
 * Single source of truth for filter state. App pages, command palette, and
 * EventsPageContainer share one client-side filter snapshot.
 *
 * Only filter *values* live here. Derived data (filtered event list,
 * filter option lists, filter counts) stays in useSearch where it can
 * depend on the events array passed in by the caller.
 *
 * Never use `useSearchStore()` without a selector - an unselected
 * subscription re-renders on every keystroke.
 */

import { startTransition } from "react";
import { create } from "zustand";
import type {
  EventDateFilter,
  FilterState,
} from "@/shared/types/filter.types";
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
  minPrice: string;
  maxPrice: string;
  registration: boolean;
  freeFoodFilter: boolean;
  goingFilter: boolean;
  selectedOrganizations: string[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
}

interface SearchStoreState extends FilterValues {
  // Bulk operations
  setFilterState: (filters: FilterState) => void;
  clearAllFilters: () => void;
}

const emptyFilters: FilterValues = {
  searchQuery: "",
  selectedCategories: [],
  selectedLocations: [],
  selectedFoods: [],
  selectedDays: [],
  minPrice: "",
  maxPrice: "",
  registration: false,
  freeFoodFilter: false,
  goingFilter: false,
  selectedOrganizations: [],
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedSince: "",
  dateFilter: "any",
  customDate: "",
};

export const useSearchStore = create<SearchStoreState>((set) => ({
  ...emptyFilters,

  // Full overwrite: every field is named explicitly for a clean slate.
  setFilterState: (filters) => {
    const normalized = normalizeFilterState(filters);
    set({
      searchQuery: normalized.searchQuery,
      selectedCategories: normalized.categories,
      selectedLocations: normalized.locations,
      selectedFoods: normalized.foods,
      selectedDays: normalized.days,
      selectedOrganizations: normalized.organizations,
      minPrice: normalized.minPrice,
      maxPrice: normalized.maxPrice,
      registration: normalized.registration,
      freeFoodFilter: normalized.freeFood,
      goingFilter: normalized.going,
      sortBy: normalized.sortBy,
      sortOrder: normalized.sortOrder,
      addedSince: normalized.addedSince,
      dateFilter: normalized.dateFilter,
      customDate: normalized.customDate,
    });
  },
  // startTransition keeps the UI responsive when clearing - both
  // command-palette and dropdown paths share this one implementation.
  clearAllFilters: () => startTransition(() => set(emptyFilters)),
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSearchStore.getState().clearAllFilters();
  });
}
