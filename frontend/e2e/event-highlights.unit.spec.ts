import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import { buildEventHighlights } from "../src/features/events/lib/eventHighlights";
import { controlBox } from "../src/shared/config/controlBox";
import { isNetworkingEvent } from "../src/shared/utils/event";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW_MS = Date.UTC(2026, 10, 8, 16);
const { mustKnowCount, mustKnowWindowMs, rowCardCount } = controlBox.eventDiscovery.highlights;

function event(id: number, startsInHours: number, overrides: Partial<Event> = {}): Event {
  const startMs = NOW_MS + startsInHours * HOUR_MS;
  return {
    id, title: `Event ${id}`, school: "uwaterloo", club: `Club ${id}`, club_id: id,
    added_at: new Date(NOW_MS - DAY_MS).toISOString(),
    occurrences: [{ id: id * 10, event_id: id, dtstart_utc: new Date(startMs).toISOString(), dtend_utc: new Date(startMs + HOUR_MS).toISOString() }],
    category: "Arts & Culture", price: 0, food: [], registration: false, campus_season_ids: [],
    source_image_url: `https://media.wat2do.io/event-images/${id}.jpg`,
    featured: false, cancelled: false, is_directory_event: false, cohosts: [],
    ...overrides,
  } as Event;
}

/** Weekly sessions over a month, the feed's Recurring filter's kind of series. */
function weekly(id: number, overrides: Partial<Event> = {}): Event {
  const base = event(id, 2, overrides);
  return {
    ...base,
    occurrences: [0, 1, 2, 3].map(week => {
      const startMs = NOW_MS + 2 * HOUR_MS + week * 7 * DAY_MS;
      return { id: id * 10 + week, event_id: id, dtstart_utc: new Date(startMs).toISOString(), dtend_utc: new Date(startMs + HOUR_MS).toISOString() };
    }),
  };
}

const mustKnowIds = (events: Event[]) => buildEventHighlights(events, NOW_MS).mustKnow.map(item => item.id);

test("networking means employers on campus or a Business event, the landing page's rule", () => {
  expect(isNetworkingEvent({ employers_on_campus: true, category: "Arts & Culture" })).toBe(true);
  expect(isNetworkingEvent({ employers_on_campus: false, category: "Business" })).toBe(true);
  expect(isNetworkingEvent({ employers_on_campus: null, category: "Business" })).toBe(true);
  expect(isNetworkingEvent({ employers_on_campus: false, category: "Games & Recreation" })).toBe(false);
  expect(isNetworkingEvent({ employers_on_campus: null, category: null })).toBe(false);
});

test("must-know ranks featured, then employer, competition, varsity and co-hosted events", () => {
  const events = [
    event(1, 3),
    event(2, 4, { competition: true }),
    event(3, 5, { featured: true }),
    event(4, 6, { employers_on_campus: true }),
    event(5, 7, { featured: true, employers_on_campus: true }),
    event(6, 8, { cohosts: [{ id: 60, club_name: "A" }, { id: 61, club_name: "B" }, { id: 62, club_name: "C" }] } as Partial<Event>),
    event(7, 9, { sports_game: true }),
  ];
  // 5 scores 5; 3 scores 3; 4 and 6 (two co-hosts count, a third does not) score 2,
  // the sooner first; then 2 and 7 score 1, the sooner first. Five make the banner.
  expect(mustKnowCount).toBe(5);
  expect(mustKnowIds(events)).toEqual([5, 3, 4, 6, 2]);
});

test("ties go to the sooner event, and plain events fill the banner when few stand out", () => {
  const events = [event(1, 30), event(2, 10), event(3, 20, { featured: true })];
  expect(mustKnowIds(events)).toEqual([3, 2, 1]);
});

test("must-know leaves out what ended, was cancelled, starts too late, has no poster or recurs", () => {
  const windowHours = mustKnowWindowMs / HOUR_MS;
  const events = [
    event(1, -3, { featured: true }),
    event(2, 5, { featured: true, cancelled: true }),
    event(3, windowHours + 1, { featured: true }),
    event(4, 5, { featured: true, source_image_url: null }),
    weekly(5, { featured: true }),
    event(6, windowHours - 1),
    event(7, -0.5),
  ];
  // Event 7 is on now, so it still counts and comes first among the plain ones.
  expect(mustKnowIds(events)).toEqual([7, 6]);
});

test("a club appears in the banner once, with its highest-ranked event", () => {
  const events = [
    event(1, 2, { club_id: 9, club: "Design Club" }),
    event(2, 3, { club_id: 9, club: "Design Club", featured: true }),
    event(3, 4),
  ];
  expect(mustKnowIds(events)).toEqual([2, 3]);
});

test("the rows hold networking and featured events, soonest first, up to a row's length", () => {
  const events = [
    event(1, 50, { category: "Business" }),
    event(2, 5, { employers_on_campus: true }),
    event(3, 1, { featured: true }),
    event(4, 20, { featured: true, category: "Business" }),
    event(5, 2),
    event(6, 3, { category: "Business", cancelled: true }),
    event(7, -2, { featured: true }),
  ];
  const highlights = buildEventHighlights(events, NOW_MS);
  expect(highlights.networking.map(item => item.id)).toEqual([2, 4, 1]);
  expect(highlights.featured.map(item => item.id)).toEqual([3, 4]);

  const many = Array.from({ length: rowCardCount + 5 }, (_, index) => event(100 + index, index + 1, { featured: true }));
  expect(buildEventHighlights(many, NOW_MS).featured).toHaveLength(rowCardCount);
});

test("the highlights are plain data, so the server can hand them to the page", () => {
  const highlights = buildEventHighlights([event(1, 2, { featured: true }), event(2, 3, { category: "Business" })], NOW_MS);
  expect(JSON.parse(JSON.stringify(highlights))).toEqual(highlights);
});
