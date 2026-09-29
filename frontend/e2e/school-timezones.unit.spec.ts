import { DEFAULT_APP_CONSTANTS } from "../src/shared/api/metaApi";
import { getClubCategoryConfig } from "../src/shared/data/clubCategoryStyles";
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { formatCardDate, formatCardTime, getEventDateSection, isEventHappeningNow, localDateTimeToUtc, toLocalDateTimeInput } from "../src/shared/utils/date";
import { eventToFormData } from "../src/shared/utils/event";
import { buildEventUpdatePayload } from "../src/shared/api/eventPayload";
import { formatPositionDeadlineBadge } from "../src/features/positions/lib/positionDates";
import type { Event, Position } from "../src/shared/types";
import { filterEvents } from "../src/features/search/api/searchService";
import { EMPTY_FILTER_STATE } from "../src/features/search/api/filterService";

let buildEventSlideModel: typeof import("../src/features/admin/lib/instagramSlides").buildEventSlideModel;
let getInstagramSlideLocale: typeof import("../src/features/admin/lib/instagramSlides").getInstagramSlideLocale;

const originalDoodles = process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS;
test.afterAll(() => {
  if (originalDoodles === undefined) delete process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS;
  else process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS = originalDoodles;
});
test.beforeAll(() => {
  const directory = new URL("../public/icons/club-categories/", import.meta.url);
  process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS = JSON.stringify(Object.fromEntries(
    readdirSync(directory).filter(name => name.endsWith(".svg")).map(name => [`/icons/club-categories/${name}`, readFileSync(new URL(name, directory), "utf8")]),
  ));
  const originalLogo = process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG;
  try {
    // The module captures the real build asset during import. Keep its large
    // SVG out of the runner environment inherited by Playwright subprocesses.
    process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG = readFileSync(new URL("../public/instagram-cover-logo.svg", import.meta.url), "utf8");
    const require = createRequire(import.meta.url);
    ({ buildEventSlideModel, getInstagramSlideLocale } = require("../src/features/admin/lib/instagramSlides"));
  } finally {
    if (originalLogo === undefined) delete process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG;
    else process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG = originalLogo;
  }
});

const timeZone = "America/Edmonton";
const event = {
  id: 1, category: "Business", title: "Alberta midnight event", school: "ualberta",
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
    hasFoodFilter: false, goingFilter: false, goingEventIds: [], campusSeasonOptions: [],
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
  expect(french.category.label).toBe("Arts");
  expect(french.badges).toEqual(["Annulé", "Nourriture", "Inscription"]);
  expect(french.title).toBe(input.title);
  expect(english.category.label).toBe("Arts");
  expect(english.badges).toEqual(["Cancelled", "Food", "Registration"]);
  await expect(buildEventSlideModel({ ...input, category: null }, "fr")).rejects.toThrow("valid category");
  expect(locale.language).toBe("fr");
  expect(await getInstagramSlideLocale("fr")).toBe(locale);
});

test("event time ranges preserve both sides of a repeated DST hour", async () => {
  const occurrence = { dtstart_utc: "2026-11-01T07:30:00Z", dtend_utc: "2026-11-01T08:30:00Z" };
  const time = formatCardTime({ occurrences: [occurrence] }, timeZone);
  expect(time).toContain("1:30 AM MDT");
  expect(time).toContain("1:30 AM MST");
  const slide = await buildEventSlideModel({ id: 1, category: "Business", tz: timeZone, ...occurrence }, "en");
  expect(slide.timeLine).toBe(time);
});

