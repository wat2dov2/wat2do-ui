import type { Event, EventDateFilter, FilterState } from "@/shared/types";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { fromZonedTime } from "date-fns-tz";
import { eventVisibleUntilMs, parseLocalDateValue, schoolCalendarDate } from "@/shared/utils/date";
import { getEventFilterCategories, START_FROM_NOW } from "@/shared/constants/eventFilters";

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
  registration: false,
  clubs: [],
  hasFood: false,
  employersOnCampus: false,
  competitions: false,
  featured: false,
  sportsGame: false,
  recurring: false,
  campusSeasonIds: [],
  going: false,
  sortBy: DEFAULT_FILTER_SORT_BY,
  sortOrder: DEFAULT_FILTER_SORT_ORDER,
  addedSince: "",
  dateFilter: "any",
  customDate: "",
  startFrom: START_FROM_NOW,
};

/** "Free food" means an event that has food and costs nothing; one definition for every entry point. */
export function freeFoodFilterPatch(value: boolean): Pick<FilterState, "hasFood" | "minPrice" | "maxPrice"> {
  return { hasFood: value, minPrice: "", maxPrice: value ? "0" : "" };
}

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

const LOCAL_DATE_TIME = /^(\d{4})-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
/** Years a start can name; anything else is a date still being typed (0002, 0020, 0202...). */
const FIRST_START_YEAR = 2000;
const LAST_START_YEAR = 2100;

/** Whether `value` is a start the reader can pick: a real school-local date and time in a plausible year. */
export function isPickedStartFrom(value: string): boolean {
  const match = LOCAL_DATE_TIME.exec(value);
  const year = Number(match?.[1]);
  return Boolean(match && parseLocalDateValue(value.slice(0, 10))) && year >= FIRST_START_YEAR && year <= LAST_START_YEAR;
}

function startFromValue(value: unknown): string {
  if (value === "") return "";
  return typeof value === "string" && isPickedStartFrom(value) ? value : START_FROM_NOW;
}

/**
 * The moment the list begins in `timeZone`: `nowMs` for the default, null for no
 * start (or before the clock is known), else the picked school-local time.
 */
export function resolveStartFromMs(startFrom: string, nowMs: number | null, timeZone: string): number | null {
  if (startFrom === START_FROM_NOW) return nowMs;
  if (!startFrom) return null;
  // Never throws (unlike localDateTimeToUtc), so a time a clock change skips still starts the list.
  return fromZonedTime(startFrom, timeZone).getTime();
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
    categories: getEventFilterCategories(stringArray(filters.categories)),
    locations: stringArray(filters.locations),
    foods: stringArray(filters.foods),
    days: stringArray(filters.days),
    minPrice: stringFrom(filters.minPrice),
    maxPrice: stringFrom(filters.maxPrice),
    minGoing: typeof filters.minGoing === "number" && Number.isFinite(filters.minGoing)
      ? Math.max(0, Math.floor(filters.minGoing))
      : 0,
    registration: filters.registration === true,
    clubs: stringArray(filters.clubs),
    hasFood: filters.hasFood === true,
    employersOnCampus: filters.employersOnCampus === true,
    competitions: filters.competitions === true,
    featured: filters.featured === true,
    sportsGame: filters.sportsGame === true,
    recurring: filters.recurring === true,
    campusSeasonIds: [...new Set(stringArray(filters.campusSeasonIds).map(id => id.trim()).filter(Boolean))],
    going: filters.going === true,
    sortBy: stringFrom(filters.sortBy) || DEFAULT_FILTER_SORT_BY,
    sortOrder: sortOrderFrom(filters.sortOrder),
    addedSince: isoTimestampFrom(filters.addedSince),
    dateFilter,
    customDate: dateFilter === "custom" ? customDate : "",
    startFrom: startFromValue(filters.startFrom),
  };
}

