import { useCallback, startTransition } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  storeStatesToFilterState,
  normalizeFilterState,
  clearNarrowingFilterState,
  DEFAULT_FILTER_SORT_BY,
  DEFAULT_FILTER_SORT_ORDER,
} from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import type { FilterState } from "@/shared/types";

type FilterStateUpdater = FilterState | ((current: FilterState) => FilterState);

function readCurrentFilterState(): FilterState {
  return storeStatesToFilterState(useSearchStore.getState());
}

export function useFilterActions() {
  const setFilterState = useCallback((updater: FilterStateUpdater) => {
    const nextFilters = normalizeFilterState(
      typeof updater === "function" ? updater(readCurrentFilterState()) : updater,
    );
    startTransition(() => {
      useSearchStore.getState().setFilterState(nextFilters);
    });
  }, []);

  const updateFilterState = useCallback(
    (patch: Partial<FilterState>) => {
      setFilterState((current) => normalizeFilterState({ ...current, ...patch }));
    },
    [setFilterState],
  );

  const toggleFilterValue = useCallback(
    (key: "categories" | "locations" | "foods" | "days" | "organizations", value: string) => {
      setFilterState((current) => {
        const currentValues = current[key];
        return {
          ...current,
          [key]: currentValues.includes(value)
            ? currentValues.filter((item) => item !== value)
            : [...currentValues, value],
        };
      });
    },
    [setFilterState],
  );

  const clearAllFilters = useCallback(() => {
    setFilterState((current) => clearNarrowingFilterState(current));
  }, [setFilterState]);

  return {
    setFilterState,
    updateFilterState,
    toggleFilterValue,
    clearAllFilters,
  };
}

/**
 * Hook for managing filter state
 *
 * Backed by the shared Zustand search store so that every call site
 * (App Router pages, EventsPageContainer, CommandPalette) reads and writes
 * the same filter values.
 */
export function useFilterState() {
  // ── Shared filter values from the store (single shallow subscription) ──
  const {
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    registration,
    freeFoodFilter,
    selectedOrganizations,
    goingFilter,
    sortBy,
    sortOrder,
    addedSince,
  } = useSearchStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      selectedCategories: s.selectedCategories,
      selectedLocations: s.selectedLocations,
      selectedFoods: s.selectedFoods,
      selectedDays: s.selectedDays,
      priceRange: s.priceRange,
      registration: s.registration,
      freeFoodFilter: s.freeFoodFilter,
      selectedOrganizations: s.selectedOrganizations,
      goingFilter: s.goingFilter,
      sortBy: s.sortBy,
      sortOrder: s.sortOrder,
      addedSince: s.addedSince,
    })),
  );
  const {
    setFilterState,
    updateFilterState,
    toggleFilterValue,
    clearAllFilters,
  } = useFilterActions();

  const setSearchQuery = useCallback(
    (value: string) => updateFilterState({ searchQuery: value }),
    [updateFilterState],
  );
  const setSelectedCategories = useCallback(
    (value: string[]) => updateFilterState({ categories: value }),
    [updateFilterState],
  );
  const setSelectedLocations = useCallback(
    (value: string[]) => updateFilterState({ locations: value }),
    [updateFilterState],
  );
  const setSelectedFoods = useCallback(
    (value: string[]) => updateFilterState({ foods: value }),
    [updateFilterState],
  );
  const setSelectedDays = useCallback(
    (value: string[]) => updateFilterState({ days: value }),
    [updateFilterState],
  );
  const setSelectedOrganizations = useCallback(
    (value: string[]) => updateFilterState({ organizations: value }),
    [updateFilterState],
  );
  const setPriceRange = useCallback(
    (value: { min: string; max: string }) =>
      updateFilterState({ priceRange: value }),
    [updateFilterState],
  );
  const setRegistration = useCallback(
    (value: boolean) => updateFilterState({ registration: value }),
    [updateFilterState],
  );
  const setFreeFoodFilter = useCallback(
    (value: boolean) => updateFilterState({ freeFood: value }),
    [updateFilterState],
  );
  const setGoingFilter = useCallback(
    (value: boolean) => updateFilterState({ going: value }),
    [updateFilterState],
  );
  const setAddedSince = useCallback(
    (value: string) => {
      setFilterState((current) =>
        normalizeFilterState({
          ...current,
          addedSince: value,
          sortBy: value ? "added_at" : DEFAULT_FILTER_SORT_BY,
          sortOrder: value ? "desc" : DEFAULT_FILTER_SORT_ORDER,
        }),
      );
    },
    [setFilterState],
  );
  const setSortBy = useCallback(
    (value: string) => updateFilterState({ sortBy: value }),
    [updateFilterState],
  );
  const setSortOrder = useCallback(
    (value: "asc" | "desc") => updateFilterState({ sortOrder: value }),
    [updateFilterState],
  );
  const setSort = useCallback(
    (sortBy: string, sortOrder: "asc" | "desc") =>
      updateFilterState({ sortBy, sortOrder }),
    [updateFilterState],
  );
  const toggleCategory = useCallback(
    (cat: string) => toggleFilterValue("categories", cat),
    [toggleFilterValue],
  );
  const toggleLocation = useCallback(
    (loc: string) => toggleFilterValue("locations", loc),
    [toggleFilterValue],
  );
  const toggleDay = useCallback(
    (day: string) => toggleFilterValue("days", day),
    [toggleFilterValue],
  );
  const toggleOrganization = useCallback(
    (org: string) => toggleFilterValue("organizations", org),
    [toggleFilterValue],
  );

  return {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    selectedLocations,
    setSelectedLocations,
    selectedFoods,
    setSelectedFoods,
    selectedDays,
    setSelectedDays,
    priceRange,
    setPriceRange,
    registration,
    setRegistration,
    selectedOrganizations,
    setSelectedOrganizations,
    freeFoodFilter,
    setFreeFoodFilter,
    goingFilter,
    setGoingFilter,
    addedSince,
    setAddedSince,
    toggleCategory,
    toggleLocation,
    toggleDay,
    toggleOrganization,
    clearAllFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    setSort,
  };
}
