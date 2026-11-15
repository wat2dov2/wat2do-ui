/** A calendar date such as "2026-11-14", written out in `language` ("November 14, 2026"). */
export function formatCalendarDate(isoDate: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** A number of minutes, hours or days with its unit, agreeing in `language` ("30 days", "30 jours"). */
export function formatDuration(value: number, unit: "minute" | "hour" | "day", language: string): string {
  return new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

/** Names joined the way `language` joins a list ("A, B and C"). */
export function formatList(names: string[], language: string): string {
  return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(names);
}
