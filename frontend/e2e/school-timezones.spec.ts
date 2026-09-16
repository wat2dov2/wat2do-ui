import { test, expect } from "@playwright/test";
import { formatCardDate, formatCardTime, getEventDateSection, isEventHappeningNow, localDateTimeToUtc, toLocalDateTimeInput } from "../src/shared/utils/date";
import { eventToFormData } from "../src/shared/utils/event";
import { buildEventUpdatePayload } from "../src/shared/api/eventPayload";
import { formatPositionDeadlineBadge } from "../src/features/positions/lib/positionDates";
import type { Event, Position } from "../src/shared/types";
import { filterEvents } from "../src/features/search/api/searchService";
import { EMPTY_FILTER_STATE } from "../src/features/search/api/filterService";

const timeZone = "America/Edmonton";
const event = {
  id: 1, title: "Alberta midnight event", school: "ualberta",
  occurrences: [{ id: "session", dtstart_utc: "2026-09-15T05:30:00Z", dtend_utc: "2026-09-15T07:00:00Z" }],
} as Event;

test("school clock controls display, not the live instant", () => {
  const now = new Date("2026-09-15T05:00:00Z");
  expect(formatCardDate(event, timeZone, "en-US", now)).toBe("Today");
  expect(getEventDateSection(event, timeZone, now)).toEqual({ kind: "today" });
  expect(formatCardTime(event, timeZone)).toContain("Sep 14");
  expect(formatCardTime(event, timeZone)).toContain("Sep 15");
  expect(formatCardTime(event, timeZone)).toContain("MDT");
  expect(isEventHappeningNow(event, new Date("2026-09-15T06:00:00Z"))).toBe(true);
  expect(isEventHappeningNow(event, now)).toBe(false);
});

test("school-local form values round-trip to UTC and reject nonexistent DST times", () => {
  expect(toLocalDateTimeInput(event.occurrences[0].dtstart_utc, timeZone)).toBe("2026-09-14T23:30");
  expect(localDateTimeToUtc("2026-09-14T23:30", timeZone)).toBe("2026-09-15T05:30:00.000Z");
  expect(() => localDateTimeToUtc("2026-03-08T02:30", timeZone)).toThrow(RangeError);
  expect(localDateTimeToUtc("2026-03-08T03:30", timeZone)).toBe("2026-03-08T09:30:00.000Z");
});

test("editing an unchanged repeated DST hour preserves its exact instant", () => {
  const repeatedHourEvent = {
    ...event,
    occurrences: [{ ...event.occurrences[0], dtstart_utc: "2026-11-01T08:30:25Z", dtend_utc: "2026-11-01T09:30:00Z" }],
  };
  const form = eventToFormData(repeatedHourEvent, timeZone);
  expect(form.occurrences[0].dtstart_local).toBe("2026-11-01T01:30");
  expect(buildEventUpdatePayload(form).occurrences[0].dtstart_utc).toBe("2026-11-01T08:30:25Z");
});

test("date-only position deadlines never shift to another calendar date", () => {
  const position = { deadline_date: "2026-09-15" } as Position;
  expect(formatPositionDeadlineBadge(position, "en-US", timeZone)).toBe("Sep 15");
});

test("a cross-school date filter evaluates each event in its own school", () => {
  const events = ["ualberta", "uwaterloo"].map((school, index) => ({
    ...event, id: index + 1, school,
    occurrences: [{ ...event.occurrences[0], dtstart_utc: "2035-01-15T05:30:00Z", dtend_utc: null }],
  }));
  const filtered = filterEvents(events, {
    ...EMPTY_FILTER_STATE, dateFilter: "custom", customDate: "2035-01-14",
    selectedCategories: [], selectedLocations: [], selectedFoods: [], selectedDays: [], selectedClubs: [],
    hasFoodFilter: false, goingFilter: false, goingEventIds: [],
  }, school => school === "ualberta" ? timeZone : "America/Toronto");
  expect(filtered.map(item => item.school)).toEqual(["ualberta"]);
});
