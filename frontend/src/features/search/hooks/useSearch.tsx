import { useState, useMemo, useDeferredValue } from "react";
import { useTranslation } from "react-i18next";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { useSearchStore } from "@/features/search/store/search.store";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { EVENT_CATEGORIES as availableCategories } from "@/shared/constants/eventCategories";
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

  // Sort state (local to the page)
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Saved filter lives in the search store (it's a filter value).
  // Dropdown open/closed state is UI-only and lives in the modal store —
  // read directly by the page container and command palette.
  const savedFilter = useSearchStore((s) => s.savedFilter);
  const setSavedFilter = useSearchStore((s) => s.setSavedFilter);

  // clearAllFilters already wraps its set() in startTransition internally,
  // so we pass the stable store ref directly — no wrapper needed.
  const handleClearAllFilters = filterState.clearAllFilters;

  // Defer the text query so typing stays responsive while filterEvents runs
  // on an interruptible boundary.
  const deferredSearchQuery = useDeferredValue(filterState.searchQuery);

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
      savedFilter,
      freeFoodFilter: filterState.freeFoodFilter,
      selectedDays: filterState.selectedDays,
      priceRange: filterState.priceRange,
      selectedLocations: filterState.selectedLocations,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      registration: filterState.registration,
      profileCompleted,
      savedEventIds,
    });
    return sortEvents(filtered, { sortBy, sortOrder });
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
    savedFilter,
    savedEventIds,
    sortBy,
    sortOrder,
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
      }),
    [
      filterState.selectedCategories,
      filterState.selectedLocations,
      filterState.selectedFoods,
      filterState.selectedDays,
      filterState.priceRange,
      filterState.registration,
    ],
  );

  const categoryPieItems = useMemo(
    () =>
      availableCategories.map((cat) => ({
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

    // Sort state
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,

    // Saved filter
    savedFilter,
    setSavedFilter,

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
  };
}
