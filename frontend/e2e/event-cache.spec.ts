import { expect, test } from "@playwright/test";
import { QueryObserver } from "@tanstack/react-query";
import { createRequire } from "node:module";
import type { Event, EventFormData } from "../src/shared/types";
import type { PaginatedEventsResponse } from "../src/features/events/api/events.api";
import { orderClubEvents } from "../src/features/events/lib/clubEventOrder";
import { queryKeys } from "../src/shared/lib/queryKeys";

const require = createRequire(import.meta.url);
const { getQueryClient }: typeof import("../src/shared/lib/queryClient") = require("../src/shared/lib/queryClient");
const { eventFeedQueryOptions, createEventAPI, updateEventAPI, deleteEventAPI }: typeof import("../src/features/events/api/events.api") = require("../src/features/events/api/events.api");
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const event = (id: number, school = "uwaterloo"): Event => ({
  id, school, club_id: 9, club: "Design Club", title: `Event ${id}`,
  added_at: `2026-09-${String(id + 10).padStart(2, "0")}T12:00:00Z`,
  occurrences: [], category: "Arts & Culture", price: 0, food: [], registration: false,
} as Event);
function feed(items: Event[]): PaginatedEventsResponse {
  const latest = items.at(-1);
  return {
    items, total: items.length, page: 1, page_size: items.length, total_pages: 1,
    latest_added_event: latest ? { title: latest.title, added_at: latest.added_at } : null,
  };
}
const form: EventFormData = {
  timeZone: "America/Toronto", club_id: 9, title: "Updated event", description: "Details",
  occurrences: [{ dtstart_local: "2026-10-01T12:00", dtend_local: "2026-10-01T13:00" }],
  location: "Campus", category: "Arts & Culture", price: 0, food: [], registration: false,
};

test.beforeEach(() => {
  // Exercise the browser's shared QueryClient without launching a browser.
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost" } } });
  getQueryClient().clear();
});
test.afterEach(() => {
  getQueryClient().clear();
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("school feed reads one complete canonical snapshot with all results and freshness metadata", async () => {
  const urls: URL[] = [];
  const complete = {
    ...feed(Array.from({ length: 55 }, (_, index) => ({ ...event(1), id: index + 1, title: `Event ${index + 1}` }))),
    generated_at: 1000,
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input), "http://localhost");
    urls.push(url);
    return Response.json(complete);
  };
  const client = getQueryClient();
  const result = await client.fetchQuery(eventFeedQueryOptions("uwaterloo"));
  expect(result).toEqual(complete);
  expect(urls.map(url => `${url.pathname}${url.search}`)).toEqual(["/api/discovery?school=uwaterloo&resource=events"]);
  globalThis.fetch = async () => Response.json({ detail: "Request failed with status 503" }, { status: 503 });
  await expect(client.fetchQuery(eventFeedQueryOptions("ubc"))).rejects.toThrow("503");
  expect(client.getQueryData(queryKeys.events.bySchool("ubc"))).toBeUndefined();
});

test("cached navigation ignores an older server snapshot and never mixes campus feeds", () => {
  const client = getQueryClient();
  const oldSnapshot = feed([event(1)]);
  const updated = feed([{ ...event(1), title: "Confirmed edit" }, event(2)]);
  client.setQueryData(queryKeys.events.bySchool("uwaterloo"), updated);
  const returning = new QueryObserver(client, { ...eventFeedQueryOptions("uwaterloo"), initialData: oldSnapshot });
  expect(returning.getCurrentResult().data).toEqual(updated);
  const campus = new QueryObserver(client, { ...eventFeedQueryOptions("ubc"), initialData: feed([event(3, "ubc")]) });
  expect(campus.getCurrentResult().data?.items.map(item => item.school)).toEqual(["ubc"]);
  expect(client.getQueryData(queryKeys.events.bySchool("uwaterloo"))).toEqual(updated);
  returning.destroy();
  campus.destroy();
});

test("failed background refresh retains usable data and differs from an initial load failure", async () => {
  const client = getQueryClient();
  const snapshot = feed([event(1)]);
  const observer = new QueryObserver(client, { ...eventFeedQueryOptions("uwaterloo"), initialData: snapshot });
  globalThis.fetch = async () => Response.json({ detail: "Request failed with status 503" }, { status: 503 });
  const refreshed = await observer.refetch();
  expect(refreshed.data).toEqual(snapshot);
  expect(refreshed.isRefetchError).toBe(true);
  expect(refreshed.isLoadingError).toBe(false);
  const cold = new QueryObserver(client, eventFeedQueryOptions("ubc"));
  expect((await cold.refetch()).isLoadingError).toBe(true);
  observer.destroy();
  cold.destroy();
});

