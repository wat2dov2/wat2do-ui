import { expect, test } from "@playwright/test";
import type { Club, Event } from "../src/shared/types";
import { isFreeFoodEvent, nicheClubs, upcomingEvents } from "../src/features/landing/lib/landingEvents";

test("free food is food that costs nothing", () => {
  expect(isFreeFoodEvent({ food: ["Pizza"], price: null } as Event)).toBe(true);
  expect(isFreeFoodEvent({ food: ["Pizza"], price: 5 } as Event)).toBe(false);
  expect(isFreeFoodEvent({ food: null, price: null } as Event)).toBe(false);
});

test("the clubs preview picks niche hobby clubs, never broad societies or associations", () => {
  const club = (club_name: string, categories = ["Games & Recreation"], event_count = 3) =>
    ({ club_name, logo_url: "logo.png", event_count, categories }) as Club;
  const clubs = [
    club("Campus Crusade for Cheese"),
    club("Motorcycle Club"),
    club("Engineering Society"),
    club("Accounting and Finance Student Association", ["Business"]),
    club("A Cappella Club", ["Arts & Culture"]),
    club("Archery Club", ["Games & Recreation"], 0),
  ];
  const picked = nicheClubs(clubs, 2).map((entry) => entry.club_name).sort();
  expect(picked).toEqual(["Campus Crusade for Cheese", "Motorcycle Club"]);
});

test("the landing lists the events still on soonest first, whatever the feed's order", () => {
  const nowMs = Date.now();
  const hourMs = 3_600_000;
  const at = (id: number, sessions: [number, number][]) => ({
    id, school: "uwaterloo",
    occurrences: sessions.map(([startsInHours, endsInHours]) => ({
      dtstart_utc: new Date(nowMs + startsInHours * hourMs).toISOString(),
      dtend_utc: new Date(nowMs + endsInHours * hourMs).toISOString(),
    })),
  }) as unknown as Event;
  // The feed leads with a weekly event by a session already over (its next is a week
  // away), and still holds one that has ended.
  const feed = [at(1, [[-4, -2], [164, 166]]), at(2, [[1, 2]]), at(3, [[-1, 1]]), at(4, [[-30, -29]])];
  expect(upcomingEvents(feed, nowMs).map((event) => event.id)).toEqual([3, 2, 1]);
});
