/**
 * Date/Time Utilities
 * Consolidates date formatting and parsing functions
 */

export type EventDateCategory =
  | "today"
  | "tomorrow"
  | "later this week"
  | "later this month"
  | "later"
  | "past";

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
    const dayOfWeek = date.toLocaleDateString(locale, { weekday: 'long' });
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

/**
 * Categorize events for the event grid section headers.
 */
export function getEventDateCategory(
  event: {
    occurrences?: Occurrence[];
  },
  currentDate: Date = new Date()
): EventDateCategory {
  const primary = getPrimaryOccurrence(event);
  const rawStart = primary?.dtstart_utc;
  if (!rawStart) return "later";

  const parsedStart = new Date(rawStart);
  if (Number.isNaN(parsedStart.getTime())) return "later";

  const parsedEnd = primary?.dtend_utc ? new Date(primary.dtend_utc) : parsedStart;
  const startDate = toMidnight(parsedStart);
  const endDate = Number.isNaN(parsedEnd.getTime())
    ? startDate
    : toMidnight(parsedEnd);
  const todayDate = toMidnight(currentDate);
  const tomorrowDate = toMidnight(
    new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() + 1
    )
  );
  const endOfWeek = toMidnight(
    new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() + ((7 - todayDate.getDay()) % 7)
    )
  );
  const endOfMonth = toMidnight(
    new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0)
  );

  if (todayDate >= startDate && todayDate <= endDate) return "today";
  if (
    (tomorrowDate >= startDate && tomorrowDate <= endDate) ||
    sameDay(startDate, tomorrowDate)
  ) {
    return "tomorrow";
  }
  if (endDate < todayDate) return "past";
  if (startDate <= endOfWeek) return "later this week";
  if (startDate <= endOfMonth) return "later this month";
  return "later";
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