test("confirmed creates and edits update shared feeds, club lists and details before revalidation", async () => {
  const client = getQueryClient();
  const schoolKey = queryKeys.events.bySchool("uwaterloo");
  const otherKey = queryKeys.events.bySchool("ubc");
  const clubKey = queryKeys.events.byClub(9, "uwaterloo");
  client.setQueryData(schoolKey, feed([{ ...event(1), club_page: "https://example.com/club" }]));
  client.setQueryData(otherKey, feed([event(3, "ubc")]));
  client.setQueryData(clubKey, [event(1)]);
  globalThis.fetch = async () => Response.json(event(2));
  await createEventAPI(form);
  expect(client.getQueryData<PaginatedEventsResponse>(schoolKey)?.items.map(item => item.id)).toEqual([1, 2]);
  expect(client.getQueryData<PaginatedEventsResponse>(schoolKey)?.latest_added_event?.title).toBe("Event 2");
  const edited = { ...event(1), title: "Confirmed edit" };
  globalThis.fetch = async () => Response.json(edited);
  await updateEventAPI(1, form);
  expect(client.getQueryData<PaginatedEventsResponse>(schoolKey)?.items.find(item => item.id === 1))
    .toMatchObject({ title: "Confirmed edit", club_page: "https://example.com/club" });
  expect(client.getQueryData<Event[]>(clubKey)?.find(item => item.id === 1)?.title).toBe("Confirmed edit");
  expect(client.getQueryData(queryKeys.events.detail(1))).toEqual(edited);
  expect(client.getQueryData<PaginatedEventsResponse>(otherKey)?.items).toEqual([event(3, "ubc")]);
});

test("deletion cancels an old read and removes the event from every cached surface", async () => {
  const client = getQueryClient();
  const first = event(1);
  const removed = event(2);
  const schoolKey = queryKeys.events.bySchool("uwaterloo");
  const clubKey = queryKeys.events.byClub(9, "uwaterloo");
  const adminKey = queryKeys.admin.list("events", {});
  const goingKey = queryKeys.goingEvents.byUser("user");
  client.setQueryData(schoolKey, feed([first, removed]));
  client.setQueryData(clubKey, [first, removed]);
  client.setQueryData(adminKey, feed([first, removed]));
  client.setQueryData(goingKey, [{ event_id: 2, occurrence_ids: ["occurrence"] }]);
  client.setQueryData(queryKeys.events.detail(2), removed);
  let resolveRead!: (value: PaginatedEventsResponse) => void;
  const oldRead = client.fetchQuery({ ...eventFeedQueryOptions("uwaterloo"), staleTime: 0,
    queryFn: () => new Promise<PaginatedEventsResponse>(resolve => { resolveRead = resolve; }),
  }).catch(() => undefined);
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await deleteEventAPI(2);
  resolveRead(feed([first, removed]));
  await oldRead;
  expect(client.getQueryData<PaginatedEventsResponse>(schoolKey)).toMatchObject({ items: [first], total: 1, latest_added_event: null });
  expect(client.getQueryData(clubKey)).toEqual([first]);
  expect(client.getQueryData<PaginatedEventsResponse>(adminKey)?.total).toBe(1);
  expect(client.getQueryData(goingKey)).toEqual([]);
  expect(client.getQueryData(queryKeys.events.detail(2))).toBeUndefined();
});

test("failed writes preserve the snapshot and a repeated delete is safe", async () => {
  const client = getQueryClient();
  const snapshot = feed([event(1)]);
  const key = queryKeys.events.bySchool("uwaterloo");
  client.setQueryData(key, snapshot);
  globalThis.fetch = async () => Response.json({ detail: "Request failed with status 503" }, { status: 503 });
  await expect(updateEventAPI(1, form)).rejects.toThrow("503");
  expect(client.getQueryData(key)).toEqual(snapshot);
  globalThis.fetch = async () => Response.json({ detail: "Not found" }, { status: 404 });
  await deleteEventAPI(1);
  expect(client.getQueryData<PaginatedEventsResponse>(key)?.items).toEqual([]);
});


