import type { Event } from "@/shared/types";
import type { EventDateFilter } from "@/shared/types/filter.types";
import type { SearchStoreFilterValues } from "@/features/search/api/filterService";
import {
  getPrimaryOccurrence,
  isActiveOrUpcomingOccurrence,
  parseLocalDateValue,
  schoolCalendarDate,
  addCalendarDays,
  localDateTimeToUtc,
} from "@/shared/utils/date";
import { getEventCategory, isVirtualLocation } from "@/shared/utils/event";

interface SearchFilters extends Omit<SearchStoreFilterValues, "sortBy" | "sortOrder"> {
  goingEventIds: number[];
}

type SortOptions = Pick<SearchStoreFilterValues, "sortBy" | "sortOrder">;

/** Include club names and Instagram handles already present in event summaries. */
function eventSearchHaystack(event: Event): string[] {
  return [
    event.title,
    event.club,
    event.ig_handle,
    event.club_ig,
    event.description,
    event.location,
    ...(event.food ?? []),
  ].filter((field): field is string => Boolean(field));
}

/** Ignore leading @ so pasted Instagram handles match. */
function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^@+/, "");
}

function normalizeSelectedValues(values: string[]): string[] {
  return values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
}

const RANDOM_EVENT_SEARCH_QUERY = "random";

interface DateFilterRange {
  startMs: number;
  endMs: number;
}

function resolveDateFilterRange(
  dateFilter: EventDateFilter,
  customDate: string,
  currentDate: Date,
  timeZone: string,
): DateFilterRange | null {
  if (dateFilter === "any") return null;

  const today = schoolCalendarDate(currentDate, timeZone);
  let start: Date;
  let end: Date;

  switch (dateFilter) {
    case "today":
      start = today;
      end = addCalendarDays(today, 1);
      break;
    case "tomorrow":
      start = addCalendarDays(today, 1);
      end = addCalendarDays(today, 2);
      break;
    case "thisWeek": {
      const daysUntilNextMonday = today.getUTCDay() === 0 ? 1 : 8 - today.getUTCDay();
      start = today;
      end = addCalendarDays(today, daysUntilNextMonday);
      break;
    }
    case "thisWeekend": {
      const day = today.getUTCDay();
      const daysUntilSaturday = day === 0 ? -1 : (6 - day + 7) % 7;
      start = addCalendarDays(today, daysUntilSaturday);
      end = addCalendarDays(start, 2);
      break;
    }
    case "nextWeek": {
      const daysSinceMonday = today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1;
      start = addCalendarDays(today, 7 - daysSinceMonday);
      end = addCalendarDays(start, 7);
      break;
    }
    case "custom": {
      const selectedDate = parseLocalDateValue(customDate);
      if (!selectedDate) return null;
      start = new Date(`${customDate}T00:00:00Z`);
      end = addCalendarDays(start, 1);
      break;
    }
  }

  return {
    startMs: Date.parse(localDateTimeToUtc(start.toISOString().slice(0, 16), timeZone)),
    endMs: Date.parse(localDateTimeToUtc(end.toISOString().slice(0, 16), timeZone)),
  };
}

function occurrenceOverlapsDateRange(occurrence: Event["occurrences"][number], range: DateFilterRange): boolean {
    const startMs = new Date(occurrence.dtstart_utc).getTime();
    if (Number.isNaN(startMs) || startMs >= range.endMs) return false;

    if (!occurrence.dtend_utc) {
      return startMs >= range.startMs;
    }

    const endMs = new Date(occurrence.dtend_utc).getTime();
    return !Number.isNaN(endMs) && endMs > range.startMs;
}

function matchesSearchQuery(event: Event, normalizedQuery: string): boolean {
  return eventSearchHaystack(event).some((field) =>
    field.toLowerCase().replace(/^@+/, "").includes(normalizedQuery),
  );
}

