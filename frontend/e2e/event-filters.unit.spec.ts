import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { filterEvents } from "../src/features/search/api/searchService";
import { clearNarrowingFilterState, EMPTY_FILTER_STATE, feedFilterAvailability, freeFoodFilterPatch, normalizeFilterState, resolveCampusSeasonFilters, resolveVarsityGamesFilter, storeStatesToFilterState } from "../src/features/search/api/filterService";
import { useSearchStore } from "../src/features/search/store/search.store";
import { useEventsStore } from "../src/features/events/store/events.store";
import { getFilterCounts } from "../src/shared/utils/filter";
import { hasActiveEventOccurrence } from "../src/shared/utils/date";
import { getEventFilterCategories, getEventQuickFilters } from "../src/shared/constants/eventFilters";

const events = [
  { id: 1, location: "Student Centre", price: 0, food: ["Pizza"] },
  { id: 2, location: " Online via ZOOM ", price: 0, food: [] },
  { id: 3, location: "Google Meet", price: 10, food: [] },
  { id: 4, location: null, price: 0, food: [] },
  { id: 5, location: " ", price: 0, food: [] },
].map(event => ({ ...event, title: "Workshop", school: "uwaterloo", occurrences: [] }) as unknown as Event);

function visibleEvents() {
  return filterEvents(events, {
    ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [],
  }, () => "America/Toronto", { 1: { going_count: 5 }, 2: { going_count: 2 } }).map(event => event.id);
}

const originalNow = Date.now;
test("compact club search finds Hip Hop events with spaces and punctuation", () => {
  const hipHop = { ...events[0], club: "Hip Hop, UW", title: "2nd BOT Session" };
  for (const searchQuery of ["hiphop", "hip-hop", "hip hop", "HIPHOP"]) {
    const result = filterEvents([hipHop], {
      ...useSearchStore.getState(), searchQuery, goingEventIds: [], campusSeasonOptions: [],
    }, () => "America/Toronto");
    expect(result.map(event => event.id)).toEqual([hipHop.id]);
  }
});
test.beforeEach(() => {
  Date.now = () => Date.parse("2026-09-28T04:00:00Z");
  useSearchStore.getState().setFilterState(EMPTY_FILTER_STATE);
});
test.afterEach(() => { Date.now = originalNow; });

test("removed format filters in legacy handoffs cannot silently narrow the event list", () => {
  const legacyFilters = JSON.parse('{"eventFormat":"online","sortOrder":"desc"}');
  useSearchStore.getState().setFilterState(normalizeFilterState(legacyFilters));
  expect(visibleEvents()).toEqual([1, 2, 3, 4, 5]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
  const handoff = storeStatesToFilterState(useSearchStore.getState());
  expect(handoff).not.toHaveProperty("eventFormat");
  expect(handoff.sortOrder).toBe("desc");
});

test("removed Media category filters cannot survive a saved handoff and silently narrow events", () => {
  const categories = ["Business", "Media & Web", "Arts & Culture"];
  expect(getEventFilterCategories(categories)).toEqual(["Business", "Arts & Culture"]);
  expect(categories).toContain("Media & Web");
  useSearchStore.getState().setFilterState(normalizeFilterState({ categories: ["Media & Web"] }));
  expect(visibleEvents()).toEqual([1, 2, 3, 4, 5]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
  expect(storeStatesToFilterState(useSearchStore.getState()).categories).toEqual([]);
  expect(normalizeFilterState({ categories }).categories).toEqual(["Business", "Arts & Culture"]);
});

test("Free, Food and minimum Going filters still combine and clear", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, maxPrice: "0", minGoing: 2 });
  expect(visibleEvents()).toEqual([1, 2]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, maxPrice: "0", hasFood: true, minGoing: 5 });
  expect(visibleEvents()).toEqual([1]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(3);
  useSearchStore.getState().setFilterState(clearNarrowingFilterState(storeStatesToFilterState(useSearchStore.getState())));
  expect(visibleEvents()).toHaveLength(5);
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
});

test("price thresholds include the boundary, combine with other filters, and clear through shared state", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "9" });
  expect(visibleEvents()).toEqual([3]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(1);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "10" });
  expect(visibleEvents()).toEqual([3]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, maxPrice: "0" });
  expect(visibleEvents()).toEqual([1, 2, 4, 5]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, maxPrice: "0", hasFood: true });
  expect(visibleEvents()).toEqual([1]);
  const handoff = storeStatesToFilterState(useSearchStore.getState());
  expect(normalizeFilterState(JSON.parse(JSON.stringify(handoff))).maxPrice).toBe("0");
  useSearchStore.getState().setFilterState(clearNarrowingFilterState(handoff));
  expect(visibleEvents()).toEqual([1, 2, 3, 4, 5]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
});