test("reassigning an event moves school and club membership without leaking old social links or overwriting freshness", async () => {
  const client = getQueryClient();
  const original = { ...event(1), club_page: "https://old.example.com", club_ig: "old-club", club_discord: "old-discord" };
  const moved = { ...event(1, "ubc"), club_id: 12, club: "New Club" };
  const historicalLatest = { title: "Recently imported past event", added_at: "2026-09-30T12:00:00Z" };
  const originalSchool = { ...feed([original]), latest_added_event: historicalLatest };
  const unrelated = { ...feed([event(3, "utoronto")]), latest_added_event: historicalLatest };
  client.setQueryData(queryKeys.events.bySchool("uwaterloo"), originalSchool);
  client.setQueryData(queryKeys.events.bySchool("ubc"), feed([]));
  client.setQueryData(queryKeys.events.bySchool("utoronto"), unrelated);
  client.setQueryData(queryKeys.events.byClub(9, "uwaterloo"), [original]);
  client.setQueryData(queryKeys.events.byClub(12, "ubc"), []);
  globalThis.fetch = async () => Response.json(moved);
  await updateEventAPI(1, form);
  expect(client.getQueryData<PaginatedEventsResponse>(queryKeys.events.bySchool("uwaterloo")))
    .toMatchObject({ items: [], latest_added_event: historicalLatest });
  expect(client.getQueryData<PaginatedEventsResponse>(queryKeys.events.bySchool("ubc"))?.items).toEqual([moved]);
  expect(client.getQueryData(queryKeys.events.byClub(9, "uwaterloo"))).toEqual([]);
  expect(client.getQueryData(queryKeys.events.byClub(12, "ubc"))).toEqual([moved]);
  expect(client.getQueryData(queryKeys.events.bySchool("utoronto"))).toEqual(unrelated);
});

test("club ordering is stable after server hydration and out-of-order mutation responses", async () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  Date.now = () => now;
  const dated = (id: number, day: string): Event => ({ ...event(id), occurrences: [{ id: String(id), event_id: id,
    dtstart_utc: `${day}T12:00:00Z`, dtend_utc: `${day}T13:00:00Z`, source: "manual",
  }] } as Event);
  const oldest = dated(1, "2026-09-01");
  const recent = dated(2, "2026-09-02");
  const soonest = dated(3, "2026-10-01");
  const later = dated(4, "2026-10-02");
  const expected = [soonest, later, recent, oldest];
  expect(orderClubEvents([later, oldest, soonest, recent], now)).toEqual(expected);
  expect(orderClubEvents(expected, now)).toEqual(expected);
  const client = getQueryClient();
  const key = queryKeys.events.byClub(9, "uwaterloo");
  client.setQueryData(key, [later, recent, oldest]);
  globalThis.fetch = async (_input, options) => Response.json(options?.method === "POST" ? soonest : feed(expected));
  await createEventAPI(form);
  expect(client.getQueryData(key)).toEqual(expected);
});


test("direct submission merges its confirmed event into an older complete canonical generation", async () => {
  const client = getQueryClient();
  Date.now = () => 2000;
  const created = event(2);
  const complete = feed([event(1), created]);
  const oldCanonical = { ...feed([event(1)]), generated_at: 1000 };
  let resolveRead!: (response: Response) => void;
  let readCount = 0;
  globalThis.fetch = async (_input, options) => {
    if (options?.method === "POST") return Response.json(created);
    readCount += 1;
    return new Promise<Response>(resolve => { resolveRead = resolve; });
  };
  expect(await createEventAPI(form)).toEqual(created);
  expect(readCount).toBe(1);
  const key = queryKeys.events.bySchool("uwaterloo");
  expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
  const returning = new QueryObserver(client, {
    ...eventFeedQueryOptions("uwaterloo"), initialData: feed([event(1)]),
  });
  const unsubscribe = returning.subscribe(() => {});
  expect(returning.getCurrentResult().isFetching).toBe(true);
  expect(readCount).toBe(1);
  resolveRead(Response.json(oldCanonical));
  await expect.poll(() => returning.getCurrentResult().data).toEqual({
    ...complete, generated_at: 1000, confirmed_at: 2000,
  });
  expect(readCount).toBe(1);
  globalThis.fetch = async () => Response.json(oldCanonical);
  await returning.refetch();
  expect(returning.getCurrentResult().data?.items).toEqual(complete.items);
  const rebuilt = { ...complete, generated_at: 3000 };
  globalThis.fetch = async () => Response.json(rebuilt);
  await returning.refetch();
  expect(returning.getCurrentResult().data).toEqual(rebuilt);
  unsubscribe();
  returning.destroy();
});

test("canonical generations cannot roll back confirmed edits or resurrect confirmed deletions", async () => {
  const client = getQueryClient();
  const key = queryKeys.events.bySchool("uwaterloo");
  const snapshot = { ...feed([event(1), event(2)]), generated_at: 1000 };
  Date.now = () => 2000;
  const observer = new QueryObserver(client, {
    ...eventFeedQueryOptions("uwaterloo"), initialData: snapshot, initialDataUpdatedAt: snapshot.generated_at,
  });
  globalThis.fetch = async () => Response.json({ ...event(1), title: "Confirmed edit" });
  await updateEventAPI(1, form);
  Date.now = () => 2100;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  await deleteEventAPI(2);
  globalThis.fetch = async () => Response.json({ ...snapshot, generated_at: 1500 });
  await observer.refetch();
  expect(client.getQueryData<PaginatedEventsResponse>(key)).toMatchObject({
    items: [{ id: 1, title: "Confirmed edit" }], confirmed_at: 2100,
  });
  const rebuilt = { ...feed([{ ...event(1), title: "Confirmed edit" }, event(3)]), generated_at: 2200 };
  globalThis.fetch = async () => Response.json(rebuilt);
  await observer.refetch();
  expect(client.getQueryData(key)).toEqual(rebuilt);
  observer.destroy();
});

