import { useState, useEffect, useCallback, useMemo } from "react";
import type { FilterState } from "@/types";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
} from "@/services/filterService";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/lib/openai";

/**
 * Custom hook for managing filters
 */
export function useFilters(profileCompleted: boolean) {
  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "Events",
    "Clubs",
    "Academic",
  ]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([
    "LAX",
    "Pollock",
    "TCF 1",
  ]);
  const [selectedFoods, setSelectedFoods] = useState<string[]>([
    "Snacks",
    "Pizza",
  ]);
  const [selectedDays, setSelectedDays] = useState<string[]>([
    "Monday",
    "Wednesday",
    "Thursday",
  ]);
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [dateRange, setDateRange] = useState<Date | undefined>(undefined);
  const [addedSince, setAddedSince] = useState<Date | undefined>(undefined);
  const [requiresRegistration, setRequiresRegistration] = useState(false);

  // Quick filter states
  const [todayFilter, setTodayFilter] = useState(false);
  const [thisWeekFilter, setThisWeekFilter] = useState(false);
  const [freeFilter, setFreeFilter] = useState(false);
  const [freeFoodFilter, setFreeFoodFilter] = useState(false);
  const [forYouFilter, setForYouFilter] = useState(false);

  // Food filter states
  const [includeFoods, setIncludeFoods] = useState(false);

  // JSON Editor state
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

  // AI prompt state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Update JSON when filters change
  useEffect(() => {
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
    setJsonValue(serializeFiltersToJSON(filterState));
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

  // Handle JSON editor changes
  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      setJsonValue(value);

      const { filters, error } = parseFiltersFromJSON(value);
      if (error) {
        setJsonError(error);
        return;
      }

      setJsonError("");
      setSearchQuery(filters.searchQuery || "");
      setSelectedCategories(filters.categories || []);
      setSelectedLocations(filters.locations || []);
      setSelectedFoods(filters.foods || []);
      setSelectedDays(filters.days || []);
      setPriceRange(filters.priceRange || { min: "", max: "" });
      setDateRange(
        filters.dateRange && filters.dateRange.length > 0
          ? new Date(filters.dateRange)
          : undefined
      );
      setAddedSince(
        filters.addedSince && filters.addedSince.length > 0
          ? new Date(filters.addedSince)
          : undefined
      );
      setRequiresRegistration(filters.requiresRegistration || false);
    },
    []
  );

  // AI filter generation handler
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    // Check if user is signed in
    if (!profileCompleted) {
      setJsonError("Sign in to use AI filter generation.");
      return;
    }

    // Check if API key is configured
    if (!isApiKeyConfigured()) {
      setJsonError(
        "OpenAI API key not configured. Add your key in src/lib/openai.ts"
      );
      return;
    }

    setAiGenerating(true);
    setJsonError("");

    try {
      const newFilters = await generateFiltersWithAI(aiPrompt, (partialJson) => {
        // Update the editor with partial JSON as it streams in
        setJsonValue(partialJson);
      });
      // Apply the final parsed filters
      const generatedJson = serializeFiltersToJSON(newFilters);
      setJsonValue(generatedJson);
      handleJsonChange(generatedJson);
    } catch (error) {
      console.error("AI generation error:", error);
      setJsonError(
        error instanceof Error
          ? error.message
          : "Failed to generate filters. Please try again."
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, profileCompleted, handleJsonChange]);

  // Filter toggle functions
  const toggleCategory = useCallback(
    (cat: string) =>
      setSelectedCategories((prev) =>
        prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
      ),
    []
  );

  const toggleLocation = useCallback(
    (loc: string) =>
      setSelectedLocations((prev) =>
        prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
      ),
    []
  );

  const toggleDay = useCallback(
    (day: string) =>
      setSelectedDays((prev) =>
        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
      ),
    []
  );

  const toggleFood = useCallback(
    (food: string) =>
      setSelectedFoods((prev) =>
        prev.includes(food) ? prev.filter((f) => f !== food) : [...prev, food]
      ),
    []
  );

  // Clear all filters handler
  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedCategories([]);
    setSelectedLocations([]);
    setSelectedFoods([]);
    setSelectedDays([]);
    setPriceRange({ min: "", max: "" });
    setDateRange(undefined);
    setAddedSince(undefined);
    setRequiresRegistration(false);
    setTodayFilter(false);
    setFreeFilter(false);
    setFreeFoodFilter(false);
    setForYouFilter(false);
    setThisWeekFilter(false);
  }, []);

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

    // JSON editor
    jsonValue,
    setJsonValue,
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
    filterState,
  };
}
