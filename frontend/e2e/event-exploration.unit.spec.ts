import { expect, test } from "@playwright/test";
import { QueryObserver } from "@tanstack/react-query";
import type { Event } from "../src/shared/types";
import type { SchoolSummary } from "../src/shared/api/schools.api";
import { toCalendarEvents } from "../src/features/events/lib/calendarEvents";
import { eventMapLocationsQuery, venueName } from "../src/features/events/api/eventMap.api";
import { getQueryClient } from "../src/shared/lib/queryClient";
import { controlBox } from "../src/shared/config/controlBox";
import { getEventStreetAddress } from "../src/shared/utils/event";

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

test("map keeps its campus and cached venues while a genuinely new feed location resolves", async () => {
  let finishSlow!: () => void;
  const slow = new Promise<void>(resolve => { finishSlow = resolve; });
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const name = new URL(String(input)).searchParams.get("q")!;
    requests.push(name);
    if (name.startsWith("Slow venue")) await slow;
    return searchResponse([-80.54, 43.47], "poi", "University of Waterloo Davis Centre Slow venue");
  };
  const client = getQueryClient();
  const first = eventMapLocationsQuery(school.slug, school, ["Davis Centre"]);
  await client.fetchQuery(first);
  const observer = new QueryObserver(client, first);
  const unsubscribe = observer.subscribe(() => {});
  const added = eventMapLocationsQuery(school.slug, school, ["Davis Centre", "Slow venue"]);
  try {
    observer.setOptions(added);
    expect(observer.getCurrentResult().data?.center).toEqual([-80.54, 43.47]);
    expect(observer.getCurrentResult().data?.locations["Davis Centre"]).toEqual([-80.54, 43.47]);
    await expect.poll(() => client.getQueryData(added.queryKey)).toMatchObject({
      locations: { "Davis Centre": [-80.54, 43.47] }, pendingCount: 1,
    });
    expect(requests.filter(name => name.startsWith("Davis Centre"))).toHaveLength(1);
    expect(requests).toHaveLength(3); // Cached campus and Davis Centre, one new venue.
    observer.setOptions(eventMapLocationsQuery("utsg", { ...school, slug: "utsg", name: "University of Toronto" }, []));
    expect(observer.getCurrentResult().data).toBeUndefined();
  } finally {
    finishSlow();
    await client.fetchQuery(added);
    unsubscribe();
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

test("returning to a cancelled location query completes its pending snapshot from the venue cache", async () => {
  let finishSlow!: () => void;
  const slow = new Promise<void>(resolve => { finishSlow = resolve; });
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    if (new URL(String(input)).searchParams.get("q")!.startsWith("Slow venue")) await slow;
    return searchResponse([-80.54, 43.47], "poi", "University of Waterloo Davis Centre Slow venue");
  };
  const client = getQueryClient();
  const query = eventMapLocationsQuery(school.slug, school, ["Davis Centre", "Slow venue"]);
  const pending = client.fetchQuery(query).catch(() => null);
  try {
    await expect.poll(() => client.getQueryData(query.queryKey)).toMatchObject({ pendingCount: 1 });
    await client.cancelQueries({ queryKey: query.queryKey, exact: true });
    finishSlow();
    await pending;
    const result = await client.fetchQuery(query);
    expect(result.pendingCount).toBe(0);
    expect(result.locations["Davis Centre"]).toEqual([-80.54, 43.47]);
    expect(result.locations["Slow venue"]).toEqual([-80.54, 43.47]);
    expect(requests).toBe(3);
  } finally {
    finishSlow();
    await pending;
  }
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

test("map uses only the school's verified building names without discarding event room details", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    const name = query.startsWith("Hagey Hall") ? "Hagey Hall" : query.startsWith("Davis Centre") ? "Davis Centre" : "University of Waterloo";
    return searchResponse([-80.54, 43.47], "poi", name);
  };
  const locations = ["J.G. Hagey Hall of the Humanities (HH) 139", "William G. Davis Computer Research Centre (DC) 1302"];
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, locations));
  expect(result.locations[locations[0]]).toEqual([-80.54, 43.47]);
  expect(result.locations[locations[1]]).toEqual([-80.54, 43.47]);
  expect(requests).toContain("Hagey Hall, Waterloo");
  expect(requests).toContain("Davis Centre, Waterloo");
  const otherSchool = await getQueryClient().fetchQuery(eventMapLocationsQuery("utsg", { ...school, slug: "utsg" }, locations));
  expect(otherSchool.locations[locations[0]]).toBeNull();
  expect(otherSchool.locations[locations[1]]).toBeNull();
  expect(requests).toContain("J.G. Hagey Hall of the Humanities, Waterloo");
});

