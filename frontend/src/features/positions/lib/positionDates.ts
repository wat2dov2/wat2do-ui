import type { Position } from "@/shared/types";

function positionDeadline(position: Position): Date | null {
  const rawDeadline = position.deadline_at
    ? position.deadline_at
    : position.deadline_date
      ? `${position.deadline_date}T12:00:00`
      : null;
  if (!rawDeadline) return null;

  const deadline = new Date(rawDeadline);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

export function formatPositionDeadlineBadge(
  position: Position,
  locale: string,
): string | null {
  const deadline = positionDeadline(position);
  if (!deadline) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(deadline);
}

export function formatPositionDeadline(
  position: Position,
  locale: string,
): string | null {
  const deadline = positionDeadline(position);
  if (!deadline) return null;
  return new Intl.DateTimeFormat(
    locale,
    position.deadline_at
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  ).format(deadline);
}
