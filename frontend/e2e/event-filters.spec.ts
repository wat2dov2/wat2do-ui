import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { filterEvents } from "../src/features/search/api/searchService";
import { clearNarrowingFilterState, EMPTY_FILTER_STATE, normalizeFilterState, resolveCampusSeasonFilters, storeStatesToFilterState } from "../src/features/search/api/filterService";
import { useSearchStore } from "../src/features/search/store/search.store";
import { useEventsStore } from "../src/features/events/store/events.store";
import { getFilterCounts } from "../src/shared/utils/filter";

const events = [
  { id: 1, location: "Student Centre", price: 0, food: ["Pizza"] },
  { id: 2, location: " Online via ZOOM ", price: 0, food: [] },
  { id: 3, location: "Google Meet", price: 10, food: [] },
  { id: 4, location: null, price: 0, food: [] },
  { id: 5, location: " ", price: 0, food: [] },
].map(event => ({ ...event, title: "Workshop", school: "uwaterloo", occurrences: [] }) as unknown as Event);

function visibleEvents() {
  return filterEvents(events, {
    ...useSearchStore.getState(), goingEventIds: [],
  }, () => "America/Toronto", { 1: { going_count: 5 }, 2: { going_count: 2 } }).map(event => event.id);
}

test.beforeEach(() => useSearchStore.getState().setFilterState(EMPTY_FILTER_STATE));

test("format selection uses the existing venue classifier and excludes unknown venues only when narrowed", () => {
  expect(visibleEvents()).toEqual([1, 2, 3, 4, 5]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, eventFormat: "online" });
  expect(visibleEvents()).toEqual([2, 3]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, eventFormat: "inPerson" });
  expect(visibleEvents()).toEqual([1]);
});

test("format combines with existing Free, Food and minimum Going filters", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, eventFormat: "online", maxPrice: "0", minGoing: 2 });
  expect(visibleEvents()).toEqual([2]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, eventFormat: "inPerson", maxPrice: "0", hasFood: true, minGoing: 5 });
  expect(visibleEvents()).toEqual([1]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(4);
});

test("format survives filter handoff and resets through the shared Clear all action", () => {
  useSearchStore.getState().setFilterState(normalizeFilterState({ eventFormat: "online", sortOrder: "desc" }));
  const handoff = storeStatesToFilterState(useSearchStore.getState());
  expect(normalizeFilterState(JSON.parse(JSON.stringify(handoff))).eventFormat).toBe("online");
  useSearchStore.getState().setFilterState(clearNarrowingFilterState(handoff));
  expect(useSearchStore.getState().eventFormat).toBe("any");
  expect(useSearchStore.getState().sortOrder).toBe("desc");
  expect(getFilterCounts(useSearchStore.getState())).toBe(0);
  expect(visibleEvents()).toHaveLength(5);
  expect(normalizeFilterState({ eventFormat: "invalid" }).eventFormat).toBe("any");
  expect(normalizeFilterState({}).eventFormat).toBe("any");
});


test("price thresholds exclude the boundary, combine with other filters, and clear through shared state", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "9" });
  expect(visibleEvents()).toEqual([3]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(1);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, minPrice: "10" });
  expect(visibleEvents()).toEqual([]);
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

const discoveryEvents = [
  { id: 11, title: "Employer booth with free pizza", employers_on_campus: true, free_food_on_campus: true, sports_game: false, price: 10, food: ["Pizza"] },
  { id: 12, title: "Free campus lunch", employers_on_campus: false, free_food_on_campus: true, sports_game: false, price: 0 },
  { id: 13, title: "Official varsity basketball match", employers_on_campus: false, free_food_on_campus: false, sports_game: true },
  { id: 14, title: "Free career workshop", category: "Business", price: 0, food: ["Pizza"], employers_on_campus: null, free_food_on_campus: null, sports_game: null },
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
  return filterEvents(discoveryEvents, { ...useSearchStore.getState(), goingEventIds: [] }, () => "America/Toronto")
    .map(event => event.id);
}

for (const [filter, expected] of [
  ["employersOnCampus", [11]],
  ["freeFoodOnCampus", [11, 12]],
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

test("discovery filters intersect independently of category, food labels, and admission price", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, freeFoodOnCampus: true });
  expect(discoveryResults()).toEqual([11]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(2);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, freeFoodOnCampus: true, maxPrice: "0" });
  expect(discoveryResults()).toEqual([12]);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, employersOnCampus: true, sportsGame: true });
  expect(discoveryResults()).toEqual([]);
});

const campusSchool: SchoolSummary = {
  slug: "uwaterloo", name: "University of Waterloo", timezone: "America/Toronto", language: "en",
  primary_color: "#000000", secondary_color: "#ffffff", faculties: [], location_examples: [], email_domains: [],
  event_seasons: [
    { id: "homecoming", labels: { en: "HOCO", fr: "Retrouvailles" }, display_windows: [{ start_date: "2026-09-28", end_date: "2026-09-29" }] },
    { id: "holidays", labels: { en: "Holidays" }, display_windows: [
      { start_date: "2026-09-28", end_date: "2026-09-29" },
      { start_date: "2026-12-01", end_date: "2026-12-31" },
    ] },
  ],
};

