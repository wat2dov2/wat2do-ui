import { expect, test } from "@playwright/test";
import type { Event } from "../src/shared/types";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { toCalendarEvents } from "../src/features/events/lib/calendarEvents";
import { eventMapLocationsQuery } from "../src/features/events/api/eventMap.api";
import { getQueryClient } from "../src/shared/lib/queryClient";
import { controlBox } from "../src/shared/config/controlBox";

const school: SchoolSummary = {
  slug: "uwaterloo", name: "University of Waterloo", city: "Waterloo",
  timezone: "America/Toronto", language: "en", primary_color: "", secondary_color: "",
};
const nativeFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  getQueryClient().clear();
});
test.afterEach(() => {
  getQueryClient().clear();
  globalThis.fetch = nativeFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

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

function searchResponse(coordinates: number[], featureType = "poi", name = "University of Waterloo Student Life Centre Davis Centre") {
  return new Response(JSON.stringify({ features: [{
    geometry: { type: "Point", coordinates }, properties: { feature_type: featureType, name, full_address: name },
  }] }), { status: 200 });
}

test("map lookups deduplicate venues and reuse session queries across filter changes", async () => {
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url);
    return searchResponse([-80.54, 43.47]);
  };
  const first = eventMapLocationsQuery(school.slug, school, ["Student Life Centre", "Student Life Centre", "Davis Centre"]);
  const result = await first.queryFn!({ signal: new AbortController().signal } as never);
  expect(Object.keys(result.locations)).toHaveLength(2);
  expect(requests).toHaveLength(3); // Campus plus two distinct venues.
  expect(requests[0].searchParams.get("near")).toBe("Waterloo");
  expect(requests[1].searchParams.get("near")).toBe("-80.54,43.47");
  const second = eventMapLocationsQuery(school.slug, school, ["Student Life Centre"]);
  await second.queryFn!({ signal: new AbortController().signal } as never);
  expect(requests).toHaveLength(3);
});

test("map exposes the campus and ready venues while a slow lookup is still pending", async () => {
  let finishSlow!: () => void;
  const slow = new Promise<void>(resolve => { finishSlow = resolve; });
  globalThis.fetch = async input => {
    const name = new URL(String(input)).searchParams.get("q")!;
    if (name.startsWith("Student Life Centre")) await slow;
    return searchResponse([-80.54, 43.47]);
  };
  const query = eventMapLocationsQuery(school.slug, school, ["Davis Centre", "Student Life Centre"]);
  const pending = getQueryClient().fetchQuery(query);
  try {
    await expect.poll(() => getQueryClient().getQueryData(query.queryKey)).toMatchObject({
      center: [-80.54, 43.47], locations: { "Davis Centre": [-80.54, 43.47] }, pendingCount: 1,
    });
    const snapshot = getQueryClient().getQueryData(query.queryKey);
    expect(getQueryClient().getQueryState(query.queryKey)?.fetchStatus).toBe("fetching");
    finishSlow();
    const result = await pending;
    expect(result.pendingCount).toBe(0);
    expect(getQueryClient().getQueryState(query.queryKey)?.fetchStatus).toBe("idle");
    // Previously published query snapshots must not mutate behind React's back.
    expect(snapshot).toMatchObject({ pendingCount: 1 });
    expect(Reflect.get(snapshot as object, "locations")).not.toHaveProperty("Student Life Centre");
  } finally {
    finishSlow();
    await pending;
  }
});

test("map preserves located events when another venue lookup fails and rejects coarse pins", async () => {
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    if (query.startsWith("Failed")) return new Response("", { status: 429 });
    if (query.startsWith("Unknown")) return searchResponse([-80.54, 43.47], "place");
    return searchResponse([-80.54, 43.47]);
  };
  const query = eventMapLocationsQuery(school.slug, school, ["Failed", "Unknown", "Davis Centre"]);
  const result = await query.queryFn!({ signal: new AbortController().signal } as never);
  expect(result.locations["Davis Centre"]).toEqual([-80.54, 43.47]);
  expect(result.locations.Failed).toBeNull();
  expect(result.locations.Unknown).toBeNull();
  expect(result.failedCount).toBe(1);
});

test("map cancels queued work when the user leaves the view", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return searchResponse([-80.54, 43.47]); };
  const query = eventMapLocationsQuery(school.slug, school, ["A", "B", "C"]);
  await expect(query.queryFn!({ signal: controller.signal } as never)).rejects.toThrow();
  expect(calls).toBe(1); // No venue queries were scheduled.
});


test("map resolves room codes to buildings and rejects unrelated street matches", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("SLC")) return searchResponse([-80.54, 43.47], "poi", "SLC Great Hall");
    if (query.startsWith("Wrong")) return searchResponse([-80.54, 43.47], "address", "143 Waterloo Street");
    return searchResponse([-80.54, 43.47]);
  };
  const query = eventMapLocationsQuery(school.slug, school, ["SLC 2143", "DC 1302", "Wrong Venue"]);
  const result = await query.queryFn!({ signal: new AbortController().signal } as never);
  expect(result.locations["SLC 2143"]).toEqual([-80.54, 43.47]);
  expect(result.locations["DC 1302"]).toBeNull();
  expect(result.locations["Wrong Venue"]).toBeNull();
  expect(requests).toContain("SLC, Waterloo");
  expect(requests.some(query => query.includes("2143") || query.includes("1302"))).toBe(false);
});

test("map searches full building names without requiring their printed abbreviation in the result", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    const name = query.startsWith("Science") ? "Science Teaching Complex" : query.startsWith("Mathematics") ? "Mathematics & Computer Building" : query.startsWith("Pearl") ? "Pearl Sullivan Engineering Building" : "University of Waterloo";
    return searchResponse([-80.54, 43.47], "poi", name);
  };
  const query = eventMapLocationsQuery(school.slug, school, ["Science Teaching Complex (STC) 0020", "Mathematics and Computer (MC), room 2034", "Pearl Sullivan Engineering Building (PSE/E7), room 1200"]);
  const result = await getQueryClient().fetchQuery(query);
  expect(result.locations["Science Teaching Complex (STC) 0020"]).toEqual([-80.54, 43.47]);
  expect(requests).toContain("Science Teaching Complex, Waterloo");
  expect(result.locations["Mathematics and Computer (MC), room 2034"]).toEqual([-80.54, 43.47]);
  expect(result.locations["Pearl Sullivan Engineering Building (PSE/E7), room 1200"]).toEqual([-80.54, 43.47]);
});
