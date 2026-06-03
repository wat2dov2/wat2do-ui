/**
 * Filter Utilities
 * Helper functions for filter operations
 */

/**
 * Get filter counts for UI display.
 *
 * Counts only fields that actually drive filterEvents — dateRange /
 * addedSince were removed because they never influenced the result.
 */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  dateRange: { from: string; to: string };
  registration: boolean;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.dateRange.from || filters.dateRange.to ? 1 : 0) +
    (filters.registration ? 1 : 0)
  );
}
