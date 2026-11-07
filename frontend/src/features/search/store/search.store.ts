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
  filterStateToStoreValues,
  type SearchStoreFilterValues,
} from "@/features/search/api/filterService";

export type FilterUpdateSource = "user" | "normalization";

interface SearchStoreState extends SearchStoreFilterValues {
  queryRevision: number;
  // Bulk operations
  setFilterState: (filters: FilterState, source?: FilterUpdateSource) => void;
  clearAllFilters: () => void;
}

const emptyFilters = filterStateToStoreValues(EMPTY_FILTER_STATE);

export const useSearchStore = create<SearchStoreState>((set) => ({
  ...emptyFilters,
  queryRevision: 0,
  setFilterState: (filters, source = "user") => set((state) => ({
    ...filterStateToStoreValues(filters), queryRevision: state.queryRevision + (source === "user" ? 1 : 0),
  })),
  clearAllFilters: () => startTransition(() => set((state) => ({
    ...emptyFilters, queryRevision: state.queryRevision + 1,
  }))),
}));

// Listening to auth broadcasts
if (typeof window !== "undefined") {
  window.addEventListener("auth-user-logout", () => {
    useSearchStore.getState().clearAllFilters();
  });
}
