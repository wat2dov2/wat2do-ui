import { addDays, format } from "date-fns";
import { parseLocalDateValue } from "@/shared/utils/date";

const DAY_FORMAT = "yyyy-MM-dd";

/** Today in the admin's own time zone, written as the day picker writes days. */
export function todayValue(now: Date = new Date()): string {
  return format(now, DAY_FORMAT);
}

/** The day `days` after `day` (before it when negative). */
export function shiftDay(day: string, days: number): string {
  return format(addDays(parseLocalDateValue(day) ?? new Date(), days), DAY_FORMAT);
}

/** When a day starts and ends in the admin's own time zone, as the API reads a window. */
export function dayWindow(day: string): { since: string; until: string } {
  const start = parseLocalDateValue(day) ?? new Date();
  return { since: start.toISOString(), until: addDays(start, 1).toISOString() };
}
