import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import { filterEvents } from "../src/features/search/api/searchService";
import { clearNarrowingFilterState, EMPTY_FILTER_STATE, normalizeFilterState, storeStatesToFilterState } from "../src/features/search/api/filterService";
import { useSearchStore } from "../src/features/search/store/search.store";
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
