import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import type { PaginatedEventsResponse } from "../src/features/events/api/events.api";
import { buildEventFeedFirstScreen } from "../src/features/events/lib/eventFeedFirstScreen";
import { resolveCampusSeasonFilters, resolveVarsityGamesFilter } from "../src/features/search/api/filterService";
import { controlBox } from "../src/shared/config/controlBox";
import type { SchoolSummary } from "../src/shared/api/schools.api";

const HOUR_MS = 3_600_000;
// Sorting and date sections read the real clock, so the feed is laid out around it.
const NOW_MS = Date.now();
const FIRST_SCREEN = controlBox.eventDiscovery.initialRenderCount;
const timezone = () => "America/Toronto";

function event(id: number, startsInHours: number, overrides: Partial<Event> = {}): Event {
  const startMs = NOW_MS + startsInHours * HOUR_MS;
  return {
    id, title: `Event ${id}`, school: "uwaterloo", club: "Design Club", club_id: 9,
    added_at: new Date(NOW_MS - id * HOUR_MS).toISOString(),
    occurrences: [{ id: id * 10, event_id: id, dtstart_utc: new Date(startMs).toISOString(), dtend_utc: new Date(startMs + HOUR_MS).toISOString() }],
    category: "Arts & Culture", price: 0, food: [], registration: false, campus_season_ids: [],
    ...overrides,
  } as Event;
}

function feed(items: Event[], latest: Event | null): PaginatedEventsResponse {
  return {
    items, total: items.length, page: 1, page_size: items.length, total_pages: 1, generated_at: NOW_MS - HOUR_MS,
    latest_added_event: latest && { title: latest.title, added_at: latest.added_at, club_name: latest.club, club_logo_url: latest.club_logo_url },
  };
}

test("the first screen is the start of the default list as of the time it is cut", () => {
  // Out of order, with two events that ended after the snapshot was generated.
  const upcoming = Array.from({ length: 40 }, (_, index) => event(index + 1, 40 - index));
  const ended = [event(101, -3), event(102, -1.5)];
  const firstScreen = buildEventFeedFirstScreen(feed([...upcoming, ...ended], null), "uwaterloo", timezone, NOW_MS);

  expect(firstScreen.events.map(item => item.id)).toEqual(
    Array.from({ length: FIRST_SCREEN }, (_, index) => 40 - index),
  );
  expect(firstScreen.total).toBe(40);
  expect(firstScreen.listedAtMs).toBe(NOW_MS);
  // Server components hand it to the page as plain data.
  expect(JSON.parse(JSON.stringify(firstScreen))).toEqual(firstScreen);
});

test("a feed shorter than a screen is all there", () => {
  const items = [event(1, 5), event(2, 2), event(3, -4)];
  const firstScreen = buildEventFeedFirstScreen(feed(items, null), "uwaterloo", timezone, NOW_MS);
  expect(firstScreen.events.map(item => item.id)).toEqual([2, 1]);
  expect(firstScreen.total).toBe(2);
});

test("the new line falls back to the newest event still on once the feed's latest has ended", () => {
  const finished = event(1, -3, { added_at: new Date(NOW_MS - 600_000).toISOString() });
  const items = [finished, event(2, 4), event(3, 30), event(4, 2)];
  const firstScreen = buildEventFeedFirstScreen(feed(items, finished), "uwaterloo", timezone, NOW_MS);
  // Of the events still on, event 2 was added last.
  expect(firstScreen.latestAddedEvent?.title).toBe("Event 2");

  const current = buildEventFeedFirstScreen(feed(items, items[2]!), "uwaterloo", timezone, NOW_MS);
  expect(current.latestAddedEvent?.title).toBe("Event 3");
});

test("the filter row's feed-wide chips see past the first screen", () => {
  const school = {
    slug: "uwaterloo", timezone: "America/Toronto",
    event_seasons: [{
      id: "exam_destress", classification_id: "exam_destress", labels: { en: "Exam de-stress" },
      display_windows: [{ start_date: "2020-01-01", end_date: "2099-12-31" }],
    }],
  } as SchoolSummary;
  const soon = Array.from({ length: 30 }, (_, index) => event(index + 1, index + 1));
  const lateGame = event(90, 200, { sports_game: true });
  const lateExamEvent = event(91, 300, { campus_season_ids: ["exam_destress"] });
  const firstScreen = buildEventFeedFirstScreen(feed([...soon, lateGame, lateExamEvent], null), "uwaterloo", timezone, NOW_MS);

  expect(firstScreen.events.map(item => item.id)).not.toContain(lateGame.id);
  expect(resolveVarsityGamesFilter(firstScreen.filterAvailability, NOW_MS, true)).toEqual({ ready: true, available: true, selected: true });
  expect(resolveCampusSeasonFilters(school, NOW_MS, "en", [], firstScreen.filterAvailability).options.map(option => option.id))
    .toEqual(["exam_destress"]);
  // They hold for the browser's own clock too, until the last of those events ends.
  const afterGame = NOW_MS + 202 * HOUR_MS;
  expect(resolveVarsityGamesFilter(firstScreen.filterAvailability, afterGame, false).available).toBe(false);
  expect(resolveCampusSeasonFilters(school, afterGame, "en", [], firstScreen.filterAvailability).options).toHaveLength(1);
});