test("minimum zero includes every event and both price bounds work independently", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "0" });
  expect(visibleEvents()).toEqual([1, 2, 3, 4, 5]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "0", maxPrice: "0" });
  expect(visibleEvents()).toEqual([1, 2, 4, 5]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "10", maxPrice: "10" });
  expect(visibleEvents()).toEqual([3]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, maxPrice: "9.99" });
  expect(visibleEvents()).toEqual([1, 2, 4, 5]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "10.01" });
  expect(visibleEvents()).toEqual([]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "11", maxPrice: "10" });
  expect(visibleEvents()).toEqual([]);
});

const discoveryEvents = [
  { id: 11, title: "Employer booth with free pizza", employers_on_campus: true, sports_game: false, price: 10, food: ["Pizza"] },
  { id: 12, title: "Free campus lunch", food: ["Lunch"], employers_on_campus: false, sports_game: false, price: 0 },
  { id: 13, title: "Official varsity basketball match", employers_on_campus: false, sports_game: true },
  { id: 14, title: "Free career workshop", category: "Business", price: 0, food: ["Pizza"], employers_on_campus: null, sports_game: null },
  { id: 15, title: "Sports watch party", category: "Health", sports_game: false },
  { id: 16, title: "Unclassified event" },
  { id: 17, title: "Intramural basketball match", sports_game: false },
  { id: 18, title: "Club-team basketball tournament", sports_game: false },
  { id: 19, title: "Recreational basketball game", sports_game: false },
  { id: 20, title: "Varsity basketball practice", sports_game: false },
  { id: 21, title: "Varsity basketball tryouts", sports_game: false },
  { id: 22, title: "Basketball match with unconfirmed varsity participation", sports_game: null },
].map(event => ({ ...event, location: "Student Centre", school: "uwaterloo", occurrences: [] }) as unknown as Event);

function discoveryResults() {
  return filterEvents(discoveryEvents, { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [] }, () => "America/Toronto")
    .map(event => event.id);
}

for (const [filter, expected] of [
  ["employersOnCampus", [11]],
  ["sportsGame", [13]],
] as const) {
  test(`${filter} uses explicit metadata and survives filter handoff and clearing`, () => {
    useSearchStore.getState().setFilterState(normalizeFilterState({ [filter]: true }));
    expect(discoveryResults()).toEqual(expected);
    expect(getFilterCounts(useSearchStore.getState())).toBe(1);
    const handoff = storeStatesToFilterState(useSearchStore.getState());
    expect(normalizeFilterState(JSON.parse(JSON.stringify(handoff)))[filter]).toBe(true);
    useSearchStore.getState().setFilterState(clearNarrowingFilterState(handoff));
    expect(discoveryResults()).toHaveLength(discoveryEvents.length);
    expect(getFilterCounts(useSearchStore.getState())).toBe(0);
    expect(normalizeFilterState({ [filter]: "true" })[filter]).toBe(false);
  });
}

test("Food plus Free intersects employer/varsity filters", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, hasFood: true, maxPrice: "0" });
  expect(discoveryResults()).toEqual([]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(3);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, hasFood: true, maxPrice: "0" });
  expect(discoveryResults()).toEqual([12, 14]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, sportsGame: true });
  expect(discoveryResults()).toEqual([]);
});

const recurringEvents = [
  // Weekly series spanning exactly three weeks (21 days): recurring.
  { id: 31, title: "Weekly yoga", occurrences: [
    { dtstart_utc: "2026-09-01T16:00:00Z", dtend_utc: "2026-09-01T17:00:00Z" },
    { dtstart_utc: "2026-09-08T16:00:00Z", dtend_utc: "2026-09-08T17:00:00Z" },
    { dtstart_utc: "2026-09-22T16:00:00Z", dtend_utc: "2026-09-22T17:00:00Z" },
  ] },
  // Single occurrence: not recurring.
  { id: 32, title: "One-off gala", occurrences: [
    { dtstart_utc: "2026-09-10T23:00:00Z", dtend_utc: "2026-09-11T02:00:00Z" },
  ] },
  // Multi-day conference spanning two days: not recurring.
  { id: 33, title: "Three-day conference", occurrences: [
    { dtstart_utc: "2026-09-01T14:00:00Z", dtend_utc: "2026-09-01T18:00:00Z" },
    { dtstart_utc: "2026-09-02T14:00:00Z", dtend_utc: "2026-09-02T18:00:00Z" },
    { dtstart_utc: "2026-09-03T14:00:00Z", dtend_utc: "2026-09-03T18:00:00Z" },
  ] },
  // Two sessions 20 days apart, just under three weeks: not recurring.
  { id: 34, title: "Almost recurring", occurrences: [
    { dtstart_utc: "2026-09-01T16:00:00Z", dtend_utc: "2026-09-01T17:00:00Z" },
    { dtstart_utc: "2026-09-21T16:00:00Z", dtend_utc: "2026-09-21T17:00:00Z" },
  ] },
].map(event => ({ ...event, location: "Student Centre", school: "uwaterloo" }) as unknown as Event);

