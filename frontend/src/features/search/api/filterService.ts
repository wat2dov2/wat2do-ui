import type { FilterState } from "@/shared/types";
import type { ApiFilterStateResponse } from "@/shared/generated";
import i18n from "@/shared/lib/i18n";

/**
 * Filter Service
 * Serializer/parser used by the JSON editor and one-shot QR filter handoff.
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
  going: false,
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedSince: "",
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
  goingFilter: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
}

type GeneratedFilterStateInput = Partial<ApiFilterStateResponse> & {
  organizations?: unknown;
  freeFood?: unknown;
  going?: unknown;
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

function isoTimestampFrom(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : "";
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
    going: filters.going === true,
    sortBy: typeof filters.sortBy === "string" && filters.sortBy ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
  };
}

/**
 * Map Zustand search-store filter values to the shared `FilterState`
 * shape used by the JSON editor.
 *
 * Key rename: the store uses `selectedCategories`/`selectedLocations`/
 * `selectedFoods`/`selectedDays` (UI-oriented naming), while `FilterState`
 * uses shorter `categories`/`locations`/`foods`/`days` keys (JSON friendly).
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
    going: values.goingFilter,
    sortBy: values.sortBy,
    sortOrder: values.sortOrder,
    addedSince: values.addedSince,
  };
}

/**
 * Normalize the generated AI FilterStateResponse to the UI FilterState.
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
    going: filters.going === true,
    sortBy: typeof filters.sortBy === "string" ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
  });
}

export function clearNarrowingFilterState(current: FilterState): FilterState {
  return normalizeFilterState({
    ...EMPTY_FILTER_STATE,
    sortBy: current.sortBy,
    sortOrder: current.sortOrder,
  });
}

const PENDING_FILTERS_SESSION_KEY = "wat2do:pending-filters";

/** Stage filters for a full-page redirect (e.g. QR poster events-list). */
export function stagePendingFilterState(filters: Partial<FilterState>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    PENDING_FILTERS_SESSION_KEY,
    serializeFiltersToJSON(normalizeFilterState(filters)),
  );
}

/** Read and clear staged filters once after landing on the events page. */
export function consumePendingFilterState(): FilterState | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_FILTERS_SESSION_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_FILTERS_SESSION_KEY);
  const { filters, error } = parseFiltersFromJSON(raw);
  return error ? null : filters;
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
