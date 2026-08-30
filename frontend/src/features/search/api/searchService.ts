import type { Event } from "@/shared/types";
import type { EventDateFilter } from "@/shared/types/filter.types";
import {
  getPrimaryOccurrence,
  parseLocalDateValue,
} from "@/shared/utils/date";
import { getEventCategory } from "@/shared/utils/event";

/**
 * Search, filter, and sort operations for Event collections.
 */

export interface SearchFilters {
  searchQuery: string;
  goingFilter: boolean;
  freeFoodFilter: boolean;
  selectedDays: string[];
  maxPrice: string;
  selectedLocations: string[];
  selectedFoods: string[];
  selectedCategories: string[];
  registration: boolean;
  profileCompleted: boolean;
  goingEventIds: number[];
  selectedOrganizations: string[];
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
}

export interface SortOptions {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

/**
 * Fields a free-text query is matched against.
 *
 * Events are discovered by club as often as by title ("animusic" should find
 * events posted by @uw_animusic), so the owning organization's name and its
 * Instagram handles are part of the haystack. All of these ship on the list
 * summary payload, so matching stays client-side.
 */
function eventSearchHaystack(event: Event): string[] {
  return [
    event.title,
    event.organization,
    event.ig_handle,
    event.organization_ig,
    event.description,
    event.location,
    ...(event.food ?? []),
  ].filter((field): field is string => Boolean(field));
}

/**
 * Normalize a query for comparison. Handles are displayed as "@uw_animusic",
 * so a leading "@" is dropped to keep pasted handles matching.
 */
function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^@+/, "");
}

const RANDOM_EVENT_SEARCH_QUERY = "random";

interface DateFilterRange {
  startMs: number;
  endMs: number;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function resolveDateFilterRange(
  dateFilter: EventDateFilter,
  customDate: string,
  currentDate: Date,
): DateFilterRange | null {
  if (dateFilter === "any") return null;

  const today = localMidnight(currentDate);
  let start: Date;
  let end: Date;

  switch (dateFilter) {
    case "today":
      start = today;
      end = addLocalDays(today, 1);
      break;
    case "tomorrow":
      start = addLocalDays(today, 1);
      end = addLocalDays(today, 2);
      break;
    case "thisWeek": {
      const daysUntilNextMonday = today.getDay() === 0 ? 1 : 8 - today.getDay();
      start = today;
      end = addLocalDays(today, daysUntilNextMonday);
      break;
    }
    case "thisWeekend": {
      const day = today.getDay();
      const daysUntilSaturday = day === 0 ? -1 : (6 - day + 7) % 7;
      start = addLocalDays(today, daysUntilSaturday);
      end = addLocalDays(start, 2);
      break;
    }
    case "nextWeek": {
      const daysSinceMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
      start = addLocalDays(today, 7 - daysSinceMonday);
      end = addLocalDays(start, 7);
      break;
    }
    case "custom": {
      const selectedDate = parseLocalDateValue(customDate);
      if (!selectedDate) return null;
      start = selectedDate;
      end = addLocalDays(selectedDate, 1);
      break;
    }
  }

  return { startMs: start.getTime(), endMs: end.getTime() };
}

function eventOverlapsDateRange(event: Event, range: DateFilterRange): boolean {
  return (event.occurrences ?? []).some((occurrence) => {
    const startMs = new Date(occurrence.dtstart_utc).getTime();
    if (Number.isNaN(startMs) || startMs >= range.endMs) return false;

    if (!occurrence.dtend_utc) {
      return startMs >= range.startMs;
    }

    const endMs = new Date(occurrence.dtend_utc).getTime();
    return !Number.isNaN(endMs) && endMs > range.startMs;
  });
}

function matchesSearchQuery(event: Event, normalizedQuery: string): boolean {
  return eventSearchHaystack(event).some((field) =>
    field.toLowerCase().replace(/^@+/, "").includes(normalizedQuery),
  );
}

/**
 * Filter events based on search and filter criteria
 */
export function filterEvents(
  events: Event[],
  filters: SearchFilters,
): Event[] {
  // Normalize the query once (loop-invariant) instead of recomputing per event.
  const q = filters.searchQuery ? normalizeSearchQuery(filters.searchQuery) : "";
  const isRandomSearch = q === RANDOM_EVENT_SEARCH_QUERY;
  // Set lookup is O(1); .includes on an array is O(n). When goingFilter is
  // active this is run per-event, so hoist and wrap once.
  const goingSet = filters.goingFilter ? new Set(filters.goingEventIds) : null;
  const addedSinceTime = filters.addedSince
    ? Date.parse(filters.addedSince)
    : Number.NaN;
  const dateRange = resolveDateFilterRange(
    filters.dateFilter,
    filters.customDate,
    new Date(),
  );

  const filtered = events.filter((event) => {
    const food = event.food ?? [];
    const price = event.price ?? 0;
    const category = getEventCategory(event);
    const dayOfWeek = getEventDayOfWeek(event);
    const needsRegistration = event.registration ?? false;

    if (q && !isRandomSearch && !matchesSearchQuery(event, q)) {
      return false;
    }

    if (goingSet && !goingSet.has(event.id)) {
      return false;
    }

    if (filters.freeFoodFilter && (food.length === 0 || price > 0)) {
      return false;
    }

    if (!Number.isNaN(addedSinceTime)) {
      const addedTime = new Date(event.added_at).getTime();
      if (Number.isNaN(addedTime) || addedTime < addedSinceTime) {
        return false;
      }
    }

    if (dateRange && !eventOverlapsDateRange(event, dateRange)) {
      return false;
    }

    if (filters.selectedDays.length > 0 && !filters.selectedDays.includes(dayOfWeek)) {
      return false;
    }

    // Maximum price only applies when the freeFood quick filter is off.
    if (!filters.freeFoodFilter) {
      if (filters.maxPrice && price > parseFloat(filters.maxPrice)) {
        return false;
      }
    }

    if (
      filters.selectedLocations.length > 0 &&
      !filters.selectedLocations.some((loc) =>
        (event.location ?? "").toLocaleLowerCase().includes(loc.toLocaleLowerCase()),
      )
    ) {
      return false;
    }

    if (
      filters.selectedFoods.length > 0 &&
      !filters.selectedFoods.some((query) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return normalizedQuery
          ? food.some((item) => item.toLocaleLowerCase().includes(normalizedQuery))
          : true;
      })
    ) {
      return false;
    }

    if (
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(category)
    ) {
      return false;
    }

    if (filters.registration && !needsRegistration) {
      return false;
    }

    if (
      filters.selectedOrganizations &&
      filters.selectedOrganizations.length > 0 &&
      !filters.selectedOrganizations.includes(event.organization ?? "")
    ) {
      return false;
    }

    return true;
  });

