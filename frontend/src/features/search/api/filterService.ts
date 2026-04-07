import type { FilterState } from "@/shared/types";

/**
 * Filter Service
 * Handles filter state management and transformations
 */

/**
 * Create default filter state
 */
export function createFilterState(): FilterState {
  return {
    searchQuery: "",
    categories: [],
    locations: [],
    foods: [],
    days: [],
    priceRange: { min: "", max: "" },
    dateRange: "",
    addedSince: "",
    requiresRegistration: false,
  };
}

/**
 * Serialize filter state to JSON string
 */
export function serializeFiltersToJSON(filters: FilterState): string {
  return JSON.stringify(filters, null, 2);
}

/**
 * Parse filter state from JSON string
 */
export function parseFiltersFromJSON(
  jsonString: string
): { filters: FilterState; error: string | null } {
  try {
    const parsed = JSON.parse(jsonString);
    const filters: FilterState = {
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.filter((c): c is string => typeof c === "string")
        : [],
      locations: Array.isArray(parsed.locations)
        ? parsed.locations.filter((l): l is string => typeof l === "string")
        : [],
      foods: Array.isArray(parsed.foods)
        ? parsed.foods.filter((f): f is string => typeof f === "string")
        : [],
      days: Array.isArray(parsed.days)
        ? parsed.days.filter((d): d is string => typeof d === "string")
        : [],
      priceRange: {
        min:
          typeof parsed.priceRange === "object" &&
          parsed.priceRange &&
          typeof (parsed.priceRange as Record<string, unknown>).min === "string"
            ? ((parsed.priceRange as Record<string, unknown>).min as string)
            : "",
        max:
          typeof parsed.priceRange === "object" &&
          parsed.priceRange &&
          typeof (parsed.priceRange as Record<string, unknown>).max === "string"
            ? ((parsed.priceRange as Record<string, unknown>).max as string)
            : "",
      },
      dateRange: typeof parsed.dateRange === "string" ? parsed.dateRange : "",
      addedSince: typeof parsed.addedSince === "string" ? parsed.addedSince : "",
      requiresRegistration:
        typeof parsed.requiresRegistration === "boolean"
          ? parsed.requiresRegistration
          : false,
    };
    return { filters, error: null };
  } catch (err) {
    console.error("Failed to parse filters from JSON:", err);
    return {
      filters: createFilterState(),
      error: "Invalid JSON format",
    };
  }
}

// Canonical home: shared/utils/filter.ts — re-exported for feature consumers
export { buildFilterQueryString } from "@/shared/utils/filter";

/**
 * Parse filter state from URL query string
 */
export function parseFilterQueryString(
  queryString: string
): FilterState | null {
  try {
    const params = new URLSearchParams(queryString);
    const filtersParam = params.get("filters");
    if (!filtersParam) return null;

    const decoded = decodeURIComponent(filtersParam);
    const { filters } = parseFiltersFromJSON(decoded);
    return filters;
  } catch (err) {
    console.error("Failed to parse filter query string:", err);
    return null;
  }
}

// Canonical home: shared/utils/filter.ts — re-exported for backward compat
export { hasActiveFilters } from "@/shared/utils/filter";

/**
 * Clear all filters (return to default state)
 */
export function clearFilters(): FilterState {
  return createFilterState();
}
