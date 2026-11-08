import {
  latestVisibleAddedEvent,
  type LatestAddedEvent,
  type PaginatedEventsResponse,
} from "@/features/events/api/events.api";
import { groupEventsByDateSection } from "@/features/events/lib/eventDateSections";
import { buildEventHighlights, type EventHighlights } from "@/features/events/lib/eventHighlights";
import {
  EMPTY_FILTER_STATE,
  feedFilterAvailability,
  filterStateToStoreValues,
  type FeedFilterAvailability,
} from "@/features/search/api/filterService";
import { filterEvents, sortEvents } from "@/features/search/api/searchService";
import { controlBox } from "@/shared/config/controlBox";
import type { Event } from "@/shared/types";
import { hasActiveEventOccurrence } from "@/shared/utils/date";
import { getUniqueEvents } from "@/shared/utils/event";

/**
 * The start of the events page's default list (no search, no filters, soonest
 * first), cut by the server from the school's complete feed. The page's HTML
 * carries only this; the browser loads the complete feed from the edge right
 * after the page paints and lists from it from then on. Until it arrives, this
 * answers the default list and every other query waits for the feed.
 */
export interface EventFeedFirstScreen {
  /** The default list's first batch of cards, in the order the page shows them. */
  events: Event[];
  /** How many events the default list holds: the page's count. */
  total: number;
  /** The must-know banner and carousel rows above the list. */
  highlights: EventHighlights;
  /** The "new" line above the list. */
  latestAddedEvent: LatestAddedEvent;
  /** What the whole feed offers the filter row (varsity games, campus seasons). */
  filterAvailability: FeedFilterAvailability;
  /** When the list was cut. Until the browser's clock starts, the page reads its chips at this time. */
  listedAtMs: number;
}

const DEFAULT_QUERY = filterStateToStoreValues(EMPTY_FILTER_STATE);

/**
 * The first screen as of `nowMs`, through the same steps the page takes for a
 * reader who has not searched or filtered: drop what has ended, filter, sort,
 * then lay the list out in date sections.
 */
export function buildEventFeedFirstScreen(
  feed: PaginatedEventsResponse,
  school: string,
  getSchoolTimezone: (school: Event["school"]) => string,
  nowMs: number,
): EventFeedFirstScreen {
  const visibleEvents = feed.items.filter((event) => hasActiveEventOccurrence(event, nowMs));
  const listedEvents = sortEvents(
    filterEvents(visibleEvents, { ...DEFAULT_QUERY, goingEventIds: [], campusSeasonOptions: [] }, getSchoolTimezone),
    DEFAULT_QUERY,
  );
  const sections = groupEventsByDateSection(getUniqueEvents(listedEvents), getSchoolTimezone, new Date(nowMs));
  return {
    events: sections
      .flatMap((section) => section.events)
      .slice(0, controlBox.eventDiscovery.initialRenderCount),
    total: listedEvents.length,
    highlights: buildEventHighlights(visibleEvents, nowMs),
    latestAddedEvent: latestVisibleAddedEvent(feed.latest_added_event, feed.items, visibleEvents),
    filterAvailability: feedFilterAvailability(feed.items, school),
    listedAtMs: nowMs,
  };
}
