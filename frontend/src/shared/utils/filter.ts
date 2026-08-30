import type { EventDateFilter } from "@/shared/types/filter.types";

/**
 * Get filter counts for UI display.
 *
 * Counts fields that narrow the event result set. Sort is an ordering
 * preference and is excluded from this badge.
 */
/**
 * How many filters are active.
 *
 * The search query is deliberately not one of them. It has its own field in
 * plain sight, so counting it made the "More filters" badge claim a filter the
 * panel does not contain and cannot clear.
 */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  minPrice: string;
  maxPrice: string;
  registration: boolean;
  selectedOrganizations: string[];
  freeFoodFilter: boolean;
  goingFilter: boolean;
  addedSince?: string;
  dateFilter?: EventDateFilter;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.minPrice ? 1 : 0) +
    (filters.maxPrice ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    filters.selectedOrganizations.length +
    (filters.freeFoodFilter ? 1 : 0) +
    (filters.goingFilter ? 1 : 0) +
    (filters.addedSince ? 1 : 0) +
    (filters.dateFilter && filters.dateFilter !== "any" ? 1 : 0)
  );
}
