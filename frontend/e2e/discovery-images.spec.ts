import { expect, test } from "@playwright/test";
import controls from "../../backend/controlbox/image_delivery.json" with { type: "json" };
import { DiscoveryImageWarmer } from "../src/shared/services/discoveryImages.server";

const source = (name: string) =>
  `https://${controls.optimized_remote_host}${controls.optimized_remote_path}${name}.webp`;
const snapshot = (...urls: string[]) => ({
  items: urls.map((source_image_url) => ({ source_image_url })),
});
const imageResponse = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/webp" },
  });
const warmers: DiscoveryImageWarmer[] = [];
const createWarmer = (
  ...args: ConstructorParameters<typeof DiscoveryImageWarmer>
) => {
  const warmer = new DiscoveryImageWarmer(...args);
  warmers.push(warmer);
  return warmer;
};
test.afterEach(() => {
  warmers.splice(0).forEach((warmer) => warmer.dispose());
});

test("warms only current first-screen owned posters, deduplicates variants, and bounds concurrency", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  let active = 0;
  let maximumActive = 0;
  let consumed = 0;
  const warmer = createWarmer(async (input, init) => {
    active++;
    maximumActive = Math.max(active, maximumActive);
    requests.push({ url: new URL(String(input)), init });
    await Promise.resolve();
    active--;
    const response = imageResponse();
    const read = response.arrayBuffer.bind(response);
    response.arrayBuffer = async () => {
      consumed++;
      return read();
    };
    return response;
  });
  const urls = Array.from(
    { length: controls.first_row_image_count + 2 },
    (_, index) => source(String(index)),
  );
  await Promise.all([
    warmer.warm("uwo", "events", snapshot(...urls)),
    warmer.warm(
      "uwaterloo",
      "positions",
      snapshot(
        urls[0],
        "https://legacy.supabase.co/storage/poster.jpg",
        "data:image/png;base64,AAAA",
        "https://wat2do.io@outside.example/media/no.jpg",
        "https://wat2do.io:8443/media/0.webp",
      ),
    ),
    warmer.warm("uwo", "clubs", snapshot(source("club"))),
  ]);
  expect(maximumActive).toBe(1);
  expect(requests).toHaveLength(
    controls.first_row_image_count * controls.warm_widths.length,
  );
  expect(consumed).toBe(requests.length);
  expect(
    new Set(requests.map(({ url }) => url.searchParams.get("url"))),
  ).toEqual(new Set(urls.slice(0, controls.first_row_image_count)));
  expect(
    requests.every(
      ({ url, init }) =>
        url.origin === `https://${controls.optimized_remote_host}` &&
        url.pathname === "/_next/image" &&
        url.searchParams.get("q") === String(controls.quality) &&
        new Headers(init?.headers).get("Accept") ===
          controls.optimized_format &&
        init?.signal instanceof AbortSignal,
    ),
  ).toBe(true);
  expect(
    new Set(requests.map(({ url }) => Number(url.searchParams.get("w")))),
  ).toEqual(new Set(controls.warm_widths));
});

test("replacing a snapshot drops obsolete queued posters and retains posters referenced elsewhere", async () => {
  const requests: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const warmer = createWarmer(async (input) => {
    requests.push(new URL(String(input)).searchParams.get("url")!);
    if (requests.length === 1) {
      started();
      await pending;
    }
    return imageResponse();
  });
  const original = warmer.warm(
    "uwo",
    "events",
    snapshot(source("old"), source("shared")),
  );
  await entered;
  const shared = warmer.warm(
    "uwaterloo",
    "positions",
    snapshot(source("shared")),
  );
  const replacement = warmer.warm("uwo", "events", snapshot(source("new")));
  release();
  await Promise.all([original, shared, replacement]);
  expect(requests.filter((url) => url === source("old"))).toHaveLength(1);
  expect(requests.filter((url) => url === source("new"))).toHaveLength(
    controls.warm_widths.length,
  );
  expect(requests.filter((url) => url === source("shared"))).toHaveLength(
    controls.warm_widths.length,
  );
  // Removed URLs are not retained as an ever-growing successful-image history.
  await warmer.warm("uwo", "events", snapshot(source("old")));
  expect(requests.filter((url) => url === source("old"))).toHaveLength(
    1 + controls.warm_widths.length,
  );
});

test("optimizer failures retry after backoff while successful variants stay warm until expiry", async () => {
  let now = 1000;
  let fail = true;
  const requests: string[] = [];
  const warmer = createWarmer(
    async (input) => {
      requests.push(String(input));
      return fail ? new Response(null, { status: 503 }) : imageResponse();
    },
    () => now,
  );
  const data = snapshot(source("retry"));
  await warmer.warm("uwo", "events", data);
  expect(requests).toHaveLength(controls.warm_widths.length);
  fail = false;
  now += controls.warm_retry_seconds * 1000 - 1;
  await warmer.warm("uwo", "events", data);
  expect(requests).toHaveLength(controls.warm_widths.length);
  now++;
  await warmer.warm("uwo", "events", data);
  expect(requests).toHaveLength(controls.warm_widths.length * 2);
  now += controls.warm_success_ttl_seconds * 1000 - 1;
  await warmer.warm("uwo", "events", data);
  expect(requests).toHaveLength(controls.warm_widths.length * 2);
  now++;
  await warmer.warm("uwo", "events", data);
  expect(requests).toHaveLength(controls.warm_widths.length * 3);
});

test("empty replacement and expired school registrations do not keep retrying old images", async () => {
  let now = 1000;
  const requests: string[] = [];
  const warmer = createWarmer(
    async (input) => {
      requests.push(new URL(String(input)).searchParams.get("url")!);
      return new Response(null, { status: 503 });
    },
    () => now,
  );
  await warmer.warm("removed-school", "events", snapshot(source("expired")));
  await warmer.warm("uwo", "events", snapshot(source("removed")));
  await warmer.warm("uwo", "events", snapshot());
  now += controls.warm_success_ttl_seconds * 1000;
  await warmer.warm("uwaterloo", "events", snapshot(source("current")));
  expect(requests.filter((url) => url === source("expired"))).toHaveLength(
    controls.warm_widths.length,
  );
  expect(requests.filter((url) => url === source("removed"))).toHaveLength(
    controls.warm_widths.length,
  );
  expect(requests.filter((url) => url === source("current"))).toHaveLength(
    controls.warm_widths.length,
  );
});
