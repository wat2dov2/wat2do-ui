/**
 * Date/Time Utilities
 * Consolidates date formatting and parsing functions
 */

/**
 * Format event date string
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
 * Get day of week from date string
 */
export function getDayOfWeek(
  dateStr: string,
  t: (key: string) => string
): string {
  const date = new Date(dateStr);
  const days = [
    t("days.sunday"),
    t("days.monday"),
    t("days.tuesday"),
    t("days.wednesday"),
    t("days.thursday"),
    t("days.friday"),
    t("days.saturday"),
  ];
  return days[date.getDay()];
}

/**
 * Parse date string to Date object
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Check if date string is valid
 */
export function isDateValid(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Format date for display (full format)
 */
export function formatDateFull(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format date for input (YYYY-MM-DD)
 */
export function formatDateForInput(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get smart defaults for event form (today's date, next hour)
 */
export function getSmartDefaults() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  const time = `${nextHour.getHours().toString().padStart(2, "0")}:00`;
  return { date: today, time };
}
