import { useMemo, useDeferredValue } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { getEventCategories } from "@/shared/data/eventCategories";
import { availableDays, availableFoods } from "@/shared/constants/eventFilters";
import { translateCategory } from "@/shared/utils/event";
import type { Event } from "@/shared/types";

/**
 * Hook for search and filtering orchestration.
 *
 * - State management → useFilterState (shallow-subscribed to the store)
 * - Business logic → searchService
 * - UI state (pie menus, expanded sections) lives in components
 */
export interface UseSearchOptions {
  events: Event[];
  profileCompleted: boolean;
  savedEventIds: number[];
}

export function useSearch({
  events,
  profileCompleted,
  savedEventIds,
}: UseSearchOptions) {
  const { t } = useTranslation();

  const filterState = useFilterState(profileCompleted);

  // Clearing filters goes through the URL-backed action returned by
  // useFilterState so the address bar and store stay in lockstep.
  const handleClearAllFilters = filterState.clearAllFilters;

  // Defer the text query so typing stays responsive while filterEvents runs
  // on an interruptible boundary.
  const deferredSearchQuery = useDeferredValue(filterState.searchQuery);

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

  const freeFoodEventsCount = useMemo(
    () =>
      events.filter(
        (event) => (event.food ?? []).length > 0 && (event.price ?? 0) === 0,
      ).length,
    [events],
  );

  // Filter + sort events.
  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: deferredSearchQuery,
      savedFilter: filterState.savedFilter,
      freeFoodFilter: filterState.freeFoodFilter,
      selectedDays: filterState.selectedDays,
      priceRange: filterState.priceRange,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      profileCompleted,
      savedEventIds,
      selectedOrganizations: filterState.selectedOrganizations,
    });
    return sortEvents(filtered, { sortBy: filterState.sortBy, sortOrder: filterState.sortOrder });
  }, [
    events,
    deferredSearchQuery,
    filterState.freeFoodFilter,
    filterState.selectedDays,
    filterState.priceRange,
    filterState.selectedLocations,
    filterState.selectedFoods,
    filterState.selectedCategories,
    filterState.registration,
    profileCompleted,
    filterState.savedFilter,
    savedEventIds,
    filterState.sortBy,
    filterState.sortOrder,
    filterState.selectedOrganizations,
  ]);

  // Calculate filter count
  const filterCount = useMemo(
    () =>
      getFilterCounts({
        selectedCategories: filterState.selectedCategories,
        selectedLocations: filterState.selectedLocations,
        selectedFoods: filterState.selectedFoods,
        selectedDays: filterState.selectedDays,
        priceRange: filterState.priceRange,
        registration: filterState.registration,
        selectedOrganizations: filterState.selectedOrganizations,
      }),
    [
      filterState.selectedCategories,
      filterState.selectedLocations,
      filterState.selectedFoods,
      filterState.selectedDays,
      filterState.priceRange,
      filterState.registration,
      filterState.selectedOrganizations,
    ],
  );

  const categoryPieItems = useMemo(
    () =>
      getEventCategories().map((cat) => ({
        id: cat,
        label: translateCategory(cat, t),
        iconName: "Tag" as const,
      })),
    [t],
  );

  const foodPieItems = useMemo(
    () =>
      availableFoods.map((food) => {
        const translation = t(`foods.${food}`);
        // If translation returns the key itself (missing translation), use the food value
        const label = translation.startsWith("foods.") ? food : translation;
        return {
          id: food,
          label,
          iconName: "Utensils" as const,
        };
      }),
    [t],
  );

  const dayPieItems = useMemo(
    () =>
      availableDays.map((day) => {
        const key = `days.${day.toLowerCase()}`;
        const translated = t(key);
        return {
          id: day,
          label: translated !== key ? translated : day,
          iconName: "Calendar" as const,
        };
      }),
    [t],
  );

  const sortPieItems = useMemo(
    () => [
      { id: "date", label: t("filters.date"), iconName: "CalendarDays" as const },
      { id: "title", label: t("filters.title"), iconName: "Tag" as const },
      { id: "location", label: t("filters.location"), iconName: "MapPin" as const },
      { id: "price", label: t("filters.price"), iconName: "ArrowUpDown" as const },
    ],
    [t],
  );

  return {
    // Filter state from useFilterState
    ...filterState,

    // Pie menu items (data only; menu state lives inside VisualFilters)
    categoryPieItems,
    foodPieItems,
    dayPieItems,
    sortPieItems,

    // Filtered and sorted events
    filteredEvents,

    // Filter count
    filterCount,

    // Quick filter counts
    freeFoodEventsCount,

    // Clear all filters
    handleClearAllFilters,

    // Available organizations
    availableOrganizations,
  };
}
