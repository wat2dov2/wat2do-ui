import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getSchoolBrowseSnapshot }: typeof import("../src/features/events/api/eventFeed.server") =
  require("../src/features/events/api/eventFeed.server");
const { getPositionDirectorySnapshot }: typeof import("../src/features/positions/api/positionDirectory.server") =
  require("../src/features/positions/api/positionDirectory.server");
const { getClubDirectorySnapshot }: typeof import("../src/features/clubs/api/clubDirectory.server") =
  require("../src/features/clubs/api/clubDirectory.server");
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

for (const { name, load, tag } of [
  { name: "Events", load: getSchoolBrowseSnapshot, tag: "event-feed" },
  { name: "Positions", load: getPositionDirectorySnapshot, tag: "position-directory" },
  { name: "Clubs", load: getClubDirectorySnapshot, tag: "club-directory" },
]) {
  test(`${name} loads all pages under the same campus cache tag without dropping metadata`, async () => {
    const requests: Array<{ url: URL; tags: string[] | undefined }> = [];
    const latest = { title: "Latest item", added_at: "2026-09-01T12:00:00Z" };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, tags: init?.next?.tags });
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        items: [{ id: page, title: `Item ${page}`, club_name: `Club ${page}` }],
        total: 2, page, page_size: 1, total_pages: 2,
        latest_added_event: latest, latest_added_position: latest,
      });
    };
    const snapshot = await load("mcmaster");
    expect(snapshot.items.map(item => item.id)).toEqual([1, 2]);
    expect(snapshot).toMatchObject({ total: 2, total_pages: 1, latest_added_event: latest, latest_added_position: latest });
    expect(requests.map(request => request.url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(requests.every(request => request.url.searchParams.get("school") === "mcmaster")).toBe(true);
    expect(requests.every(request => request.tags?.includes(`${tag}-mcmaster`))).toBe(true);
  });

  test(`${name} does not expose a partial directory when a later page fails`, async () => {
    globalThis.fetch = async input => new URL(String(input)).searchParams.get("page") === "1"
      ? Response.json({ items: [], total: 2, page: 1, page_size: 1, total_pages: 2 })
      : new Response(null, { status: 503 });
    await expect(load("mcmaster")).rejects.toThrow("503");
  });
}