test("Recurring keeps only events whose occurrences span at least three weeks", () => {
  const recurringResults = () =>
    filterEvents(recurringEvents, { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [] }, () => "America/Toronto")
      .map(event => event.id);

  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, recurring: true });
  expect(recurringResults()).toEqual([31]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(1);

  useSearchStore.getState().setFilterState(EMPTY_FILTER_STATE);
  expect(recurringResults()).toEqual([31, 32, 33, 34]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
});

const upcomingVarsityGame = {
  ...discoveryEvents[2],
  occurrences: [{ dtstart_utc: "2026-09-29T16:00:00Z", dtend_utc: "2026-09-29T18:00:00Z" }],
} as Event;

test("Varsity games availability requires an active or upcoming classified game at the current school", () => {
  const unrelated = [
    { ...upcomingVarsityGame, school: "mit" },
    { ...upcomingVarsityGame, sports_game: false },
    { ...upcomingVarsityGame, sports_game: null },
    { ...upcomingVarsityGame, occurrences: [{ dtstart_utc: "2026-09-27T16:00:00Z", dtend_utc: "2026-09-27T18:00:00Z" }] },
  ] as Event[];
  expect(resolveVarsityGamesFilter(feedFilterAvailability(unrelated, "uwaterloo"), Date.now(), true))
    .toEqual({ ready: true, available: false, selected: false });
  expect(resolveVarsityGamesFilter(feedFilterAvailability([upcomingVarsityGame], "uwaterloo"), Date.now(), true))
    .toEqual({ ready: true, available: true, selected: true });
  expect(resolveVarsityGamesFilter(feedFilterAvailability([upcomingVarsityGame], "uwaterloo"), Date.parse("2026-09-29T17:00:00Z"), false).available).toBe(true);
  expect(resolveVarsityGamesFilter(feedFilterAvailability([upcomingVarsityGame], "uwaterloo"), Date.parse("2026-09-29T18:00:01Z"), true).available).toBe(false);
});

test("Varsity availability uses all cached events and stays visible when another filter excludes games", () => {
  const cachedEvents = [...Array.from({ length: 100 }, (_, index) => ({ ...events[0], id: index + 100 })), upcomingVarsityGame];
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, hasFood: true });
  const filtered = filterEvents(cachedEvents, {
    ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [],
  }, () => "America/Toronto");
  expect(filtered).not.toContain(upcomingVarsityGame);
  const availability = resolveVarsityGamesFilter(feedFilterAvailability(cachedEvents, "uwaterloo"), Date.now(), false);
  expect(availability.available).toBe(true);
  expect(getEventQuickFilters({ sportsGameAvailable: availability.available }).map(filter => filter.id)).toContain("sportsGame");
});

test("pending feeds and hydration clocks hide Varsity without clearing staged selections", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, sportsGame: true });
  const selected = useSearchStore.getState().sportsGame;
  expect(resolveVarsityGamesFilter(null, Date.now(), selected))
    .toEqual({ ready: false, available: false, selected: false });
  expect(resolveVarsityGamesFilter(feedFilterAvailability([upcomingVarsityGame], "uwaterloo"), null, selected))
    .toEqual({ ready: false, available: false, selected: false });
  expect(useSearchStore.getState().sportsGame).toBe(true);
  expect(getEventQuickFilters().map(filter => filter.id)).not.toContain("sportsGame");
  expect(resolveVarsityGamesFilter(feedFilterAvailability([upcomingVarsityGame], "uwaterloo"), Date.now(), selected).selected).toBe(true);
});

