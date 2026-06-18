import type { FilterState } from "@/shared/types";
import type { ApiFilterStateResponse } from "@/shared/generated";
import { QP } from "@/shared/constants/queryParams";
import i18n from "@/shared/lib/i18n";

/**
 * Filter Service
 * Serializer/parser used by the JSON editor and URL hydration.
 */

export const DEFAULT_FILTER_SORT_BY = "date";
export const DEFAULT_FILTER_SORT_ORDER = "asc";

export const EMPTY_FILTER_STATE: FilterState = {
  searchQuery: "",
  categories: [],
  locations: [],
  foods: [],
  days: [],
  priceRange: { min: "", max: "" },
  registration: false,
  organizations: [],
  freeFood: false,
  saved: false,
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
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
  registration: boolean;
  selectedOrganizations: string[];
  freeFoodFilter: boolean;
  savedFilter: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

type GeneratedFilterStateInput = Partial<ApiFilterStateResponse> & {
  organizations?: unknown;
  freeFood?: unknown;
  saved?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function priceRangeFrom(value: unknown): FilterState["priceRange"] {
  const priceRaw = typeof value === "object" && value ? (value as Record<string, unknown>) : null;
  return {
    min: priceRaw && typeof priceRaw.min === "string" ? priceRaw.min : "",
    max: priceRaw && typeof priceRaw.max === "string" ? priceRaw.max : "",
  };
}

function sortOrderFrom(value: unknown): FilterState["sortOrder"] {
  return value === "desc" ? "desc" : DEFAULT_FILTER_SORT_ORDER;
}

export function normalizeFilterState(filters: Partial<FilterState>): FilterState {
  return {
    searchQuery: typeof filters.searchQuery === "string" ? filters.searchQuery : "",
    categories: stringArray(filters.categories),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    priceRange: priceRangeFrom(filters.priceRange),
    registration: filters.registration === true,
    organizations: stringArray(filters.organizations),
    freeFood: filters.freeFood === true,
    saved: filters.saved === true,
    sortBy: typeof filters.sortBy === "string" && filters.sortBy ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
  };
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
    registration: values.registration,
    organizations: values.selectedOrganizations,
    freeFood: values.freeFoodFilter,
    saved: values.savedFilter,
    sortBy: values.sortBy,
    sortOrder: values.sortOrder,
  };
}

/**
 * Normalize the generated AI FilterStateResponse to the UI/URL FilterState.
 */
export function generatedFilterStateToFilterState(
  filters: GeneratedFilterStateInput,
): FilterState {
  return normalizeFilterState({
    searchQuery: typeof filters.searchQuery === "string" ? filters.searchQuery : "",
    categories: stringArray(filters.categories),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    priceRange: priceRangeFrom(filters.priceRange),
    registration:
      typeof filters.registration === "boolean" ? filters.registration : false,
    organizations: stringArray(filters.organizations),
    freeFood: filters.freeFood === true,
    saved: filters.saved === true,
    sortBy: typeof filters.sortBy === "string" ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
  });
}

function isDefaultPriceRange(priceRange: FilterState["priceRange"]): boolean {
  return priceRange.min === "" && priceRange.max === "";
}

export function isEmptyFilterState(filters: FilterState): boolean {
  return (
    filters.searchQuery === "" &&
    filters.categories.length === 0 &&
    filters.locations.length === 0 &&
    filters.foods.length === 0 &&
    filters.days.length === 0 &&
    isDefaultPriceRange(filters.priceRange) &&
    !filters.registration &&
    filters.organizations.length === 0 &&
    !filters.freeFood &&
    !filters.saved &&
    filters.sortBy === DEFAULT_FILTER_SORT_BY &&
    filters.sortOrder === DEFAULT_FILTER_SORT_ORDER
  );
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
    const filters = generatedFilterStateToFilterState(parsed as GeneratedFilterStateInput);
    return { filters, error: null };
  } catch (err) {
    console.error("Failed to parse filters from JSON:", err);
    return {
      filters: { ...EMPTY_FILTER_STATE },
      error: i18n.t("forms.invalidJsonFormat"),
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

export function writeFiltersToSearchParams(
  params: URLSearchParams,
  filters: FilterState,
): URLSearchParams {
  const normalized = normalizeFilterState(filters);
  if (isEmptyFilterState(normalized)) {
    params.delete(QP.FILTERS);
  } else {
    params.set(QP.FILTERS, JSON.stringify(normalized));
  }
  return params;
}
