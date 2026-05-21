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

const toMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sameDay = (firstDate: Date, secondDate: Date): boolean =>
  firstDate.toDateString() === secondDate.toDateString();

/**
 * Format event date string (e.g., "Tue, Jan 5")
 */
export function formatEventDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format time string (12-hour format)
 */
export function formatTime(timeStr: string): string {
  if (!timeStr) return "";
  const [hours, minutes] = timeStr.split(":");
  const h = parseInt(hours);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

/**
 * Format event date for card display (e.g., "Tuesday Jan 27")
 * Uses i18n locale for proper localization
 */
export function formatCardDate(
  event: { dtstart_utc?: string; dayOfWeek?: string; date?: string },
  locale: string = 'en-US'
): string {
  if (event.dtstart_utc) {
    const date = new Date(event.dtstart_utc);
    const dayOfWeek = date.toLocaleDateString(locale, { weekday: 'long' });
    const month = date.toLocaleDateString(locale, { month: 'short' });
    const day = date.getDate();
    return `${dayOfWeek} ${month} ${day}`;
  }
  // Fallback to old format
  if (event.dayOfWeek && event.date) {
    const parts = event.date.split(' ');
    if (parts.length >= 2) {
      return `${event.dayOfWeek} ${parts[0]} ${parts[1].replace(',', '')}`;
    }
    return `${event.dayOfWeek} ${event.date}`;
  }
  return event.date || '';
}

/**
 * Format event date for modal/detail display (e.g., "Mon, Jan 27, 2025").
 * Falls back to the raw `date` string, then to `dtstart_utc` / `eventDate`.
 */
export function formatDisplayDate(event: {
  date?: string;
  dtstart_utc?: string;
  eventDate?: Date;
}): string {
  if (event.date) return event.date;
  const raw = event.dtstart_utc || event.eventDate;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format event time for modal/detail display (e.g., "8:00 AM – 10:00 AM").
 * Falls back to the raw `time` string, then to `dtstart_utc` / `eventDate`.
 */
export function formatDisplayTime(event: {
  time?: string;
  dtstart_utc?: string;
  dtend_utc?: string;
  eventDate?: Date;
}): string {
  if (event.time) return event.time;
  const raw = event.dtstart_utc || event.eventDate;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const end = event.dtend_utc ? new Date(event.dtend_utc) : null;
  const start = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (end && !isNaN(end.getTime())) {
    return `${start} \u2013 ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return start;
}

/**
 * Format event time for card display (e.g., "12:30 PM to 3:00 PM")
 */
export function formatCardTime(event: {
  dtstart_utc?: string;
  dtend_utc?: string;
  time?: string;
}): string {
  if (event.dtstart_utc && event.dtend_utc) {
    const start = new Date(event.dtstart_utc);
    const end = new Date(event.dtend_utc);
    
    const formatTime = (date: Date): string => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const minutesStr = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
      return `${displayHours}${minutesStr} ${ampm}`;
    };
    
    return `${formatTime(start)} to ${formatTime(end)}`;
  }
  // Fallback to old format
  if (event.time) {
    // Convert "12:00 PM - 3:00 PM" to "12:00 PM to 3:00 PM"
    return event.time.replace(/\s*-\s*/g, ' to ');
  }
  return '';
}

/**
 * Categorize events for the event grid section headers.
 */
export function getEventDateCategory(
  event: {
    dtstart_utc?: string | null;
    dtend_utc?: string | null;
    eventDate?: Date;
  },
  currentDate: Date = new Date()
): EventDateCategory {
  const rawStart = event.dtstart_utc || event.eventDate;
  if (!rawStart) return "later";

  const parsedStart = new Date(rawStart);
  if (Number.isNaN(parsedStart.getTime())) return "later";

  const parsedEnd = event.dtend_utc ? new Date(event.dtend_utc) : parsedStart;
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
