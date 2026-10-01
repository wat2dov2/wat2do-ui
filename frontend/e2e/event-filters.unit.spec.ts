import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { filterEvents } from "../src/features/search/api/searchService";
import { clearNarrowingFilterState, EMPTY_FILTER_STATE, normalizeFilterState, resolveCampusSeasonFilters, resolveVarsityGamesFilter, storeStatesToFilterState } from "../src/features/search/api/filterService";
import { useSearchStore } from "../src/features/search/store/search.store";
import { useEventsStore } from "../src/features/events/store/events.store";
import { getFilterCounts } from "../src/shared/utils/filter";
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
  ["freeFoodOnCampus", [12, 14]],
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

test("free food requires free admission and food, and intersects employer/varsity filters", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, freeFoodOnCampus: true });
  expect(discoveryResults()).toEqual([]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(2);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, freeFoodOnCampus: true, maxPrice: "0" });
  expect(discoveryResults()).toEqual([12, 14]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, sportsGame: true });
  expect(discoveryResults()).toEqual([]);
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
  expect(resolveVarsityGamesFilter(unrelated, "uwaterloo", Date.now(), true))
    .toEqual({ ready: true, available: false, selected: false });
  expect(resolveVarsityGamesFilter([upcomingVarsityGame], "uwaterloo", Date.now(), true))
    .toEqual({ ready: true, available: true, selected: true });
  expect(resolveVarsityGamesFilter([upcomingVarsityGame], "uwaterloo", Date.parse("2026-09-29T17:00:00Z"), false).available).toBe(true);
  expect(resolveVarsityGamesFilter([upcomingVarsityGame], "uwaterloo", Date.parse("2026-09-29T18:00:01Z"), true).available).toBe(false);
});

test("Varsity availability uses all cached events and stays visible when another filter excludes games", () => {
  const cachedEvents = [...Array.from({ length: 100 }, (_, index) => ({ ...events[0], id: index + 100 })), upcomingVarsityGame];
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, hasFood: true });
  const filtered = filterEvents(cachedEvents, {
    ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: [],
  }, () => "America/Toronto");
  expect(filtered).not.toContain(upcomingVarsityGame);
  const availability = resolveVarsityGamesFilter(cachedEvents, "uwaterloo", Date.now(), false);
  expect(availability.available).toBe(true);
  expect(getEventQuickFilters({ sportsGameAvailable: availability.available }).map(filter => filter.id)).toContain("sportsGame");
});

test("pending feeds and hydration clocks hide Varsity without clearing staged selections", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, sportsGame: true });
  const selected = useSearchStore.getState().sportsGame;
  expect(resolveVarsityGamesFilter(null, "uwaterloo", Date.now(), selected))
    .toEqual({ ready: false, available: false, selected: false });
  expect(resolveVarsityGamesFilter([upcomingVarsityGame], "uwaterloo", null, selected))
    .toEqual({ ready: false, available: false, selected: false });
  expect(useSearchStore.getState().sportsGame).toBe(true);
  expect(getEventQuickFilters().map(filter => filter.id)).not.toContain("sportsGame");
  expect(resolveVarsityGamesFilter([upcomingVarsityGame], "uwaterloo", Date.now(), selected).selected).toBe(true);
});

test("a school without Varsity games clears stale narrowing and telemetry without a new user query", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, sportsGame: true });
  const state = useSearchStore.getState();
  const varsity = resolveVarsityGamesFilter(events, "uwaterloo", Date.now(), state.sportsGame);
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

test("campus season visibility follows inclusive school-local dates and supports separate windows", () => {
  const visible = (now: string) => resolveCampusSeasonFilters(campusSchool, Date.parse(now), "en", [], []).options.map(option => option.id);
  expect(visible("2026-09-28T03:59:59Z")).toEqual([]);
  expect(visible("2026-09-28T04:00:00Z")).toEqual(["homecoming", "thanksgiving"]);
  expect(visible("2026-09-30T03:59:59Z")).toEqual(["homecoming", "thanksgiving"]);
  expect(visible("2026-09-30T04:00:00Z")).toEqual([]);
  expect(visible("2026-12-01T04:59:59Z")).toEqual([]);
  expect(visible("2026-12-01T05:00:00Z")).toEqual(["winter_holidays"]);
  expect(resolveCampusSeasonFilters({ ...campusSchool, slug: "ualberta", timezone: "America/Edmonton" }, Date.parse("2026-09-28T04:00:00Z"), "en", [], []).options).toEqual([]);
});

