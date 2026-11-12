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
 * Points an event earns toward topping up the featured row, one entry per
 * signal the feed carries: employers on campus weigh most, then competitions
 * and varsity games, the one-off events students regret missing; each
 * co-hosting club (up to two) marks a bigger, joint event.
 */
const FEATURED_SIGNALS: ReadonlyArray<readonly [points: number, earned: (event: Event) => number]> = [
  [2, event => Number(event.employers_on_campus === true)],
  [1, event => Number(event.competition === true)],
  [1, event => Number(event.sports_game === true)],
  [1, event => Math.min(event.cohosts?.length ?? 0, 2)],
];

function featuredScore(event: Event): number {
  return FEATURED_SIGNALS.reduce((score, [points, earned]) => score + points * earned(event), 0);
}

/**
 * The featured row's events: every event Wat2Do featured that is still on and
 * has a poster, soonest first. A school with fewer than `featuredCount` of
 * them tops the row up with one-off events that start within the window,
 * ranked by their signals, then soonest first, one per club.
 */
function pickFeaturedEvents(soonestFirst: readonly UpcomingEvent[], nowMs: number): Event[] {
  const { featuredCount, featuredWindowMs } = controlBox.eventDiscovery.highlights;
  const picked = soonestFirst
    .map(({ event }) => event)
    .filter(event => event.featured === true && Boolean(event.source_image_url));
  if (picked.length >= featuredCount) return picked;

  const clubOf = (event: Event) => event.club_id != null ? `id:${event.club_id}` : `name:${event.club ?? event.id}`;
  const clubs = new Set(picked.map(clubOf));
  const candidates = soonestFirst
    .filter(({ event, startMs }) =>
      event.featured !== true
      && startMs <= nowMs + featuredWindowMs
      && Boolean(event.source_image_url)
      && !recursAtLeastThreeWeeks(event))
    .map(({ event }) => ({ event, score: featuredScore(event) }))
    // Stable: equal scores keep their soonest-first order.
    .sort((a, b) => b.score - a.score);
  for (const { event } of candidates) {
    if (picked.length >= featuredCount) break;
    if (clubs.has(clubOf(event))) continue;
    clubs.add(clubOf(event));
    picked.push(event);
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
