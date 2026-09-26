import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("next/server");
const callbacks: Array<() => Promise<void>> = [];
const queued: Array<{ school: string; resources: string[] }> = [];
let failQueue = false;
const serverModule = require.cache[require.resolve("next/server")]!;
serverModule.exports = {
  ...server,
  after: (callback: () => Promise<void>) => callbacks.push(callback),
};
require("../src/app/discoveryRefresh.server");
const refreshModule =
  require.cache[require.resolve("../src/app/discoveryRefresh.server")]!;
const refresh = refreshModule.exports;
refreshModule.exports = {
  ...refresh,
  queueDiscoveryRefresh: async (school: string, resources: string[]) => {
    if (failQueue) throw new Error("storage unavailable");
    queued.push({ school, resources });
  },
  reconcileDiscoverySnapshots: async () => {},
};
require("../src/shared/api/schools.server");
const schoolsModule =
  require.cache[require.resolve("../src/shared/api/schools.server")]!;
const schools = schoolsModule.exports;
schoolsModule.exports = {
  ...schools,
  getSchoolDirectory: async () => [{ slug: "uwo" }],
};
const {
  POST,
}: typeof import("../src/app/api/revalidate-events/route") = require("../src/app/api/revalidate-events/route");
serverModule.exports = server;
refreshModule.exports = refresh;
schoolsModule.exports = schools;
const originalSecret = process.env.EVENT_FEED_REVALIDATION_SECRET;

test.beforeEach(() => {
  callbacks.length = queued.length = 0;
  failQueue = false;
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

test("acknowledges durable scoped work without claiming a completed warm", async () => {
  const response = await POST(request(eventRequest));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    accepted: true,
    school: "uwo",
    resources: ["events", "clubs"],
  });
  expect(queued).toEqual([{ school: "uwo", resources: ["events", "clubs"] }]);
  expect(callbacks).toHaveLength(1);
});

test("failed durable writes are errors, not successful warming responses", async () => {
  failQueue = true;
  expect((await POST(request(eventRequest))).status).toBe(503);
  expect(callbacks).toEqual([]);
});

test("invalid and unauthorized requests never schedule work", async () => {
  expect((await POST(request(eventRequest, "wrong"))).status).toBe(401);
  for (const body of [
    { ...eventRequest, school: "western" },
    { ...eventRequest, resources: ["invalid"] },
    { ...eventRequest, event_ids: [0] },
  ]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(queued).toEqual([]);
  expect(callbacks).toEqual([]);
});
