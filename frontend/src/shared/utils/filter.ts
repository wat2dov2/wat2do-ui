/**
 * Filter Utilities
 * Helper functions for filter operations
 */

import type { DatePreset } from "@/shared/types";

/**
 * Get filter counts for UI display.
 *
 * Counts fields that change the event result set or its active ordering.
 */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  datePreset?: DatePreset;
  priceRange: { min: string; max: string };
  registration: boolean;
  selectedOrganizations?: string[];
  freeFoodFilter: boolean;
  savedFilter: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
}): number {
  const hasActiveSort = filters.sortBy !== "date" || filters.sortOrder !== "asc";

  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.datePreset && filters.datePreset !== "upcoming" ? 1 : 0) +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    (filters.selectedOrganizations?.length ?? 0) +
    (filters.freeFoodFilter ? 1 : 0) +
    (filters.savedFilter ? 1 : 0) +
    (hasActiveSort ? 1 : 0)
  );
}
