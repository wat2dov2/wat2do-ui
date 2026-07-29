import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { getEventCategories } from "@/shared/data/eventCategories";
import { availableDays, availableFoods } from "@/shared/constants/eventFilters";
import { translateCategory } from "@/shared/utils/event";
import type { Event } from "@/shared/types";

/**
 * Search/filter orchestration: useFilterState for store state, searchService for logic.
 * UI expand/collapse state lives in components.
 */
export interface UseSearchOptions {
  events: Event[];
  profileCompleted: boolean;
  goingEventIds: number[];
}

export function useSearch({
  events,
  profileCompleted,
  goingEventIds,
}: UseSearchOptions) {
  const { t } = useTranslation();

  const filterState = useFilterState(profileCompleted);

  const handleClearAllFilters = filterState.clearAllFilters;

  const availableOrganizations = useMemo(() => {
    const orgs = new Set<string>();
    events.forEach((event) => {
      const org = event.organization?.trim();
      if (org) {
        orgs.add(org);
      }
    });
    return Array.from(orgs).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filterState.searchQuery,
      goingFilter: filterState.goingFilter,
      freeFoodFilter: filterState.freeFoodFilter,
      selectedDays: filterState.selectedDays,
      priceRange: filterState.priceRange,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      profileCompleted,
      goingEventIds,
      selectedOrganizations: filterState.selectedOrganizations,
      addedSince: filterState.addedSince,
    });
    return sortEvents(filtered, { sortBy: filterState.sortBy, sortOrder: filterState.sortOrder });
  }, [
    events,
    filterState.searchQuery,
    filterState.freeFoodFilter,
    filterState.selectedDays,
    filterState.priceRange,
    filterState.selectedLocations,
    filterState.selectedFoods,
    filterState.selectedCategories,
    filterState.registration,
    profileCompleted,
    filterState.goingFilter,
    goingEventIds,
    filterState.sortBy,
    filterState.sortOrder,
    filterState.selectedOrganizations,
    filterState.addedSince,
  ]);

  const filterCount = useMemo(
    () =>
      getFilterCounts({
        searchQuery: filterState.searchQuery,
        selectedCategories: filterState.selectedCategories,
        selectedLocations: filterState.selectedLocations,
        selectedFoods: filterState.selectedFoods,
        selectedDays: filterState.selectedDays,
        priceRange: filterState.priceRange,
        registration: filterState.registration,
        selectedOrganizations: filterState.selectedOrganizations,
        freeFoodFilter: filterState.freeFoodFilter,
        goingFilter: filterState.goingFilter,
        addedSince: filterState.addedSince,
      }),
    [
      filterState.searchQuery,
      filterState.selectedCategories,
      filterState.selectedLocations,
      filterState.selectedFoods,
      filterState.selectedDays,
      filterState.priceRange,
      filterState.registration,
      filterState.selectedOrganizations,
      filterState.freeFoodFilter,
      filterState.goingFilter,
      filterState.addedSince,
    ],
  );

  const categoryOptions = useMemo(
    () =>
      getEventCategories().map((cat) => ({
        id: cat,
        label: translateCategory(cat, t),
      })),
    [t],
  );

  const foodOptions = useMemo(
    () =>
      availableFoods.map((food) => {
        const translation = t(`foods.${food}`);
        // If translation returns the key itself (missing translation), use the food value
        const label = translation.startsWith("foods.") ? food : translation;
        return {
          id: food,
          label,
        };
      }),
    [t],
  );

  const dayOptions = useMemo(
    () =>
      availableDays.map((day) => {
        const key = `days.${day.toLowerCase()}`;
        const translated = t(key);
        return {
          id: day,
          label: translated !== key ? translated : day,
        };
      }),
    [t],
  );

  return {
    ...filterState,
    categoryOptions,
    foodOptions,
    dayOptions,
    filteredEvents,
    filterCount,
    handleClearAllFilters,
    availableOrganizations,
  };
}