test("map resolves an unlisted named venue through its supplied street address and city", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("University of Waterloo")) return searchResponse([-80.54, 43.47]);
    if (query.startsWith("Unlisted venue")) return new Response(JSON.stringify({ features: [] }), { status: 200 });
    return new Response(JSON.stringify({ features: [
      { geometry: { type: "Point", coordinates: [-80.54, 43.47] }, properties: { feature_type: "address", full_address: "1133 West Hastings Street, Waterloo, Ontario, Canada" } },
      { geometry: { type: "Point", coordinates: [-123.11, 49.28] }, properties: { feature_type: "address", full_address: "1134 West Hastings Street, Vancouver, British Columbia, Canada" } },
      { geometry: { type: "Point", coordinates: [-123.118, 49.286] }, properties: { feature_type: "address", full_address: "1133 West Hastings Street, Vancouver, British Columbia, Canada" } },
    ] }), { status: 200 });
  };
  const location = "Unlisted venue, 1133 W Hastings St, Vancouver, BC / Online";
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, [location]));
  expect(result.locations[location]).toEqual([-123.118, 49.286]);
  expect(requests).toContain("Unlisted venue, Vancouver");
  expect(requests).toContain("1133 W Hastings St, Vancouver");
  const roomDetail = "Unlisted venue, 1133 W Hastings St, Vancouver, BC, Room 2034";
  const repeated = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, [roomDetail]));
  expect(repeated.locations[roomDetail]).toEqual([-123.118, 49.286]);
  expect(requests).toHaveLength(3); // Campus, named venue, exact supplied address only once.
});

test("map uses an off-campus address city for the venue and rejects the same name in another city", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("University of Waterloo")) return searchResponse([-80.54, 43.47]);
    return new Response(JSON.stringify({ features: [
      { geometry: { type: "Point", coordinates: [-80.54, 43.47] }, properties: { feature_type: "poi", name: "Baker Hall", full_address: "Baker Hall, Waterloo, Ontario, Canada" } },
      { geometry: { type: "Point", coordinates: [-79.94, 40.44] }, properties: { feature_type: "poi", name: "Baker Hall", full_address: "Baker Hall, 4909 Frew Street, Pittsburgh, Pennsylvania, USA" } },
    ] }), { status: 200 });
  };
  const location = "Baker Hall, Carnegie Mellon University, 4909 Frew St, Pittsburgh, PA";
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, [location]));
  expect(result.locations[location]).toEqual([-79.94, 40.44]);
  expect(requests).toContain("Baker Hall, Pittsburgh");
  expect(requests).toHaveLength(2); // Exact named venue succeeds without an address retry.
});

test("map ignores campus and room metadata between a supplied street and its city", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("University of Waterloo")) return searchResponse([-80.54, 43.47]);
    if (query.startsWith("Mattamy Athletic Centre")) return new Response(JSON.stringify({ features: [] }), { status: 200 });
    return searchResponse([-79.38, 43.66], "address", "50 Carlton Street, Toronto, Ontario, Canada");
  };
  const location = "Mattamy Athletic Centre, 50 Carlton Street, Toronto Metropolitan University, Room 2034, Toronto, ON M5B 1J2";
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, [location]));
  expect(result.locations[location]).toEqual([-79.38, 43.66]);
  expect(requests).toContain("Mattamy Athletic Centre, Toronto");
  expect(requests).toContain("50 Carlton Street, Toronto");
});

