import { expect, test } from "@playwright/test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import discoveryControls from "../../backend/controlbox/discovery_cache.json" with { type: "json" };
import {
  DiscoverySnapshotStore,
  type SnapshotStorage,
} from "../src/shared/services/discoverySnapshotStore";

class MemoryStorage implements SnapshotStorage {
  objects = new Map<
    string,
    { value: string; etag: string; writtenAt: number }
  >();
  version = 0;
  gets: string[] = [];
  constructor(private now = Date.now) {}
  async get(key: string) {
    this.gets.push(key);
    const object = this.objects.get(key);
    return object ? { value: object.value, etag: object.etag } : null;
  }
  async put(key: string, value: string, etag?: string) {
    if (this.objects.get(key)?.etag !== etag) return false;
    this.objects.set(key, {
      value,
      etag: String(++this.version),
      writtenAt: this.now(),
    });
    return true;
  }
  async deleteOlderThan(prefix: string, cutoff: number) {
    for (const [key, object] of this.objects)
      if (
        key.startsWith(`${prefix}/`) &&
        !key.slice(prefix.length + 1).includes("/") &&
        object.writtenAt < cutoff
      )
        this.objects.delete(key);
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

test("writes during generation keep last-good data and rebuild at once", async () => {
  const store = new DiscoverySnapshotStore(new MemoryStorage());
  await store.refresh("uwo", "events", async () => [1]);
  await store.invalidate("uwo", "events");
  let builds = 0;
  expect(
    await store.refresh("uwo", "events", async () => {
      builds += 1;
      if (builds === 1) await store.invalidate("uwo", "events");
      else expect((await store.read("uwo", "events"))?.data).toEqual([1]);
      return [builds + 1];
    }),
  ).toBe(true);
  expect(builds).toBe(2);
  expect((await store.read("uwo", "events"))?.data).toEqual([3]);
  expect((await store.inspect("uwo", "events")).dirty).toBe(false);
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
    if (key.startsWith("generations/")) throw new Error("upload interrupted");
    return put(key, value, etag);
  };
  expect(await store.refresh("uwo", "events", async () => [2])).toBe(false);
  expect((await store.read("uwo", "events"))?.data).toEqual([1]);
  expect((await store.inspect("uwo", "events")).dirty).toBe(true);
});

test("unchanged snapshots rebuild hourly while invalidation refreshes immediately", async () => {
  let now = 1000;
  const store = new DiscoverySnapshotStore(new MemoryStorage(), () => now);
  let builds = 0;
  const build = async () => [++builds];
  expect(await store.refresh("uwo", "events", build)).toBe(true);
  now += 300_000;
  expect(await store.refresh("uwo", "events", build)).toBe(false);
  now += 3_299_999;
  expect(await store.refresh("uwo", "events", build)).toBe(false);
  expect(builds).toBe(1);
  now += 1;
  expect(await store.refresh("uwo", "events", build)).toBe(true);
  now += 15_000;
  await store.invalidate("uwo", "events");
  expect(await store.refresh("uwo", "events", build)).toBe(true);
  expect((await store.read("uwo", "events"))?.data).toEqual([3]);
});

test("refresh expiry preserves valid last-good data but readiness rejects over-age data", async () => {
  let now = 1000;
  const store = new DiscoverySnapshotStore(new MemoryStorage(), () => now);
  await store.refresh("uwo", "events", async () => []);
  now += discoveryControls.refresh_interval_seconds * 1000;
  expect((await store.read("uwo", "events"))?.data).toEqual([]);
  expect((await store.inspect("uwo", "events")).ready).toBe(true);
  now += 86_400_000;
  expect(await store.read("uwo", "events")).toBeNull();
  expect((await store.inspect("uwo", "events")).ready).toBe(false);
});

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  FileSnapshotStorage,
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
const {
  buildSiteBannerSnapshot,
}: typeof import("../src/shared/api/siteBanner.server") = require("../src/shared/api/siteBanner.server");
const banner = {
  message_translation_key: "navigation.siteBannerMessage",
  cta_href: "/about",
  cta_label_translation_key: "navigation.siteBannerAction",
};
const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("banner source distinguishes disabled content from failed refreshes", async () => {
  globalThis.fetch = async (_input, init) => {
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response(null, { status: 204 });
  };
  expect(await buildSiteBannerSnapshot()).toBeNull();
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await expect(buildSiteBannerSnapshot()).rejects.toThrow("503");
  globalThis.fetch = async () => new Response("invalid json");
  await expect(buildSiteBannerSnapshot()).rejects.toThrow();
  globalThis.fetch = async () => {
    throw new Error("source unavailable");
  };
  await expect(buildSiteBannerSnapshot()).rejects.toThrow("source unavailable");
});

test("published banners survive replacement readers and failed refresh without a page-time API call", async () => {
  const store = new DiscoverySnapshotStore(new MemoryStorage());
  await store.refresh("_global", "site-banner", async () => banner);
  const cachePath =
    require.resolve("../src/shared/services/discoveryCache.server");
  const bannerPath = require.resolve("../src/shared/api/siteBanner.server");
  const previousCache = require.cache[cachePath];
  const previousBanner = require.cache[bannerPath];
  const previousDirectory = process.env.DISCOVERY_CACHE_DIR;
  let getSiteBanner: (typeof import("../src/shared/api/siteBanner.server"))["getSiteBanner"];
  try {
    // Reads and refreshes go to the memory store below; no file is touched.
    process.env.DISCOVERY_CACHE_DIR = path.join(tmpdir(), "wat2do-discovery-unused");
    delete require.cache[cachePath];
    delete require.cache[bannerPath];
    const adapter: typeof import("../src/shared/services/discoveryCache.server") = require(
      cachePath,
    );
    adapter.discoveryStore!.read = store.read.bind(store);
    adapter.discoveryStore!.refresh = store.refresh.bind(store);
    getSiteBanner = require(bannerPath).getSiteBanner;
  } finally {
    if (previousCache) require.cache[cachePath] = previousCache;
    else delete require.cache[cachePath];
    if (previousBanner) require.cache[bannerPath] = previousBanner;
    else delete require.cache[bannerPath];
    if (previousDirectory === undefined) delete process.env.DISCOVERY_CACHE_DIR;
    else process.env.DISCOVERY_CACHE_DIR = previousDirectory;
  }
  let sourceReads = 0;
  globalThis.fetch = async () => {
    sourceReads++;
    return new Response(null, { status: 503 });
  };
  expect(await getSiteBanner()).toMatchObject(banner);
  expect(sourceReads).toBe(0);
  await store.invalidate("_global", "site-banner");
  expect(
    await store.refresh("_global", "site-banner", buildSiteBannerSnapshot),
  ).toBe(false);
  expect(sourceReads).toBe(1);
  expect(await getSiteBanner()).toMatchObject(banner);
  expect(sourceReads).toBe(1);
  await store.invalidate("_global", "site-banner");
  await store.refresh("_global", "site-banner", async () => null);
  expect(await getSiteBanner()).toBeNull();
  expect(sourceReads).toBe(1);
});

async function withCacheDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "wat2do-discovery-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("file storage writes whole files by rename and returns content etags", async () => {
  await withCacheDirectory(async (directory) => {
    const storage = new FileSnapshotStorage(directory);
    const key = "v2/uwo/events/state.json";
    expect(await storage.get(key)).toBeNull();
    expect(await storage.put(key, '{"a":1}')).toBe(true);
    const stored = await storage.get(key);
    expect(stored?.value).toBe('{"a":1}');
    expect(stored?.etag).toMatch(/^[0-9a-f]{64}$/);
    // Only the renamed file remains; no temporary file is left beside it.
    expect(await readdir(path.join(directory, "v2/uwo/events"))).toEqual([
      "state.json",
    ]);
    expect(await new FileSnapshotStorage(directory).get(key)).toEqual(stored);
  });
});

