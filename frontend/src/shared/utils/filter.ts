/**
 * Get filter counts for UI display.
 *
 * Counts fields that narrow the event result set. Sort is an ordering
 * preference and is excluded from this badge.
 */
export function getFilterCounts(filters: {
  searchQuery?: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  maxPrice: string;
  registration: boolean;
  selectedOrganizations?: string[];
  freeFoodFilter: boolean;
  goingFilter: boolean;
  addedSince?: string;
}): number {
  const hasSearchQuery = Boolean(filters.searchQuery?.trim());

  return (
    (hasSearchQuery ? 1 : 0) +
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.maxPrice ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    (filters.selectedOrganizations?.length ?? 0) +
    (filters.freeFoodFilter ? 1 : 0) +
    (filters.goingFilter ? 1 : 0) +
    (filters.addedSince ? 1 : 0)
  );
}
