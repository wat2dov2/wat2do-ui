import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { filterClubs, normalizeClub } from "../src/features/clubs/api/clubService";
import type { ApiClubResponse } from "../src/shared/generated";

const { getClubDirectorySnapshot }: typeof import("../src/features/clubs/api/clubDirectory.server") =
  createRequire(import.meta.url)("../src/features/clubs/api/clubDirectory.server");
const clubs = [
  { id: 1, club_name: "Tech Club", categories: ["Technology"], event_count: 2 },
  { id: 2, club_name: "Board Games", categories: ["Social"], event_count: 1 },
  { id: 3, club_name: "Tech Society", categories: ["Technology", "Social"], event_count: 0 },
].map(club => normalizeClub({ ...club, club_type: "independent", school: "uwaterloo" } as ApiClubResponse));
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("loads every campus page before publishing the cached directory", async () => {
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requests.push(url);
    const page = Number(url.searchParams.get("page"));
    return Response.json({ items: [clubs[page - 1]], total: 3, page, page_size: 1, total_pages: 3 });
  };
  const directory = await getClubDirectorySnapshot("uwaterloo");
  expect(directory.items).toEqual(clubs);
  expect(directory.total).toBe(3);
  expect(directory.total_pages).toBe(1);
  expect(requests.map(url => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  expect(requests.every(url => url.searchParams.get("school") === "uwaterloo")).toBe(true);
});

test("rejects a failed later page rather than caching a partial directory", async () => {
  globalThis.fetch = async input => new URL(String(input)).searchParams.get("page") === "1"
    ? Response.json({ items: [clubs[0]], total: 2, page: 1, page_size: 1, total_pages: 2 })
    : new Response(null, { status: 503 });
  await expect(getClubDirectorySnapshot("uwaterloo")).rejects.toThrow("503");
});

test("combines cached search, OR categories, minimum count and membership without mutation", () => {
  const filters = { search: " TECH ", categories: ["Social", "Technology"], minEvents: 1 };
  expect(filterClubs(clubs, filters).map(club => club.id)).toEqual([1]);
  expect(filterClubs(clubs, { ...filters, ids: [] })).toEqual([]);
  expect(filterClubs(clubs, { ...filters, minEvents: 0, ids: [3] }).map(club => club.id)).toEqual([3]);
  expect(filterClubs(clubs, { search: "", categories: [], minEvents: 0 })).toEqual(clubs);
  expect(clubs.map(club => club.id)).toEqual([1, 2, 3]);
});