test("file storage compare-and-swap rejects stale etags and existing files", async () => {
  await withCacheDirectory(async (directory) => {
    const storage = new FileSnapshotStorage(directory);
    const key = "v2/uwo/events/state.json";
    expect(await storage.put(key, "first")).toBe(true);
    expect(await storage.put(key, "second")).toBe(false);
    expect(await storage.put("v2/uwo/events/missing.json", "x", "etag")).toBe(
      false,
    );
    const first = (await storage.get(key))!;
    expect(await storage.put(key, "second", first.etag)).toBe(true);
    expect(await storage.put(key, "third", first.etag)).toBe(false);
    expect((await storage.get(key))?.value).toBe("second");
  });
});

test("concurrent writers in one process cannot both win the same etag", async () => {
  await withCacheDirectory(async (directory) => {
    // Separate instances stand in for separate Next bundles in one process.
    const writers = [
      new FileSnapshotStorage(directory),
      new FileSnapshotStorage(directory),
    ];
    const key = "v2/uwo/events/state.json";
    await writers[0].put(key, "start");
    const { etag } = (await writers[0].get(key))!;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        writers[index % 2].put(key, `writer ${index}`, etag),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await writers[1].get(key))?.value).toBe(
      `writer ${results.indexOf(true)}`,
    );
    const creations = await Promise.all(
      writers.map((writer, index) =>
        writer.put("generations/v2/uwo/events/one.json", `${index}`),
      ),
    );
    expect(creations.filter(Boolean)).toHaveLength(1);
  });
});