test("Instagram slides omit unknown end times and reject a missing school timezone", async () => {
  const input = { id: 1, category: "Business", tz: timeZone, dtstart_utc: "2026-09-18T22:30:00Z" };
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

test("published slides use the posting account before club or school identity", async () => {
  const input = {
    id: 1, category: "Business", tz: timeZone, school: "ualberta",
    ig_handle: "  @@posting.account  ", club_ig: "@club.account", club: "Campus Club",
  };
  expect((await buildEventSlideModel(input, "en")).author).toBe("posting.account");
  expect((await buildEventSlideModel({ ...input, ig_handle: "https://www.instagram.com/posting.account/?hl=en" }, "en")).author).toBe("posting.account");
  expect((await buildEventSlideModel({ ...input, ig_handle: null, club_ig: "https://instagram.com/club.account/" }, "en")).author).toBe("club.account");
  expect((await buildEventSlideModel({ ...input, ig_handle: "https://outside.example/account" }, "en")).author).toBe("club.account");
  expect((await buildEventSlideModel({ ...input, ig_handle: " @ " }, "fr")).author).toBe("club.account");
  expect((await buildEventSlideModel({ ...input, ig_handle: null, club_ig: " " }, "en")).author).toBe("Campus Club");
  expect((await buildEventSlideModel({ ...input, ig_handle: null, club_ig: null, club: " " }, "en")).author).toBe("ualberta.wat2do.io");
});

test("published slides preserve host attribution and omit removed comment text", async () => {
  const input = {
    id: 1, category: "Business", tz: timeZone, school: "ualberta", title: "Campus event",
    description: " Meet the team.\n\nBring your questions. ",
    club_logo_url: "https://example.com/club.png", source_image_url: "https://example.com/event.png",
  };
  for (const language of ["en", "fr"] as const) {
    const slide = await buildEventSlideModel(input, language);
    expect(slide).not.toHaveProperty("description");
    expect(slide.avatarSrc).toBe(input.club_logo_url);
    expect(slide.imageSrc).toBe(input.source_image_url);
    expect(slide.siteName).toBe("ualberta.wat2do.io");
    const prepared = await buildEventSlideModel(input, language, "data:image/png;base64,poster", "data:image/png;base64,avatar");
    expect(prepared.imageSrc).toBe("data:image/png;base64,poster");
    expect(prepared.avatarSrc).toBe("data:image/png;base64,avatar");
    const sparse = await buildEventSlideModel({ ...input, description: null, club_logo_url: null }, language);
    expect(sparse.title).toBe(input.title);
    expect(sparse.avatarSrc).toBe("");
  }
});


test("Memorial Instagram slides use French and Newfoundland local time", async () => {
  const slide = await buildEventSlideModel({
    id: 1, category: "Business", school: "mun", tz: "America/St_Johns", title: "Campus event",
    dtstart_utc: "2026-09-23T22:00:00Z", registration: true,
  }, "fr");
  expect(slide.dateLine).toBe("mercredi 23 septembre");
  expect(slide.timeLine).toContain("19:30");
  expect(slide.badges).toContain("Inscription");
});

for (const category of [undefined, null, "", "   ", "Events", "Unknown"]) {
  test(`Instagram slides reject an invalid category: ${category}`, async () => {
    await expect(buildEventSlideModel({ id: 1, tz: timeZone, category }, "en")).rejects.toThrow("valid category");
  });
}

test("every supported Instagram category keeps its localized label and colour", async () => {
  for (const category of DEFAULT_APP_CONSTANTS.event_categories) {
    for (const language of ["en", "fr"] as const) {
      const slide = await buildEventSlideModel({ id: 1, tz: timeZone, category }, language);
      expect(slide.category.color).toBe(getClubCategoryConfig(category).color);
      expect(slide.category.color).not.toBe("#E8E8E8");
      expect(slide.category.label).not.toMatch(/^(Events|Événements)$/);
      expect(slide.category.label).not.toBe("");
    }
  }
});


test("Instagram artwork shares school colors and localizes stable sticker choices", async () => {
  const context = { school: { name: "University of Alberta", primary_color: "#154734", secondary_color: "#FFDB05" } };
  const input = { id: 1, category: "Business", tz: timeZone, school: "ualberta", sticker_ids: ["campus-pick", "free-food", "unknown"] };
  const en = await buildEventSlideModel(input, "en", undefined, undefined, context);
  const fr = await buildEventSlideModel(input, "fr", undefined, undefined, context);
  expect(en.colors).toEqual({ primary: "#154734", secondary: "#FFDB05" });
  expect(en.doodleIcons).toHaveLength(42);
  expect(en.stickers.map(sticker => sticker.label)).toEqual(["Campus pick", "Free food"]);
  expect(fr.stickers.map(sticker => sticker.label)).toEqual(["À découvrir", "Repas gratuit"]);
  expect(en.stickers.map(sticker => sticker.seed)).toEqual(fr.stickers.map(sticker => sticker.seed));
});
