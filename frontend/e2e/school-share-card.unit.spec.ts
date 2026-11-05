import { expect, test } from "@playwright/test";
import socialPreviews from "../../backend/controlbox/social_previews.json" with { type: "json" };
import {
  buildSchoolShareCard,
  buildSchoolShareImage,
} from "../src/features/events/lib/schoolShareCard";
import type { School } from "../src/shared/api/schools.api";
import type { Event } from "../src/shared/types";

const now = Date.parse("2026-11-03T18:00:00Z");
const waterloo: School = {
  slug: "uwaterloo",
  name: "University of Waterloo",
  primary_color: "#6B238E",
  secondary_color: "#FFD54F",
  timezone: "America/Toronto",
  language: "en",
};
const laval: School = { ...waterloo, slug: "ulaval", name: "Université Laval", language: "fr" };

/** An event whose only session runs from `start` to `end` (ISO, UTC). */
const event = (id: number, start: string, end: string): Event => ({
  id, school: "uwaterloo", title: `Event ${id}`, occurrences: [{ dtstart_utc: start, dtend_utc: end }],
} as Event);
const ended = event(1, "2026-11-02T18:00:00Z", "2026-11-02T20:00:00Z");
const running = event(2, "2026-11-03T17:00:00Z", "2026-11-03T19:00:00Z");
const tomorrow = event(3, "2026-11-04T18:00:00Z", "2026-11-04T20:00:00Z");

test("the card counts only events that have not ended, in the school's colours and language", () => {
  expect(buildSchoolShareCard(waterloo, [ended, running, tomorrow], now)).toEqual({
    colors: { primary: "#6B238E", secondary: "#FFD54F" },
    schoolName: "University of Waterloo",
    eventsLine: "2 upcoming events",
    siteLine: "uwaterloo.wat2do.io",
  });
  expect(buildSchoolShareCard(waterloo, [ended, tomorrow], now).eventsLine).toBe("1 upcoming event");
  expect(buildSchoolShareCard(waterloo, [ended], now).eventsLine).toBe("Campus events and clubs");
  expect(buildSchoolShareCard(laval, [running, tomorrow], now).eventsLine).toBe("2 événements à venir");
  expect(buildSchoolShareCard(laval, [tomorrow], now).eventsLine).toBe("1 événement à venir");
  expect(buildSchoolShareCard(laval, [], now).eventsLine).toBe("Événements et clubs du campus");
});

test("the preview URL lives on the school's host and changes exactly when the card does", () => {
  const card = buildSchoolShareCard(waterloo, [running, tomorrow], now);
  const image = buildSchoolShareImage("uwaterloo", card);
  expect(image).toMatchObject({
    alt: "Upcoming events at University of Waterloo on Wat2Do",
    width: socialPreviews.width,
    height: socialPreviews.height,
    type: "image/png",
  });
  expect(image.url).toMatch(/^https:\/\/uwaterloo\.wat2do\.io\/og-image\.png\?v=[\w-]{12}$/);

  // Same drawing, same URL: an hour later both events are still upcoming.
  const later = buildSchoolShareCard(waterloo, [running, tomorrow], now + 60 * 60 * 1000 - 1);
  expect(buildSchoolShareImage("uwaterloo", later).url).toBe(image.url);
  // A finished event, a recoloured school or a renamed one is a new image.
  const afterRunningEnds = buildSchoolShareCard(waterloo, [running, tomorrow], Date.parse("2026-11-03T20:00:00Z"));
  for (const changed of [
    afterRunningEnds,
    buildSchoolShareCard({ ...waterloo, secondary_color: "#FFFFFF" }, [running, tomorrow], now),
    buildSchoolShareCard({ ...waterloo, name: "Waterloo" }, [running, tomorrow], now),
  ]) {
    expect(buildSchoolShareImage("uwaterloo", changed).url).not.toBe(image.url);
  }
});