/** Map the shared filter shape to the store's UI-oriented names, normalizing it first. */
export function filterStateToStoreValues(filters: FilterState): SearchStoreFilterValues {
  const normalized = normalizeFilterState(filters);
  return {
    searchQuery: normalized.searchQuery,
    selectedCategories: normalized.categories,
    selectedLocations: normalized.locations,
    selectedFoods: normalized.foods,
    selectedDays: normalized.days,
    selectedClubs: normalized.clubs,
    minPrice: normalized.minPrice,
    maxPrice: normalized.maxPrice,
    minGoing: normalized.minGoing,
    registration: normalized.registration,
    hasFoodFilter: normalized.hasFood,
    employersOnCampus: normalized.employersOnCampus,
    competitions: normalized.competitions,
    featured: normalized.featured,
    sportsGame: normalized.sportsGame,
    recurring: normalized.recurring,
    campusSeasonIds: normalized.campusSeasonIds,
    goingFilter: normalized.going,
    sortBy: normalized.sortBy,
    sortOrder: normalized.sortOrder,
    addedSince: normalized.addedSince,
    dateFilter: normalized.dateFilter,
    customDate: normalized.customDate,
    startFrom: normalized.startFrom,
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
    registration: values.registration,
    clubs: values.selectedClubs,
    hasFood: values.hasFoodFilter,
    employersOnCampus: values.employersOnCampus,
    competitions: values.competitions,
    featured: values.featured,
    sportsGame: values.sportsGame,
    recurring: values.recurring,
    campusSeasonIds: values.campusSeasonIds,
    going: values.goingFilter,
    sortBy: values.sortBy,
    sortOrder: values.sortOrder,
    addedSince: values.addedSince,
    dateFilter: values.dateFilter,
    customDate: values.customDate,
    startFrom: values.startFrom,
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

/**
 * What the whole school feed offers the filters that only show while they can
 * find something: the last moment each still has an event on. Kept as moments
 * rather than yes or no, it answers for any time exactly as the feed's events
 * would, so the server's first screen of the feed can carry it in place of them.
 */
export interface FeedFilterAvailability {
  /** When the school's last varsity game stops being on, or null when it has none. */
  sportsGameUntilMs: number | null;
  /** For each campus season (by classification id), when its last uncancelled event stops being on. */
  campusSeasonUntilMs: Record<string, number>;
}

/** Availability comes from the complete school feed, before any narrowing filters. */
export function feedFilterAvailability(events: readonly Event[], school: string): FeedFilterAvailability {
  let sportsGameUntilMs: number | null = null;
  const campusSeasonUntilMs: Record<string, number> = {};
  for (const event of events) {
    const untilMs = event.school === school ? eventVisibleUntilMs(event) : null;
    if (untilMs === null) continue;
    if (event.sports_game === true) sportsGameUntilMs = Math.max(sportsGameUntilMs ?? untilMs, untilMs);
    if (event.cancelled) continue;
    for (const seasonId of event.campus_season_ids ?? []) {
      campusSeasonUntilMs[seasonId] = Math.max(campusSeasonUntilMs[seasonId] ?? untilMs, untilMs);
    }
  }
  return { sportsGameUntilMs, campusSeasonUntilMs };
}

/** Whether a campus season (by classification id) still has an event on at `currentTimeMs`. */
function hasCampusSeasonEvent(availability: FeedFilterAvailability, seasonId: string, currentTimeMs: number): boolean {
  return Object.hasOwn(availability.campusSeasonUntilMs, seasonId) &&
    availability.campusSeasonUntilMs[seasonId]! >= currentTimeMs;
}

/** Whether the varsity chip shows at `currentTimeMs`, and whether a selection of it still narrows. */
export function resolveVarsityGamesFilter(
  availability: FeedFilterAvailability | null,
  currentTimeMs: number | null,
  selected: boolean,
) {
  if (availability === null || currentTimeMs === null) {
    return { ready: false, available: false, selected: false };
  }
  const available = availability.sportsGameUntilMs !== null && availability.sportsGameUntilMs >= currentTimeMs;
  return { ready: true, available, selected: selected && available };
}

export interface CampusSeasonFilterOption {
  id: string;
  label: string;
  classificationId: string;
  windows: SchoolSummary["event_seasons"][number]["display_windows"];
}

/**
 * Window visibility and applied selections share the current school's calendar.
 * `availability` must describe this school's feed.
 */
export function resolveCampusSeasonFilters(
  school: SchoolSummary | undefined,
  currentTimeMs: number | null,
  language: string,
  selectedIds: readonly string[],
  availability: FeedFilterAvailability | null,
) {
  if (!school || school.event_seasons === undefined || currentTimeMs === null || availability === null) {
    return { ready: false, options: [] as CampusSeasonFilterOption[], selectedIds: [] };
  }
  const today = schoolCalendarDate(currentTimeMs, school.timezone).toISOString().slice(0, 10);
  const options = school.event_seasons
    .filter(season => season.display_windows.some(window => window.start_date <= today && today <= window.end_date))
    .filter(season => season.classification_id !== "exam_destress" ||
      hasCampusSeasonEvent(availability, season.classification_id, currentTimeMs))
    .map(season => ({
      id: season.id,
      classificationId: season.classification_id,
      windows: season.display_windows,
      label: season.labels[language] ?? season.labels[language.split("-")[0]] ?? season.labels.en,
    }));
  const activeIds = new Set(options.map(option => option.id));
  return { ready: true, options, selectedIds: selectedIds.filter(id => activeIds.has(id)) };
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