test("concurrent direct confirmations share one complete read and preserve both new events", async () => {
  const client = getQueryClient();
  const key = queryKeys.events.bySchool("uwaterloo");
  Date.now = () => 2000;
  let nextId = 2;
  let reads = 0;
  let resolveRead!: (response: Response) => void;
  globalThis.fetch = async (_input, options) => {
    if (options?.method === "POST") return Response.json(event(nextId++));
    reads += 1;
    return new Promise<Response>(resolve => { resolveRead = resolve; });
  };
  await createEventAPI(form);
  await createEventAPI(form);
  expect(reads).toBe(1);
  resolveRead(Response.json({ ...feed([event(1)]), generated_at: 1000 }));
  await expect.poll(() => client.getQueryData<PaginatedEventsResponse>(key)?.items.map(item => item.id)).toEqual([1, 2, 3]);
  expect(client.getQueryData<PaginatedEventsResponse>(key)?.confirmed_at).toBe(2000);
});

test("a direct create followed by deletion cannot reappear when its pending complete read finishes", async () => {
  const client = getQueryClient();
  const key = queryKeys.events.bySchool("uwaterloo");
  Date.now = () => 2000;
  let reads = 0;
  let resolveRead!: (response: Response) => void;
  globalThis.fetch = async (_input, options) => {
    if (options?.method === "POST") return Response.json(event(2));
    if (options?.method === "DELETE") return new Response(null, { status: 204 });
    reads += 1;
    return new Promise<Response>(resolve => { resolveRead = resolve; });
  };
  await createEventAPI(form);
  Date.now = () => 2100;
  await deleteEventAPI(2);
  expect(reads).toBe(1);
  resolveRead(Response.json({ ...feed([event(1), event(2)]), generated_at: 1000 }));
  await expect.poll(() => client.getQueryData<PaginatedEventsResponse>(key)?.items.map(item => item.id)).toEqual([1]);
  expect(client.getQueryData<PaginatedEventsResponse>(key)?.confirmed_at).toBe(2100);
});

test("old hydrated snapshots retain their actual age instead of becoming fresh on mount", () => {
  Date.now = () => 1_000_000;
  const snapshot = { ...feed([event(1)]), generated_at: 1000 };
  const client = getQueryClient();
  const observer = new QueryObserver(client, {
    ...eventFeedQueryOptions("uwaterloo"), initialData: snapshot, initialDataUpdatedAt: snapshot.generated_at,
  });
  expect(client.getQueryState(queryKeys.events.bySchool("uwaterloo"))?.dataUpdatedAt).toBe(1000);
  expect(observer.getCurrentResult().isStale).toBe(true);
  observer.destroy();
});

test("Positions and Clubs browser consumers reuse complete public snapshots without auth requests", async () => {
  const { getPositionDirectory }: typeof import("../src/features/positions/api/positions.api") = require("../src/features/positions/api/positions.api");
  const { clubDirectoryQueryOptions }: typeof import("../src/features/clubs/api/clubs.api") = require("../src/features/clubs/api/clubs.api");
  const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), credentials: init?.credentials });
    return Response.json({ items: [{ id: 1, club_name: "Western Club" }], total: 1, page: 1, page_size: 1, total_pages: 1, generated_at: 1000 });
  };
  const positions = await getPositionDirectory(" UWO ");
  const client = getQueryClient();
  const directory = await client.fetchQuery(clubDirectoryQueryOptions(" UWO "));
  const form = new QueryObserver(client, {
    ...clubDirectoryQueryOptions("uwo"), select: (snapshot) => snapshot.items,
  });
  expect(requests).toEqual([
    { url: "/api/discovery?school=uwo&resource=positions", credentials: "omit" },
    { url: "/api/discovery?school=uwo&resource=clubs", credentials: "omit" },
  ]);
  expect(positions.generated_at).toBe(1000);
  expect(form.getCurrentResult().data).toEqual(directory.items);
  expect(client.getQueryData(queryKeys.clubs.allForSchool("uwo"))).toEqual(directory);
  form.destroy();
});