  if (!isRandomSearch || filtered.length === 0) {
    return filtered;
  }

  const randomEvent = filtered[Math.floor(Math.random() * filtered.length)];
  return randomEvent ? [randomEvent] : [];
}

/**
 * Sort events based on sort options
 */
export function sortEvents(
  events: Event[],
  sortOptions: SortOptions,
): Event[] {
  const { sortBy, sortOrder } = sortOptions;
  const sorted = [...events];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "date": {
        const getDateValue = (event: Event): number => {
          const primary = getPrimaryOccurrence(event);
          if (primary && primary.dtstart_utc) {
            const d = new Date(primary.dtstart_utc);
            if (!isNaN(d.getTime())) return d.getTime();
          }
          return 0;
        };
        const dateA = getDateValue(a);
        const dateB = getDateValue(b);
        comparison = dateA - dateB;
        break;
      }
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "location":
        comparison = (a.location ?? "").localeCompare(b.location ?? "");
        break;
      case "price":
        comparison = (a.price || 0) - (b.price || 0);
        break;
      case "added_at": {
        const dateA = new Date(a.added_at).getTime();
        const dateB = new Date(b.added_at).getTime();
        comparison =
          (Number.isNaN(dateA) ? 0 : dateA) -
          (Number.isNaN(dateB) ? 0 : dateB);
        break;
      }
      default:
        return 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });

  return sorted;
}

// Canonical home: shared/utils/filter.ts - re-exported for feature consumers
export { getFilterCounts } from "@/shared/utils/filter";
function getEventDayOfWeek(event: Event): string {
  const primary = getPrimaryOccurrence(event);
  if (!primary || !primary.dtstart_utc) return "";
  const date = new Date(primary.dtstart_utc);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "long" });
}