test("a school without Varsity games clears stale narrowing and telemetry without a new user query", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, sportsGame: true });
  const state = useSearchStore.getState();
  const varsity = resolveVarsityGamesFilter(feedFilterAvailability(events, "uwaterloo"), Date.now(), state.sportsGame);
  expect(varsity.ready).toBe(true);
  const effective = { ...state, sportsGame: varsity.selected };
  expect(filterEvents(events, { ...effective, goingEventIds: [], campusSeasonOptions: [] }, () => "America/Toronto")).toHaveLength(events.length);
  expect(getFilterCounts(effective)).toBe(0);
  expect(storeStatesToFilterState(effective).sportsGame).toBe(false);
  state.setFilterState(storeStatesToFilterState(effective), "normalization");
  expect(useSearchStore.getState().sportsGame).toBe(false);
  expect(useSearchStore.getState().queryRevision).toBe(state.queryRevision);
  expect(getEventQuickFilters({ profileCompleted: true, sportsGameAvailable: varsity.available }).map(filter => filter.id))
    .toContain("going");
  expect(getEventQuickFilters({ profileCompleted: true, sportsGameAvailable: varsity.available }).map(filter => filter.id))
    .not.toContain("sportsGame");
});

const campusSchool: SchoolSummary = {
  slug: "uwaterloo", name: "University of Waterloo", timezone: "America/Toronto", language: "en",
  primary_color: "#000000", secondary_color: "#ffffff", faculties: [], location_examples: [], email_domains: [],
  event_seasons: [
    { id: "homecoming", classification_id: "homecoming", labels: { en: "HOCO", fr: "Retrouvailles" }, display_windows: [{ start_date: "2026-09-28", end_date: "2026-09-29" }] },
    { id: "thanksgiving", classification_id: "holidays", labels: { en: "Thanksgiving" }, display_windows: [
      { start_date: "2026-09-28", end_date: "2026-09-29" },
    ] },
    { id: "winter_holidays", classification_id: "holidays", labels: { en: "Winter holidays" }, display_windows: [
      { start_date: "2026-12-01", end_date: "2026-12-31" },
    ] },
  ],
};

/** A feed with no events, where only the calendar decides season chips. */
const NO_FEED_EVENTS = feedFilterAvailability([], campusSchool.slug);

test("feed availability holds until the last qualifying event ends, at any time, as the events themselves would", () => {
  const school = { ...campusSchool, event_seasons: [{
    id: "exam_destress", classification_id: "exam_destress", labels: { en: "Exam de-stress" },
    display_windows: [{ start_date: "2026-09-01", end_date: "2026-11-01" }],
  }] } as SchoolSummary;
  const at = (iso: string) => Date.parse(iso);
  const feed = [
    { ...upcomingVarsityGame, id: 50 },
    { ...upcomingVarsityGame, id: 51, occurrences: [
      { dtstart_utc: "2026-09-29T20:00:00Z", dtend_utc: "2026-09-29T22:00:00Z" },
      // No end time: still on for the feed's visibility window after it starts.
      { dtstart_utc: "2026-10-02T20:00:00Z", dtend_utc: null },
    ] },
    { ...upcomingVarsityGame, id: 52, school: "mit", occurrences: [{ dtstart_utc: "2026-12-01T20:00:00Z", dtend_utc: null }] },
    { ...events[0], id: 53, campus_season_ids: ["exam_destress"], occurrences: [{ dtstart_utc: "2026-10-01T18:00:00Z", dtend_utc: "2026-10-01T19:00:00Z" }] },
    { ...events[0], id: 54, cancelled: true, campus_season_ids: ["exam_destress"], occurrences: [{ dtstart_utc: "2026-10-20T18:00:00Z", dtend_utc: "2026-10-20T19:00:00Z" }] },
  ] as Event[];
  const availability = feedFilterAvailability(feed, "uwaterloo");
  // Plain data, so the server can hand it to the page with the first screen.
  expect(JSON.parse(JSON.stringify(availability))).toEqual(availability);
  for (const time of ["2026-09-28T12:00:00Z", "2026-10-01T19:00:00Z", "2026-10-01T19:00:01Z", "2026-10-02T21:00:00Z", "2026-10-02T21:00:01Z", "2026-12-01T20:30:00Z"]) {
    const nowMs = at(time);
    const varsityOn = feed.some(event => event.school === "uwaterloo" && event.sports_game === true && hasActiveEventOccurrence(event, nowMs));
    expect(resolveVarsityGamesFilter(availability, nowMs, true), time).toEqual({ ready: true, available: varsityOn, selected: varsityOn });
    const examOn = feed.some(event => !event.cancelled && event.campus_season_ids?.includes("exam_destress") && hasActiveEventOccurrence(event, nowMs));
    expect(resolveCampusSeasonFilters(school, nowMs, "en", ["exam_destress"], availability).selectedIds, time).toEqual(examOn ? ["exam_destress"] : []);
  }
  expect(resolveVarsityGamesFilter(availability, at("2026-10-02T21:00:00Z"), false).available).toBe(true);
  expect(resolveVarsityGamesFilter(availability, at("2026-10-02T21:00:01Z"), false).available).toBe(false);
});

