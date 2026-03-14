import { useState, useCallback, useMemo, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, Calendar, CalendarDays, ArrowUpDown } from "lucide-react";
import { useFilterState } from "@/features/search/hooks/useFilterState";
import { usePieMenu } from "@/shared/hooks/usePieMenu";
import { filterEvents, sortEvents, getFilterCounts } from "@/features/search/api/searchService";
import { availableCategories, availableLocations, availableDays, availableFoods } from "@/features/events/data/events";
import type { Event } from "@/shared/types";

/**
 * Hook for search and filtering orchestration
 * 
 * Refactored to:
 * - Remove UI state (expanded sections, popups) - moved to components
 * - Remove useEffect for click outside - handled by components
 * - Focus on business logic only
 * 
 * Separation of concerns:
 * - State management → useFilterState
 * - Business logic → searchService
 * - UI orchestration → components (not this hook)
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
  
  // Use base filter state hook
  const filterState = useFilterState(profileCompleted);

  // Sort states (business logic, not UI)
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Saved filter for quick filter (business logic)
  const [savedFilter, setSavedFilter] = useState(false);

  // Filter dropdown state (UI state - but needed for command palette integration)
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Clear all filters handler (use startTransition to keep UI responsive)
  const handleClearAllFilters = useCallback(() => {
    startTransition(() => {
      filterState.clearAllFilters();
      setSavedFilter(false);
    });
  }, [filterState]);

  const todayEventsCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return events.filter((event) => {
      const raw = event.dtstart_utc || event.eventDate || event.date;
      if (!raw) return false;
      const d = new Date(raw);
      return !isNaN(d.getTime()) && d >= today && d < tomorrow;
    }).length;
  }, [events]);

  const freeFoodEventsCount = useMemo(() => {
    return events.filter((event) => ((event.food ?? []).length > 0) && (event.price ?? 0) === 0)
      .length;
  }, [events]);

  // Filter events using the service
  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filterState.searchQuery,
      savedFilter,
      todayFilter: filterState.todayFilter,
      freeFilter: filterState.freeFilter,
      freeFoodFilter: filterState.freeFoodFilter,
      forYouFilter: filterState.forYouFilter,
      thisWeekFilter: filterState.thisWeekFilter,
      selectedDays: filterState.selectedDays,
      priceRange: filterState.priceRange,
      selectedLocations: filterState.selectedLocations,
      includeFoods: filterState.includeFoods,
      selectedFoods: filterState.selectedFoods,
      selectedCategories: filterState.selectedCategories,
      requiresRegistration: filterState.requiresRegistration,
      profileCompleted,
      savedEventIds,
    });

    // Sort events
    return sortEvents(filtered, { sortBy, sortOrder });
  }, [
    events,
    filterState.searchQuery,
    filterState.todayFilter,
    filterState.freeFilter,
    filterState.freeFoodFilter,
    filterState.forYouFilter,
    filterState.thisWeekFilter,
    filterState.selectedDays,
    filterState.priceRange,
    filterState.selectedLocations,
    filterState.includeFoods,
    filterState.selectedFoods,
    filterState.selectedCategories,
    filterState.requiresRegistration,
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
        dateRange: filterState.dateRange,
        requiresRegistration: filterState.requiresRegistration,
      }),
    [
      filterState.selectedCategories,
      filterState.selectedLocations,
      filterState.selectedFoods,
      filterState.selectedDays,
      filterState.priceRange,
      filterState.dateRange,
      filterState.requiresRegistration,
    ]
  );

  // Memoized pie menu items
  const getCategoryTranslationKey = (cat: string): string => {
    const categoryMap: Record<string, string> = {
      "Events": "navigation.events",
      "Clubs": "navigation.clubs",
      "Academic": "categories.academic",
      "Religious": "categories.religious",
      "Cultural": "categories.cultural",
      "Social & Games": "categories.socialGames",
      "Sports": "categories.sports",
      "Career": "categories.career",
    };
    return categoryMap[cat] || `categories.${cat}`;
  };

  const categoryPieItems = useMemo(
    () =>
      availableCategories.map((cat) => ({
        id: cat,
        label: t(getCategoryTranslationKey(cat)) || cat,
        icon: <Tag className="w-4 h-4" />,
      })),
    [t]
  );

  const locationPieItems = useMemo(
    () =>
      availableLocations.map((loc) => ({
        id: loc,
        label: t(`locations.${loc}`) || loc,
        icon: <MapPin className="w-4 h-4" />,
      })),
    [t]
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
          icon: <Utensils className="w-4 h-4" />,
        };
      }),
    [t]
  );

  const dayPieItems = useMemo(
    () =>
      availableDays.map((day) => ({
        id: day,
        label: t(`days.${day.toLowerCase()}`) || day,
        icon: <Calendar className="w-4 h-4" />,
      })),
    [t]
  );

  const sortPieItems = useMemo(
    () => [
      {
        id: "date",
        label: t("filters.date"),
        icon: <CalendarDays className="w-4 h-4" />,
      },
      {
        id: "title",
        label: t("filters.title"),
        icon: <Tag className="w-4 h-4" />,
      },
      {
        id: "location",
        label: t("filters.location"),
        icon: <MapPin className="w-4 h-4" />,
      },
      {
        id: "price",
        label: t("filters.price"),
        icon: <ArrowUpDown className="w-4 h-4" />,
      },
    ],
    [t]
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

    // Filter dropdown (UI state - needed for command palette)
    showFilterDropdown,
    setShowFilterDropdown,

    // Pie menus (UI state - but needed for pie menu functionality)
    categoryPieMenu: usePieMenu(),
    locationPieMenu: usePieMenu(),
    foodPieMenu: usePieMenu(),
    dayPieMenu: usePieMenu(),
    sortPieMenu: usePieMenu(),

    // Pie menu items
    categoryPieItems,
    locationPieItems,
    foodPieItems,
    dayPieItems,
    sortPieItems,

    // Filtered and sorted events
    filteredEvents,

    // Filter count
    filterCount,

    // Quick filter counts
    todayEventsCount,
    freeFoodEventsCount,

    // Clear all filters
    handleClearAllFilters,
  };
}
