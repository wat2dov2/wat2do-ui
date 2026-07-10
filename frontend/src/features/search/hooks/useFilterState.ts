import { useCallback, useMemo, useState, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
  storeStatesToFilterState,
  generatedFilterStateToFilterState,
  normalizeFilterState,
  clearNarrowingFilterState,
  DEFAULT_FILTER_SORT_BY,
  DEFAULT_FILTER_SORT_ORDER,
} from "@/features/search/api/filterService";
import { generateFiltersWithAI, isApiKeyConfigured } from "@/shared/lib/openai";
import { useDebouncedCallback } from "@/shared/hooks/useDebouncedCallback";
import { JSON_EDITOR_DEBOUNCE_MS } from "@/shared/constants/ui";
import { useSearchStore } from "@/features/search/store/search.store";
import type { FilterState } from "@/shared/types";

type FilterStateUpdater = FilterState | ((current: FilterState) => FilterState);

function readCurrentFilterState(): FilterState {
  return storeStatesToFilterState(useSearchStore.getState());
}

export function useFilterActions() {
  const setFilterState = useCallback((updater: FilterStateUpdater) => {
    const nextFilters = normalizeFilterState(
      typeof updater === "function" ? updater(readCurrentFilterState()) : updater,
    );
    startTransition(() => {
      useSearchStore.getState().setFilterState(nextFilters);
    });
  }, []);

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
    setFilterState((current) => clearNarrowingFilterState(current));
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
    goingFilter,
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
      goingFilter: s.goingFilter,
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
  } = useFilterActions();

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
  const setGoingFilter = useCallback(
    (value: boolean) => updateFilterState({ going: value }),
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
  const toggleAddedWithin24h = useCallback(() => {
    setFilterState((current) => {
      if (current.addedWithin24h) {
        return normalizeFilterState({
          ...current,
          addedWithin24h: false,
          sortBy: DEFAULT_FILTER_SORT_BY,
          sortOrder: DEFAULT_FILTER_SORT_ORDER,
        });
      }

      return normalizeFilterState({
        ...current,
        addedWithin24h: true,
        sortBy: "added_at",
        sortOrder: "desc",
      });
    });
  }, [setFilterState]);

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
          goingFilter,
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
      goingFilter,
      sortBy,
      sortOrder,
      addedWithin24h,
    ],
  );

  const [jsonError, setJsonError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const applyJsonFilters = useCallback(
    (value: string) => {
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
        going: filters.going || false,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        addedWithin24h: filters.addedWithin24h || false,
      });
    },
    [setFilterState],
  );

  const debouncedApplyJsonFilters = useDebouncedCallback(
    applyJsonFilters,
    JSON_EDITOR_DEBOUNCE_MS,
  );

  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      debouncedApplyJsonFilters(value);
    },
    [debouncedApplyJsonFilters],
  );

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
    freeFoodFilter,
    setFreeFoodFilter,
    goingFilter,
    setGoingFilter,
    addedWithin24h,
    setAddedWithin24h,
    toggleAddedWithin24h,
    toggleCategory,
    toggleLocation,
    toggleDay,
    toggleFood,
    toggleOrganization,
    jsonValue,
    jsonError,
    handleJsonChange,
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,
    clearAllFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    setSort,
  };
}
