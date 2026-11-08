import type { Event } from "@/shared/types";
import {
  eventDateSectionKey,
  eventDateSectionOrder,
  getEventDateSection,
  hasEventEnded,
  type EventDateSection,
} from "@/shared/utils/date";

export interface DateSectionGroup {
  key: string;
  section: EventDateSection;
  events: Event[];
}

const PAST_SECTION: EventDateSection = { kind: "past" };

/**
 * Bucket events into date sections, ordered Today, Tomorrow, then week by week.
 *
 * Sections are derived from the events themselves, so only weeks that actually
 * have events get a heading. The server returns upcoming-only events; a
 * timezone-skew straggler can still land in the past and is dropped here - the
 * one place the list decides what's shown, so callers bucket unconditionally.
 * When the reader asked for past events (`includePast`), events that already
 * ended close the list in one Past section instead, most recent first.
 */
export function groupEventsByDateSection(
  events: Event[],
  getSchoolTimezone: (school: Event["school"]) => string,
  currentDate: Date = new Date(),
  includePast = false,
): DateSectionGroup[] {
  const groups = new Map<string, DateSectionGroup>();

  events.forEach((event) => {
    const ended = hasEventEnded(event, currentDate.getTime());
    const section = ended
      ? (includePast ? PAST_SECTION : null)
      : getEventDateSection(event, getSchoolTimezone(event.school), currentDate);
    if (!section) return;

    const key = eventDateSectionKey(section);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      return;
    }
    groups.set(key, { key, section, events: [event] });
  });

  // Events arrive in date order, so the Past section reverses them to lead with the latest.
  groups.get(eventDateSectionKey(PAST_SECTION))?.events.reverse();

  return [...groups.values()].sort(
    (a, b) => eventDateSectionOrder(a.section) - eventDateSectionOrder(b.section),
  );
}
