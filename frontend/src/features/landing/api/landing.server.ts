import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import { FREE_FOOD_PREVIEW_COUNT, isFreeFoodEvent, nicheClubs } from "@/features/landing/lib/landingEvents";
import type { Club, Event } from "@/shared/types";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import { isNetworkingEvent } from "@/shared/utils/event";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Clubs the clubs preview shows. */
const PREVIEW_CLUBS = 2;

/**
 * Everything the landing page shows about one school, from its published
 * feeds. A feed that cannot be read leaves its numbers null, never zero, so
 * the page says nothing rather than something untrue. The page's own HTML
 * carries only these: the event views below the hero load the school's feed
 * in the browser as they come near, as the events page does.
 */
export interface LandingSnapshot {
  /** Upcoming events at the school. */
  upcomingCount: number | null;
  /** The free-food events the filters preview shows, in the feed's order. */
  freeFoodEvents: Event[];
  /** Upcoming events first added in the last seven days. */
  newThisWeekCount: number | null;
  /** Upcoming networking opportunities: employer events and business clubs' events. */
  networkingCount: number | null;
  /** Upcoming events with food that cost nothing, as the feed's free food filter finds them. */
  freeFoodCount: number | null;
  /** Clubs in the school's directory. */
  clubCount: number | null;
  /** A few niche clubs from the directory, for the clubs preview. */
  previewClubs: Club[];
  /** Open club positions at the school. */
  positionCount: number | null;
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
    upcomingCount: events?.length ?? null,
    freeFoodEvents: (events ?? [])
      .filter((event) => isFreeFoodEvent(event) && event.source_image_url)
      .slice(0, FREE_FOOD_PREVIEW_COUNT),
    newThisWeekCount: countEvents((event) => Boolean(event.added_at) && now - Date.parse(event.added_at!) <= WEEK_MS),
    networkingCount: countEvents(isNetworkingEvent),
    freeFoodCount: countEvents(isFreeFoodEvent),
    clubCount: clubs?.length ?? null,
    previewClubs: nicheClubs(clubs ?? [], PREVIEW_CLUBS),
    positionCount: positions?.length ?? null,
  };
}
