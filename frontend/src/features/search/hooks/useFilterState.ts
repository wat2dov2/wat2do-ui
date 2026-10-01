import { useCallback, startTransition } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  storeStatesToFilterState,
  clearNarrowingFilterState,
} from "@/features/search/api/filterService";
import { useSearchStore, type FilterUpdateSource } from "@/features/search/store/search.store";
import type { EventDateFilter, FilterState } from "@/shared/types";

type FilterStateUpdater = FilterState | ((current: FilterState) => FilterState);

function readCurrentFilterState(): FilterState {
  return storeStatesToFilterState(useSearchStore.getState());
}

export function useFilterActions() {
  const setFilterState = useCallback((updater: FilterStateUpdater, source?: FilterUpdateSource) => {
    const nextFilters = typeof updater === "function"
      ? updater(readCurrentFilterState())
      : updater;
    startTransition(() => {
      useSearchStore.getState().setFilterState(nextFilters, source);
    });
  }, []);

  const updateFilterState = useCallback(
    (patch: Partial<FilterState>, source?: FilterUpdateSource) => {
      setFilterState((current) => ({ ...current, ...patch }), source);
    },
    [setFilterState],
  );

  const toggleFilterValue = useCallback(
    (key: "categories" | "locations" | "foods" | "days" | "campusSeasonIds", value: string) => {
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
      registration: s.registration,
      hasFoodFilter: s.hasFoodFilter,
      employersOnCampus: s.employersOnCampus,
      competitions: s.competitions,
      featured: s.featured,
      sportsGame: s.sportsGame,
      campusSeasonIds: s.campusSeasonIds,
      selectedClubs: s.selectedClubs,
      goingFilter: s.goingFilter,
      sortBy: s.sortBy,
      sortOrder: s.sortOrder,
      addedSince: s.addedSince,
      dateFilter: s.dateFilter,
      customDate: s.customDate,
    })),
  );
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
  const setMinGoing = useCallback(
    (value: number) => updateFilterState({ minGoing: value }),
    [updateFilterState],
  );
  const setHasFoodFilter = useCallback(
    (value: boolean) => updateFilterState({ hasFood: value }),
    [updateFilterState],
  );
  const setEmployersOnCampus = useCallback(
    (value: boolean) => updateFilterState({ employersOnCampus: value }),
    [updateFilterState],
  );
  const setFreeFood = useCallback(
    (value: boolean) => updateFilterState({ hasFood: value, minPrice: "", maxPrice: value ? "0" : "" }),
    [updateFilterState],
  );
  const setCompetitions = useCallback(
    (value: boolean) => updateFilterState({ competitions: value }), [updateFilterState],
  );
  const setFeatured = useCallback(
    (value: boolean) => updateFilterState({ featured: value }), [updateFilterState],
  );
  const setSportsGame = useCallback(
    (value: boolean, source?: FilterUpdateSource) => updateFilterState({ sportsGame: value }, source),
    [updateFilterState],
  );
  const setCampusSeasonIds = useCallback(
    (value: string[], source?: FilterUpdateSource) => updateFilterState({ campusSeasonIds: value }, source),
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
  const toggleCampusSeason = useCallback(
    (id: string) => toggleFilterValue("campusSeasonIds", id),
    [toggleFilterValue],
  );
  return {
    ...values,
    freeFood: values.hasFoodFilter && values.minPrice === "" && values.maxPrice === "0",
    setSearchQuery,
    setSelectedCategories,
    setSelectedLocations,
    setSelectedFoods,
    setSelectedDays,
    setMinPrice,
    setMaxPrice,
    setMinGoing,
    setRegistration,
    setSelectedClubs,
    setHasFoodFilter,
    setEmployersOnCampus,
    setFreeFood,
    setCompetitions,
    setFeatured,
    setSportsGame,
    setCampusSeasonIds,
    toggleCampusSeason,
    setGoingFilter,
    setAddedSince,
    setDateFilter,
    toggleCategory,
    toggleDay,
    clearAllFilters,
  };
}
