import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { Event } from "@/shared/types";
import { hasActiveEventOccurrence } from "@/shared/utils/date";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Everything the landing page shows about one school, from its published feeds. */
export interface LandingSnapshot {
  /** Upcoming events at the school, in the feed's order. */
  events: Event[];
  /** Clubs in the school's directory; null when the directory is unavailable. */
  clubCount: number | null;
  /** Upcoming events first added in the last seven days. */
  newThisWeekCount: number;
}

/**
 * Reads the same published snapshots as the events and clubs pages, so the
 * landing page's map, views and numbers always match what students will find.
 * An unavailable feed shows an empty page section rather than failing the page.
 */
export async function getLandingSnapshot(school: string): Promise<LandingSnapshot> {
  const now = Date.now();
  const [events, clubCount] = await Promise.all([
    getSchoolBrowseSnapshot(school).then(
      (snapshot) => snapshot.items.filter((event) => hasActiveEventOccurrence(event, now)),
      (error: unknown) => {
        console.error("Landing page event feed fetch failed:", error);
        return [];
      },
    ),
    getClubDirectorySnapshot(school).then(
      (directory) => directory.items.length,
      (error: unknown) => {
        console.error("Landing page club directory fetch failed:", error);
        return null;
      },
    ),
  ]);
  return {
    events,
    clubCount,
    newThisWeekCount: events.filter(
      (event) => event.added_at && now - Date.parse(event.added_at) <= WEEK_MS,
    ).length,
  };
}
