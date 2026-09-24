import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents } from "@/features/search/api/searchService";
import { getFilterCounts } from "@/shared/utils/filter";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { availableDays } from "@/shared/constants/eventFilters";
import { translateCategory } from "@/shared/utils/event";
import type { Event } from "@/shared/types";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

/**
 * Search/filter orchestration: useFilterState for store state, searchService for logic.
 * UI expand/collapse state lives in components.
 */
interface UseSearchOptions {
  events: Event[];
  goingEventIds: number[];
  goingCounts: Readonly<Record<string, { going_count: number }>> | null;
}

export function useSearch({
  events,
  goingEventIds,
  goingCounts,
}: UseSearchOptions) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const { t } = useTranslation();
  const { event_categories: eventCategories } = useAppConstants();

  const filterState = useFilterState();

  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filterState.searchQuery,
      goingFilter: filterState.goingFilter,
      hasFoodFilter: filterState.hasFoodFilter,
      selectedDays: filterState.selectedDays,
      minPrice: filterState.minPrice,
      maxPrice: filterState.maxPrice,
      minGoing: filterState.minGoing,
      eventFormat: filterState.eventFormat,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      goingEventIds,
      selectedClubs: filterState.selectedClubs,
      addedSince: filterState.addedSince,
      dateFilter: filterState.dateFilter,
      customDate: filterState.customDate,
    }, getSchoolTimezone, goingCounts ?? {});
    return sortEvents(filtered, { sortBy: filterState.sortBy, sortOrder: filterState.sortOrder });
  }, [
    events,
    getSchoolTimezone,
    filterState.searchQuery,
    filterState.hasFoodFilter,
    filterState.selectedDays,
    filterState.minPrice,
    filterState.maxPrice,
    filterState.minGoing,
    filterState.eventFormat,
    goingCounts,
    filterState.selectedLocations,
    filterState.selectedFoods,
    filterState.selectedCategories,
    filterState.registration,
    filterState.goingFilter,
    goingEventIds,
    filterState.sortBy,
    filterState.sortOrder,
    filterState.selectedClubs,
    filterState.addedSince,
    filterState.dateFilter,
    filterState.customDate,
  ]);

  const filterCount = getFilterCounts(filterState);

  const categoryOptions = useMemo(
    () =>
      eventCategories.map((cat) => ({
        id: cat,
        label: translateCategory(cat, t),
      })),
    [eventCategories, t],
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
  };
}
