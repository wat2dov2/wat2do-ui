import { toZonedTime } from "date-fns-tz";
import type { Event } from "@/shared/types";
import { controlBox } from "@/shared/config/controlBox";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  event: Event;
}

/** Expand every occurrence, retaining the listing for the shared details drawer. */
export function toCalendarEvents(events: Event[], timeZone: string): CalendarEvent[] {
  return events.flatMap(event => (event.occurrences ?? []).flatMap(occurrence => {
    const startMs = Date.parse(occurrence.dtstart_utc);
    const endMs = occurrence.dtend_utc ? Date.parse(occurrence.dtend_utc) :
      startMs + controlBox.eventDiscovery.eventWithoutEndVisibilityMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{
      id: `${event.id}:${occurrence.id}`,
      title: event.title,
      start: toZonedTime(startMs, timeZone),
      end: toZonedTime(endMs, timeZone),
      event,
    }];
  }));
}
