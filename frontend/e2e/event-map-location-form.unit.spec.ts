import { expect, test } from "@playwright/test";
import { isEventFormValid, markAllFieldsTouched, validateEventForm, type EventFormRules } from "../src/shared/services/validationService";
import { buildEventPayload } from "../src/shared/api/eventPayload";
import type { EventFormData } from "../src/shared/types";

const form = (location: string, map_location: string): EventFormData => ({
  timeZone: "America/Toronto", club_id: 7, title: "Jam", description: "",
  occurrences: [{ dtstart_local: "2026-10-21T19:00", dtend_local: "" }],
  location, map_location, category: "", price: 0, food: [], registration: false,
});
const newEvent: EventFormRules = { requireClub: true, initialLocation: "", initialMapLocation: "" };
const saved: EventFormRules = { requireClub: true, initialLocation: "AL 113", initialMapLocation: "Arts Lecture Hall, Waterloo, ON" };
const messages = { mapLocationRequired: "map location required" };
const mapError = (data: EventFormData, rules: EventFormRules) =>
  validateEventForm(data, markAllFieldsTouched(), messages, rules).map_location;

test("a physical venue needs a map location, and an online event does not", () => {
  expect(mapError(form("AL 113", ""), newEvent)).toBe("map location required");
  expect(isEventFormValid(form("AL 113", ""), {}, newEvent)).toBe(false);
  expect(mapError(form("AL 113", "Arts Lecture Hall, Waterloo, ON"), newEvent)).toBeUndefined();
  expect(mapError(form("Online (Zoom)", ""), newEvent)).toBeUndefined();
  expect(isEventFormValid(form("Online (Zoom)", ""), {}, newEvent)).toBe(true);
});

test("changing the location requires a new map location", () => {
  expect(mapError(form("AL 113", "Arts Lecture Hall, Waterloo, ON"), saved)).toBeUndefined();
  expect(mapError(form("MC 4040", "Arts Lecture Hall, Waterloo, ON"), saved)).toBe("map location required");
  expect(mapError(form("MC 4040", ""), saved)).toBe("map location required");
  expect(mapError(form("MC 4040", "Mathematics 3, Waterloo, ON"), saved)).toBeUndefined();
  // A saved map location cannot be cleared while the venue stays physical.
  expect(mapError(form("AL 113", ""), saved)).toBe("map location required");
});

test("an event saved without a map location can be edited without adding one", () => {
  const unplaced: EventFormRules = { requireClub: true, initialLocation: "TBA", initialMapLocation: "" };
  expect(mapError(form("TBA", ""), unplaced)).toBeUndefined();
});

test("the payload sends both locations and an empty map location as null", () => {
  expect(buildEventPayload(form("AL 113", " Arts Lecture Hall, Waterloo, ON "))).toMatchObject({
    location: "AL 113", map_location: "Arts Lecture Hall, Waterloo, ON",
  });
  expect(buildEventPayload(form("Online", "")).map_location).toBeNull();
});
