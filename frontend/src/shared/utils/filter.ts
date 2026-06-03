/**
 * Filter Utilities
 * Helper functions for filter operations
 */

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
  priceRange: { min: string; max: string };
  registration: boolean;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.registration ? 1 : 0)
  );
}
