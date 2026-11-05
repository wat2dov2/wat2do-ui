import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import discoveryControls from "../../backend/controlbox/discovery_cache.json" with { type: "json" };

const require = createRequire(import.meta.url);

// Next's data cache only exists inside a running Next server, so the reader is
// loaded against a stand-in `unstable_cache` that records how it was called.
const nextCache = require("next/cache");
const nextCacheModule = require.cache[require.resolve("next/cache")]!;
const cacheCalls: Array<{
  keyParts: string[];
  options: { tags: string[]; revalidate: number };
}> = [];
nextCacheModule.exports = {
  ...nextCache,
  unstable_cache:
    <T>(
      run: () => Promise<T>,
      keyParts: string[],
      options: { tags: string[]; revalidate: number },
    ) =>
    () => {
      cacheCalls.push({ keyParts, options });
      return run();
    },
};
const cachePath = require.resolve("../src/shared/services/discoveryCache.server");
delete require.cache[cachePath];
const {
  discoveryTag,
  readDiscoverySnapshot,
}: typeof import("../src/shared/services/discoveryCache.server") = require(cachePath);
delete require.cache[cachePath];
nextCacheModule.exports = nextCache;

const {
  buildSchoolBrowseSnapshot,
}: typeof import("../src/features/events/api/eventFeed.server") = require("../src/features/events/api/eventFeed.server");
const {
  buildPositionDirectorySnapshot,
}: typeof import("../src/features/positions/api/positionDirectory.server") = require("../src/features/positions/api/positionDirectory.server");
const {
  buildClubDirectorySnapshot,
}: typeof import("../src/features/clubs/api/clubDirectory.server") = require("../src/features/clubs/api/clubDirectory.server");
const {
  buildSchoolSnapshot,
}: typeof import("../src/shared/api/schools.server") = require("../src/shared/api/schools.server");
const {
  buildSiteBannerSnapshot,
}: typeof import("../src/shared/api/siteBanner.server") = require("../src/shared/api/siteBanner.server");
const banner = {
  message_translation_key: "navigation.siteBannerMessage",
  cta_href: "/about",
  cta_label_translation_key: "navigation.siteBannerAction",
};
const originalFetch = globalThis.fetch;
// The Playwright runner sets PLAYWRIGHT_TEST, which turns the cache off for browser tests.
const originalPlaywrightTest = process.env.PLAYWRIGHT_TEST;
test.beforeEach(() => {
  cacheCalls.length = 0;
  delete process.env.PLAYWRIGHT_TEST;
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPlaywrightTest === undefined) delete process.env.PLAYWRIGHT_TEST;
  else process.env.PLAYWRIGHT_TEST = originalPlaywrightTest;
});

test("each school's resource is one tagged cache entry that ages out hourly", async () => {
  const before = Date.now();
  const snapshot = await readDiscoverySnapshot("uwo", "events", async () => ({
    items: [1],
  }));
  const tag = `discovery:v${discoveryControls.schema_version}:uwo:events`;
  expect(cacheCalls).toEqual([
    {
      keyParts: [tag],
      options: {
        tags: [tag],
        revalidate: discoveryControls.refresh_interval_seconds,
      },
    },
  ]);
  expect(snapshot.items).toEqual([1]);
  expect(snapshot.generated_at).toBeGreaterThanOrEqual(before);
  expect(snapshot.generated_at).toBeLessThanOrEqual(Date.now());
});

test("browser tests read their own fixtures on every request", async () => {
  process.env.PLAYWRIGHT_TEST = "1";
  let builds = 0;
  for (let read = 0; read < 2; read++)
    await readDiscoverySnapshot("uwo", "events", async () => ({ items: [++builds] }));
  expect(builds).toBe(2);
  expect(cacheCalls).toEqual([]);
});

test("the school directory and banner are shared by every school", () => {
  expect(discoveryTag("uwo", "site-banner")).toBe(
    discoveryTag("uwaterloo", "site-banner"),
  );
  expect(discoveryTag("uwo", "schools")).toBe(
    `discovery:v${discoveryControls.schema_version}:_global:schools`,
  );
  expect(discoveryTag("uwo", "clubs")).not.toBe(
    discoveryTag("uwaterloo", "clubs"),
  );
});

