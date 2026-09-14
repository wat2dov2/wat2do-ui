import { hasActiveEventOccurrence } from "@/shared/utils/date";
import type { Event } from "@/shared/types";

/**
 * A club's events, ordered the way its page reads them: what is still
 * to come first (soonest first), then its history (most recent first).
 *
 * The backend returns one flat date-ascending list, so the unordered form opens
 * the page on the host's oldest event. That matters beyond taste, because this
 * ordering depends on the current time and the current time is not known during
 * the server render. Leaving the list untouched until a clock arrived meant the
 * page painted the oldest events and then rearranged itself into the right ones
 * a tick later. The server calls this with its own clock instead, so the first
 * paint is already correct and the client's later pass agrees with it.
 */
export function orderClubEvents(events: Event[], nowMs: number): Event[] {
  const upcoming: Event[] = [];
  const past: Event[] = [];

  for (const event of events) {
    (hasActiveEventOccurrence(event, nowMs) ? upcoming : past).push(event);
  }

  return [...upcoming, ...past.reverse()];
}