test("map retains short city names when choosing the supplied address locality", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("University of Waterloo")) return searchResponse([-80.54, 43.47]);
    return searchResponse([-80.45, 43.29], "poi", "Workshop venue, 1 Main Street, Ayr, Ontario, Canada");
  };
  const location = "Workshop venue, 1 Main Street, Ayr, ON";
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, [location]));
  expect(result.locations[location]).toEqual([-80.45, 43.29]);
  expect(requests).toContain("Workshop venue, Ayr");
});

test("a supplied city cannot reuse a venue cached without that matching constraint", async () => {
  const toronto = { ...school, slug: "utsg", name: "University of Toronto", city: "Toronto" };
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    requests.push(query);
    if (query.startsWith("University of Toronto")) return searchResponse([-79.39, 43.66]);
    if (query.startsWith("40 St.")) return searchResponse([-79.39, 43.66], "address", "40 St. George Street, Toronto, Ontario, Canada");
    return searchResponse([-75.69, 45.42], "poi", "Bahen Centre, Ottawa, Ontario, Canada");
  };
  const bare = await getQueryClient().fetchQuery(eventMapLocationsQuery(toronto.slug, toronto, ["Bahen Centre"]));
  expect(bare.locations["Bahen Centre"]).toEqual([-75.69, 45.42]);
  const location = "Bahen Centre (BA) Room 2195, 40 St. George Street, Toronto, ON";
  const detailed = await getQueryClient().fetchQuery(eventMapLocationsQuery(toronto.slug, toronto, [location]));
  expect(detailed.locations[location]).toEqual([-79.39, 43.66]);
  expect(requests.filter(query => query === "Bahen Centre, Toronto")).toHaveLength(2);
  expect(requests).toHaveLength(4); // Campus, bare venue, constrained venue, exact address.
});

test("map street extraction never treats room numbers or campus buildings as street addresses", () => {
  expect(getEventStreetAddress("Columbia Icefield (CIF), 220 Columbia St W, Waterloo, ON")).toBe("220 Columbia St W");
  expect(getEventStreetAddress("Room 2034, Student Life Centre")).toBeNull();
  expect(getEventStreetAddress("2034 Main Hall, University of Waterloo")).toBeNull();
  expect(getEventStreetAddress("University of Waterloo, Online")).toBeNull();
  expect(getEventStreetAddress("845 rue Sherbrooke Ouest, Montréal, Québec")).toBe("845 rue Sherbrooke Ouest");
  expect(getEventStreetAddress("Learning Crossroads, 100 Louis-Pasteur Private, Ottawa")).toBe("100 Louis-Pasteur Private");
});

test("map matches Concordia's supplied English address to the exact French provider label", async () => {
  const concordia = { ...school, slug: "concordia", name: "Concordia University", city: "Montreal" };
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!;
    if (query.startsWith("Concordia University")) return searchResponse([-73.578, 45.497], "poi", "Concordia University");
    if (query.startsWith("4THSPACE")) return new Response(JSON.stringify({ features: [] }), { status: 200 });
    return new Response(JSON.stringify({ features: [
      { geometry: { type: "Point", coordinates: [-73.55, 45.51] }, properties: { feature_type: "address", full_address: "1400 Boulevard De Maisonneuve Est, Montréal, Quebec H2L 2X4, Canada" } },
      { geometry: { type: "Point", coordinates: [-73.57, 45.49] }, properties: { feature_type: "address", full_address: "1400 Boulevard Sherbrooke Ouest, Montréal, Quebec, Canada" } },
      { geometry: { type: "Point", coordinates: [-79.39, 43.65] }, properties: { feature_type: "address", full_address: "1400 Boulevard De Maisonneuve Ouest, Toronto, Ontario, Canada" } },
      { geometry: { type: "Point", coordinates: [-73.578, 45.497] }, properties: { feature_type: "address", full_address: "1400 Boulevard De Maisonneuve Ouest, Montréal, Quebec H3G 2V8, Canada" } },
    ] }), { status: 200 });
  };
  const location = "4THSPACE, 1400 de Maisonneuve Boulevard West, Montreal, QC";
  expect(getEventStreetAddress("1400 Boulevard De Maisonneuve Ouest, Montréal, Quebec H3G 2V8, Canada")).toBe("1400 Boulevard De Maisonneuve Ouest");
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(concordia.slug, concordia, [location]));
  expect(result.locations[location]).toEqual([-73.578, 45.497]);
});

