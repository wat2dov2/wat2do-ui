import type { EventDateFilter, FilterState } from "@/shared/types";
import { parseLocalDateValue } from "@/shared/utils/date";

// Shared normalization for visual filters and QR handoff.

const DEFAULT_FILTER_SORT_BY = "date";
const DEFAULT_FILTER_SORT_ORDER = "asc";

export const EMPTY_FILTER_STATE: FilterState = {
  searchQuery: "",
  categories: [],
  locations: [],
  foods: [],
  days: [],
  minPrice: "",
  maxPrice: "",
  minGoing: 0,
  eventFormat: "any",
  registration: false,
  clubs: [],
  hasFood: false,
  going: false,
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedSince: "",
  dateFilter: "any",
  customDate: "",
};

/** UI filter names, independent of the store implementation. */
export interface SearchStoreFilterValues extends Omit<
  FilterState,
  "categories" | "locations" | "foods" | "days" | "clubs" | "hasFood" | "going"
> {
  selectedCategories: FilterState["categories"];
  selectedLocations: FilterState["locations"];
  selectedFoods: FilterState["foods"];
  selectedDays: FilterState["days"];
  selectedClubs: FilterState["clubs"];
  hasFoodFilter: FilterState["hasFood"];
  goingFilter: FilterState["going"];
}

type FilterStateInput = Partial<Record<keyof FilterState, unknown>>;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringFrom(value: unknown): string {
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

export function normalizeFilterState(filters: FilterStateInput): FilterState {
  const customDate = localDateFrom(filters.customDate);
  const dateFilter = dateFilterFrom(filters.dateFilter, customDate);
  return {
    searchQuery: stringFrom(filters.searchQuery),
    categories: stringArray(filters.categories),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    minPrice: stringFrom(filters.minPrice),
    maxPrice: stringFrom(filters.maxPrice),
    minGoing: typeof filters.minGoing === "number" && Number.isFinite(filters.minGoing)
      ? Math.max(0, Math.floor(filters.minGoing))
      : 0,
    eventFormat: filters.eventFormat === "online" || filters.eventFormat === "inPerson"
      ? filters.eventFormat
      : "any",
    registration: filters.registration === true,
    clubs: stringArray(filters.clubs),
    hasFood: filters.hasFood === true,
    going: filters.going === true,
    sortBy: stringFrom(filters.sortBy) || DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
    dateFilter,
    customDate: dateFilter === "custom" ? customDate : "",
  };
}

/** Map UI-oriented store names to the shared filter shape. */
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
    minGoing: values.minGoing,
    eventFormat: values.eventFormat,
    registration: values.registration,
    clubs: values.selectedClubs,
    hasFood: values.hasFoodFilter,
    going: values.goingFilter,
    sortBy: values.sortBy,
    sortOrder: values.sortOrder,
    addedSince: values.addedSince,
    dateFilter: values.dateFilter,
    customDate: values.customDate,
  };
}

export function clearNarrowingFilterState(current: FilterState): FilterState {
  return normalizeFilterState({
    ...EMPTY_FILTER_STATE,
    sortBy: current.sortBy,
    sortOrder: current.sortOrder,
  });
}

/** Normalized states have stable key order and value shapes. */
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
    return normalizeFilterState(JSON.parse(raw) as FilterStateInput);
  } catch {
    return null;
  }
}