test("file storage refuses keys that leave its directory", async () => {
  await withCacheDirectory(async (directory) => {
    const storage = new FileSnapshotStorage(path.join(directory, "cache"));
    await writeFile(path.join(directory, "outside.json"), "secret");
    for (const key of [
      "../outside.json",
      "v2/../../outside.json",
      "/etc/passwd",
      "v2//state.json",
      "",
    ]) {
      await expect(storage.get(key)).rejects.toThrow(
        "Invalid discovery storage key",
      );
      await expect(storage.put(key, "x")).rejects.toThrow(
        "Invalid discovery storage key",
      );
    }
    expect(() => new FileSnapshotStorage("relative/cache")).toThrow(
      "DISCOVERY_CACHE_DIR must be an absolute path",
    );
  });
});

test("file storage deletes only expired files directly under one prefix", async () => {
  await withCacheDirectory(async (directory) => {
    const storage = new FileSnapshotStorage(directory);
    const prefix = "generations/v2/uwo/events";
    const otherResource = "generations/v2/uwo/clubs/old.json";
    for (const name of ["old.json", "new.json"])
      await storage.put(`${prefix}/${name}`, name);
    await storage.put(otherResource, "other resource");
    const old = new Date(Date.now() - 8 * 86_400_000);
    await utimes(path.join(directory, prefix, "old.json"), old, old);
    await utimes(path.join(directory, otherResource), old, old);
    await storage.deleteOlderThan(prefix, Date.now() - 7 * 86_400_000);
    expect(await readdir(path.join(directory, prefix))).toEqual(["new.json"]);
    expect(await storage.get(otherResource)).not.toBeNull();
    // A resource that never published a generation has nothing to prune.
    await storage.deleteOlderThan("generations/v2/uwo/branding", Date.now());
  });
});

test("publishing prunes that resource's generations past retention", async () => {
  let now = 1_000_000_000_000;
  const storage = new MemoryStorage(() => now);
  const store = new DiscoverySnapshotStore(storage, () => now);
  const retention = discoveryControls.generation_retention_days * 86_400_000;
  const generations = (resource: string) =>
    [...storage.objects.keys()].filter((key) =>
      key.startsWith(
        `generations/v${discoveryControls.schema_version}/uwo/${resource}/`,
      ),
    );
  await store.refresh("uwo", "events", async () => [1]);
  await store.refresh("uwo", "positions", async () => [1]);
  const [first] = generations("events");
  now += retention / 2;
  await store.invalidate("uwo", "events");
  await store.refresh("uwo", "events", async () => [2]);
  expect(generations("events")).toHaveLength(2);
  now += retention / 2 + 1;
  await store.invalidate("uwo", "events");
  await store.refresh("uwo", "events", async () => [3]);
  expect(generations("events")).toHaveLength(2);
  expect(generations("events")).not.toContain(first);
  // Another resource's generations wait for its own refresh.
  expect(generations("positions")).toHaveLength(1);
  expect((await store.read("uwo", "events"))?.data).toEqual([3]);
});

