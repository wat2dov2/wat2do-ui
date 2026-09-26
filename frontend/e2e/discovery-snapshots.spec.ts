import { expect, test } from "@playwright/test";
import { getEventListeners } from "node:events";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import discoveryControls from "../../backend/controlbox/discovery_cache.json" with { type: "json" };
import {
  DiscoverySnapshotStore,
  type SnapshotStorage,
} from "../src/shared/services/discoverySnapshotStore";

class MemoryStorage implements SnapshotStorage {
  objects = new Map<string, { value: string; etag: string }>();
  version = 0;
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async put(key: string, value: string, etag?: string) {
    if (this.objects.get(key)?.etag !== etag) return false;
    this.objects.set(key, { value, etag: String(++this.version) });
    return true;
  }
}

test("Western snapshots survive worker replacement and stay school-scoped", async () => {
  const storage = new MemoryStorage();
  const first = new DiscoverySnapshotStore(storage);
  expect(
    await first.refresh("uwo", "events", async () => ({
      items: [{ id: 1, school: "uwo" }],
    })),
  ).toBe(true);
  const replacement = new DiscoverySnapshotStore(storage);
  expect(
    (await replacement.read<{ items: unknown[] }>("uwo", "events"))?.data.items,
  ).toHaveLength(1);
  expect(await replacement.read("uwaterloo", "events")).toBeNull();
  expect((await replacement.inspect("uwo", "events")).ready).toBe(true);
});

test("failed refresh preserves last-good data and durable dirty work", async () => {
  const store = new DiscoverySnapshotStore(new MemoryStorage());
  await store.refresh("uwo", "events", async () => [1]);
  await store.invalidate("uwo", "events");
  expect(
    await store.refresh("uwo", "events", async () => {
      throw new Error("upstream unavailable");
    }),
  ).toBe(false);
  expect((await store.read("uwo", "events"))?.data).toEqual([1]);
  const state = await store.inspect("uwo", "events");
  expect(state).toMatchObject({
    ready: true,
    dirty: true,
    refreshing: false,
    lastError: "upstream unavailable",
  });
});

test("concurrent workers share one lease", async () => {
  const storage = new MemoryStorage();
  const first = new DiscoverySnapshotStore(storage);
  const second = new DiscoverySnapshotStore(storage);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const build = first.refresh("uwo", "events", async () => {
    started();
    await pending;
    return [1];
  });
  await entered;
  expect(await second.refresh("uwo", "events", async () => [2])).toBe(false);
  release();
  expect(await build).toBe(true);
});

test("writes during generation keep last-good data and require a new build", async () => {
  const store = new DiscoverySnapshotStore(new MemoryStorage());
  await store.refresh("uwo", "events", async () => [1]);
  await store.invalidate("uwo", "events");
  expect(
    await store.refresh("uwo", "events", async () => {
      await store.invalidate("uwo", "events");
      return [2];
    }),
  ).toBe(false);
  expect((await store.read("uwo", "events"))?.data).toEqual([1]);
  expect((await store.inspect("uwo", "events")).dirty).toBe(true);
  await store.refresh("uwo", "events", async () => [3]);
  expect((await store.read("uwo", "events"))?.data).toEqual([3]);
});

test("failed and abandoned leases can be recovered after their deadline", async () => {
  let now = 1000;
  const storage = new MemoryStorage();
  const store = new DiscoverySnapshotStore(storage, () => now);
  await store.refresh("uwo", "events", async () => {
    throw new Error("connection reset");
  });
  expect(await store.refresh("uwo", "events", async () => [])).toBe(false);
  now += 200_000;
  expect(
    await new DiscoverySnapshotStore(storage, () => now).refresh(
      "uwo",
      "events",
      async () => [],
    ),
  ).toBe(true);
  expect((await store.inspect("uwo", "events")).ready).toBe(true);
});

test("event invalidation leaves positions and other schools intact", async () => {
  const store = new DiscoverySnapshotStore(new MemoryStorage());
  for (const school of ["uwo", "uwaterloo"])
    for (const resource of ["events", "positions"] as const)
      await store.refresh(school, resource, async () => []);
  await store.invalidate("uwo", "events");
  expect((await store.inspect("uwo", "events")).dirty).toBe(true);
  expect((await store.inspect("uwo", "positions")).dirty).toBe(false);
  expect((await store.inspect("uwaterloo", "events")).dirty).toBe(false);
});

test("concurrent invalidations are retained instead of losing refresh requests", async () => {
  const storage = new MemoryStorage();
  const stores = [
    new DiscoverySnapshotStore(storage),
    new DiscoverySnapshotStore(storage),
  ];
  await stores[0].refresh("uwo", "events", async () => []);
  await Promise.all(stores.map((store) => store.invalidate("uwo", "events")));
  expect((await stores[0].inspect("uwo", "events")).dirty).toBe(true);
});