test("campus season visibility follows inclusive school-local dates and supports separate windows", () => {
  const visible = (now: string) => resolveCampusSeasonFilters(campusSchool, Date.parse(now), "en", [], NO_FEED_EVENTS).options.map(option => option.id);
  expect(visible("2026-09-28T03:59:59Z")).toEqual([]);
  expect(visible("2026-09-28T04:00:00Z")).toEqual(["homecoming", "thanksgiving"]);
  expect(visible("2026-09-30T03:59:59Z")).toEqual(["homecoming", "thanksgiving"]);
  expect(visible("2026-09-30T04:00:00Z")).toEqual([]);
  expect(visible("2026-12-01T04:59:59Z")).toEqual([]);
  expect(visible("2026-12-01T05:00:00Z")).toEqual(["winter_holidays"]);
  expect(resolveCampusSeasonFilters({ ...campusSchool, slug: "ualberta", timezone: "America/Edmonton" }, Date.parse("2026-09-28T04:00:00Z"), "en", [], NO_FEED_EVENTS).options).toEqual([]);
});

test("campus season labels use the current language, its base language, then English", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(campusSchool, now, "fr-CA", [], NO_FEED_EVENTS).options.map(option => option.label)).toEqual(["Retrouvailles", "Thanksgiving"]);
  expect(resolveCampusSeasonFilters(campusSchool, now, "de", [], NO_FEED_EVENTS).options.map(option => option.label)).toEqual(["HOCO", "Thanksgiving"]);
});

test("season selections normalize once and survive filter handoff and Clear all", () => {
  const normalized = normalizeFilterState({ campusSeasonIds: [" homecoming ", "", "homecoming", null, 42], sortOrder: "desc" });
  expect(normalized.campusSeasonIds).toEqual(["homecoming"]);
  useSearchStore.getState().setFilterState(normalized);
  const handoff = storeStatesToFilterState(useSearchStore.getState());
  expect(normalizeFilterState(JSON.parse(JSON.stringify(handoff))).campusSeasonIds).toEqual(["homecoming"]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(1);
  useSearchStore.getState().setFilterState(clearNarrowingFilterState(handoff));
  expect(useSearchStore.getState().campusSeasonIds).toEqual([]);
  expect(useSearchStore.getState().sortOrder).toBe("desc");
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
});

test("season filters OR their metadata IDs and intersect existing discovery filters", () => {
  const seasonalEvents = [
    { id: 1, campus_season_ids: ["homecoming"], employers_on_campus: true },
    { id: 2, campus_season_ids: ["holidays"], employers_on_campus: false },
    { id: 3, campus_season_ids: null, employers_on_campus: true },
    { id: 4, employers_on_campus: true },
    { id: 5, campus_season_ids: [], employers_on_campus: true },
  ].map(item => ({ ...events[0], ...item, occurrences: [{ dtstart_utc: "2026-09-28T16:00:00Z", dtend_utc: null }] }) as Event);
  const results = () => filterEvents(seasonalEvents, { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", [], NO_FEED_EVENTS).options }, () => campusSchool.timezone).map(item => item.id);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, campusSeasonIds: ["homecoming", "thanksgiving"] });
  expect(results()).toEqual([1, 2]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(2);
  useSearchStore.getState().setFilterState({ ...storeStatesToFilterState(useSearchStore.getState()), employersOnCampus: true });
  expect(results()).toEqual([1]);
});

test("expired and other-school selections stop narrowing results, counts, and telemetry before stored cleanup", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, campusSeasonIds: ["homecoming", "other-school-hoco"] });
  const submitted = useSearchStore.getState();
  const beforeExpiry = `${submitted.queryRevision}:${JSON.stringify(storeStatesToFilterState(submitted))}`;
  const expired = resolveCampusSeasonFilters(campusSchool, Date.parse("2026-10-01T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, NO_FEED_EVENTS);
  expect(expired.ready).toBe(true);
  expect(expired.selectedIds).toEqual([]);
  const effective = { ...useSearchStore.getState(), campusSeasonIds: expired.selectedIds };
  expect(filterEvents(events, { ...effective, goingEventIds: [], campusSeasonOptions: [] }, () => campusSchool.timezone)).toHaveLength(events.length);
  expect(getFilterCounts(effective)).toBe(0);
  expect(storeStatesToFilterState(effective).campusSeasonIds).toEqual([]);
  const expiredQuery = `${effective.queryRevision}:${JSON.stringify(storeStatesToFilterState(effective))}`;
  expect(expiredQuery).not.toBe(beforeExpiry);
  useSearchStore.getState().setFilterState(storeStatesToFilterState(effective), "normalization");
  const cleaned = useSearchStore.getState();
  expect(cleaned.campusSeasonIds).toEqual([]);
  expect(`${cleaned.queryRevision}:${JSON.stringify(storeStatesToFilterState(cleaned))}`).toBe(expiredQuery);
  expect(resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, NO_FEED_EVENTS).selectedIds).toEqual([]);
  // An intentional repeated user query still gets its own revision.
  cleaned.setFilterState(storeStatesToFilterState(cleaned));
  expect(useSearchStore.getState().queryRevision).toBe(cleaned.queryRevision + 1);
});

test("unavailable school configuration or the initial hydration clock never authorizes clearing stored selections", () => {
  const selected = ["homecoming"];
  expect(resolveCampusSeasonFilters(campusSchool, null, "en", selected, NO_FEED_EVENTS)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters(undefined, Date.now(), "en", selected, NO_FEED_EVENTS)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(selected).toEqual(["homecoming"]);
});

test("older school snapshots without season configuration preserve staged selections while explicit empty configuration clears them", () => {
  const oldSnapshot = { ...campusSchool };
  delete oldSnapshot.event_seasons;
  const selected = ["homecoming"];
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(oldSnapshot, now, "en", selected, NO_FEED_EVENTS)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters({ ...campusSchool, event_seasons: [] }, now, "en", selected, NO_FEED_EVENTS)).toEqual({ ready: true, options: [], selectedIds: [] });
  expect(selected).toEqual(["homecoming"]);
});

test("school transitions clear seasonal selections even when the next school offers the same ID", () => {
  useEventsStore.getState().setSchoolFilter("uwaterloo");
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, campusSeasonIds: ["homecoming"], employersOnCampus: true });
  useEventsStore.getState().setSchoolFilter(" UWATERLOO ");
  expect(useSearchStore.getState().campusSeasonIds).toEqual(["homecoming"]);
  useEventsStore.getState().setSchoolFilter("uwo");
  expect(useSearchStore.getState().campusSeasonIds).toEqual([]);
  expect(useSearchStore.getState().employersOnCampus).toBe(true);
  const nextSchool = { ...campusSchool, slug: "uwo" };
  const next = resolveCampusSeasonFilters(nextSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, NO_FEED_EVENTS);
  expect(next.options.map(option => option.id)).toContain("homecoming");
  expect(next.selectedIds).toEqual([]);
  // A QR handoff is applied after the navigation owner selects its school.
  useSearchStore.getState().setFilterState(normalizeFilterState({ campusSeasonIds: ["homecoming"] }));
  useEventsStore.getState().setSchoolFilter("uwo");
  expect(useSearchStore.getState().campusSeasonIds).toEqual(["homecoming"]);
});


