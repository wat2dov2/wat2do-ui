import { getPrimaryOccurrence, hasActiveEventOccurrence } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

/** Upcoming events first, then newest history, independent of input order. */
export function orderClubEvents(events: Event[], nowMs: number): Event[] {
  const upcoming: Event[] = [];
  const past: Event[] = [];

  const currentDate = new Date(nowMs);
  const chronological = events.map(event => ({
    event,
    start: Date.parse(getPrimaryOccurrence(event, currentDate)?.dtstart_utc ?? "") || 0,
  })).sort((first, second) => first.start - second.start || first.event.id - second.event.id);
  for (const { event } of chronological) {
    (hasActiveEventOccurrence(event, nowMs) ? upcoming : past).push(event);
  }

  return [...upcoming, ...past.reverse()];
}
