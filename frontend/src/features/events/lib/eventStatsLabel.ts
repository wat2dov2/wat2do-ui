import type { TFunction } from "i18next";
import type { EventStats } from "@/features/events/api/events.api";

/** An event's live counts as one line ("12 clicks · 4 going"), or nothing until it has any. */
export function buildEventStatsLabel(
  t: TFunction,
  stats: EventStats | undefined,
): string | undefined {
  if (!stats) return undefined;

  const parts = [
    stats.click_count > 0 ? t("events.clickCount", { count: stats.click_count }) : null,
    stats.going_count > 0 ? t("events.goingCount", { count: stats.going_count }) : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}
