import type { EventDateFilter, FilterState } from "@/shared/types";
import { parseLocalDateValue } from "@/shared/utils/date";

/**
 * Filter Service
 * Normalization used by visual filters and one-shot QR filter handoff.
 */

export const DEFAULT_FILTER_SORT_BY = "date";
export const DEFAULT_FILTER_SORT_ORDER = "asc";

export const EMPTY_FILTER_STATE: FilterState = {
  searchQuery: "",
  categories: [],
  locations: [],
  foods: [],
  days: [],
  minPrice: "",
  maxPrice: "",
  registration: false,
  organizations: [],
  freeFood: false,
  going: false,
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedSince: "",
  dateFilter: "any",
  customDate: "",
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
  minPrice: string;
  maxPrice: string;
  registration: boolean;
  selectedOrganizations: string[];
  freeFoodFilter: boolean;
  goingFilter: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
}

type FilterStateInput = Partial<Record<keyof FilterState, unknown>>;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function priceFrom(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sortOrderFrom(value: unknown): FilterState["sortOrder"] {
  return value === "desc" ? "desc" : DEFAULT_FILTER_SORT_ORDER;
}

function isoTimestampFrom(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : "";
}

const EVENT_DATE_FILTERS = new Set<EventDateFilter>([
  "any",
  "today",
  "tomorrow",
  "thisWeek",
  "thisWeekend",
  "nextWeek",
  "custom",
]);

function localDateFrom(value: unknown): string {
  return typeof value === "string" && parseLocalDateValue(value) ? value : "";
}

function dateFilterFrom(
  value: unknown,
  customDate: string,
): EventDateFilter {
  const candidate =
    typeof value === "string" && EVENT_DATE_FILTERS.has(value as EventDateFilter)
      ? (value as EventDateFilter)
      : "any";
  return candidate === "custom" && !customDate ? "any" : candidate;
}

export function normalizeFilterState(filters: Partial<FilterState>): FilterState {
  const customDate = localDateFrom(filters.customDate);
  const dateFilter = dateFilterFrom(filters.dateFilter, customDate);
  return {
    searchQuery: typeof filters.searchQuery === "string" ? filters.searchQuery : "",
    categories: stringArray(filters.categories),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    minPrice: priceFrom(filters.minPrice),
    maxPrice: priceFrom(filters.maxPrice),
    registration: filters.registration === true,
    organizations: stringArray(filters.organizations),
    freeFood: filters.freeFood === true,
    going: filters.going === true,
    sortBy: typeof filters.sortBy === "string" && filters.sortBy ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
    dateFilter,
    customDate: dateFilter === "custom" ? customDate : "",
  };
}

/**
 * Map Zustand search-store filter values to the shared `FilterState`
 * shape used by filter consumers.
 *
 * Key rename: the store uses `selectedCategories`/`selectedLocations`/
 * `selectedFoods`/`selectedDays` (UI-oriented naming), while `FilterState`
 * uses shorter `categories`/`locations`/`foods`/`days` keys.
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
    minPrice: values.minPrice,
    maxPrice: values.maxPrice,
    registration: values.registration,
    organizations: values.selectedOrganizations,
    freeFood: values.freeFoodFilter,
    going: values.goingFilter,
    sortBy: values.sortBy,
    sortOrder: values.sortOrder,
    addedSince: values.addedSince,
    dateFilter: values.dateFilter,
    customDate: values.customDate,
  };
}

/**
 * Normalize untrusted JSON or API filter input to the UI FilterState.
 */
export function filterStateFromInput(
  filters: FilterStateInput,
): FilterState {
  const customDate = localDateFrom(filters.customDate);
  return normalizeFilterState({
    searchQuery: typeof filters.searchQuery === "string" ? filters.searchQuery : "",
    categories: stringArray(filters.categories),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    minPrice: priceFrom(filters.minPrice),
    maxPrice: priceFrom(filters.maxPrice),
    registration:
      typeof filters.registration === "boolean" ? filters.registration : false,
    organizations: stringArray(filters.organizations),
    freeFood: filters.freeFood === true,
    going: filters.going === true,
    sortBy: typeof filters.sortBy === "string" ? filters.sortBy : DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
    dateFilter: dateFilterFrom(filters.dateFilter, customDate),
    customDate,
  });
}

export function clearNarrowingFilterState(current: FilterState): FilterState {
  return normalizeFilterState({
    ...EMPTY_FILTER_STATE,
    sortBy: current.sortBy,
    sortOrder: current.sortOrder,
  });
}

/**
 * Whether two filter states are equivalent. Both sides come from
 * `normalizeFilterState`, so key order and value shapes are already canonical
 * and a structural comparison is exact.
 */
export function isSameFilterState(a: FilterState, b: FilterState): boolean {
  return JSON.stringify(normalizeFilterState(a)) === JSON.stringify(normalizeFilterState(b));
}

const PENDING_FILTERS_SESSION_KEY = "wat2do:pending-filters";

/** Stage filters for a full-page redirect (e.g. QR poster events-list). */
export function stagePendingFilterState(filters: Partial<FilterState>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(
    PENDING_FILTERS_SESSION_KEY,
    JSON.stringify(normalizeFilterState(filters)),
  );
}

/** Read and clear staged filters once after landing on the events page. */
export function consumePendingFilterState(): FilterState | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PENDING_FILTERS_SESSION_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_FILTERS_SESSION_KEY);
  try {
    return filterStateFromInput(JSON.parse(raw) as FilterStateInput);
  } catch {
    return null;
  }
}