test("the snapshot store publishes and rereads through file storage", async () => {
  await withCacheDirectory(async (directory) => {
    const store = new DiscoverySnapshotStore(new FileSnapshotStorage(directory));
    await store.refresh("uwo", "events", async () => ({ items: [1] }));
    await store.invalidate("uwo", "events");
    await store.refresh("uwo", "events", async () => ({ items: [2] }));
    const replacement = new DiscoverySnapshotStore(
      new FileSnapshotStorage(directory),
    );
    expect((await replacement.read("uwo", "events"))?.data).toEqual({
      items: [2],
    });
    expect(
      await readdir(
        path.join(
          directory,
          `generations/v${discoveryControls.schema_version}/uwo/events`,
        ),
      ),
    ).toHaveLength(2);
  });
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
const worker: typeof import("../src/app/discoveryRefresh.server") = require(
  workerModulePath,
);
if (originalWorkerModule)
  require.cache[workerModulePath] = originalWorkerModule;
else delete require.cache[workerModulePath];
cacheModule.exports = originalCacheModule;
schoolModule.exports = originalSchoolModule;

test("readiness covers every school, waits for a failed dataset, and retains coverage during refresh failure", async () => {
  workerStorage.objects.clear();
  workerNow += discoveryControls.snapshot_check_seconds * 1000;
  let failWesternEvents = true;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/schools")
      return Response.json([{ slug: "uwo" }, { slug: "uwaterloo" }]);
    if (url.pathname.startsWith("/schools/"))
      return Response.json({ slug: url.pathname.split("/").pop() });
    if (url.pathname === "/site-banner") return Response.json(banner);
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

test("the banner is warmed globally and invalidation leaves school data untouched", async () => {
  workerStorage.objects.clear();
  workerNow += discoveryControls.snapshot_check_seconds * 1000;
  await workerStore.refresh("_global", "schools", async () => [
    { slug: "uwo" },
    { slug: "uwaterloo" },
  ]);
  for (const school of ["uwo", "uwaterloo"]) {
    for (const resource of worker.discoveryResources)
      await workerStore.refresh(school, resource, async () => ({ items: [] }));
  }
  expect(await worker.discoveryReadiness()).toEqual({
    ready: false,
    schools: 2,
    missing: ["_global/site-banner"],
  });
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)).pathname);
    return new Response(null, { status: 204 });
  };
  await worker.reconcileDiscoverySnapshots();
  expect(requests).toEqual(["/site-banner"]);
  expect((await worker.discoveryReadiness()).ready).toBe(true);
  expect((await workerStore.read("_global", "site-banner"))?.data).toBeNull();
  await worker.queueDiscoveryRefresh("uwo", ["site-banner"]);
  expect((await workerStore.inspect("_global", "site-banner")).dirty).toBe(
    true,
  );
  expect((await workerStore.inspect("_global", "schools")).dirty).toBe(false);
  expect((await workerStore.inspect("uwo", "events")).dirty).toBe(false);
  expect(await workerStore.read("uwo", "site-banner")).toBeNull();
});

