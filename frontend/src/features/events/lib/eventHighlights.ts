import { recursAtLeastThreeWeeks } from "@/features/search/api/searchService";
import { controlBox } from "@/shared/config/controlBox";
import type { Event } from "@/shared/types";
import { getPrimaryOccurrence, hasActiveEventOccurrence } from "@/shared/utils/date";
import { getUniqueEvents, isNetworkingEvent } from "@/shared/utils/event";

/** What the events page shows above its grid, cut from the events still on. */
export interface EventHighlights {
  /** The featured row at the top of the page, most important first. */
  featured: Event[];
  /** Events most recently added to Wat2Do, newest first. */
  fresh: Event[];
  /** Employer and business events, soonest first. */
  networking: Event[];
}

interface UpcomingEvent {
  event: Event;
  /** The start of its next (or current) occurrence. */
  startMs: number;
}

/**
 * Points an event earns toward the featured row, one entry per signal the
 * feed carries. Events Wat2Do featured on Instagram were picked by hand, so
 * they weigh most; employers on campus, competitions and varsity games are the
 * one-off events students regret missing; each co-hosting club (up to two)
 * marks a bigger, joint event.
 */
const FEATURED_SIGNALS: ReadonlyArray<readonly [points: number, earned: (event: Event) => number]> = [
  [3, event => Number(event.featured === true)],
  [2, event => Number(event.employers_on_campus === true)],
  [1, event => Number(event.competition === true)],
  [1, event => Number(event.sports_game === true)],
  [1, event => Math.min(event.cohosts?.length ?? 0, 2)],
];

function featuredScore(event: Event): number {
  return FEATURED_SIGNALS.reduce((score, [points, earned]) => score + points * earned(event), 0);
}

/**
 * The featured row's events: one-off events with a poster that are on now or
 * start within the window, ranked by their signals, then soonest first. A club
 * appears once, so the row shows several clubs' biggest events.
 */
function pickFeaturedEvents(soonestFirst: readonly UpcomingEvent[], nowMs: number): Event[] {
  const { featuredCount, featuredWindowMs } = controlBox.eventDiscovery.highlights;
  const candidates = soonestFirst
    .filter(({ event, startMs }) =>
      startMs <= nowMs + featuredWindowMs
      && Boolean(event.source_image_url)
      && !recursAtLeastThreeWeeks(event))
    .map(({ event }) => ({ event, score: featuredScore(event) }))
    // Stable: equal scores keep their soonest-first order.
    .sort((a, b) => b.score - a.score);
  const clubs = new Set<string>();
  const picked: Event[] = [];
  for (const { event } of candidates) {
    const club = event.club_id != null ? `id:${event.club_id}` : `name:${event.club ?? event.id}`;
    if (clubs.has(club)) continue;
    clubs.add(club);
    picked.push(event);
    if (picked.length === featuredCount) break;
  }
  return picked;
}

/**
 * The events page's highlights as of `nowMs`. The server cuts them into the
 * page's first screen and the browser cuts them again from the complete feed,
 * through this one function, so both draw the same highlights.
 */
export function buildEventHighlights(events: readonly Event[], nowMs: number): EventHighlights {
  const now = new Date(nowMs);
  const soonestFirst = getUniqueEvents([...events])
    .filter(event => !event.cancelled && hasActiveEventOccurrence(event, nowMs))
    .map((event): UpcomingEvent => ({
      event,
      startMs: Date.parse(getPrimaryOccurrence(event, now)?.dtstart_utc ?? "") || Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.event.id - b.event.id);
  const { rowCardCount } = controlBox.eventDiscovery.highlights;
  const featured = pickFeaturedEvents(soonestFirst, nowMs);
  const shown = new Set(featured.map(event => event.id));

  return {
    featured,
    // The newest additions the featured row doesn't already show.
    fresh: soonestFirst
      .map(({ event }) => event)
      .filter(event => !shown.has(event.id))
      .sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at) || b.id - a.id)
      .slice(0, rowCardCount),
    networking: soonestFirst
      .map(({ event }) => event)
      .filter(isNetworkingEvent)
      .slice(0, rowCardCount),
  };
}
