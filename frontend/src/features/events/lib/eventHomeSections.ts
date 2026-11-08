import { recursAtLeastThreeWeeks } from "@/features/search/api/searchService";
import { controlBox } from "@/shared/config/controlBox";
import type { Event } from "@/shared/types";
import { getPrimaryOccurrence, hasActiveEventOccurrence } from "@/shared/utils/date";
import { getUniqueEvents, isNetworkingEvent } from "@/shared/utils/event";

/** What the events page shows above its grid, cut from the events still on. */
export interface EventHomeSections {
  /** The banner's events, most important first. */
  mustKnow: Event[];
  /** Employer and business events, soonest first. */
  networking: Event[];
  /** Events Wat2Do published to Instagram, soonest first. */
  featured: Event[];
}

interface UpcomingEvent {
  event: Event;
  /** The start of its next (or current) occurrence. */
  startMs: number;
}

/**
 * Points an event earns toward the must-know banner, one entry per signal the
 * feed carries. Featured events were picked by hand for Wat2Do's Instagram, so
 * they weigh most; employers on campus, competitions and varsity games are the
 * one-off events students regret missing; each co-hosting club (up to two)
 * marks a bigger, joint event.
 */
const MUST_KNOW_SIGNALS: ReadonlyArray<readonly [points: number, earned: (event: Event) => number]> = [
  [3, event => Number(event.featured === true)],
  [2, event => Number(event.employers_on_campus === true)],
  [1, event => Number(event.competition === true)],
  [1, event => Number(event.sports_game === true)],
  [1, event => Math.min(event.cohosts?.length ?? 0, 2)],
];

function mustKnowScore(event: Event): number {
  return MUST_KNOW_SIGNALS.reduce((score, [points, earned]) => score + points * earned(event), 0);
}

/**
 * The must-know banner's events: one-off events with a poster that are on now
 * or start within the window, ranked by their signals, then soonest first. A
 * club appears once, so the banner shows several clubs' biggest events.
 */
function pickMustKnowEvents(soonestFirst: readonly UpcomingEvent[], nowMs: number): Event[] {
  const { mustKnowCount, mustKnowWindowMs } = controlBox.eventDiscovery.homeSections;
  const candidates = soonestFirst
    .filter(({ event, startMs }) =>
      startMs <= nowMs + mustKnowWindowMs
      && Boolean(event.source_image_url)
      && !recursAtLeastThreeWeeks(event))
    .map(({ event }) => ({ event, score: mustKnowScore(event) }))
    // Stable: equal scores keep their soonest-first order.
    .sort((a, b) => b.score - a.score);
  const clubs = new Set<string>();
  const picked: Event[] = [];
  for (const { event } of candidates) {
    const club = event.club_id != null ? `id:${event.club_id}` : `name:${event.club ?? event.id}`;
    if (clubs.has(club)) continue;
    clubs.add(club);
    picked.push(event);
    if (picked.length === mustKnowCount) break;
  }
  return picked;
}

/**
 * The events page's sections as of `nowMs`. The server cuts them into the
 * page's first screen and the browser cuts them again from the complete feed,
 * through this one function, so both draw the same sections.
 */
export function buildEventHomeSections(events: readonly Event[], nowMs: number): EventHomeSections {
  const now = new Date(nowMs);
  const soonestFirst = getUniqueEvents([...events])
    .filter(event => !event.cancelled && hasActiveEventOccurrence(event, nowMs))
    .map((event): UpcomingEvent => ({
      event,
      startMs: Date.parse(getPrimaryOccurrence(event, now)?.dtstart_utc ?? "") || Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.event.id - b.event.id);
  const rowEvents = (belongs: (event: Event) => boolean) => soonestFirst
    .map(({ event }) => event)
    .filter(belongs)
    .slice(0, controlBox.eventDiscovery.homeSections.rowEventCount);

  return {
    mustKnow: pickMustKnowEvents(soonestFirst, nowMs),
    networking: rowEvents(isNetworkingEvent),
    featured: rowEvents(event => event.featured === true),
  };
}
