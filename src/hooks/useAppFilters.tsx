import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, Calendar, CalendarDays, ArrowUpDown } from "lucide-react";
import { useFilters } from "./useFilters";
import { usePieMenu } from "./usePieMenu";
import { filterEvents, sortEvents, getFilterCounts } from "@/services/eventService";
import { availableCategories, availableLocations, availableDays, availableFoods } from "@/data/events";
import type { Event } from "@/types";

interface UseAppFiltersOptions {
  events: Event[];
  profileCompleted: boolean;
  savedEventIds: number[];
}

/**
 * Hook for managing filters in the App component
 * Extends useFilters with App-specific functionality like sorting, expanded sections, and pie menus
 */
export function useAppFilters({
  events,
  profileCompleted,
  savedEventIds,
}: UseAppFiltersOptions) {
  const { t } = useTranslation();
  
  // Use base filters hook
  const filters = useFilters(profileCompleted);

  // Sort states
  const [sortBy, setSortBy] = useState<string>("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Saved filter for quick filter
  const [savedFilter, setSavedFilter] = useState(false);

  // Calendar popup states
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [showAddedSincePicker, setShowAddedSincePicker] = useState(false);

  // Filter dropdown state
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    dateRange: false,
    location: false,
    priceRange: false,
    food: false,
    dayOfWeek: false,
    addedSince: false,
    registration: false,
    sort: false,
  });

  // Pie menu hooks
  const categoryPieMenu = usePieMenu();
  const locationPieMenu = usePieMenu();
  const foodPieMenu = usePieMenu();
  const dayPieMenu = usePieMenu();
  const sortPieMenu = usePieMenu();

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isCalendar = target.closest("[data-calendar-picker]");
      const isTrigger = target.closest("button[data-calendar-trigger]");
      const isFilterDropdown = target.closest("[data-filter-dropdown]");
      const isFilterTrigger = target.closest("[data-filter-trigger]");
      const isPieMenu = target.closest("[data-pie-menu]");

      if (!isCalendar && !isTrigger) {
        setShowDateRangePicker(false);
        setShowAddedSincePicker(false);
      }

      // Don't close filter dropdown when clicking on pie menu
      if (!isFilterDropdown && !isFilterTrigger && !isPieMenu) {
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Section toggle
  const toggleSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    []
  );

  // Clear all filters handler
  const handleClearAllFilters = useCallback(() => {
    filters.clearAllFilters();
    setSavedFilter(false);
  }, [filters]);

  // Calculate counts for quick filters
  const todayEventsCount = useMemo(() => {
    return events.filter((event) => event.date === "Today").length;
  }, [events]);

  const freeFoodEventsCount = useMemo(() => {
    return events.filter((event) => (event.food?.length || 0) > 0 && (event.price || 0) === 0)
      .length;
  }, [events]);

  // Filter events using the service
  const filteredEvents = useMemo(() => {
    const filtered = filterEvents(events, {
      searchQuery: filters.searchQuery,
      savedFilter,
      todayFilter: filters.todayFilter,
      freeFilter: filters.freeFilter,
      freeFoodFilter: filters.freeFoodFilter,
      forYouFilter: filters.forYouFilter,
      thisWeekFilter: filters.thisWeekFilter,
      selectedDays: filters.selectedDays,
      priceRange: filters.priceRange,
      selectedLocations: filters.selectedLocations,
      includeFoods: filters.includeFoods,
      selectedFoods: filters.selectedFoods,
      selectedCategories: filters.selectedCategories,
      requiresRegistration: filters.requiresRegistration,
      profileCompleted,
      savedEventIds,
    });

    // Sort events
    return sortEvents(filtered, { sortBy, sortOrder });
  }, [
    events,
    filters.searchQuery,
    filters.todayFilter,
    filters.freeFilter,
    filters.freeFoodFilter,
    filters.forYouFilter,
    filters.thisWeekFilter,
    filters.selectedDays,
    filters.priceRange,
    filters.selectedLocations,
    filters.includeFoods,
    filters.selectedFoods,
    filters.selectedCategories,
    filters.requiresRegistration,
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
        selectedCategories: filters.selectedCategories,
        selectedLocations: filters.selectedLocations,
        selectedFoods: filters.selectedFoods,
        selectedDays: filters.selectedDays,
        priceRange: filters.priceRange,
        dateRange: filters.dateRange,
        requiresRegistration: filters.requiresRegistration,
      }),
    [
      filters.selectedCategories,
      filters.selectedLocations,
      filters.selectedFoods,
      filters.selectedDays,
      filters.priceRange,
      filters.dateRange,
      filters.requiresRegistration,
    ]
  );

  // Memoized pie menu items
  const categoryPieItems = useMemo(
    () =>
      availableCategories.map((cat) => ({
        id: cat,
        label: t(`categories.${cat}`) || cat,
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
      availableFoods.map((food) => ({
        id: food,
        label: t(`foods.${food}`) || food,
        icon: <Utensils className="w-4 h-4" />,
      })),
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
    // Filter state from useFilters
    ...filters,

    // Sort state
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,

    // Saved filter
    savedFilter,
    setSavedFilter,

    // Calendar popup states
    showDateRangePicker,
    setShowDateRangePicker,
    showAddedSincePicker,
    setShowAddedSincePicker,

    // Filter dropdown
    showFilterDropdown,
    setShowFilterDropdown,

    // Expanded sections
    expandedSections,
    toggleSection,

    // Pie menus
    categoryPieMenu,
    locationPieMenu,
    foodPieMenu,
    dayPieMenu,
    sortPieMenu,

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