test("named holiday filters require classified occurrences within that school's inclusive window", () => {
  const seasonalEvents = [
    { id: 1, start: "2026-09-28T03:59:59Z", end: null },
    { id: 2, start: "2026-09-28T04:00:00Z", end: null },
    { id: 3, start: "2026-09-30T03:59:59Z", end: null },
    { id: 4, start: "2026-09-30T04:00:00Z", end: null },
    { id: 5, start: "2026-12-15T16:00:00Z", end: null },
    { id: 6, start: "2026-09-28T03:00:00Z", end: "2026-09-28T05:00:00Z" },
  ].map(item => ({ ...events[0], id: item.id, campus_season_ids: ["holidays"], occurrences: [{ dtstart_utc: item.start, dtend_utc: item.end }] }) as Event);
  seasonalEvents.push({ ...seasonalEvents[1], id: 7, campus_season_ids: [] });
  const results = (now: string, selection: string) => {
    const seasons = resolveCampusSeasonFilters(campusSchool, Date.parse(now), "en", [selection], NO_FEED_EVENTS);
    return filterEvents(seasonalEvents, {
      ...useSearchStore.getState(), goingEventIds: [], campusSeasonIds: seasons.selectedIds, campusSeasonOptions: seasons.options,
    }, () => campusSchool.timezone).map(event => event.id);
  };
  expect(results("2026-09-28T12:00:00Z", "thanksgiving")).toEqual([2, 3, 6]);
  expect(results("2026-12-01T12:00:00Z", "winter_holidays")).toEqual([5]);
});


