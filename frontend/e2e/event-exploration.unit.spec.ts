import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import { toCalendarEvents } from "../src/features/events/lib/calendarEvents";
import { controlBox } from "../src/shared/config/controlBox";
import { getEventStreetAddress } from "../src/shared/utils/event";

function event(occurrences: Event["occurrences"]): Event {
  return { id: 1, title: "Cooking night", occurrences } as Event;
}

test("calendar expands recurring occurrences in the school clock, including DST", () => {
  const listing = event([
    { id: "before", dtstart_utc: "2026-10-30T22:00:00Z", dtend_utc: "2026-10-30T23:00:00Z" },
    { id: "after", dtstart_utc: "2026-11-06T23:00:00Z", dtend_utc: "2026-11-07T00:00:00Z" },
  ]);
  const calendar = toCalendarEvents([listing], "America/Toronto");
  expect(calendar).toHaveLength(2);
  expect(calendar.map(item => item.start.getHours())).toEqual([18, 18]);
  expect(calendar.map(item => item.end.getHours())).toEqual([19, 19]);
  expect(calendar[0].event).toBe(listing);
  expect(calendar[0].id).not.toBe(calendar[1].id);
});

test("calendar bounds undated ends using the feed visibility rule and rejects invalid ranges", () => {
  const calendar = toCalendarEvents([event([
    { id: "no-end", dtstart_utc: "2026-10-06T22:00:00Z", dtend_utc: null },
    { id: "bad-start", dtstart_utc: "invalid", dtend_utc: null },
    { id: "backwards", dtstart_utc: "2026-10-06T22:00:00Z", dtend_utc: "2026-10-06T21:00:00Z" },
  ])], "America/Toronto");
  expect(calendar).toHaveLength(1);
  expect(calendar[0].end.getTime() - calendar[0].start.getTime()).toBe(controlBox.eventDiscovery.eventWithoutEndVisibilityMs);
});

test("street extraction never treats room numbers or campus buildings as street addresses", () => {
  expect(getEventStreetAddress("Columbia Icefield (CIF), 220 Columbia St W, Waterloo, ON")).toBe("220 Columbia St W");
  expect(getEventStreetAddress("Room 2034, Student Life Centre")).toBeNull();
  expect(getEventStreetAddress("2034 Main Hall, University of Waterloo")).toBeNull();
  expect(getEventStreetAddress("University of Waterloo, Online")).toBeNull();
  expect(getEventStreetAddress("845 rue Sherbrooke Ouest, Montréal, Québec")).toBe("845 rue Sherbrooke Ouest");
  expect(getEventStreetAddress("Learning Crossroads, 100 Louis-Pasteur Private, Ottawa")).toBe("100 Louis-Pasteur Private");
  expect(getEventStreetAddress("1400 Boulevard De Maisonneuve Ouest, Montréal, Quebec H3G 2V8, Canada")).toBe("1400 Boulevard De Maisonneuve Ouest");
  for (const address of ["1 Discovery Pkwy NW", "2 Innovation Cir NE", "3 Campus Sq SW", "4 National Parkway SE", "5 University Avenue Nord", "6 Campus Road Sud", "7 College Street Est", "8 Avenue Road West", "9 University Private", "10 Nadolny Sachs Pvt"]) {
    expect(getEventStreetAddress(`${address}, Waterloo`)).toBe(address);
  }
});