test("a missing school stays null and a failed build caches nothing", async () => {
  expect(
    await readDiscoverySnapshot("uwo", "branding", async () => null),
  ).toBeNull();
  await expect(
    readDiscoverySnapshot("uwo", "events", async () => {
      throw new Error("source unavailable");
    }),
  ).rejects.toThrow("source unavailable");
});

test("banner source distinguishes disabled content from failed refreshes", async () => {
  globalThis.fetch = async (_input, init) => {
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(null, { status: 204 });
  };
  expect(await buildSiteBannerSnapshot()).toBeNull();
  globalThis.fetch = async () => Response.json(banner);
  expect(await buildSiteBannerSnapshot()).toEqual(banner);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await expect(buildSiteBannerSnapshot()).rejects.toThrow("503");
  globalThis.fetch = async () => new Response("invalid json");
  await expect(buildSiteBannerSnapshot()).rejects.toThrow();
  globalThis.fetch = async () => {
    throw new Error("source unavailable");
  };
  await expect(buildSiteBannerSnapshot()).rejects.toThrow("source unavailable");
});

for (const { name, load } of [
  { name: "Events", load: buildSchoolBrowseSnapshot },
  { name: "Positions", load: buildPositionDirectorySnapshot },
  { name: "Clubs", load: buildClubDirectorySnapshot },
]) {
  test(`${name} loads all pages with school-scoped fresh reads without dropping metadata`, async () => {
    const requests: Array<{
      url: URL;
      cache: RequestCache | undefined;
      signal: AbortSignal | null | undefined;
    }> = [];
    const latest = { title: "Latest item", added_at: "2026-09-01T12:00:00Z" };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, cache: init?.cache, signal: init?.signal });
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        items: [{ id: page, title: `Item ${page}`, club_name: `Club ${page}` }],
        total: 2,
        page,
        page_size: 1,
        total_pages: 2,
        latest_added_event: latest,
        latest_added_position: latest,
      });
    };
    const snapshot = await load("mcmaster");
    expect(snapshot.items.map((item) => item.id)).toEqual([1, 2]);
    expect(snapshot).toMatchObject({
      total: 2,
      total_pages: 1,
      latest_added_event: latest,
      latest_added_position: latest,
    });
    expect(
      requests.map((request) => request.url.searchParams.get("page")),
    ).toEqual(["1", "2"]);
    expect(
      requests.every(
        (request) => request.url.searchParams.get("school") === "mcmaster",
      ),
    ).toBe(true);
    expect(
      requests.every(
        (request) =>
          request.cache === "no-store" && request.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });

  test(`${name} does not expose a partial directory when a later page fails`, async () => {
    globalThis.fetch = async (input) =>
      new URL(String(input)).searchParams.get("page") === "1"
        ? Response.json({
            items: [],
            total: 2,
            page: 1,
            page_size: 1,
            total_pages: 2,
          })
        : new Response(null, { status: 503 });
    await expect(load("mcmaster")).rejects.toThrow("503");
  });
}

test("unknown school lookup preserves null instead of inventing branding", async () => {
  globalThis.fetch = async () => new Response(null, { status: 404 });
  expect(await buildSchoolSnapshot("uwo")).toBeNull();
});

test("changing totals and overlapping pages cannot publish a partial catalog", async () => {
  const {
    collectPaginatedPages,
  }: typeof import("../src/shared/lib/pagination") = require("../src/shared/lib/pagination");
  await expect(
    collectPaginatedPages(async (page) => ({
      items: [{ id: page }],
      total: page + 1,
      page,
      page_size: 1,
      total_pages: 2,
    })),
  ).rejects.toThrow("changed during pagination");
  await expect(
    collectPaginatedPages(async (page) => ({
      items: [{ id: 1 }],
      total: 2,
      page,
      page_size: 1,
      total_pages: 2,
    })),
  ).rejects.toThrow("Incomplete discovery snapshot");
});
