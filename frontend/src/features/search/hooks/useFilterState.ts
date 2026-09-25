import { useCallback, startTransition } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  storeStatesToFilterState,
  clearNarrowingFilterState,
} from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import type { EventDateFilter, EventFormatFilter, FilterState } from "@/shared/types";

type FilterStateUpdater = FilterState | ((current: FilterState) => FilterState);

function readCurrentFilterState(): FilterState {
  return storeStatesToFilterState(useSearchStore.getState());
}

export function useFilterActions() {
  const setFilterState = useCallback((updater: FilterStateUpdater) => {
    const nextFilters = typeof updater === "function"
      ? updater(readCurrentFilterState())
      : updater;
    startTransition(() => {
      useSearchStore.getState().setFilterState(nextFilters);
    });
  }, []);

  const updateFilterState = useCallback(
    (patch: Partial<FilterState>) => {
      setFilterState((current) => ({ ...current, ...patch }));
    },
    [setFilterState],
  );

  const toggleFilterValue = useCallback(
    (key: "categories" | "locations" | "foods" | "days", value: string) => {
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
    setFilterState(clearNarrowingFilterState);
  }, [setFilterState]);

  return {
    updateFilterState,
    toggleFilterValue,
    clearAllFilters,
  };
}

export function useFilterState() {
  const values = useSearchStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      selectedCategories: s.selectedCategories,
      selectedLocations: s.selectedLocations,
      selectedFoods: s.selectedFoods,
      selectedDays: s.selectedDays,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      minGoing: s.minGoing,
      eventFormat: s.eventFormat,
      registration: s.registration,
      hasFoodFilter: s.hasFoodFilter,
      selectedClubs: s.selectedClubs,
      goingFilter: s.goingFilter,
      sortBy: s.sortBy,
      sortOrder: s.sortOrder,
      addedSince: s.addedSince,
      dateFilter: s.dateFilter,
      customDate: s.customDate,
    })),
  );
  const priceFilterValue = values.maxPrice === "0" ? "0" : values.minPrice;
  const {
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
  const setSelectedClubs = useCallback(
    (value: string[]) => updateFilterState({ clubs: value }),
    [updateFilterState],
  );
  const setMinPrice = useCallback(
    (value: string) => updateFilterState({ minPrice: value }),
    [updateFilterState],
  );
  const setMaxPrice = useCallback(
    (value: string) => updateFilterState({ maxPrice: value }),
    [updateFilterState],
  );
  const setRegistration = useCallback(
    (value: boolean) => updateFilterState({ registration: value }),
    [updateFilterState],
  );
  const setEventFormat = useCallback(
    (value: EventFormatFilter) => updateFilterState({ eventFormat: value }),
    [updateFilterState],
  );
  const setMinGoing = useCallback(
    (value: number) => updateFilterState({ minGoing: value }),
    [updateFilterState],
  );
  const setHasFoodFilter = useCallback(
    (value: boolean) => updateFilterState({ hasFood: value }),
    [updateFilterState],
  );
  const setPriceFilter = useCallback(
    (value: string) => updateFilterState({
      minPrice: value !== "" && Number(value) > 0 ? value : "",
      maxPrice: value !== "" && Number(value) === 0 ? "0" : "",
    }),
    [updateFilterState],
  );
  const setGoingFilter = useCallback(
    (value: boolean) => updateFilterState({ going: value }),
    [updateFilterState],
  );
  const setAddedSince = useCallback(
    (value: string) => updateFilterState({ addedSince: value }),
    [updateFilterState],
  );
  const setDateFilter = useCallback(
    (value: EventDateFilter, selectedDate = "") =>
      updateFilterState({ dateFilter: value, customDate: selectedDate }),
    [updateFilterState],
  );
  const toggleCategory = useCallback(
    (cat: string) => toggleFilterValue("categories", cat),
    [toggleFilterValue],
  );
  const toggleDay = useCallback(
    (day: string) => toggleFilterValue("days", day),
    [toggleFilterValue],
  );
  return {
    ...values,
    setSearchQuery,
    setSelectedCategories,
    setSelectedLocations,
    setSelectedFoods,
    setSelectedDays,
    setMinPrice,
    setMaxPrice,
    setMinGoing,
    setEventFormat,
    setRegistration,
    setSelectedClubs,
    setHasFoodFilter,
    priceFilterValue,
    setPriceFilter,
    setGoingFilter,
    setAddedSince,
    setDateFilter,
    toggleCategory,
    toggleDay,
    clearAllFilters,
  };
}
