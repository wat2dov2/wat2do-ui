/**
 * Directory Filters Stores (Zustand)
 *
 * The search box and filters of a directory page (clubs, positions). They live
 * in a store rather than in the page, so they outlive it: leaving for a club's
 * page and coming back, by its "All clubs" link or the browser's Back, finds the
 * directory searched and filtered as it was left. The events page keeps its
 * filters the same way, in the search store.
 *
 * Each directory names its own filters; the search box works the same in all
 * of them. Signing out starts every directory over, like the events filters.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";

export interface DirectoryFiltersState<Filters extends object> {
  /** What the search box holds, submitted or not. */
  searchQuery: string;
  /** The search the list applies; `revision` counts submissions, so a repeated search still counts. */
  submittedSearch: { query: string; revision: number };
  filters: Filters;
  setSearchQuery: (query: string) => void;
  /** Applies what the search box holds. */
  submitSearch: () => void;
  /** Empties the search box and applies that. */
  clearSearch: () => void;
  /** Fills the search box with `query` and applies it with `filters`. */
  searchFor: (query: string, filters: Filters) => void;
  setFilters: (update: Partial<Filters> | ((current: Filters) => Partial<Filters>)) => void;
}

export type DirectoryFiltersStore<Filters extends object> = UseBoundStore<StoreApi<DirectoryFiltersState<Filters>>>;

export function createDirectoryFiltersStore<Filters extends object>(
  initialFilters: Filters,
): DirectoryFiltersStore<Filters> {
  const nextSubmission = (state: DirectoryFiltersState<Filters>, query: string) => ({
    query,
    revision: state.submittedSearch.revision + 1,
  });

  const store = create<DirectoryFiltersState<Filters>>()((set) => ({
    searchQuery: "",
    submittedSearch: { query: "", revision: 0 },
    filters: initialFilters,
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    submitSearch: () => set((state) => ({ submittedSearch: nextSubmission(state, state.searchQuery.trim()) })),
    clearSearch: () => set((state) => ({ searchQuery: "", submittedSearch: nextSubmission(state, "") })),
    searchFor: (query, filters) => set((state) => ({
      searchQuery: query,
      submittedSearch: nextSubmission(state, query),
      filters,
    })),
    setFilters: (update) => set((state) => ({
      filters: { ...state.filters, ...(typeof update === "function" ? update(state.filters) : update) },
    })),
  }));

  if (typeof window !== "undefined") {
    window.addEventListener("auth-user-logout", () => {
      store.setState((state) => ({
        searchQuery: "",
        submittedSearch: nextSubmission(state, ""),
        filters: initialFilters,
      }));
    });
  }

  return store;
}
