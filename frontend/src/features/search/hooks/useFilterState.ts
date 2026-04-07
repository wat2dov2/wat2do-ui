import { useReducer, useCallback, useMemo, useState } from "react";
import type { FilterState } from "@/shared/types/filter.types";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
} from "@/features/search/api/filterService";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/shared/lib/openai";
import {
  filterStateReducer,
  initialState,
  type FilterStateReducerState,
} from "@/features/search/hooks/useFilterState.reducer";

/**
 * Hook for managing filter state
 * 
 * Refactored to use useReducer instead of multiple useState calls
 * - Reduces state management complexity
 * - Eliminates useEffect for JSON sync (now derived)
 * - Single source of truth for filter state
 * 
 * State boundaries: Local state only - no global state
 */
export function useFilterState(profileCompleted: boolean) {
  const [state, dispatch] = useReducer(filterStateReducer, initialState);

  // Derived JSON value - no useEffect needed
  const jsonValue = useMemo(() => {
    const filterState: FilterState = {
      searchQuery: state.searchQuery,
      categories: state.selectedCategories,
      locations: state.selectedLocations,
      foods: state.selectedFoods,
      days: state.selectedDays,
      priceRange: state.priceRange,
      dateRange: state.dateRange?.toISOString() || "",
      addedSince: state.addedSince?.toISOString() || "",
      requiresRegistration: state.requiresRegistration,
    };
    return serializeFiltersToJSON(filterState);
  }, [
    state.searchQuery,
    state.selectedCategories,
    state.selectedLocations,
    state.selectedFoods,
    state.selectedDays,
    state.priceRange,
    state.dateRange,
    state.addedSince,
    state.requiresRegistration,
  ]);

  // JSON error state (only for JSON editor)
  const [jsonError, setJsonError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Handle JSON editor changes
  const handleJsonChange = useCallback((value: string | undefined) => {
    if (!value) return;

    const { filters, error } = parseFiltersFromJSON(value);
    if (error) {
      setJsonError(error);
      return;
    }

    setJsonError("");
    dispatch({
      type: "SET_FILTER_STATE",
      payload: {
        searchQuery: filters.searchQuery || "",
        selectedCategories: filters.categories || [],
        selectedLocations: filters.locations || [],
        selectedFoods: filters.foods || [],
        selectedDays: filters.days || [],
        priceRange: filters.priceRange || { min: "", max: "" },
        dateRange:
          filters.dateRange && filters.dateRange.length > 0
            ? new Date(filters.dateRange)
            : undefined,
        addedSince:
          filters.addedSince && filters.addedSince.length > 0
            ? new Date(filters.addedSince)
            : undefined,
        requiresRegistration: filters.requiresRegistration || false,
      },
    });
  }, []);

  // AI filter generation handler
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    if (!profileCompleted) {
      setJsonError("Sign in to use AI filter generation.");
      return;
    }

    if (!isApiKeyConfigured()) {
      setJsonError(
        "AI generation is not available. Please check server configuration."
      );
      return;
    }

    setAiGenerating(true);
    setJsonError("");

    try {
      const newFilters = await generateFiltersWithAI(aiPrompt, () => {
        // Partial updates handled by the streaming callback
      });
      const generatedJson = serializeFiltersToJSON(newFilters);
      handleJsonChange(generatedJson);
    } catch (error) {
      setJsonError(
        error instanceof Error
          ? error.message
          : "Failed to generate filters. Please try again."
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, profileCompleted, handleJsonChange]);

  // Get current filter state
  const filterState = useMemo(
    (): FilterState => ({
      searchQuery: state.searchQuery,
      categories: state.selectedCategories,
      locations: state.selectedLocations,
      foods: state.selectedFoods,
      days: state.selectedDays,
      priceRange: state.priceRange,
      dateRange: state.dateRange?.toISOString() || "",
      addedSince: state.addedSince?.toISOString() || "",
      requiresRegistration: state.requiresRegistration,
    }),
    [state]
  );

  return {
    // Filter state
    searchQuery: state.searchQuery,
    setSearchQuery: (value: string) =>
      dispatch({ type: "SET_SEARCH_QUERY", payload: value }),
    selectedCategories: state.selectedCategories,
    setSelectedCategories: (value: string[]) =>
      dispatch({ type: "SET_CATEGORIES", payload: value }),
    selectedLocations: state.selectedLocations,
    setSelectedLocations: (value: string[]) =>
      dispatch({ type: "SET_LOCATIONS", payload: value }),
    selectedFoods: state.selectedFoods,
    setSelectedFoods: (value: string[]) =>
      dispatch({ type: "SET_FOODS", payload: value }),
    selectedDays: state.selectedDays,
    setSelectedDays: (value: string[]) =>
      dispatch({ type: "SET_DAYS", payload: value }),
    priceRange: state.priceRange,
    setPriceRange: (value: { min: string; max: string }) =>
      dispatch({ type: "SET_PRICE_RANGE", payload: value }),
    dateRange: state.dateRange,
    setDateRange: (value: Date | undefined) =>
      dispatch({ type: "SET_DATE_RANGE", payload: value }),
    addedSince: state.addedSince,
    setAddedSince: (value: Date | undefined) =>
      dispatch({ type: "SET_ADDED_SINCE", payload: value }),
    requiresRegistration: state.requiresRegistration,
    setRequiresRegistration: (value: boolean) =>
      dispatch({ type: "SET_REQUIRES_REGISTRATION", payload: value }),
    includeFoods: state.includeFoods,
    setIncludeFoods: (value: boolean) =>
      dispatch({ type: "SET_INCLUDE_FOODS", payload: value }),

    // Quick filters
    todayFilter: state.todayFilter,
    setTodayFilter: (value: boolean) =>
      dispatch({ type: "SET_TODAY_FILTER", payload: value }),
    thisWeekFilter: state.thisWeekFilter,
    setThisWeekFilter: (value: boolean) =>
      dispatch({ type: "SET_THIS_WEEK_FILTER", payload: value }),
    freeFilter: state.freeFilter,
    setFreeFilter: (value: boolean) =>
      dispatch({ type: "SET_FREE_FILTER", payload: value }),
    freeFoodFilter: state.freeFoodFilter,
    setFreeFoodFilter: (value: boolean) =>
      dispatch({ type: "SET_FREE_FOOD_FILTER", payload: value }),
    forYouFilter: state.forYouFilter,
    setForYouFilter: (value: boolean) =>
      dispatch({ type: "SET_FOR_YOU_FILTER", payload: value }),

    // Toggle functions
    toggleCategory: (cat: string) =>
      dispatch({ type: "TOGGLE_CATEGORY", payload: cat }),
    toggleLocation: (loc: string) =>
      dispatch({ type: "TOGGLE_LOCATION", payload: loc }),
    toggleDay: (day: string) =>
      dispatch({ type: "TOGGLE_DAY", payload: day }),
    toggleFood: (food: string) =>
      dispatch({ type: "TOGGLE_FOOD", payload: food }),

    // JSON editor (derived, no state needed)
    jsonValue,
    setJsonValue: handleJsonChange,
    jsonError,
    setJsonError,
    handleJsonChange,

    // AI generation
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,

    // Utilities
    clearAllFilters: () => dispatch({ type: "CLEAR_ALL_FILTERS" }),
    setFilterStateFromURL: (filters: FilterState) =>
      dispatch({
        type: "SET_FILTER_STATE",
        payload: {
          searchQuery: filters.searchQuery || "",
          selectedCategories: filters.categories || [],
          selectedLocations: filters.locations || [],
          selectedFoods: filters.foods || [],
          selectedDays: filters.days || [],
          priceRange: filters.priceRange || { min: "", max: "" },
          dateRange: filters.dateRange ? new Date(filters.dateRange) : undefined,
          addedSince: filters.addedSince ? new Date(filters.addedSince) : undefined,
          requiresRegistration: filters.requiresRegistration || false,
        },
      }),
    filterState,
  };
}