test("map preserves exact street types and compound directions in Canadian and US addresses", async () => {
  const labels = new Map([
    ["1 Discovery Pkwy NW", "1 Discovery Parkway Northwest"],
    ["2 Innovation Cir NE", "2 Innovation Circle Northeast"],
    ["3 Campus Sq SW", "3 Campus Square Southwest"],
    ["4 National Parkway SE", "4 National Parkway Southeast"],
    ["5 University Avenue Nord", "5 Avenue University North"],
    ["6 Campus Road Sud", "6 Chemin Campus South"],
    ["7 College Street Est", "7 Rue College East"],
    ["8 Avenue Road West", "8 Avenue Road West"],
    ["9 University Private", "9 University Pvt"],
    ["10 Nadolny Sachs Pvt", "10 Nadolny Sachs Private"],
  ]);
  const locations = [...labels.keys()].map(address => `${address}, Waterloo`);
  globalThis.fetch = async input => {
    const query = new URL(String(input)).searchParams.get("q")!.split(",")[0];
    if (query.startsWith("University of Waterloo")) return searchResponse([-80.54, 43.47]);
    const label = labels.get(query)!;
    const wrongLabel = query.startsWith("8 ") ? "8 Road Avenue West" : /\b(?:Private|Pvt)\b/.test(label)
      ? label.replace(/\b(?:Private|Pvt)\b/, "Street") : label.replace(/Northwest|Northeast|Southwest|Southeast|North|South|East/, "West");
    return new Response(JSON.stringify({ features: [
      { geometry: { type: "Point", coordinates: [-80.51, 43.45] }, properties: { feature_type: "address", full_address: `${wrongLabel}, Waterloo, Ontario, Canada` } },
      { geometry: { type: "Point", coordinates: [-80.54, 43.47] }, properties: { feature_type: "address", full_address: `${label}, Waterloo, Ontario, Canada` } },
    ] }), { status: 200 });
  };
  for (const address of labels.keys()) expect(getEventStreetAddress(`${address}, Waterloo`)).toBe(address);
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, locations));
  for (const location of locations) expect(result.locations[location]).toEqual([-80.54, 43.47]);
});

test("hybrid events map their physical venue while online-only events never create a pin", async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    requests.push(new URL(String(input)).searchParams.get("q")!);
    return searchResponse([-80.54, 43.47], "poi", "University of Waterloo Student Life Centre");
  };
  expect(venueName("Online (Zoom)")).toBeNull();
  expect(venueName("Hybrid")).toBeNull();
  expect(venueName("On-Campus")).toBeNull();
  expect(venueName("Pinnacle Hotel Harbourfront, 1133 W Hastings Street, Vancouver, BC / Online")).toBe("Pinnacle Hotel Harbourfront");
  expect(venueName("Student Life Centre (SLC) Lower Atrium")).toBe("Student Life Centre");
  expect(venueName("Room 2034, Student Life Centre")).toBe("Student Life Centre");
  const locations = ["Online; Student Life Centre", "Student Life Centre / Online (Zoom)", "Online (Zoom)"];
  const result = await getQueryClient().fetchQuery(eventMapLocationsQuery(school.slug, school, locations));
  expect(result.locations[locations[0]]).toEqual([-80.54, 43.47]);
  expect(result.locations[locations[1]]).toEqual([-80.54, 43.47]);
  expect(result.locations[locations[2]]).toBeNull();
  expect(requests).toHaveLength(2); // Campus and one shared physical venue.
  expect(requests[1]).toBe("Student Life Centre, Waterloo");
});
