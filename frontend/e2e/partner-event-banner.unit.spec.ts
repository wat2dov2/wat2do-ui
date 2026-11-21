import { expect, test } from "@playwright/test";
import partners from "../../backend/controlbox/partners.json" with { type: "json" };
import { findPartnerEventBanner } from "../src/features/events/lib/partnerEventBanner";
import type { Event } from "../src/shared/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Dip & Drink's booth at the bazaar: Nov 20 1-8 PM and Nov 21 11 AM-8 PM, Toronto time.
const friday = { dtstart_utc: "2026-11-20T18:00:00Z", dtend_utc: "2026-11-21T01:00:00Z" };
const saturday = { dtstart_utc: "2026-11-21T16:00:00Z", dtend_utc: "2026-11-22T01:00:00Z" };
const popUp = {
  id: 47001,
  school: "tmu",
  title: "Dip & Drink at the 3rd Annual Bazaar",
  ig_handle: "dipanddrink.offical",
  location: "Victoria Park Hub, 1527 Victoria Park Ave, 2nd Floor, Scarborough",
  map_location: "Victoria Park Hub, 1527 Victoria Park Ave, Scarborough, ON",
  cancelled: false,
  occurrences: [friday, saturday],
} as Event;
const club = { ...popUp, id: 47002, ig_handle: "tmucricket" } as Event;
const at = (iso: string) => Date.parse(iso);

test("the banner shows the date on now, then the next, and nothing once the last one ends", () => {
  expect(findPartnerEventBanner([club, popUp], "tmu", at("2026-11-20T20:00:00Z"))).toEqual({
    partnerName: "Dip & Drink",
    discountPercent: 20,
    discountCode: "WAT2DO",
    eventId: 47001,
    venue: "Victoria Park Hub",
    occurrence: friday,
  });
  expect(findPartnerEventBanner([popUp], "tmu", at("2026-11-21T02:00:00Z"))?.occurrence).toEqual(saturday);
  expect(findPartnerEventBanner([popUp], "tmu", at("2026-11-22T01:00:00Z"))?.occurrence).toEqual(saturday);
  expect(findPartnerEventBanner([popUp], "tmu", at("2026-11-22T01:00:01Z"))).toBeNull();
});

test("an event shows from banner_lead_days before it starts", () => {
  const lead = partners.banner_lead_days * DAY;
  const start = at(friday.dtstart_utc);
  expect(findPartnerEventBanner([popUp], "tmu", start - lead)?.eventId).toBe(47001);
  expect(findPartnerEventBanner([popUp], "tmu", start - lead - 1)).toBeNull();
});

test("only a partner's own events that are not cancelled, at its own schools", () => {
  const now = at("2026-11-20T20:00:00Z");
  expect(findPartnerEventBanner([club], "tmu", now)).toBeNull();
  expect(findPartnerEventBanner([{ ...popUp, cancelled: true } as Event], "tmu", now)).toBeNull();
  // Dip & Drink is TMU's partner, so another school's site never promotes it.
  expect(findPartnerEventBanner([{ ...popUp, school: "uwaterloo" } as Event], "uwaterloo", now)).toBeNull();
  // Older rows can keep the handle's "@" or its capitals.
  expect(
    findPartnerEventBanner([{ ...popUp, ig_handle: " @DipAndDrink.offical " } as Event], "tmu", now)?.eventId,
  ).toBe(47001);
});

test("of several partner events, the soonest wins", () => {
  const later = { ...popUp, id: 47003, occurrences: [{ dtstart_utc: "2026-11-25T18:00:00Z", dtend_utc: null }] } as Event;
  const now = at("2026-11-19T12:00:00Z");
  expect(findPartnerEventBanner([later, popUp], "tmu", now)?.eventId).toBe(47001);
  expect(findPartnerEventBanner([later, popUp], "tmu", at("2026-11-22T02:00:00Z"))?.eventId).toBe(47003);
});

test("the venue is the map location's name alone, or none", () => {
  const now = at("2026-11-20T20:00:00Z");
  const venue = (mapLocation: string | null) =>
    findPartnerEventBanner([{ ...popUp, map_location: mapLocation } as Event], "tmu", now)?.venue;
  expect(venue("Ted Rogers School of Management, Toronto Metropolitan University, 55 Dundas St W, Toronto, ON"))
    .toBe("Ted Rogers School of Management");
  // A bare street address, or no place at all (online or still to be announced), names no venue.
  expect(venue("1527 Victoria Park Ave, Scarborough, ON")).toBeNull();
  expect(venue(null)).toBeNull();
});
