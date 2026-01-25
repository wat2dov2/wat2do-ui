import type { FilterState } from "@/types";
import { hasActiveFilters } from "@/services/filterService";

/**
 * Filter Utilities
 * Helper functions for filter operations
 */

/**
 * Get filter counts for UI display
 */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  dateRange?: Date;
  requiresRegistration: boolean;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.dateRange ? 1 : 0) +
    (filters.requiresRegistration ? 1 : 0)
  );
}

/**
 * Check if filters are active (using filter service)
 */
export function hasFilters(filters: FilterState): boolean {
  return hasActiveFilters(filters);
}

/**
 * Build filter query string for URL
 */
export function buildFilterQueryString(filters: FilterState): string {
  try {
    const encoded = encodeURIComponent(JSON.stringify(filters));
    return `filters=${encoded}`;
  } catch (error) {
    console.error("Error building filter query string:", error);
    return "";
  }
}

/**
 * Parse filter query string from URL
 */
export function parseFilterQueryString(
  queryString: string
): FilterState | null {
  try {
    const params = new URLSearchParams(queryString);
    const filtersParam = params.get("filters");
    if (!filtersParam) return null;

    const decoded = decodeURIComponent(filtersParam);
    const parsed = JSON.parse(decoded) as FilterState;
    return parsed;
  } catch (error) {
    console.error("Error parsing filter query string:", error);
    return null;
  }
}
