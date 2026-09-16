import { controlBox } from "@/shared/config/controlBox";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** Calendar-only dates use UTC fields for arithmetic, not as event instants. */
export function schoolCalendarDate(value: Date | string | number, timeZone: string): Date {
  return new Date(`${formatInTimeZone(value, timeZone, "yyyy-MM-dd")}T00:00:00Z`);
}

export function toLocalDateTimeInput(value: Date | string | number, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd'T'HH:mm");
}

export function localDateTimeToUtc(value: string, timeZone: string, originalUtc?: string): string {
  // Preserve an unchanged instant, including the second occurrence of a repeated DST hour.
  if (originalUtc && toLocalDateTimeInput(originalUtc, timeZone) === value) return originalUtc;
  const instant = fromZonedTime(value, timeZone);
  if (!Number.isFinite(instant.getTime()) || toLocalDateTimeInput(instant, timeZone) !== value.slice(0, 16)) {
    throw new RangeError("Invalid school-local date/time");
  }
  return instant.toISOString();
}

/**
 * Where an event sits in the feed's date sections: the two named near-term
 * sections, or a Monday-to-Sunday week range. Everything beyond tomorrow is a
 * range, so the feed reads "Today, Tomorrow, <rest of this week>, then one
 * section per following week".
 */
export type EventDateSection =
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "range"; startMs: number; endMs: number };

export interface Occurrence {
  dtstart_utc: string;
  dtend_utc?: string | null;
}

/**
 * The moment an occurrence stops being visible in the feed.
 *
 * An occurrence with no end time stays visible for a fixed window after it
 * starts. This is the single definition of "still visible" - both the filter
 * that decides which events are counted and the date sectioning that decides
 * where they render read it, so the header count can never disagree with the
 * list. Returns `null` when the occurrence has no usable start.
 */
function occurrenceVisibleUntilMs(occurrence: Occurrence): number | null {
  const startTimeMs = new Date(occurrence.dtstart_utc).getTime();
  if (Number.isNaN(startTimeMs)) return null;

  if (occurrence.dtend_utc) {
    const endTimeMs = new Date(occurrence.dtend_utc).getTime();
    if (!Number.isNaN(endTimeMs)) return endTimeMs;
  }

  return startTimeMs + controlBox.eventDiscovery.eventWithoutEndVisibilityMs;
}

/** Whether an occurrence is still in progress or starts in the future. */
export function isActiveOrUpcomingOccurrence(
  occurrence: Occurrence,
  currentTimeMs: number,
): boolean {
  const visibleUntilMs = occurrenceVisibleUntilMs(occurrence);
  return visibleUntilMs !== null && visibleUntilMs >= currentTimeMs;
}

export function hasActiveEventOccurrence(
  event: { occurrences?: Occurrence[] },
  currentTimeMs: number,
): boolean {
  return (event.occurrences ?? []).some((occurrence) =>
    isActiveOrUpcomingOccurrence(occurrence, currentTimeMs),
  );
}

const sameDay = (firstDate: Date, secondDate: Date): boolean =>
  firstDate.getTime() === secondDate.getTime();

/** Parse a date-only form value as local calendar time, never UTC midnight. */
export function parseLocalDateValue(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : undefined;
}

/**
 * Resolve the primary occurrence from an event's occurrences list.
 * Earliest active or future occurrence wins; only falls back after all sessions end.
 */
export function getPrimaryOccurrence(event: { occurrences?: Occurrence[] }, currentDate = new Date()): Occurrence | null {
  const occurrences = event.occurrences;
  if (!occurrences || occurrences.length === 0) {
    return null;
  }
  const active = occurrences.filter(o => isActiveOrUpcomingOccurrence(o, currentDate.getTime()));
  const pool = active.length > 0 ? active : occurrences;
  const sorted = [...pool].sort((a, b) => new Date(a.dtstart_utc).getTime() - new Date(b.dtstart_utc).getTime());
  return sorted[0] || null;
}

