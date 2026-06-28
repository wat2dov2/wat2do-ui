import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
  storeStatesToFilterState,
  generatedFilterStateToFilterState,
  normalizeFilterState,
  writeFiltersToSearchParams,
  EMPTY_FILTER_STATE,
} from "@/features/search/api/filterService";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/shared/lib/openai";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";
import { useSearchStore } from "@/features/search/store/search.store";
import type { FilterState } from "@/shared/types";

type FilterStateUpdater = FilterState | ((current: FilterState) => FilterState);

function useCurrentFilterState(): FilterState {
  return useSearchStore(
    useShallow((s) =>
      storeStatesToFilterState({
        searchQuery: s.searchQuery,
        selectedCategories: s.selectedCategories,
        selectedLocations: s.selectedLocations,
        selectedFoods: s.selectedFoods,
        selectedDays: s.selectedDays,
        priceRange: s.priceRange,
        registration: s.registration,
        selectedOrganizations: s.selectedOrganizations,
        freeFoodFilter: s.freeFoodFilter,
        savedFilter: s.savedFilter,
        sortBy: s.sortBy,
        sortOrder: s.sortOrder,
        addedWithin24h: s.addedWithin24h,
      }),
    ),
  );
}

export function useFilterUrlActions() {
  const currentFilterState = useCurrentFilterState();
  const [searchParams, setSearchParams] = useMutableSearchParams();

  const setFilterState = useCallback(
    (updater: FilterStateUpdater) => {
      const nextFilters = normalizeFilterState(
        typeof updater === "function" ? updater(currentFilterState) : updater,
      );
      const nextParams = new URLSearchParams(searchParams.toString());
      setSearchParams(writeFiltersToSearchParams(nextParams, nextFilters), {
        replace: true,
      });
    },
    [currentFilterState, searchParams, setSearchParams],
  );

  const updateFilterState = useCallback(
    (patch: Partial<FilterState>) => {
      setFilterState((current) => normalizeFilterState({ ...current, ...patch }));
    },
    [setFilterState],
  );

  const toggleFilterValue = useCallback(
    (key: "categories" | "locations" | "foods" | "days" | "organizations", value: string) => {
      setFilterState((current) => {
        const currentValues = current[key];
        return {
          ...current,
          [key]: currentValues.includes(value)
            ? currentValues.filter((item) => item !== value)
            : [...currentValues, value],
        };
      });
    },
    [setFilterState],
  );

  const clearAllFilters = useCallback(() => {
    setFilterState(EMPTY_FILTER_STATE);
  }, [setFilterState]);

  return {
    setFilterState,
    updateFilterState,
    toggleFilterValue,
    clearAllFilters,
  };
}

/**
 * Hook for managing filter state
 *
 * Backed by the shared Zustand search store so that every call site
 * (App Router pages, EventsPageContainer, CommandPalette) reads and writes
 * the same filter values. Derived/UI-only state (JSON editor, AI
 * prompt) stays local to this hook.
 */