test("an expired worker cannot overwrite a replacement worker's generation", async () => {
  let now = 1000;
  const storage = new MemoryStorage();
  const old = new DiscoverySnapshotStore(storage, () => now);
  const replacement = new DiscoverySnapshotStore(storage, () => now);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldBuild = old.refresh("uwo", "events", async () => {
    started();
    await pending;
    return [1];
  });
  await entered;
  now += 200_000;
  expect(await replacement.refresh("uwo", "events", async () => [2])).toBe(
    true,
  );
  release();
  expect(await oldBuild).toBe(false);
  expect((await replacement.read("uwo", "events"))?.data).toEqual([2]);
});

test("failed payload upload never changes the published pointer", async () => {
  const storage = new MemoryStorage();
  const store = new DiscoverySnapshotStore(storage);
  await store.refresh("uwo", "events", async () => [1]);
  await store.invalidate("uwo", "events");
  const put = storage.put.bind(storage);
  storage.put = async (key, value, etag) => {
    if (key.includes("/generations/")) throw new Error("upload interrupted");
    return put(key, value, etag);
  };
  expect(await store.refresh("uwo", "events", async () => [2])).toBe(false);
  expect((await store.read("uwo", "events"))?.data).toEqual([1]);
  expect((await store.inspect("uwo", "events")).dirty).toBe(true);
});

test("refresh expiry preserves valid last-good data but readiness rejects over-age data", async () => {
  let now = 1000;
  const store = new DiscoverySnapshotStore(new MemoryStorage(), () => now);
  await store.refresh("uwo", "events", async () => []);
  now += 600_000;
  expect((await store.read("uwo", "events"))?.data).toEqual([]);
  expect((await store.inspect("uwo", "events")).ready).toBe(true);
  now += 86_400_000;
  expect(await store.read("uwo", "events")).toBeNull();
  expect((await store.inspect("uwo", "events")).ready).toBe(false);
});

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  S3SnapshotStorage,
}: typeof import("../src/shared/services/discoveryCache.server") = require("../src/shared/services/discoveryCache.server");
const {
  getSchoolBrowseSnapshot,
}: typeof import("../src/features/events/api/eventFeed.server") = require("../src/features/events/api/eventFeed.server");
const {
  getPositionDirectorySnapshot,
}: typeof import("../src/features/positions/api/positionDirectory.server") = require("../src/features/positions/api/positionDirectory.server");
const {
  getClubDirectorySnapshot,
}: typeof import("../src/features/clubs/api/clubDirectory.server") = require("../src/features/clubs/api/clubDirectory.server");
const originalFetch = globalThis.fetch;
const originalAbortTimeout = AbortSignal.timeout;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalAbortTimeout;
});

function storageWithHandler(
  handle: S3Client["config"]["requestHandler"]["handle"],
) {
  return new S3SnapshotStorage(
    "discovery-test",
    new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      maxAttempts: 1,
      requestHandler: { handle },
    }),
  );
}

function storageDeadline() {
  const deadline = new AbortController();
  AbortSignal.timeout = (milliseconds) => {
    expect(milliseconds).toBe(discoveryControls.request_timeout_seconds * 1000);
    return deadline.signal;
  };
  return deadline;
}

for (const operation of ["get", "put"] as const) {
  test(`S3 ${operation} aborts a stalled request before response headers`, async () => {
    const deadline = storageDeadline();
    const timeout = new DOMException(
      "Storage deadline exceeded",
      "TimeoutError",
    );
    const storage = storageWithHandler(async (_request, options) => {
      expect(options?.abortSignal).toBe(deadline.signal);
      return new Promise((_resolve, reject) => {
        deadline.signal.addEventListener(
          "abort",
          () => reject(deadline.signal.reason),
          { once: true },
        );
        queueMicrotask(() => deadline.abort(timeout));
      });
    });
    const result =
      operation === "get"
        ? storage.get("state.json")
        : storage.put("state.json", "{}");
    await expect(result).rejects.toThrow("Storage deadline exceeded");
  });
}

test("S3 deadline destroys a stalled body after headers and allows the next read", async () => {
  const deadline = storageDeadline();
  const timeout = new DOMException(
    "Storage body deadline exceeded",
    "TimeoutError",
  );
  const stalledBody = new Readable({
    read() {
      queueMicrotask(() => deadline.abort(timeout));
    },
  });
  let reads = 0;
  const storage = storageWithHandler(async () => ({
    response: {
      statusCode: 200,
      headers: { etag: '"published"' },
      body: ++reads === 1 ? stalledBody : Readable.from(['{"items":[]}']),
    },
  }));
  await expect(storage.get("state.json")).rejects.toThrow(
    "Storage body deadline exceeded",
  );
  expect(stalledBody.destroyed).toBe(true);
  expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0);
  const nextDeadline = storageDeadline();
  expect(await storage.get("state.json")).toEqual({
    value: '{"items":[]}',
    etag: '"published"',
  });
  expect(getEventListeners(nextDeadline.signal, "abort")).toHaveLength(0);
});

