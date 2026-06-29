/**
 * Filter Utilities
 * Helper functions for filter operations
 */

/**
 * Get filter counts for UI display.
 *
 * Counts fields that change the event result set or its active ordering.
 */
export function getFilterCounts(filters: {
  searchQuery?: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  registration: boolean;
  selectedOrganizations?: string[];
  freeFoodFilter: boolean;
  savedFilter: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedWithin24h?: boolean;
  viewMode?: "grid" | "calendar" | "map";
}): number {
  const hasActiveSort = filters.sortBy !== "date" || filters.sortOrder !== "asc";
  const hasSearchQuery = Boolean(filters.searchQuery?.trim());
  const hasActiveViewMode = filters.viewMode != null && filters.viewMode !== "grid";

  return (
    (hasSearchQuery ? 1 : 0) +
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    (filters.selectedOrganizations?.length ?? 0) +
    (filters.freeFoodFilter ? 1 : 0) +
    (filters.savedFilter ? 1 : 0) +
    (filters.addedWithin24h ? 1 : 0) +
    (hasActiveSort ? 1 : 0) +
    (hasActiveViewMode ? 1 : 0)
  );
}
