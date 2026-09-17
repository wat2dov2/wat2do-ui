import { test, expect } from "@playwright/test";
import { formatCardDate, formatCardTime, getEventDateSection, isEventHappeningNow, localDateTimeToUtc, toLocalDateTimeInput } from "../src/shared/utils/date";
import { eventToFormData } from "../src/shared/utils/event";
import { buildEventUpdatePayload } from "../src/shared/api/eventPayload";
import { formatPositionDeadlineBadge } from "../src/features/positions/lib/positionDates";
import type { Event, Position } from "../src/shared/types";
import { filterEvents } from "../src/features/search/api/searchService";
import { EMPTY_FILTER_STATE } from "../src/features/search/api/filterService";
import { buildEventSlideModel, getInstagramSlideLocale } from "../src/features/admin/lib/instagramSlides";

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
  expect(formatCardTime(event, timeZone)).not.toContain("MDT");
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

test("Instagram slides show both endpoints in the school's timezone across midnight", async () => {
  const slide = await buildEventSlideModel({ ...event, ...event.occurrences[0], id: event.id, tz: timeZone }, "en");
  expect(slide.dateLine).toBe("Monday, September 14");
  expect(slide.timeLine).toContain("Sep 14, 11:30 PM");
  expect(slide.timeLine).toContain("Sep 15, 1:00 AM");
  expect(slide.timeLine).not.toMatch(/[\u2009\u202f]/);
});

test("Instagram translations stay school-scoped across concurrent English and French renders", async () => {
  const input = {
    id: 1, school: "ulaval", tz: "America/Toronto", title: "Original title",
    dtstart_utc: "2026-09-18T22:30:00Z", dtend_utc: "2026-09-19T00:00:00Z",
    category: "Arts & Culture", cancelled: true, food: ["yes"], registration: true,
  };
  const [french, english, locale] = await Promise.all([
    buildEventSlideModel(input, "fr"), buildEventSlideModel(input, "en"), getInstagramSlideLocale("fr"),
  ]);
  expect(french.dateLine).toBe("vendredi 18 septembre");
  expect(french.timeLine).toContain("18:30");
  expect(french.timeLine).toContain("20:00");
  expect(french.category.label).toBe("Arts et culture");
  expect(french.badges).toEqual(["Annulé", "Nourriture", "Inscription"]);
  expect(french.title).toBe(input.title);
  expect(english.category.label).toBe("Arts & Culture");
  expect(english.badges).toEqual(["Cancelled", "Food", "Registration"]);
  expect((await buildEventSlideModel({ ...input, category: null }, "fr")).category.label).toBe("Événements");
  expect(locale.language).toBe("fr");
  expect(await getInstagramSlideLocale("fr")).toBe(locale);
});

test("event time ranges preserve both sides of a repeated DST hour", async () => {
  const occurrence = { dtstart_utc: "2026-11-01T07:30:00Z", dtend_utc: "2026-11-01T08:30:00Z" };
  const time = formatCardTime({ occurrences: [occurrence] }, timeZone);
  expect(time).toContain("1:30 AM MDT");
  expect(time).toContain("1:30 AM MST");
  const slide = await buildEventSlideModel({ id: 1, tz: timeZone, ...occurrence }, "en");
  expect(slide.timeLine).toBe(time);
});

test("Instagram slides omit unknown end times and reject a missing school timezone", async () => {
  const input = { id: 1, tz: timeZone, dtstart_utc: "2026-09-18T22:30:00Z" };
  const withoutEnd = await buildEventSlideModel(input, "en");
  expect(withoutEnd.timeLine).toBe("4:30 PM");
  const invalidEnd = await buildEventSlideModel({ ...input, dtend_utc: "invalid" }, "en");
  expect(invalidEnd.timeLine).toBe(withoutEnd.timeLine);
  expect((await buildEventSlideModel({ ...input, dtstart_utc: null }, "fr")).dateLine).toBe("");
  await expect(buildEventSlideModel({ ...input, tz: "" }, "en")).rejects.toThrow("School timezone is required");
});

test("ordinary ranges use compact localized times without redundant zone labels", () => {
  const input = { occurrences: [{ dtstart_utc: "2026-09-21T22:00:00Z", dtend_utc: "2026-09-22T00:00:00Z" }] };
  expect(formatCardTime(input, "America/Toronto")).toBe("6:00-8:00 PM");
  expect(formatCardTime(input, "America/Toronto", "fr")).toBe("18:00-20:00");
});

test("published slides preserve the school-local added timestamp and omit missing dates", async () => {
  const input = { id: 1, tz: timeZone, added_at: "2026-09-15T05:30:00Z" };
  expect((await buildEventSlideModel(input, "en")).addedLine).toBe("Added Sep 14, 2026, 11:30 PM");
  expect((await buildEventSlideModel(input, "fr")).addedLine).toContain("Ajouté le 14 sept. 2026");
  expect((await buildEventSlideModel({ ...input, added_at: null }, "en")).addedLine).toBe("");
  expect((await buildEventSlideModel({ ...input, added_at: "invalid" }, "en")).addedLine).toBe("");
});
