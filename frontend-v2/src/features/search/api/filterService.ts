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
  } catch (error) {
    return {
      filters: createFilterState(),
      error: error instanceof Error ? error.message : "Invalid JSON format",
    };
  }
}

/**
 * Convert filter state to URL query string
 */
export function buildFilterQueryString(filters: FilterState): string {
  try {
    const encoded = encodeURIComponent(JSON.stringify(filters));
    return `filters=${encoded}`;
  } catch (error) {
    return "";
  }
}

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
  } catch (error) {
    return null;
  }
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.searchQuery.trim() !== "" ||
    filters.categories.length > 0 ||
    filters.locations.length > 0 ||
    filters.foods.length > 0 ||
    filters.days.length > 0 ||
    filters.priceRange.min !== "" ||
    filters.priceRange.max !== "" ||
    filters.dateRange !== "" ||
    filters.addedSince !== "" ||
    filters.requiresRegistration
  );
}

/**
 * Clear all filters (return to default state)
 */
export function clearFilters(): FilterState {
  return createFilterState();
}
