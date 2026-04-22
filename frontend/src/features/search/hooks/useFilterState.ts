import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  serializeFiltersToJSON,
  parseFiltersFromJSON,
  storeStatesToFilterState,
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
  const { t } = useTranslation();

  // ── Shared filter values + actions from store (single shallow subscription) ──
  // Action refs are stable in Zustand (they never change identity), but bundling
  // them into the same useShallow call keeps the hook body declarative and
  // avoids a separate subscription per action.
  const {
    searchQuery,
    selectedCategories,
    selectedLocations,
    selectedFoods,
    selectedDays,
    priceRange,
    requiresRegistration,
    freeFoodFilter,
    setSearchQuery,
    setSelectedCategories,
    setSelectedLocations,
    setSelectedFoods,
    setSelectedDays,
    setPriceRange,
    setRequiresRegistration,
    setFreeFoodFilter,
    toggleFilter,
    clearAllFilters,
    setFilterStateFromURL,
  } = useSearchStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      selectedCategories: s.selectedCategories,
      selectedLocations: s.selectedLocations,
      selectedFoods: s.selectedFoods,
      selectedDays: s.selectedDays,
      priceRange: s.priceRange,
      requiresRegistration: s.requiresRegistration,
      freeFoodFilter: s.freeFoodFilter,
      setSearchQuery: s.setSearchQuery,
      setSelectedCategories: s.setSelectedCategories,
      setSelectedLocations: s.setSelectedLocations,
      setSelectedFoods: s.setSelectedFoods,
      setSelectedDays: s.setSelectedDays,
      setPriceRange: s.setPriceRange,
      setRequiresRegistration: s.setRequiresRegistration,
      setFreeFoodFilter: s.setFreeFoodFilter,
      toggleFilter: s.toggleFilter,
      clearAllFilters: s.clearAllFilters,
      setFilterStateFromURL: s.setFilterStateFromURL,
    })),
  );

  // Per-filter toggle adapters — stable refs derived from the single
  // toggleFilter action so downstream props don't churn.
  const toggleCategory = useCallback(
    (cat: string) => toggleFilter("selectedCategories", cat),
    [toggleFilter],
  );
  const toggleLocation = useCallback(
    (loc: string) => toggleFilter("selectedLocations", loc),
    [toggleFilter],
  );
  const toggleFood = useCallback(
    (food: string) => toggleFilter("selectedFoods", food),
    [toggleFilter],
  );
  const toggleDay = useCallback(
    (day: string) => toggleFilter("selectedDays", day),
    [toggleFilter],
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
          requiresRegistration,
        }),
      ),
    [
      searchQuery,
      selectedCategories,
      selectedLocations,
      selectedFoods,
      selectedDays,
      priceRange,
      requiresRegistration,
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
      setFilterStateFromURL({
        searchQuery: filters.searchQuery || "",
        categories: filters.categories || [],
        locations: filters.locations || [],
        foods: filters.foods || [],
        days: filters.days || [],
        priceRange: filters.priceRange || { min: "", max: "" },
        requiresRegistration: filters.requiresRegistration || false,
      });
    },
    [setFilterStateFromURL],
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
      const generatedJson = serializeFiltersToJSON(newFilters);
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
    requiresRegistration,
    setRequiresRegistration,

    // Quick filters (only the ones wired to UI)
    freeFoodFilter,
    setFreeFoodFilter,

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
  };
}
