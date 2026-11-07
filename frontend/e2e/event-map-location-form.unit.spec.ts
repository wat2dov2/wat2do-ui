import { expect, test } from "@playwright/test";
import { isEventFormValid, markAllFieldsTouched, validateEventForm } from "../src/shared/services/validationService";
import { buildEventPayload } from "../src/shared/api/eventPayload";
import { mapEventInputToFormData, mapLocationFor, withLocation } from "../src/features/events/hooks/useEventForm.utils";
import type { EventFormData } from "../src/shared/types";

const form = (location: string, map_location: string): EventFormData => ({
  timeZone: "America/Toronto", club_id: 7, title: "Jam", description: "",
  occurrences: [{ dtstart_local: "2026-10-21T19:00", dtend_local: "" }],
  location, map_location, category: "", price: 0, food: [], registration: false,
});
const saved = { location: "AL 113", map_location: "Arts Lecture Hall, Waterloo, ON" };

test("the map looks for the venue as typed, and for nothing online or still to be announced", () => {
  expect(mapLocationFor(" SLC Great Hall ")).toBe("SLC Great Hall");
  expect(mapLocationFor("Online (Zoom)")).toBe("");
  expect(mapLocationFor("TBA")).toBe("");
  expect(mapLocationFor("Location shared after registration")).toBe("");
  expect(mapLocationFor("")).toBe("");
  expect(withLocation(form("", ""), "MC 4040")).toMatchObject({ location: "MC 4040", map_location: "MC 4040" });
});

test("a saved event keeps its saved map location only at its saved venue", () => {
  const event = form(saved.location, saved.map_location);
  expect(withLocation(event, "MC 4040", saved).map_location).toBe("MC 4040");
  expect(withLocation(event, "Online", saved).map_location).toBe("");
  expect(withLocation(withLocation(event, "MC 4040", saved), " AL 113 ", saved).map_location).toBe(saved.map_location);
});

test("a read flyer's venue is searched as written", () => {
  const fallbacks = { timeZone: "America/Toronto", occurrences: [], source_image_url: null };
  expect(mapEventInputToFormData({ location: "Sir Isaac Brock Statue" }, fallbacks).map_location).toBe("Sir Isaac Brock Statue");
  expect(mapEventInputToFormData({ location: "Online" }, fallbacks).map_location).toBe("");
});

test("one location is all a valid event needs", () => {
  expect(validateEventForm(form("AL 113", "AL 113"), markAllFieldsTouched())).toEqual({});
  expect(isEventFormValid(form("Online (Zoom)", ""), {})).toBe(true);
  expect(validateEventForm(form("", ""), markAllFieldsTouched()).location).toBeTruthy();
  expect(isEventFormValid(form("", ""), {})).toBe(false);
});

test("the payload sends both locations and an empty map location as null", () => {
  expect(buildEventPayload(form("AL 113", " Arts Lecture Hall, Waterloo, ON "))).toMatchObject({
    location: "AL 113", map_location: "Arts Lecture Hall, Waterloo, ON",
  });
  expect(buildEventPayload(form("Online", "")).map_location).toBeNull();
});