export function filterEvents(
  events: Event[],
  filters: SearchFilters,
  getSchoolTimezone: (school: Event["school"]) => string,
  goingCounts: Readonly<Record<string, { going_count: number }>> = {},
): Event[] {
  const q = filters.searchQuery ? normalizeSearchQuery(filters.searchQuery) : "";
  const isRandomSearch = q === RANDOM_EVENT_SEARCH_QUERY;
  const goingSet = filters.goingFilter ? new Set(filters.goingEventIds) : null;
  const locations = normalizeSelectedValues(filters.selectedLocations);
  const foods = normalizeSelectedValues(filters.selectedFoods);
  const clubs = normalizeSelectedValues(filters.selectedClubs);
  const minPrice = filters.minPrice ? parseFloat(filters.minPrice) : Number.NaN;
  const maxPrice = filters.maxPrice ? parseFloat(filters.maxPrice) : Number.NaN;
  const addedSinceTime = filters.addedSince
    ? Date.parse(filters.addedSince)
    : Number.NaN;
  const currentDate = new Date();
  const dateRanges = new Map<string, DateFilterRange | null>();
  // Carry only matching, still-visible sessions into cards and date sections.
  // Returning the original occurrence list could label a Today result Tomorrow.
  const candidates = filters.dateFilter !== "any"
    ? events.map((event) => {
      const timeZone = getSchoolTimezone(event.school);
      if (!dateRanges.has(timeZone)) {
        dateRanges.set(timeZone, resolveDateFilterRange(filters.dateFilter, filters.customDate, currentDate, timeZone));
      }
      const dateRange = dateRanges.get(timeZone);
      if (!dateRange) return event;
      return {
        ...event,
        occurrences: event.occurrences.filter((occurrence) =>
          isActiveOrUpcomingOccurrence(occurrence, currentDate.getTime()) &&
          occurrenceOverlapsDateRange(occurrence, dateRange),
        ),
      };
    }).filter((event) => event.occurrences.length > 0)
    : events;

  const filtered = candidates.filter((event) => {
    const food = event.food ?? [];
    const price = event.price ?? 0;

    if (q && !isRandomSearch && !matchesSearchQuery(event, q)) {
      return false;
    }

    if (goingSet && !goingSet.has(event.id)) {
      return false;
    }
    if ((goingCounts[event.id]?.going_count ?? 0) < filters.minGoing) return false;

    if (filters.eventFormat !== "any") {
      const location = event.location?.trim() ?? "";
      if (!location || isVirtualLocation(location) !== (filters.eventFormat === "online")) return false;
    }

    if (filters.hasFoodFilter && food.length === 0) {
      return false;
    }

    if (!Number.isNaN(addedSinceTime)) {
      const addedTime = new Date(event.added_at).getTime();
      if (Number.isNaN(addedTime) || addedTime < addedSinceTime) {
        return false;
      }
    }

    if (filters.selectedDays.length > 0) {
      const weekdays = getEventWeekdays(event, getSchoolTimezone(event.school));
      if (!filters.selectedDays.every((day) => weekdays.has(day))) return false;
    }

    if (price < minPrice || price > maxPrice) return false;

    if (locations.length > 0) {
      const location = (event.location ?? "").toLocaleLowerCase();
      if (!locations.every((query) => location.includes(query))) return false;
    }

    if (foods.length > 0) {
      const availableFoods = food.map((item) => item.toLocaleLowerCase());
      if (!foods.every((query) => availableFoods.some((item) => item.includes(query)))) {
        return false;
      }
    }

    if (
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(getEventCategory(event))
    ) {
      return false;
    }

    if (filters.registration && !event.registration) {
      return false;
    }

    if (clubs.length > 0) {
      const club = (event.club ?? "").toLocaleLowerCase();
      if (!clubs.every((query) => club.includes(query))) return false;
    }

    return true;
  });

  if (!isRandomSearch || filtered.length === 0) {
    return filtered;
  }

  const randomEvent = filtered[Math.floor(Math.random() * filtered.length)];
  return randomEvent ? [randomEvent] : [];
}

function eventSortValue(event: Event, sortBy: string): string | number {
  switch (sortBy) {
    case "date": {
      const primary = getPrimaryOccurrence(event);
      const timestamp = primary?.dtstart_utc
        ? new Date(primary.dtstart_utc).getTime()
        : Number.NaN;
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    case "title":
      return event.title;
    case "location":
      return event.location ?? "";
    case "price":
      return event.price || 0;
    case "added_at": {
      const timestamp = new Date(event.added_at).getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    default:
      return 0;
  }
}

export function sortEvents(
  events: Event[],
  { sortBy, sortOrder }: SortOptions,
): Event[] {
  const ranked = events.map((event) => ({
    event,
    value: eventSortValue(event, sortBy),
  }));
  ranked.sort((a, b) => {
    const comparison = typeof a.value === "string" && typeof b.value === "string"
      ? a.value.localeCompare(b.value)
      : Number(a.value) - Number(b.value);
    return sortOrder === "asc" ? comparison : -comparison;
  });
  return ranked.map(({ event }) => event);
}

function getEventWeekdays(event: Event, timeZone: string): Set<string> {
  return new Set((event.occurrences ?? []).flatMap((occurrence) => {
    const date = new Date(occurrence.dtstart_utc);
    return Number.isNaN(date.getTime()) ? [] : [
      date.toLocaleDateString("en-US", { weekday: "long", timeZone }),
    ];
  }));
}