/** Compact time-until label ("3d 4h", "15h 34m", "12m"); null once the start has passed. */
export function formatCountdown(startMs: number, nowMs: number): string | null {
  const diff = startMs - nowMs;
  if (diff <= 0) return null;
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function isEventHappeningNow(
  event: { occurrences?: Occurrence[] },
  currentDate: Date = new Date()
): boolean {
  const primary = getPrimaryOccurrence(event, currentDate);
  if (!primary?.dtstart_utc) return false;

  const start = new Date(primary.dtstart_utc);
  if (Number.isNaN(start.getTime())) return false;

  const now = currentDate.getTime();
  if (now < start.getTime()) return false;

  // An event with no end time is treated as running for the same window the
  // feed already keeps it visible for, rather than never counting as live.
  if (!primary.dtend_utc) {
    return now - start.getTime() <= controlBox.eventDiscovery.eventWithoutEndVisibilityMs;
  }

  const end = new Date(primary.dtend_utc);
  if (Number.isNaN(end.getTime())) return false;
  return now <= end.getTime();
}

export function wasAddedWithinLast24Hours(
  event: { added_at?: string | null },
  currentDate: Date = new Date()
): boolean {
  if (!event.added_at) return false;

  const addedAt = new Date(event.added_at);
  if (Number.isNaN(addedAt.getTime())) return false;

  const ageMs = currentDate.getTime() - addedAt.getTime();
  return ageMs >= 0 && ageMs <= controlBox.eventDiscovery.newEventWindowMs;
}

/**
 * Format an event date for compact card display.
 * Today and tomorrow use localized relative labels; later dates use the full
 * localized weekday so cards never abbreviate Monday to Mon, for example.
 */
export function formatCardDate(
  event: { occurrences?: Occurrence[] },
  timeZone: string,
  locale: string = "en-US",
  currentDate: Date = new Date(),
): string {
  const primary = getPrimaryOccurrence(event, currentDate);
  if (primary && primary.dtstart_utc) {
    const date = new Date(primary.dtstart_utc);
    if (Number.isNaN(date.getTime())) return "";

    const relativeDateFormatter = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
    });
    const formatRelativeDate = (offset: 0 | 1): string => {
      const label = relativeDateFormatter.format(offset, "day");
      return `${label.charAt(0).toLocaleUpperCase(locale)}${label.slice(1)}`;
    };

    const day = schoolCalendarDate(date, timeZone);
    const today = schoolCalendarDate(currentDate, timeZone);
    if (sameDay(day, today)) return formatRelativeDate(0);
    if (sameDay(day, addCalendarDays(today, 1))) return formatRelativeDate(1);

    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(date);
  }
  return "";
}

/**
 * Format event time for card display (e.g., "12:30 PM to 3:00 PM")
 */
export function formatCardTime(event: {
  occurrences?: Occurrence[];
}, timeZone: string, locale = "en-US"): string {
  const primary = getPrimaryOccurrence(event);
  if (primary && primary.dtstart_utc) {
    const start = new Date(primary.dtstart_utc);
    const parsedEnd = primary.dtend_utc ? new Date(primary.dtend_utc) : null;
    const end = parsedEnd && parsedEnd.getTime() >= start.getTime() ? parsedEnd : null;
    
    if (!Number.isFinite(start.getTime())) return "";
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short",
      ...(end && !sameDay(schoolCalendarDate(start, timeZone), schoolCalendarDate(end, timeZone))
        ? { month: "short", day: "numeric" } as const : {}),
    });
    return end && Number.isFinite(end.getTime())
      ? formatter.formatRange(start, end)
      : formatter.format(start);
  }
  return '';
}

