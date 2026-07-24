import { controlBox } from "@/shared/config/controlBox";

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

const toMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sameDay = (firstDate: Date, secondDate: Date): boolean =>
  firstDate.toDateString() === secondDate.toDateString();

/**
 * Resolve the primary occurrence from an event's occurrences list.
 * Earliest future occurrence wins; falls back to earliest past occurrence if all are in the past.
 */
export function getPrimaryOccurrence(event: { occurrences?: Occurrence[] }): Occurrence | null {
  const occurrences = event.occurrences;
  if (!occurrences || occurrences.length === 0) {
    return null;
  }
  const now = new Date();
  const future = occurrences.filter(o => new Date(o.dtstart_utc) >= now);
  const pool = future.length > 0 ? future : occurrences;
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
  const primary = getPrimaryOccurrence(event);
  if (!primary?.dtstart_utc || !primary.dtend_utc) return false;

  const start = new Date(primary.dtstart_utc);
  const end = new Date(primary.dtend_utc);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

  const now = currentDate.getTime();
  return start.getTime() <= now && now <= end.getTime();
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
 * Format event date for card display (e.g., "Tuesday Jan 27")
 * Uses i18n locale for proper localization
 */
export function formatCardDate(
  event: { occurrences?: Occurrence[] },
  locale: string = 'en-US'
): string {
  const primary = getPrimaryOccurrence(event);
  if (primary && primary.dtstart_utc) {
    const date = new Date(primary.dtstart_utc);
    const englishWeekdays = ["Sun", "Mon", "Tues", "Wed", "Thur", "Fri", "Sat"];
    const dayOfWeek = locale.toLowerCase().startsWith("en")
      ? englishWeekdays[date.getDay()]
      : date.toLocaleDateString(locale, { weekday: "short" });
    const month = date.toLocaleDateString(locale, { month: 'short' });
    const day = date.getDate();
    return `${dayOfWeek} ${month} ${day}`;
  }
  return '';
}

/**
 * Format event time for card display (e.g., "12:30 PM to 3:00 PM")
 */
export function formatCardTime(event: {
  occurrences?: Occurrence[];
}): string {
  const primary = getPrimaryOccurrence(event);
  if (primary && primary.dtstart_utc) {
    const start = new Date(primary.dtstart_utc);
    const end = primary.dtend_utc ? new Date(primary.dtend_utc) : null;
    
    const formatTime = (date: Date): string => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const minutesStr = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
      return `${displayHours}${minutesStr} ${ampm}`;
    };
    
    return end ? `${formatTime(start)} to ${formatTime(end)}` : formatTime(start);
  }
  return '';
}

const addDays = (date: Date, days: number): Date =>
  toMidnight(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));

/** Sunday that closes the Monday-to-Sunday week containing `date`. */
function endOfWeek(date: Date): Date {
  return addDays(date, (7 - date.getDay()) % 7);
}

/** Monday that opens the Monday-to-Sunday week containing `date`. */
function startOfWeek(date: Date): Date {
  return addDays(date, date.getDay() === 0 ? -6 : 1 - date.getDay());
}

/**
 * Place an event in the feed's date sections. Returns `null` for events that
 * already ended, which the feed drops.
 */
export function getEventDateSection(
  event: {
    occurrences?: Occurrence[];
  },
  currentDate: Date = new Date()
): EventDateSection | null {
  const primary = getPrimaryOccurrence(event);
  const rawStart = primary?.dtstart_utc;
  if (!rawStart) return null;

  const parsedStart = new Date(rawStart);
  if (Number.isNaN(parsedStart.getTime())) return null;

  const parsedEnd = primary?.dtend_utc ? new Date(primary.dtend_utc) : parsedStart;
  const startDate = toMidnight(parsedStart);
  const endDate = Number.isNaN(parsedEnd.getTime())
    ? startDate
    : toMidnight(parsedEnd);
  const todayDate = toMidnight(currentDate);
  const tomorrowDate = addDays(todayDate, 1);

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
  const thisWeekStart = addDays(todayDate, 2);
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
  t: (key: string) => string,
  locale: string = "en-US"
): string {
  const start = new Date(occurrence.dtstart_utc);
  if (isNaN(start.getTime())) return "";

  let datePrefix = "";
  const today = new Date();
  
  if (sameDay(start, today)) {
    const translated = t("filters.today");
    datePrefix = translated === "filters.today" ? "Today" : translated;
  } else {
    const weekday = start.toLocaleDateString(locale, { weekday: "long" });
    const month = start.toLocaleDateString(locale, { month: "short" });
    const day = start.getDate();
    datePrefix = `${weekday} ${month} ${day}`;
  }

  const formatTime = (d: Date): string => {
    return d.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const startStr = formatTime(start);
  if (occurrence.dtend_utc) {
    const end = new Date(occurrence.dtend_utc);
    if (!isNaN(end.getTime())) {
      return `${datePrefix}, ${startStr} - ${formatTime(end)}`;
    }
  }
  return `${datePrefix}, ${startStr}`;
}
