import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cache = require("next/cache");
const server = require("next/server");
const invalidations: Array<{ tag: string; profile: unknown }> = [];
const callbacks: Array<() => Promise<void>> = [];
const cacheModule = require.cache[require.resolve("next/cache")]!;
const serverModule = require.cache[require.resolve("next/server")]!;
cacheModule.exports = { ...cache, revalidateTag: (tag: string, profile: unknown) => invalidations.push({ tag, profile }) };
serverModule.exports = { ...server, after: (callback: () => Promise<void>) => callbacks.push(callback) };
const { POST }: typeof import("../src/app/api/revalidate-events/route") = require("../src/app/api/revalidate-events/route");
cacheModule.exports = cache;
serverModule.exports = server;
const originalFetch = globalThis.fetch;
const originalSecret = process.env.EVENT_FEED_REVALIDATION_SECRET;

test.beforeEach(() => {
  invalidations.length = 0;
  callbacks.length = 0;
  process.env.EVENT_FEED_REVALIDATION_SECRET = "test-revalidation-secret";
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.EVENT_FEED_REVALIDATION_SECRET;
  else process.env.EVENT_FEED_REVALIDATION_SECRET = originalSecret;
});

function request(secret = "test-revalidation-secret") {
  return new server.NextRequest("http://localhost/api/revalidate-events", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ school: "uwaterloo", event_id: 7 }),
  });
}

test("invalidates and warms every directory independently while preserving stale snapshots", async () => {
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname === "/events/") return new Response(null, { status: 503 });
    if (url.pathname === "/schools") return Response.json([]);
    if (url.pathname.startsWith("/schools/")) return Response.json({ slug: "uwaterloo" });
    return Response.json({ items: [], total: 0, page: 1, page_size: 100, total_pages: 1 });
  };
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(invalidations).toEqual([
    { tag: "event-detail-7", profile: { expire: 0 } },
    { tag: "event-feed-uwaterloo", profile: "max" },
    { tag: "position-directory-uwaterloo", profile: "max" },
    { tag: "club-directory-uwaterloo", profile: "max" },
    { tag: "school-branding-uwaterloo", profile: "max" },
    { tag: "school-directory", profile: "max" },
  ]);
  expect(callbacks).toHaveLength(5);
  const results = await Promise.allSettled(callbacks.map(callback => callback()));
  expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
  expect(urls.map(url => url.pathname).sort()).toEqual(["/clubs/", "/events/", "/positions/", "/schools", "/schools/uwaterloo"].sort());
});

test("unauthorized invalidation never touches or warms the cache", async () => {
  const response = await POST(request("wrong-secret"));
  expect(response.status).toBe(401);
  expect(invalidations).toEqual([]);
  expect(callbacks).toEqual([]);
});
