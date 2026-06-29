import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { getEventCategories } from "@/shared/data/eventCategories";
import { availableDays, availableFoods } from "@/shared/constants/eventFilters";
import { translateCategory } from "@/shared/utils/event";
import type { Event, ViewMode } from "@/shared/types";

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
  viewMode: ViewMode;
}

export function useSearch({
  events,
  profileCompleted,
  savedEventIds,
  viewMode,
}: UseSearchOptions) {
  const { t } = useTranslation();

  const filterState = useFilterState(profileCompleted);

  // Clearing filters goes through the URL-backed action returned by
  // useFilterState so the address bar and store stay in lockstep.
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

  // Filter + sort events.
  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filterState.searchQuery,
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
      addedWithin24h: filterState.addedWithin24h,
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
    filterState.savedFilter,
    savedEventIds,
    filterState.sortBy,
    filterState.sortOrder,
    filterState.selectedOrganizations,
    filterState.addedWithin24h,
  ]);

  // Calculate filter count
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
        savedFilter: filterState.savedFilter,
        sortBy: filterState.sortBy,
        sortOrder: filterState.sortOrder,
        addedWithin24h: filterState.addedWithin24h,
        viewMode,
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
      filterState.savedFilter,
      filterState.sortBy,
      filterState.sortOrder,
      filterState.addedWithin24h,
      viewMode,
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
      { id: "added_at", label: t("events.newlyAdded"), iconName: "Sparkles" as const },
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

    // Clear all filters
    handleClearAllFilters,

    // Available organizations
    availableOrganizations,
  };
}
