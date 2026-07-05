const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

interface FormatRelativeTimeOptions {
  /** When true, never fall back to a calendar date — always "N minutes/hours/days ago". */
  alwaysAgo?: boolean;
}

/**
 * Format a date as a relative time string ("2 hours ago", "3 days ago", etc.).
 * By default falls back to locale date string for dates older than 7 days.
 */
export function formatRelativeTime(
  date: Date | string,
  t?: (key: string, opts?: Record<string, unknown>) => string,
  options?: FormatRelativeTimeOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return t ? t("common.justNow") : "just now";
  }

  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / MS_PER_MINUTE);
  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  const maxRelativeDays = options?.alwaysAgo ? Number.POSITIVE_INFINITY : 7;

  if (diffMins < 1) return t ? t("common.justNow") : "just now";
  if (diffMins < 60) {
    return t
      ? t("common.minuteAgo", { count: diffMins })
      : `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  }
  if (diffHours < 24) {
    return t
      ? t("common.hourAgo", { count: diffHours })
      : `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  }
  if (diffDays < maxRelativeDays) {
    return t
      ? t("common.dayAgo", { count: diffDays })
      : `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }
  return d.toLocaleDateString();
}

/**
 * Compact variant for tables/lists ("2m ago", "3h ago", "5d ago").
 */
export function formatRelativeTimeCompact(
  date: Date | string,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / MS_PER_MINUTE);
  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffMins < 1) return t ? t("common.justNow") : "just now";
  if (diffMins < 60) {
    return t
      ? t("common.minuteAgoCompact", { count: diffMins })
      : `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return t
      ? t("common.hourAgoCompact", { count: diffHours })
      : `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return t
      ? t("common.dayAgoCompact", { count: diffDays })
      : `${diffDays}d ago`;
  }
  return d.toLocaleDateString();
}