test("campus season labels use the current language, its base language, then English", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(campusSchool, now, "fr-CA", [], []).options.map(option => option.label)).toEqual(["Retrouvailles", "Thanksgiving"]);
  expect(resolveCampusSeasonFilters(campusSchool, now, "de", [], []).options.map(option => option.label)).toEqual(["HOCO", "Thanksgiving"]);
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
  const results = () => filterEvents(seasonalEvents, { ...useSearchStore.getState(), goingEventIds: [], campusSeasonOptions: resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", [], []).options }, () => campusSchool.timezone).map(item => item.id);
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
  const expired = resolveCampusSeasonFilters(campusSchool, Date.parse("2026-10-01T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, []);
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
  expect(resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, []).selectedIds).toEqual([]);
  // An intentional repeated user query still gets its own revision.
  cleaned.setFilterState(storeStatesToFilterState(cleaned));
  expect(useSearchStore.getState().queryRevision).toBe(cleaned.queryRevision + 1);
});

test("unavailable school configuration or the initial hydration clock never authorizes clearing stored selections", () => {
  const selected = ["homecoming"];
  expect(resolveCampusSeasonFilters(campusSchool, null, "en", selected, [])).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters(undefined, Date.now(), "en", selected, [])).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(selected).toEqual(["homecoming"]);
});

test("older school snapshots without season configuration preserve staged selections while explicit empty configuration clears them", () => {
  const oldSnapshot = { ...campusSchool };
  delete oldSnapshot.event_seasons;
  const selected = ["homecoming"];
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(oldSnapshot, now, "en", selected, [])).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters({ ...campusSchool, event_seasons: [] }, now, "en", selected, [])).toEqual({ ready: true, options: [], selectedIds: [] });
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
  const next = resolveCampusSeasonFilters(nextSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds, []);
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
    const seasons = resolveCampusSeasonFilters(campusSchool, Date.parse(now), "en", [selection], []);
    return filterEvents(seasonalEvents, {
      ...useSearchStore.getState(), goingEventIds: [], campusSeasonIds: seasons.selectedIds, campusSeasonOptions: seasons.options,
    }, () => campusSchool.timezone).map(event => event.id);
  };
  expect(results("2026-09-28T12:00:00Z", "thanksgiving")).toEqual([2, 3, 6]);
  expect(results("2026-12-01T12:00:00Z", "winter_holidays")).toEqual([5]);
});


test("named seasonal filters carry only matching sessions into cards and date sections", () => {
  const seasons = resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", ["thanksgiving"], []);
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
    id: "midterm_prep", classification_id: "midterm_prep", labels: { en: "Midterm prep" },
    display_windows: [{ start_date: "2026-09-01", end_date: "2026-11-01" }],
  }] } as SchoolSummary;
  const now = Date.parse("2026-09-30T12:00:00Z");
  expect(resolveCampusSeasonFilters(school, now, "en", ["midterm_prep"], null).ready).toBe(false);
  const empty = resolveCampusSeasonFilters(school, now, "en", ["midterm_prep"], []);
  expect(empty.options).toEqual([]);
  expect(empty.selectedIds).toEqual([]);
  const matching = { ...events[0], school: school.slug, campus_season_ids: ["midterm_prep"], occurrences: [{ dtstart_utc: "2026-10-01T18:00:00Z" }] } as Event;
  expect(resolveCampusSeasonFilters(school, now, "en", [], [matching]).options).toHaveLength(1);
  expect(resolveCampusSeasonFilters(school, now, "en", [], [{ ...matching, cancelled: true }]).options).toEqual([]);
});
