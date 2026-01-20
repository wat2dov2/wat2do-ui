import { useState, useMemo, useCallback } from "react";
import type { FilterState } from "@/types";

/**
 * Custom hook for managing filter state
 * Follows Vercel React best practices for state management
 */
export function useFilters() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedFoods, setSelectedFoods] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<{ min: string; max: string }>({
    min: "",
    max: "",
  });
  const [dateRange, setDateRange] = useState<Date | undefined>(undefined);
  const [addedSince, setAddedSince] = useState<Date | undefined>(undefined);
  const [requiresRegistration, setRequiresRegistration] = useState(false);
  
  // Quick filters
  const [todayFilter, setTodayFilter] = useState(false);
  const [freeFilter, setFreeFilter] = useState(false);
  const [freeFoodFilter, setFreeFoodFilter] = useState(false);
  const [forYouFilter, setForYouFilter] = useState(false);
  const [savedFilter, setSavedFilter] = useState(false);

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
    setSavedFilter(false);
  }, []);

  const filterState: FilterState = useMemo(
    () => ({
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
    // State
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    dateRange,
    addedSince,
    requiresRegistration,
    todayFilter,
    freeFilter,
    freeFoodFilter,
    forYouFilter,
    savedFilter,
    // Setters
    setSearchQuery,
    setSelectedCategories,
    setSelectedLocations,
    setSelectedFoods,
    setSelectedDays,
    setPriceRange,
    setDateRange,
    setAddedSince,
    setRequiresRegistration,
    setTodayFilter,
    setFreeFilter,
    setFreeFoodFilter,
    setForYouFilter,
    setSavedFilter,
    // Computed
    filterState,
    clearAllFilters,
  };
}
