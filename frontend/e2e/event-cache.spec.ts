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

test("school feed loads every page and preserves metadata without publishing partial failures", async () => {
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input), "http://localhost");
    urls.push(url);
    const page = Number(url.searchParams.get("page"));
    return Response.json({ ...feed([event(page)]), page, total: 2, total_pages: 2 });
  };
  const client = getQueryClient();
  const result = await client.fetchQuery(eventFeedQueryOptions("uwaterloo"));
  expect(result.items.map(item => item.id)).toEqual([1, 2]);
  expect(result.latest_added_event?.title).toBe("Event 1");
  expect(result.total_pages).toBe(1);
  expect(urls.map(url => url.searchParams.get("page"))).toEqual(["1", "2"]);
  expect(urls.every(url => url.searchParams.get("school") === "uwaterloo")).toBe(true);
  globalThis.fetch = async input => new URL(String(input), "http://localhost").searchParams.get("page") === "1"
    ? Response.json({ ...feed([event(1, "ubc")]), total_pages: 2 })
    : Response.json({ detail: "Request failed with status 503" }, { status: 503 });
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


test("direct submission returns promptly while its complete feed refresh supersedes an old route snapshot", async () => {
  const client = getQueryClient();
  const created = event(2);
  const complete = feed([event(1), created]);
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
  resolveRead(Response.json(complete));
  await expect.poll(() => returning.getCurrentResult().data).toEqual(complete);
  expect(readCount).toBe(1);
  unsubscribe();
  returning.destroy();
});