export function useFilterState(profileCompleted: boolean) {
  const { t } = useTranslation();

  // ── Shared filter values from the store (single shallow subscription) ──
  const {
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    registration,
    freeFoodFilter,
    selectedOrganizations,
    savedFilter,
    sortBy,
    sortOrder,
    addedWithin24h,
  } = useSearchStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      selectedCategories: s.selectedCategories,
      selectedLocations: s.selectedLocations,
      selectedFoods: s.selectedFoods,
      selectedDays: s.selectedDays,
      priceRange: s.priceRange,
      registration: s.registration,
      freeFoodFilter: s.freeFoodFilter,
      selectedOrganizations: s.selectedOrganizations,
      savedFilter: s.savedFilter,
      sortBy: s.sortBy,
      sortOrder: s.sortOrder,
      addedWithin24h: s.addedWithin24h,
    })),
  );
  const {
    setFilterState,
    updateFilterState,
    toggleFilterValue,
    clearAllFilters,
  } = useFilterUrlActions();

  const setSearchQuery = useCallback(
    (value: string) => updateFilterState({ searchQuery: value }),
    [updateFilterState],
  );
  const setSelectedCategories = useCallback(
    (value: string[]) => updateFilterState({ categories: value }),
    [updateFilterState],
  );
  const setSelectedLocations = useCallback(
    (value: string[]) => updateFilterState({ locations: value }),
    [updateFilterState],
  );
  const setSelectedFoods = useCallback(
    (value: string[]) => updateFilterState({ foods: value }),
    [updateFilterState],
  );
  const setSelectedDays = useCallback(
    (value: string[]) => updateFilterState({ days: value }),
    [updateFilterState],
  );
  const setSelectedOrganizations = useCallback(
    (value: string[]) => updateFilterState({ organizations: value }),
    [updateFilterState],
  );
  const setPriceRange = useCallback(
    (value: { min: string; max: string }) =>
      updateFilterState({ priceRange: value }),
    [updateFilterState],
  );
  const setRegistration = useCallback(
    (value: boolean) => updateFilterState({ registration: value }),
    [updateFilterState],
  );
  const setFreeFoodFilter = useCallback(
    (value: boolean) => updateFilterState({ freeFood: value }),
    [updateFilterState],
  );
  const setSavedFilter = useCallback(
    (value: boolean) => updateFilterState({ saved: value }),
    [updateFilterState],
  );
  const setAddedWithin24h = useCallback(
    (value: boolean) => updateFilterState({ addedWithin24h: value }),
    [updateFilterState],
  );
  const setSortBy = useCallback(
    (value: string) => updateFilterState({ sortBy: value }),
    [updateFilterState],
  );
  const setSortOrder = useCallback(
    (value: "asc" | "desc") => updateFilterState({ sortOrder: value }),
    [updateFilterState],
  );
  const setSort = useCallback(
    (sortBy: string, sortOrder: "asc" | "desc") =>
      updateFilterState({ sortBy, sortOrder }),
    [updateFilterState],
  );

  // Per-filter toggle adapters — stable refs derived from the single
  // URL action so downstream props don't churn.
  const toggleCategory = useCallback(
    (cat: string) => toggleFilterValue("categories", cat),
    [toggleFilterValue],
  );
  const toggleLocation = useCallback(
    (loc: string) => toggleFilterValue("locations", loc),
    [toggleFilterValue],
  );
  const toggleFood = useCallback(
    (food: string) => toggleFilterValue("foods", food),
    [toggleFilterValue],
  );
  const toggleDay = useCallback(
    (day: string) => toggleFilterValue("days", day),
    [toggleFilterValue],
  );
  const toggleOrganization = useCallback(
    (org: string) => toggleFilterValue("organizations", org),
    [toggleFilterValue],
  );

  // Derived JSON value - no useEffect needed.
  // The key rename (selectedCategories → categories, etc.) is documented on
  // storeStatesToFilterState in filterService.ts.
  const jsonValue = useMemo(
    () =>
      serializeFiltersToJSON(
        storeStatesToFilterState({
          searchQuery,
          selectedCategories,
          selectedLocations,
          selectedFoods,
          selectedDays,
          priceRange,
          registration,
          selectedOrganizations,
          freeFoodFilter,
          savedFilter,
          sortBy,
          sortOrder,
          addedWithin24h,
        }),
      ),
    [
      searchQuery,
      selectedCategories,
      selectedLocations,
      selectedFoods,
      selectedDays,
      priceRange,
      registration,
      selectedOrganizations,
      freeFoodFilter,
      savedFilter,
      sortBy,
      sortOrder,
      addedWithin24h,
    ],
  );

  // JSON editor + AI state (only the dropdown cares; kept local)
  const [jsonError, setJsonError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Handle JSON editor changes
  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;

      const { filters, error } = parseFiltersFromJSON(value);
      if (error) {
        setJsonError(error);
        return;
      }

      setJsonError("");
      setFilterState({
        searchQuery: filters.searchQuery || "",
        categories: filters.categories || [],
        locations: filters.locations || [],
        foods: filters.foods || [],
        days: filters.days || [],
        priceRange: filters.priceRange || { min: "", max: "" },
        registration: filters.registration || false,
        organizations: filters.organizations || [],
        freeFood: filters.freeFood || false,
        saved: filters.saved || false,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        addedWithin24h: filters.addedWithin24h || false,
      });
    },
    [setFilterState],
  );

  // AI filter generation handler
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    if (!profileCompleted) {
      setJsonError(t("filters.aiSignInRequired"));
      return;
    }

    if (!isApiKeyConfigured()) {
      setJsonError(t("filters.aiNotAvailable"));
      return;
    }

    setAiGenerating(true);
    setJsonError("");

    try {
      const newFilters = await generateFiltersWithAI(aiPrompt, () => {
        // Partial updates handled by the streaming callback
      });
      const generatedJson = serializeFiltersToJSON(
        generatedFilterStateToFilterState(newFilters),
      );
      handleJsonChange(generatedJson);
    } catch (error) {
      console.error("AI filter generation failed:", error);
      setJsonError(
        error instanceof Error ? error.message : t("filters.aiGenerateFailed"),
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, profileCompleted, handleJsonChange, t]);

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
    registration,
    setRegistration,
    selectedOrganizations,
    setSelectedOrganizations,

    // Quick filters (only the ones wired to UI)
    freeFoodFilter,
    setFreeFoodFilter,
    savedFilter,
    setSavedFilter,
    addedWithin24h,
    setAddedWithin24h,

    // Toggle functions
    toggleCategory,
    toggleLocation,
    toggleDay,
    toggleFood,
    toggleOrganization,

    // JSON editor (derived, no state needed)
    jsonValue,
    jsonError,
    handleJsonChange,

    // AI generation
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,

    // Utilities
    clearAllFilters,

    // Sort
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    setSort,
  };
}