test("named seasonal filters carry only matching sessions into cards and date sections", () => {
  const seasons = resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", ["thanksgiving"], NO_FEED_EVENTS);
  const recurring = {
    ...events[0], campus_season_ids: ["holidays"], occurrences: [
      { dtstart_utc: "2026-09-27T16:00:00Z", dtend_utc: null },
      { dtstart_utc: "2026-09-28T16:00:00Z", dtend_utc: null },
      { dtstart_utc: "2026-12-01T16:00:00Z", dtend_utc: null },
    ],
  } as Event;
  const result = filterEvents([recurring], {
    ...useSearchStore.getState(), goingEventIds: [], campusSeasonIds: seasons.selectedIds, campusSeasonOptions: seasons.options,
  }, () => campusSchool.timezone);
  expect(result).toHaveLength(1);
  expect(result[0].occurrences).toEqual([recurring.occurrences[1]]);
  expect(recurring.occurrences).toHaveLength(3);
});


test("a later holiday occurrence cannot keep an expired selected-window occurrence in results", () => {
  Date.now = () => Date.parse("2026-10-12T16:00:00Z");
  const recurring = {
    ...events[0], campus_season_ids: ["holidays"], occurrences: [
      { dtstart_utc: "2026-10-01T16:00:00Z", dtend_utc: "2026-10-01T18:00:00Z" },
      { dtstart_utc: "2026-10-25T16:00:00Z", dtend_utc: "2026-10-25T18:00:00Z" },
    ],
  } as Event;
  const result = filterEvents([recurring], {
    ...useSearchStore.getState(), goingEventIds: [], campusSeasonIds: ["thanksgiving"], campusSeasonOptions: [{
      id: "thanksgiving", classificationId: "holidays", label: "Thanksgiving",
      windows: [{ start_date: "2026-09-28", end_date: "2026-10-14" }],
    }],
  }, () => campusSchool.timezone);
  expect(result).toEqual([]);
});


test("empty seasonal filters wait for the complete feed and hide options with no upcoming school matches", () => {
  const school = { ...campusSchool, event_seasons: [{
    id: "exam_destress", classification_id: "exam_destress", labels: { en: "Exam de-stress" },
    display_windows: [{ start_date: "2026-09-01", end_date: "2026-11-01" }],
  }] } as SchoolSummary;
  const now = Date.parse("2026-09-30T12:00:00Z");
  expect(resolveCampusSeasonFilters(school, now, "en", ["exam_destress"], null).ready).toBe(false);
  const empty = resolveCampusSeasonFilters(school, now, "en", ["exam_destress"], NO_FEED_EVENTS);
  expect(empty.options).toEqual([]);
  expect(empty.selectedIds).toEqual([]);
  const matching = { ...events[0], school: school.slug, campus_season_ids: ["exam_destress"], occurrences: [{ dtstart_utc: "2026-10-01T18:00:00Z" }] } as Event;
  expect(resolveCampusSeasonFilters(school, now, "en", [], feedFilterAvailability([matching], school.slug)).options).toHaveLength(1);
  expect(resolveCampusSeasonFilters(school, now, "en", [], feedFilterAvailability([{ ...matching, cancelled: true }], school.slug)).options).toEqual([]);
});


test("Competitions and Featured intersect, survive handoff, and clear together", () => {
  const candidates = [
    { ...events[0], id: 90, competition: true, featured: true },
    { ...events[0], id: 91, competition: true, featured: false },
    { ...events[0], id: 92, competition: null, featured: true },
    { ...events[0], id: 93, competition: true, featured: false },
    { ...events[0], id: 94, competition: true, featured: false },
  ];
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, competitions: true, featured: true });
  const state = useSearchStore.getState();
  const options = { ...state, goingEventIds: [], campusSeasonOptions: [] };
  expect(filterEvents(candidates, options, () => "America/Toronto", {}).map(event => event.id)).toEqual([90]);
  expect(getFilterCounts(state)).toBe(2);
  const handoff = storeStatesToFilterState(state);
  expect(normalizeFilterState(handoff)).toMatchObject({ competitions: true, featured: true });
  expect(getEventQuickFilters().map(filter => filter.id)).toEqual(expect.arrayContaining(["competitions", "featured"]));
  useSearchStore.getState().clearAllFilters();
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
});

test("cohost names and Instagram handles match cached event search and club filters", () => {
  const shared = { ...events[0], cohosts: [{ id: 9, club_name: "Campus Makers", ig: "campusmakers" }] };
  const options = { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [] };
  expect(filterEvents([shared], { ...options, searchQuery: "@campusmakers" }, () => "America/Toronto", {})).toHaveLength(1);
  expect(filterEvents([shared], { ...options, selectedClubs: ["Campus Makers"] }, () => "America/Toronto", {})).toHaveLength(1);
});


