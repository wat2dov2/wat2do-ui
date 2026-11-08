import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import { preferInterestsWithinDay, sortEvents } from "../src/features/search/api/searchService";
import { groupEventsByDateSection } from "../src/features/events/lib/eventDateSections";
import { onboardingInterests } from "../src/features/onboarding/utils/onboardingInterests";
import { getEventCategory } from "../src/shared/utils/event";

const TORONTO = () => "America/Toronto";
// Wednesday 2026-09-30, 09:00 in Toronto.
const NOW_MS = Date.parse("2026-09-30T13:00:00Z");

function event(id: number, category: string, startUtc: string, endUtc: string | null = null): Event {
  return {
    id,
    title: `Event ${id}`,
    school: "uwaterloo",
    category,
    occurrences: [{ dtstart_utc: startUtc, dtend_utc: endUtc }],
  } as unknown as Event;
}

const ids = (events: Event[]) => events.map((item) => item.id);

test("the reader's interests lead each day while days stay in date order", () => {
  const events = sortEvents([
    event(1, "Business", "2026-09-30T15:00:00Z"),
    event(2, "Health", "2026-09-30T18:00:00Z"),
    event(3, "Business", "2026-09-30T22:00:00Z"),
    event(4, "Health", "2026-09-30T23:30:00Z"),
    // 22:00 on Oct 1 UTC is still Oct 1 in Toronto; 02:00 on Oct 2 UTC is Oct 1 too.
    event(5, "Business", "2026-10-01T22:00:00Z"),
    event(6, "Health", "2026-10-02T02:00:00Z"),
  ], { sortBy: "date", sortOrder: "asc" });

  expect(ids(preferInterestsWithinDay(events, ["Health"], TORONTO, NOW_MS))).toEqual([2, 4, 1, 3, 6, 5]);
});

test("no interests, or none on a day, leaves the order exactly as it was", () => {
  const events = [
    event(1, "Business", "2026-09-30T15:00:00Z"),
    event(2, "Arts & Culture", "2026-09-30T18:00:00Z"),
  ];
  expect(preferInterestsWithinDay(events, [], TORONTO, NOW_MS)).toBe(events);
  expect(ids(preferInterestsWithinDay(events, ["Health"], TORONTO, NOW_MS))).toEqual([1, 2]);
});

test("an event without a category counts as the default category", () => {
  const events = [
    event(1, "Business", "2026-09-30T15:00:00Z"),
    event(2, "", "2026-09-30T18:00:00Z"),
  ];
  expect(ids(preferInterestsWithinDay(events, [getEventCategory({ category: "" })], TORONTO, NOW_MS))).toEqual([2, 1]);
});

test("the Past section keeps its latest-first order while upcoming days lead with interests", () => {
  const events = sortEvents([
    // Two ended events on the same past day (the later one an interest), then today's.
    event(1, "Business", "2026-09-28T14:00:00Z", "2026-09-28T15:00:00Z"),
    event(2, "Health", "2026-09-28T20:00:00Z", "2026-09-28T21:00:00Z"),
    event(3, "Business", "2026-09-30T15:00:00Z", "2026-09-30T16:00:00Z"),
    event(4, "Health", "2026-09-30T18:00:00Z", "2026-09-30T19:00:00Z"),
  ], { sortBy: "date", sortOrder: "asc" });

  const ranked = preferInterestsWithinDay(events, ["Health"], TORONTO, NOW_MS);
  const sections = groupEventsByDateSection(ranked, TORONTO, new Date(NOW_MS), true);

  expect(sections.map((section) => [section.section.kind, ids(section.events)])).toEqual([
    ["today", [4, 3]],
    ["past", [2, 1]],
  ]);
});

test("onboarding saves the picked topics plus the tapped events' categories, each once", () => {
  expect(onboardingInterests(
    ["Business", "Health"],
    [{ category: "Health" }, { category: "Arts & Culture" }, { category: "Arts & Culture" }],
  )).toEqual(["Business", "Health", "Arts & Culture"]);
  expect(onboardingInterests([], [])).toEqual([]);
});