export const addCalendarDays = (date: Date, days: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

/** Sunday that closes the Monday-to-Sunday week containing `date`. */
function endOfWeek(date: Date): Date {
  return addCalendarDays(date, (7 - date.getUTCDay()) % 7);
}

/** Monday that opens the Monday-to-Sunday week containing `date`. */
function startOfWeek(date: Date): Date {
  return addCalendarDays(date, date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay());
}

/**
 * Place an event in the feed's date sections. Returns `null` for events that
 * already ended, which the feed drops.
 */
export function getEventDateSection(
  event: {
    occurrences?: Occurrence[];
  },
  timeZone: string,
  currentDate: Date = new Date()
): EventDateSection | null {
  if (!hasActiveEventOccurrence(event, currentDate.getTime())) return null;

  const primary = getPrimaryOccurrence(event, currentDate);
  const rawStart = primary?.dtstart_utc;
  if (!rawStart) return null;

  const parsedStart = new Date(rawStart);
  if (Number.isNaN(parsedStart.getTime())) return null;

  // Read the same visibility rule the filter uses: an occurrence with no end
  // time runs until its visibility window closes. Deriving the end any other
  // way lets an event be counted as upcoming but land in no section, which
  // renders an empty feed under a non-zero count.
  const visibleUntilMs = occurrenceVisibleUntilMs(primary);
  const startDate = schoolCalendarDate(parsedStart, timeZone);
  const endDate =
    visibleUntilMs === null ? startDate : schoolCalendarDate(visibleUntilMs, timeZone);
  const todayDate = schoolCalendarDate(currentDate, timeZone);
  const tomorrowDate = addCalendarDays(todayDate, 1);

  // Multi-day events surface in the earliest section they are still running in.
  if (todayDate >= startDate && todayDate <= endDate) return { kind: "today" };
  if (
    (tomorrowDate >= startDate && tomorrowDate <= endDate) ||
    sameDay(startDate, tomorrowDate)
  ) {
    return { kind: "tomorrow" };
  }
  if (endDate < todayDate) return null;

  // The current week's section starts the day after tomorrow so it never
  // repeats what the Today and Tomorrow sections already show.
  const thisWeekEnd = endOfWeek(todayDate);
  const thisWeekStart = addCalendarDays(todayDate, 2);
  if (startDate <= thisWeekEnd) {
    return thisWeekStart > thisWeekEnd
      ? null
      : { kind: "range", startMs: thisWeekStart.getTime(), endMs: thisWeekEnd.getTime() };
  }

  return {
    kind: "range",
    startMs: startOfWeek(startDate).getTime(),
    endMs: endOfWeek(startDate).getTime(),
  };
}

/** Stable identity for a section, used to bucket and order events. */
export function eventDateSectionKey(section: EventDateSection): string {
  return section.kind === "range" ? `range:${section.startMs}` : section.kind;
}

/** Today and Tomorrow always lead; week ranges follow in chronological order. */
export function eventDateSectionOrder(section: EventDateSection): number {
  if (section.kind === "today") return -2;
  if (section.kind === "tomorrow") return -1;
  return section.startMs;
}

/** "Sun Jul 26 - Sun Aug 2" (single day collapses to one label). */
export function formatEventDateSectionRange(
  startMs: number,
  endMs: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const formatDay = (ms: number): string => {
    const parts = formatter.formatToParts(new Date(ms));
    const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${partValue("weekday")} ${partValue("month")} ${partValue("day")}`.trim();
  };

  const start = formatDay(startMs);
  const end = formatDay(endMs);
  return start === end ? start : t("events.dateSections.range", { start, end });
}

/**
 * Format a single occurrence into a badge label (e.g. "Monday May 25, 6:00 PM - 7:00 PM" or "Today, 6:00 PM - 7:00 PM")
 */
export function formatOccurrence(
  occurrence: { dtstart_utc: string; dtend_utc?: string | null },
  timeZone: string,
  locale: string = "en-US"
): string {
  const start = new Date(occurrence.dtstart_utc);
  if (isNaN(start.getTime())) return "";

  const event = { occurrences: [occurrence] };
  return `${formatCardDate(event, timeZone, locale)}, ${formatCardTime(event, timeZone, locale)}`;
}