test("the CDN is warmed once per published generation, not on every pass", async () => {
  workerStorage.objects.clear();
  workerNow += discoveryControls.refresh_interval_seconds * 1000;
  const originalPublicBase = process.env.STORAGE_PUBLIC_BASE_URL;
  process.env.STORAGE_PUBLIC_BASE_URL = "https://wat2do.example/media";
  const warmed: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/discovery") {
      warmed.push(url.search);
      return Response.json({});
    }
    if (url.pathname === "/schools")
      return Response.json([{ slug: "uwo" }, { slug: "uwaterloo" }]);
    if (url.pathname.startsWith("/schools/"))
      return Response.json({ slug: url.pathname.split("/").pop() });
    if (url.pathname === "/site-banner") return new Response(null, { status: 204 });
    return Response.json({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
  };
  const processState = globalThis as typeof globalThis & {
    discoveryWorker?: { warming?: Promise<void> };
  };
  const pass = async () => {
    await worker.reconcileDiscoverySnapshots();
    await processState.discoveryWorker?.warming;
    workerNow += discoveryControls.snapshot_check_seconds * 1000;
  };
  try {
    await pass();
    expect(warmed).toHaveLength(6);
    await pass();
    expect(warmed).toHaveLength(6);
    await worker.queueDiscoveryRefresh("uwo", ["events"]);
    await pass();
    expect(warmed.slice(6)).toEqual(["?school=uwo&resource=events"]);
  } finally {
    if (originalPublicBase === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
    else process.env.STORAGE_PUBLIC_BASE_URL = originalPublicBase;
  }
});

test("persisted usable snapshots admit a replacement task before stalled upstream refreshes finish", async () => {
  workerStorage.objects.clear();
  workerNow += discoveryControls.snapshot_check_seconds * 1000;
  await workerStore.refresh("_global", "schools", async () => [
    { slug: "uwo" },
    { slug: "uwaterloo" },
  ]);
  await workerStore.refresh("_global", "site-banner", async () => null);
  for (const school of ["uwo", "uwaterloo"]) {
    for (const resource of worker.discoveryResources)
      await workerStore.refresh(school, resource, async () => ({ items: [] }));
  }
  workerNow += discoveryControls.refresh_interval_seconds * 1000;
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (input) => {
    started();
    await pending;
    const url = new URL(String(input));
    if (url.pathname === "/schools")
      return Response.json([{ slug: "uwo" }, { slug: "uwaterloo" }]);
    if (url.pathname.startsWith("/schools/"))
      return Response.json({ slug: url.pathname.split("/").pop() });
    if (url.pathname === "/site-banner")
      return new Response(null, { status: 204 });
    return Response.json({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
      total_pages: 0,
    });
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
    const processState = globalThis as typeof globalThis & {
      discoveryWorker?: { timer?: ReturnType<typeof setInterval> };
    };
    clearInterval(processState.discoveryWorker?.timer);
    if (processState.discoveryWorker)
      processState.discoveryWorker.timer = undefined;
  }
});


test("published and startup-warmed snapshots serve concurrent visitors without storage reads", async () => {
  const storage = new MemoryStorage();
  const store = new DiscoverySnapshotStore(storage);
  await store.refresh("uwo", "events", async () => ({ items: [1] }));
  storage.gets = [];
  await Promise.all(Array.from({ length: 20 }, () => store.read("uwo", "events")));
  expect(storage.gets).toEqual([]);
  const replacement = new DiscoverySnapshotStore(storage);
  await Promise.all(Array.from({ length: 20 }, () => replacement.read("uwo", "events")));
  expect(storage.gets).toHaveLength(2);
  storage.gets = [];
  expect((await replacement.read("uwo", "events"))?.data).toEqual({ items: [1] });
  expect(storage.gets).toEqual([]);
});

test("warm reads detect another task's published revision without redownloading unchanged payloads", async () => {
  let now = 1000;
  const storage = new MemoryStorage();
  const writer = new DiscoverySnapshotStore(storage, () => now);
  const reader = new DiscoverySnapshotStore(storage, () => now);
  await writer.refresh("uwo", "events", async () => [1]);
  await reader.read("uwo", "events");
  storage.gets = [];
  now += discoveryControls.snapshot_check_seconds * 1000;
  expect((await reader.read("uwo", "events"))?.data).toEqual([1]);
  expect(storage.gets).toHaveLength(1);
  await writer.invalidate("uwo", "events");
  await writer.refresh("uwo", "events", async () => [2]);
  now += discoveryControls.snapshot_check_seconds * 1000;
  expect((await reader.read("uwo", "events"))?.data).toEqual([2]);
  now += discoveryControls.maximum_snapshot_age_seconds * 1000;
  expect(await reader.read("uwo", "events")).toBeNull();
});