test("campus season visibility follows inclusive school-local dates and supports separate windows", () => {
  const visible = (now: string) => resolveCampusSeasonFilters(campusSchool, Date.parse(now), "en", []).options.map(option => option.id);
  expect(visible("2026-09-28T03:59:59Z")).toEqual([]);
  expect(visible("2026-09-28T04:00:00Z")).toEqual(["homecoming", "holidays"]);
  expect(visible("2026-09-30T03:59:59Z")).toEqual(["homecoming", "holidays"]);
  expect(visible("2026-09-30T04:00:00Z")).toEqual([]);
  expect(visible("2026-12-01T04:59:59Z")).toEqual([]);
  expect(visible("2026-12-01T05:00:00Z")).toEqual(["holidays"]);
  expect(resolveCampusSeasonFilters({ ...campusSchool, slug: "ualberta", timezone: "America/Edmonton" }, Date.parse("2026-09-28T04:00:00Z"), "en", []).options).toEqual([]);
});

test("campus season labels use the current language, its base language, then English", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(campusSchool, now, "fr-CA", []).options.map(option => option.label)).toEqual(["Retrouvailles", "Holidays"]);
  expect(resolveCampusSeasonFilters(campusSchool, now, "de", []).options.map(option => option.label)).toEqual(["HOCO", "Holidays"]);
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
  ].map(item => ({ ...events[0], ...item }) as Event);
  const results = () => filterEvents(seasonalEvents, { ...useSearchStore.getState(), goingEventIds: [] }, () => campusSchool.timezone).map(item => item.id);
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, campusSeasonIds: ["homecoming", "holidays"] });
  expect(results()).toEqual([1, 2]);
  expect(getFilterCounts(useSearchStore.getState())).toBe(2);
  useSearchStore.getState().setFilterState({ ...storeStatesToFilterState(useSearchStore.getState()), employersOnCampus: true });
  expect(results()).toEqual([1]);
});

test("expired and other-school selections stop narrowing results, counts, and telemetry before stored cleanup", () => {
  useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, campusSeasonIds: ["homecoming", "other-school-hoco"] });
  const submitted = useSearchStore.getState();
  const beforeExpiry = `${submitted.queryRevision}:${JSON.stringify(storeStatesToFilterState(submitted))}`;
  const expired = resolveCampusSeasonFilters(campusSchool, Date.parse("2026-10-01T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds);
  expect(expired.ready).toBe(true);
  expect(expired.selectedIds).toEqual([]);
  const effective = { ...useSearchStore.getState(), campusSeasonIds: expired.selectedIds };
  expect(filterEvents(events, { ...effective, goingEventIds: [] }, () => campusSchool.timezone)).toHaveLength(events.length);
  expect(getFilterCounts(effective)).toBe(0);
  expect(storeStatesToFilterState(effective).campusSeasonIds).toEqual([]);
  const expiredQuery = `${effective.queryRevision}:${JSON.stringify(storeStatesToFilterState(effective))}`;
  expect(expiredQuery).not.toBe(beforeExpiry);
  useSearchStore.getState().setFilterState(storeStatesToFilterState(effective), "normalization");
  const cleaned = useSearchStore.getState();
  expect(cleaned.campusSeasonIds).toEqual([]);
  expect(`${cleaned.queryRevision}:${JSON.stringify(storeStatesToFilterState(cleaned))}`).toBe(expiredQuery);
  expect(resolveCampusSeasonFilters(campusSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds).selectedIds).toEqual([]);
  // An intentional repeated user query still gets its own revision.
  cleaned.setFilterState(storeStatesToFilterState(cleaned));
  expect(useSearchStore.getState().queryRevision).toBe(cleaned.queryRevision + 1);
});

test("unavailable school configuration or the initial hydration clock never authorizes clearing stored selections", () => {
  const selected = ["homecoming"];
  expect(resolveCampusSeasonFilters(campusSchool, null, "en", selected)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters(undefined, Date.now(), "en", selected)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(selected).toEqual(["homecoming"]);
});

test("older school snapshots without season configuration preserve staged selections while explicit empty configuration clears them", () => {
  const oldSnapshot = { ...campusSchool };
  delete oldSnapshot.event_seasons;
  const selected = ["homecoming"];
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(resolveCampusSeasonFilters(oldSnapshot, now, "en", selected)).toEqual({ ready: false, options: [], selectedIds: [] });
  expect(resolveCampusSeasonFilters({ ...campusSchool, event_seasons: [] }, now, "en", selected)).toEqual({ ready: true, options: [], selectedIds: [] });
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
  const next = resolveCampusSeasonFilters(nextSchool, Date.parse("2026-09-28T12:00:00Z"), "en", useSearchStore.getState().campusSeasonIds);
  expect(next.options.map(option => option.id)).toContain("homecoming");
  expect(next.selectedIds).toEqual([]);
  // A QR handoff is applied after the navigation owner selects its school.
  useSearchStore.getState().setFilterState(normalizeFilterState({ campusSeasonIds: ["homecoming"] }));
  useEventsStore.getState().setSchoolFilter("uwo");
  expect(useSearchStore.getState().campusSeasonIds).toEqual(["homecoming"]);
});
