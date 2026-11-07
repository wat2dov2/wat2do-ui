import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import type { Club, Event } from "@/shared/types";
import { hasActiveEventOccurrence } from "@/shared/utils/date";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Clubs the clubs preview shows. */
const PREVIEW_CLUBS = 2;

/**
 * Everything the landing page shows about one school, from its published
 * feeds. A feed that cannot be read leaves its numbers null, never zero, so
 * the page says nothing rather than something untrue.
 */
export interface LandingSnapshot {
  /** Upcoming events at the school, in the feed's order. */
  events: Event[] | null;
  /** Upcoming events first added in the last seven days. */
  newThisWeekCount: number | null;
  /** Upcoming events with an occurrence starting in the next seven days. */
  thisWeekCount: number | null;
  /** Upcoming events with food that cost nothing, as the feed's free food filter finds them. */
  freeFoodCount: number | null;
  /** Clubs in the school's directory. */
  clubCount: number | null;
  /** The first clubs in the directory that have a logo, for the clubs preview. */
  previewClubs: Club[];
  /** Open club positions at the school. */
  positionCount: number | null;
}

function startsWithin(event: Event, from: number, until: number): boolean {
  return (event.occurrences ?? []).some((occurrence) => {
    const start = Date.parse(occurrence.dtstart_utc);
    return start >= from && start < until;
  });
}

/** Reads a published feed, or null with the failure logged when it is unavailable. */
async function readOrNull<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`Landing page ${label} fetch failed:`, error);
    return null;
  }
}

/**
 * Reads the same published snapshots as the events, clubs and positions pages,
 * so the landing page's views and numbers always match what students will find.
 */
export async function getLandingSnapshot(school: string): Promise<LandingSnapshot> {
  const now = Date.now();
  const [events, clubs, positions] = await Promise.all([
    readOrNull("event feed", async () =>
      (await getSchoolBrowseSnapshot(school)).items.filter((event) => hasActiveEventOccurrence(event, now))),
    readOrNull("club directory", async () => (await getClubDirectorySnapshot(school)).items),
    readOrNull("position directory", async () => (await getPositionDirectorySnapshot(school)).items),
  ]);
  const countEvents = (matches: (event: Event) => boolean) => (events ? events.filter(matches).length : null);
  return {
    events,
    newThisWeekCount: countEvents((event) => Boolean(event.added_at) && now - Date.parse(event.added_at!) <= WEEK_MS),
    thisWeekCount: countEvents((event) => startsWithin(event, now, now + WEEK_MS)),
    freeFoodCount: countEvents((event) => event.food.length > 0 && !event.price),
    clubCount: clubs?.length ?? null,
    previewClubs: (clubs ?? []).filter((club) => club.logo_url).slice(0, PREVIEW_CLUBS),
    positionCount: positions?.length ?? null,
  };
}
