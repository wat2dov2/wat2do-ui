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
