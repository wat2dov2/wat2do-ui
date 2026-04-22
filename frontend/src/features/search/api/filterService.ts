import type { FilterState } from "@/shared/types";
import { QP } from "@/shared/constants/queryParams";

/**
 * Filter Service
 * Serializer/parser used by the JSON editor and URL hydration.
 */

const EMPTY_FILTER_STATE: FilterState = {
  searchQuery: "",
  categories: [],
  locations: [],
  foods: [],
  days: [],
  priceRange: { min: "", max: "" },
  requiresRegistration: false,
};

/**
 * Shape of the search-store filter values consumed by the UI.
 * Intentionally independent from the store module so this mapping
 * stays a pure data transform (no Zustand imports here).
 */
export interface SearchStoreFilterValues {
  searchQuery: string;
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  requiresRegistration: boolean;
}

/**
 * Map Zustand search-store filter values to the shared `FilterState`
 * shape used by the JSON editor and URL params.
 *
 * Key rename: the store uses `selectedCategories`/`selectedLocations`/
 * `selectedFoods`/`selectedDays` (UI-oriented naming), while `FilterState`
 * uses shorter `categories`/`locations`/`foods`/`days` keys (URL/JSON
 * friendly). All other keys pass through unchanged.
 */
export function storeStatesToFilterState(
  values: SearchStoreFilterValues,
): FilterState {
  return {
    searchQuery: values.searchQuery,
    categories: values.selectedCategories,
    locations: values.selectedLocations,
    foods: values.selectedFoods,
    days: values.selectedDays,
    priceRange: values.priceRange,
    requiresRegistration: values.requiresRegistration,
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
  jsonString: string,
): { filters: FilterState; error: string | null } {
  try {
    const parsed = JSON.parse(jsonString);
    const priceRaw =
      typeof parsed.priceRange === "object" && parsed.priceRange
        ? (parsed.priceRange as Record<string, unknown>)
        : null;
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
        min: priceRaw && typeof priceRaw.min === "string" ? priceRaw.min : "",
        max: priceRaw && typeof priceRaw.max === "string" ? priceRaw.max : "",
      },
      requiresRegistration:
        typeof parsed.requiresRegistration === "boolean"
          ? parsed.requiresRegistration
          : false,
    };
    return { filters, error: null };
  } catch (err) {
    console.error("Failed to parse filters from JSON:", err);
    return {
      filters: { ...EMPTY_FILTER_STATE },
      error: "Invalid JSON format",
    };
  }
}

/**
 * Parse filter state from a URL query string fragment (e.g. "filters=…").
 * Returns null for missing or malformed payloads.
 */
export function parseFilterQueryString(
  queryString: string,
): FilterState | null {
  try {
    const params = new URLSearchParams(queryString);
    const filtersParam = params.get(QP.FILTERS);
    if (!filtersParam) return null;

    const decoded = decodeURIComponent(filtersParam);
    const { filters, error } = parseFiltersFromJSON(decoded);
    if (error) return null;
    return filters;
  } catch (err) {
    console.error("Failed to parse filter query string:", err);
    return null;
  }
}
