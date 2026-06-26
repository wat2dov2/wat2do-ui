/**
 * Filter Utilities
 * Helper functions for filter operations
 */

import type { DatePreset } from "@/shared/types";

/**
 * Get filter counts for UI display.
 *
 * Counts only fields that actually drive filterEvents —
 * addedSince was removed because it never influenced the result.
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
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.datePreset && filters.datePreset !== "upcoming" ? 1 : 0) +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    (filters.selectedOrganizations?.length ?? 0)
  );
}
