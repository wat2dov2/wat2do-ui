import { useCallback, useMemo, useState } from "react";
import type { FilterState } from "@/shared/types/filter.types";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
} from "@/features/search/api/filterService";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/shared/lib/openai";
import { useSearchStore } from "@/features/search/store/search.store";

/**
 * Hook for managing filter state
 *
 * Backed by the shared Zustand search store so that every call site
 * (AppContent, EventsPageContainer, CommandPalette) reads and writes
 * the same filter values. Derived/UI-only state (JSON editor, AI
 * prompt) stays local to this hook.
 */
export function useFilterState(profileCompleted: boolean) {
  // ── Shared filter values from store ─────────────────────────────
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);
  const selectedCategories = useSearchStore((s) => s.selectedCategories);
  const setSelectedCategories = useSearchStore((s) => s.setSelectedCategories);
  const selectedLocations = useSearchStore((s) => s.selectedLocations);
  const setSelectedLocations = useSearchStore((s) => s.setSelectedLocations);
  const selectedFoods = useSearchStore((s) => s.selectedFoods);
  const setSelectedFoods = useSearchStore((s) => s.setSelectedFoods);
  const selectedDays = useSearchStore((s) => s.selectedDays);
  const setSelectedDays = useSearchStore((s) => s.setSelectedDays);
  const priceRange = useSearchStore((s) => s.priceRange);
  const setPriceRange = useSearchStore((s) => s.setPriceRange);
  const dateRange = useSearchStore((s) => s.dateRange);
  const setDateRange = useSearchStore((s) => s.setDateRange);
  const addedSince = useSearchStore((s) => s.addedSince);
  const setAddedSince = useSearchStore((s) => s.setAddedSince);
  const requiresRegistration = useSearchStore((s) => s.requiresRegistration);
  const setRequiresRegistration = useSearchStore((s) => s.setRequiresRegistration);
  const includeFoods = useSearchStore((s) => s.includeFoods);
  const setIncludeFoods = useSearchStore((s) => s.setIncludeFoods);
  const todayFilter = useSearchStore((s) => s.todayFilter);
  const setTodayFilter = useSearchStore((s) => s.setTodayFilter);
  const thisWeekFilter = useSearchStore((s) => s.thisWeekFilter);
  const setThisWeekFilter = useSearchStore((s) => s.setThisWeekFilter);
  const freeFilter = useSearchStore((s) => s.freeFilter);
  const setFreeFilter = useSearchStore((s) => s.setFreeFilter);
  const freeFoodFilter = useSearchStore((s) => s.freeFoodFilter);
  const setFreeFoodFilter = useSearchStore((s) => s.setFreeFoodFilter);
  const forYouFilter = useSearchStore((s) => s.forYouFilter);
  const setForYouFilter = useSearchStore((s) => s.setForYouFilter);
  const toggleCategory = useSearchStore((s) => s.toggleCategory);
  const toggleLocation = useSearchStore((s) => s.toggleLocation);
  const toggleDay = useSearchStore((s) => s.toggleDay);
  const toggleFood = useSearchStore((s) => s.toggleFood);
  const clearAllFilters = useSearchStore((s) => s.clearAllFilters);
  const setFilterStateFromURL = useSearchStore((s) => s.setFilterStateFromURL);

  // Derived JSON value - no useEffect needed
  const jsonValue = useMemo(() => {
    const filterState: FilterState = {
      searchQuery,
      categories: selectedCategories,
      locations: selectedLocations,
      foods: selectedFoods,
      days: selectedDays,
      priceRange,
      dateRange: dateRange?.toISOString() || "",
      addedSince: addedSince?.toISOString() || "",
      requiresRegistration,
    };
    return serializeFiltersToJSON(filterState);
  }, [
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    dateRange,
    addedSince,
    requiresRegistration,
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
    setFilterStateFromURL({
      searchQuery: filters.searchQuery || "",
      categories: filters.categories || [],
      locations: filters.locations || [],
      foods: filters.foods || [],
      days: filters.days || [],
      priceRange: filters.priceRange || { min: "", max: "" },
      dateRange:
        filters.dateRange && filters.dateRange.length > 0
          ? filters.dateRange
          : "",
      addedSince:
        filters.addedSince && filters.addedSince.length > 0
          ? filters.addedSince
          : "",
      requiresRegistration: filters.requiresRegistration || false,
    });
  }, [setFilterStateFromURL]);

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
      console.error("AI filter generation failed:", error);
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
      searchQuery,
      categories: selectedCategories,
      locations: selectedLocations,
      foods: selectedFoods,
      days: selectedDays,
      priceRange,
      dateRange: dateRange?.toISOString() || "",
      addedSince: addedSince?.toISOString() || "",
      requiresRegistration,
    }),
    [
      searchQuery,
      selectedCategories,
      selectedLocations,
      selectedFoods,
      selectedDays,
      priceRange,
      dateRange,
      addedSince,
      requiresRegistration,
    ]
  );

  return {
    // Filter state
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    selectedLocations,
    setSelectedLocations,
    selectedFoods,
    setSelectedFoods,
    selectedDays,
    setSelectedDays,
    priceRange,
    setPriceRange,
    dateRange,
    setDateRange,
    addedSince,
    setAddedSince,
    requiresRegistration,
    setRequiresRegistration,
    includeFoods,
    setIncludeFoods,

    // Quick filters
    todayFilter,
    setTodayFilter,
    thisWeekFilter,
    setThisWeekFilter,
    freeFilter,
    setFreeFilter,
    freeFoodFilter,
    setFreeFoodFilter,
    forYouFilter,
    setForYouFilter,

    // Toggle functions
    toggleCategory,
    toggleLocation,
    toggleDay,
    toggleFood,

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
    clearAllFilters,
    setFilterStateFromURL,
    filterState,
  };
}
