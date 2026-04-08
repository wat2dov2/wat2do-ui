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
 */

import { create } from "zustand";
import type { FilterState } from "@/shared/types/filter.types";

interface FilterValues {
  searchQuery: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  dateRange: Date | undefined;
  addedSince: Date | undefined;
  requiresRegistration: boolean;
  todayFilter: boolean;
  thisWeekFilter: boolean;
  freeFilter: boolean;
  freeFoodFilter: boolean;
  forYouFilter: boolean;
  includeFoods: boolean;
  savedFilter: boolean;
}

interface SearchStoreState extends FilterValues {
  // UI state shared between command palette and EventsPageContainer
  showFilterDropdown: boolean;
  setShowFilterDropdown: (value: boolean) => void;

  // Setters
  setSearchQuery: (value: string) => void;
  setSelectedCategories: (value: string[]) => void;
  setSelectedLocations: (value: string[]) => void;
  setSelectedFoods: (value: string[]) => void;
  setSelectedDays: (value: string[]) => void;
  setPriceRange: (value: { min: string; max: string }) => void;
  setDateRange: (value: Date | undefined) => void;
  setAddedSince: (value: Date | undefined) => void;
  setRequiresRegistration: (value: boolean) => void;
  setTodayFilter: (value: boolean) => void;
  setThisWeekFilter: (value: boolean) => void;
  setFreeFilter: (value: boolean) => void;
  setFreeFoodFilter: (value: boolean) => void;
  setForYouFilter: (value: boolean) => void;
  setIncludeFoods: (value: boolean) => void;
  setSavedFilter: (value: boolean) => void;

  // Toggle helpers
  toggleCategory: (cat: string) => void;
  toggleLocation: (loc: string) => void;
  toggleDay: (day: string) => void;
  toggleFood: (food: string) => void;

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
  dateRange: undefined,
  addedSince: undefined,
  requiresRegistration: false,
  todayFilter: false,
  thisWeekFilter: false,
  freeFilter: false,
  freeFoodFilter: false,
  forYouFilter: false,
  includeFoods: false,
  savedFilter: false,
};

export const useSearchStore = create<SearchStoreState>((set, get) => ({
  ...emptyFilters,

  // ── UI state ────────────────────────────────────────────────────
  showFilterDropdown: false,
  setShowFilterDropdown: (value) => set({ showFilterDropdown: value }),

  // ── Setters ─────────────────────────────────────────────────────
  setSearchQuery: (value) => set({ searchQuery: value }),
  setSelectedCategories: (value) => set({ selectedCategories: value }),
  setSelectedLocations: (value) => set({ selectedLocations: value }),
  setSelectedFoods: (value) => set({ selectedFoods: value }),
  setSelectedDays: (value) => set({ selectedDays: value }),
  setPriceRange: (value) => set({ priceRange: value }),
  setDateRange: (value) => set({ dateRange: value }),
  setAddedSince: (value) => set({ addedSince: value }),
  setRequiresRegistration: (value) => set({ requiresRegistration: value }),
  setTodayFilter: (value) => set({ todayFilter: value }),
  setThisWeekFilter: (value) => set({ thisWeekFilter: value }),
  setFreeFilter: (value) => set({ freeFilter: value }),
  setFreeFoodFilter: (value) => set({ freeFoodFilter: value }),
  setForYouFilter: (value) => set({ forYouFilter: value }),
  setIncludeFoods: (value) => set({ includeFoods: value }),
  setSavedFilter: (value) => set({ savedFilter: value }),

  // ── Toggles ─────────────────────────────────────────────────────
  toggleCategory: (cat) =>
    set((s) => ({
      selectedCategories: s.selectedCategories.includes(cat)
        ? s.selectedCategories.filter((c) => c !== cat)
        : [...s.selectedCategories, cat],
    })),
  toggleLocation: (loc) =>
    set((s) => ({
      selectedLocations: s.selectedLocations.includes(loc)
        ? s.selectedLocations.filter((l) => l !== loc)
        : [...s.selectedLocations, loc],
    })),
  toggleDay: (day) =>
    set((s) => ({
      selectedDays: s.selectedDays.includes(day)
        ? s.selectedDays.filter((d) => d !== day)
        : [...s.selectedDays, day],
    })),
  toggleFood: (food) =>
    set((s) => ({
      selectedFoods: s.selectedFoods.includes(food)
        ? s.selectedFoods.filter((f) => f !== food)
        : [...s.selectedFoods, food],
    })),

  // ── Bulk ────────────────────────────────────────────────────────
  setFilterStateFromURL: (filters) =>
    set({
      searchQuery: filters.searchQuery || "",
      selectedCategories: filters.categories || [],
      selectedLocations: filters.locations || [],
      selectedFoods: filters.foods || [],
      selectedDays: filters.days || [],
      priceRange: filters.priceRange || { min: "", max: "" },
      dateRange: filters.dateRange ? new Date(filters.dateRange) : undefined,
      addedSince: filters.addedSince ? new Date(filters.addedSince) : undefined,
      requiresRegistration: filters.requiresRegistration || false,
    }),
  clearAllFilters: () => set(emptyFilters),
}));
