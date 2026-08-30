import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { getEventCategories } from "@/shared/data/eventCategories";
import { availableDays } from "@/shared/constants/eventFilters";
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

  const filterState = useFilterState();

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
      maxPrice: filterState.maxPrice,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      profileCompleted,
      goingEventIds,
      selectedOrganizations: filterState.selectedOrganizations,
      addedSince: filterState.addedSince,
      dateFilter: filterState.dateFilter,
      customDate: filterState.customDate,
    });
    return sortEvents(filtered, { sortBy: filterState.sortBy, sortOrder: filterState.sortOrder });
  }, [
    events,
    filterState.searchQuery,
    filterState.freeFoodFilter,
    filterState.selectedDays,
    filterState.maxPrice,
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
    filterState.dateFilter,
    filterState.customDate,
  ]);

  const filterCount = useMemo(
    () =>
      getFilterCounts({
        selectedCategories: filterState.selectedCategories,
        selectedLocations: filterState.selectedLocations,
        selectedFoods: filterState.selectedFoods,
        selectedDays: filterState.selectedDays,
        maxPrice: filterState.maxPrice,
        registration: filterState.registration,
        selectedOrganizations: filterState.selectedOrganizations,
        freeFoodFilter: filterState.freeFoodFilter,
        goingFilter: filterState.goingFilter,
        addedSince: filterState.addedSince,
        dateFilter: filterState.dateFilter,
      }),
    [
      filterState.selectedCategories,
      filterState.selectedLocations,
      filterState.selectedFoods,
      filterState.selectedDays,
      filterState.maxPrice,
      filterState.registration,
      filterState.selectedOrganizations,
      filterState.freeFoodFilter,
      filterState.goingFilter,
      filterState.addedSince,
      filterState.dateFilter,
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
    dayOptions,
    filteredEvents,
    filterCount,
    handleClearAllFilters,
    availableOrganizations,
  };
}
