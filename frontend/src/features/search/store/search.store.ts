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
import type { FilterState } from "@/shared/types/filter.types";
import {
  EMPTY_FILTER_STATE,
  normalizeFilterState,
  type SearchStoreFilterValues,
} from "@/features/search/api/filterService";

interface SearchStoreState extends SearchStoreFilterValues {
  // Bulk operations
  setFilterState: (filters: FilterState) => void;
  clearAllFilters: () => void;
}

function toStoreValues(filters: FilterState): SearchStoreFilterValues {
  const normalized = normalizeFilterState(filters);
  return {
    searchQuery: normalized.searchQuery,
    selectedCategories: normalized.categories,
    selectedLocations: normalized.locations,
    selectedFoods: normalized.foods,
    selectedDays: normalized.days,
    selectedClubs: normalized.clubs,
    minPrice: normalized.minPrice,
    maxPrice: normalized.maxPrice,
    minGoing: normalized.minGoing,
    registration: normalized.registration,
    hasFoodFilter: normalized.hasFood,
    goingFilter: normalized.going,
    sortBy: normalized.sortBy,
    sortOrder: normalized.sortOrder,
    addedSince: normalized.addedSince,
    dateFilter: normalized.dateFilter,
    customDate: normalized.customDate,
  };
}

const emptyFilters = toStoreValues(EMPTY_FILTER_STATE);

export const useSearchStore = create<SearchStoreState>((set) => ({
  ...emptyFilters,
  setFilterState: (filters) => set(toStoreValues(filters)),
  clearAllFilters: () => startTransition(() => set(emptyFilters)),
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSearchStore.getState().clearAllFilters();
  });
}