test("S3 rejects an expired deadline before consuming a returned body", async () => {
  const deadline = storageDeadline();
  const body = Readable.from(["late data"]);
  const storage = storageWithHandler(async () => {
    deadline.abort(
      new DOMException("Storage deadline exceeded", "TimeoutError"),
    );
    return { response: { statusCode: 200, headers: { etag: '"late"' }, body } };
  });
  await expect(storage.get("state.json")).rejects.toThrow(
    "Storage deadline exceeded",
  );
  expect(body.destroyed).toBe(true);
  expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0);
});

for (const { name, load } of [
  { name: "Events", load: getSchoolBrowseSnapshot },
  { name: "Positions", load: getPositionDirectorySnapshot },
  { name: "Clubs", load: getClubDirectorySnapshot },
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
  const {
    getSchool,
  }: typeof import("../src/shared/api/schools.server") = require("../src/shared/api/schools.server");
  globalThis.fetch = async () => new Response(null, { status: 404 });
  expect(await getSchool("uwo")).toBeNull();
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

// Exercise the real all-school worker and readiness gate with shared storage and
// source HTTP fixtures. No Next server, browser or production service is started.
const cacheModule =
  require.cache[
    require.resolve("../src/shared/services/discoveryCache.server")
  ]!;
require("../src/shared/api/schools.server");
const schoolModule =
  require.cache[require.resolve("../src/shared/api/schools.server")]!;
const originalCacheModule = cacheModule.exports;
const originalSchoolModule = schoolModule.exports;
let workerNow = Date.now();
const workerStorage = new MemoryStorage();
const workerStore = new DiscoverySnapshotStore(workerStorage, () => workerNow);
cacheModule.exports = { ...originalCacheModule, discoveryStore: workerStore };
schoolModule.exports = {
  ...originalSchoolModule,
  getSchoolDirectory: async () => [{ slug: "uwo" }, { slug: "uwaterloo" }],
};
const workerModulePath = require.resolve("../src/app/discoveryRefresh.server");
const originalWorkerModule = require.cache[workerModulePath];
delete require.cache[workerModulePath];
const worker: typeof import("../src/app/discoveryRefresh.server") = require(workerModulePath);
if (originalWorkerModule) require.cache[workerModulePath] = originalWorkerModule;
else delete require.cache[workerModulePath];
cacheModule.exports = originalCacheModule;
schoolModule.exports = originalSchoolModule;

test("readiness covers every school, waits for a failed dataset, and retains coverage during refresh failure", async () => {
  workerStorage.objects.clear();
  let failWesternEvents = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/schools")
      return Response.json([{ slug: "uwo" }, { slug: "uwaterloo" }]);
    if (url.pathname.startsWith("/schools/"))
      return Response.json({ slug: url.pathname.split("/").pop() });
    if (
      url.pathname === "/events/" &&
      url.searchParams.get("school") === "uwo" &&
      failWesternEvents
    )
      return new Response(null, { status: 503 });
    return Response.json({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      total_pages: 0,
    });
  };
  expect((await worker.discoveryReadiness()).ready).toBe(false);
  await worker.reconcileDiscoverySnapshots();
  expect(await worker.discoveryReadiness()).toEqual({
    ready: false,
    schools: 2,
    missing: ["uwo/events"],
  });
  failWesternEvents = false;
  workerNow += 60_000;
  await worker.reconcileDiscoverySnapshots();
  expect(await worker.discoveryReadiness()).toEqual({
    ready: true,
    schools: 2,
    missing: [],
  });
  failWesternEvents = true;
  await worker.queueDiscoveryRefresh("uwo", ["events"]);
  await worker.reconcileDiscoverySnapshots();
  expect(await worker.discoveryReadiness()).toEqual({
    ready: true,
    schools: 2,
    missing: [],
  });
});

test("persisted usable snapshots admit a replacement task before stalled upstream refreshes finish", async () => {
  workerStorage.objects.clear();
  await workerStore.refresh("_global", "schools", async () => [{ slug: "uwo" }, { slug: "uwaterloo" }]);
  for (const school of ["uwo", "uwaterloo"]) {
    for (const resource of worker.discoveryResources) await workerStore.refresh(school, resource, async () => ({ items: [] }));
  }
  workerNow += 600_000;
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async input => {
    started();
    await pending;
    const url = new URL(String(input));
    if (url.pathname === "/schools") return Response.json([{ slug: "uwo" }, { slug: "uwaterloo" }]);
    if (url.pathname.startsWith("/schools/")) return Response.json({ slug: url.pathname.split("/").pop() });
    return Response.json({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
  };
  try {
    // This resolves before the deferred source response. A reconciliation-first
    // startup would wait on pending and fail the regression's test deadline.
    await worker.initializeDiscoverySnapshots();
    await entered;
    expect((await worker.discoveryReadiness()).ready).toBe(true);
  } finally {
    release();
    await worker.reconcileDiscoverySnapshots();
    const processState = globalThis as typeof globalThis & { discoveryWorker?: { timer?: ReturnType<typeof setInterval> } };
    clearInterval(processState.discoveryWorker?.timer);
    if (processState.discoveryWorker) processState.discoveryWorker.timer = undefined;
  }
});
