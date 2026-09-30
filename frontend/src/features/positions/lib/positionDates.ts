import positionsControl from "../../../../../backend/controlbox/positions.json" with { type: "json" };
import { schoolCalendarDate } from "@/shared/utils/date";
import type { Position } from "@/shared/types";

function positionDeadline(position: Position): Date | null {
  const rawDeadline = position.deadline_at
    ? position.deadline_at
    : position.deadline_date
      ? `${position.deadline_date}T00:00:00Z`
      : null;
  if (!rawDeadline) return null;

  const deadline = new Date(rawDeadline);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

export function formatPositionDeadlineBadge(
  position: Position,
  locale: string,
  timeZone: string,
): string | null {
  const deadline = positionDeadline(position);
  if (!deadline) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: position.deadline_at ? timeZone : "UTC",
  }).format(deadline);
}

export function formatPositionDeadline(
  position: Position,
  locale: string,
  timeZone: string,
): string | null {
  const deadline = positionDeadline(position);
  if (!deadline) return null;
  return new Intl.DateTimeFormat(
    locale,
    position.deadline_at
      ? { dateStyle: "medium", timeStyle: "long", timeZone }
      : { dateStyle: "medium", timeZone: "UTC" },
  ).format(deadline);
}

/** Calendar day for the scroll indicator, preserving date-only deadlines. */
export function positionDeadlineCalendarDate(position: Position, timeZone: string): string | null {
  const deadline = positionDeadline(position);
  if (!deadline) return null;
  return schoolCalendarDate(deadline, position.deadline_at ? timeZone : "UTC").toISOString().slice(0, 10);
}


/** Match the backend's UTC calendar-month expiry, including short months and DST. */
export function undatedPositionCutoff(now: number): number {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - positionsControl.undated_visibility_months);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff.getTime();
}