test("Featured reads publication metadata from the cached feed and clears without another fetch", () => {
  const cached = [
    { ...events[0], id: 100, featured: false },
    { ...events[0], id: 101, featured: false },
    { ...events[0], id: 102, featured: true },
  ];
  const options = { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [] };
  expect(filterEvents(cached, { ...options, featured: true }, () => "America/Toronto", {}).map(event => event.id)).toEqual([102]);
  expect(filterEvents(cached, { ...options, featured: false }, () => "America/Toronto", {}).map(event => event.id)).toEqual([100, 101, 102]);
  const refreshed = cached.map(event => ({ ...event, featured: false }));
  expect(filterEvents(refreshed, { ...options, featured: true }, () => "America/Toronto", {}).map(event => event.id)).toEqual([]);
});


test("shared quick-filter order places Competitions before Varsity, Recurring right after Free food, and Exam de-stress just before the date filter", () => {
  const ids = getEventQuickFilters({ sportsGameAvailable: true }).map(filter => filter.id);
  expect(ids.indexOf("competitions")).toBe(ids.indexOf("sportsGame") - 1);
  expect(ids.slice(ids.indexOf("featured"), ids.indexOf("featured") + 5))
    .toEqual(["featured", "campusSeasons", "employersOnCampus", "freeFoodOnCampus", "recurring"]);
  expect(ids.indexOf("examDestress")).toBe(ids.indexOf("date") - 1);
  expect(ids.slice(ids.indexOf("minGoing"), ids.indexOf("minGoing") + 2))
    .toEqual(["minGoing", "price"]);
});


test("Free food matches Food plus Free for missing prices and listed food", () => {
  const candidates = [
    { ...events[0], id: 201, price: 0 },
    { ...events[0], id: 202, price: null },
    { ...events[0], id: 203, price: undefined },
    { ...events[0], id: 204, price: 5 },
    { ...events[0], id: 205, price: 0, food: [] },
    { ...events[0], id: 206, price: null, food: [] },
    { ...events[0], id: 207, price: -1 },
  ] as Event[];
  const results = () => filterEvents(candidates, { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [] }, () => "America/Toronto").map(event => event.id);
  const filename = new URL("../src/features/search/hooks/useFilterState.ts", import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const hooks = { exports: {} as typeof import("../src/features/search/hooks/useFilterState") };
  runInNewContext(outputText, {
    exports: hooks.exports,
    require: (id: string) => {
      if (id === "react") return {
        useCallback: (callback: unknown) => callback,
        startTransition: (callback: () => void) => callback(),
      };
      if (id === "zustand/react/shallow") return { useShallow: (selector: unknown) => selector };
      if (id === "@/features/search/api/filterService") return { storeStatesToFilterState, clearNarrowingFilterState, freeFoodFilterPatch };
      if (id === "@/features/search/store/search.store") return {
        useSearchStore: Object.assign((selector: (state: ReturnType<typeof useSearchStore.getState>) => unknown) => selector(useSearchStore.getState()), { getState: useSearchStore.getState }),
      };
      throw new Error(`Unexpected module: ${id}`);
    },
  });
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "10", employersOnCampus: true });
  const beforeRevision = useSearchStore.getState().queryRevision;
  hooks.exports.useFilterState().setFreeFood(true);
  expect(useSearchStore.getState().queryRevision).toBe(beforeRevision + 1);
  expect(useSearchStore.getState()).toMatchObject({ hasFoodFilter: true, minPrice: "", maxPrice: "0", employersOnCampus: true });
  expect(hooks.exports.useFilterState().freeFood).toBe(true);
  hooks.exports.useFilterState().setEmployersOnCampus(false);
  const shortcut = results();
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, hasFood: true, maxPrice: "0" });
  expect(shortcut).toEqual(results());
  expect(shortcut).toEqual([201, 202, 203, 207]);
  expect(hooks.exports.useFilterState().freeFood).toBe(true);
  const handoff = storeStatesToFilterState(useSearchStore.getState());
  expect(handoff).toMatchObject({ hasFood: true, minPrice: "", maxPrice: "0" });
  expect(handoff).not.toHaveProperty("freeFoodOnCampus");
  hooks.exports.useFilterState().setMaxPrice("5");
  expect(hooks.exports.useFilterState().freeFood).toBe(false);
  hooks.exports.useFilterState().setFreeFood(false);
  expect(useSearchStore.getState()).toMatchObject({ hasFoodFilter: false, minPrice: "", maxPrice: "" });
  expect(results()).toHaveLength(candidates.length);
});
