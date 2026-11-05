import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import discoveryControls from "../../backend/controlbox/discovery_cache.json" with { type: "json" };

const require = createRequire(import.meta.url);
const server = require("next/server");
const nextCache = require("next/cache");
const revalidated: Array<{ tag: string; profile: unknown }> = [];
let directoryFails = false;
const nextCacheModule = require.cache[require.resolve("next/cache")]!;
nextCacheModule.exports = {
  ...nextCache,
  revalidateTag: (tag: string, profile: unknown) =>
    revalidated.push({ tag, profile }),
};
require("../src/shared/api/schools.server");
const schoolsModule =
  require.cache[require.resolve("../src/shared/api/schools.server")]!;
const schools = schoolsModule.exports;
schoolsModule.exports = {
  ...schools,
  getSchoolDirectory: async () => {
    if (directoryFails) throw new Error("directory unavailable");
    return [{ slug: "uwo" }];
  },
};
const {
  POST,
}: typeof import("../src/app/api/revalidate-events/route") = require("../src/app/api/revalidate-events/route");
nextCacheModule.exports = nextCache;
schoolsModule.exports = schools;
const originalSecret = process.env.EVENT_FEED_REVALIDATION_SECRET;
const tag = (scope: string, resource: string) =>
  `discovery:v${discoveryControls.schema_version}:${scope}:${resource}`;

test.beforeEach(() => {
  revalidated.length = 0;
  directoryFails = false;
  process.env.EVENT_FEED_REVALIDATION_SECRET = "test-revalidation-secret";
});
test.afterEach(() => {
  if (originalSecret === undefined)
    delete process.env.EVENT_FEED_REVALIDATION_SECRET;
  else process.env.EVENT_FEED_REVALIDATION_SECRET = originalSecret;
});
function request(body: unknown, secret = "test-revalidation-secret") {
  return new server.NextRequest("http://localhost/api/revalidate-events", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const eventRequest = { school: "uwo", resources: ["events", "clubs"] };

test("marks only the school's named snapshots stale, keeping them readable", async () => {
  const response = await POST(request(eventRequest));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    accepted: true,
    school: "uwo",
    resources: ["events", "clubs"],
  });
  expect(revalidated).toEqual([
    { tag: tag("uwo", "events"), profile: "max" },
    { tag: tag("uwo", "clubs"), profile: "max" },
  ]);
});

test("a banner refresh marks the one banner every school shares", async () => {
  const response = await POST(request({ school: "uwo", resources: ["site-banner"] }));
  expect(response.status).toBe(202);
  expect(revalidated).toEqual([
    { tag: tag("_global", "site-banner"), profile: "max" },
  ]);
});

test("an unreadable school directory is an error, not an acknowledgement", async () => {
  directoryFails = true;
  expect((await POST(request(eventRequest))).status).toBe(503);
  expect(revalidated).toEqual([]);
});

test("invalid and unauthorized requests never revalidate", async () => {
  expect((await POST(request(eventRequest, "wrong"))).status).toBe(401);
  for (const body of [
    { ...eventRequest, school: "western" },
    { ...eventRequest, resources: ["invalid"] },
    { ...eventRequest, event_ids: [0] },
  ]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(revalidated).toEqual([]);
});
