import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const { warmDiscoveryRoutes, prefetchDiscoveryRoute }: typeof import("../src/app/hooks/useAppNavigation") =
  createRequire(import.meta.url)("../src/app/hooks/useAppNavigation");
type PrefetchOptions = Parameters<Parameters<typeof warmDiscoveryRoutes>[0]["prefetch"]>[1];

function recordingRouter() {
  const calls: Array<{ href: string; options: PrefetchOptions }> = [];
  return {
    calls,
    prefetch: (href: string, options: PrefetchOptions) => {
      calls.push({ href, options });
    },
  };
}

const originalGlobals = new Map(
  ["window", "document", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

function browserScheduler() {
  let nextId = 0;
  const timers = new Map<number, () => void>();
  const idleCallbacks = new Map<number, IdleRequestCallback>();
  const document = Object.assign(new EventTarget(), { readyState: "complete", visibilityState: "visible" });
  const navigator = { onLine: true, connection: { saveData: false, effectiveType: "4g" } };
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void) { timers.set(++nextId, callback); return nextId; },
    clearTimeout(id: number) { timers.delete(id); },
    requestIdleCallback: ((callback: IdleRequestCallback) => {
      idleCallbacks.set(++nextId, callback);
      return nextId;
    }) as Window["requestIdleCallback"] | undefined,
    cancelIdleCallback(id: number) { idleCallbacks.delete(id); },
  });
  for (const [key, value] of Object.entries({ window, document, navigator })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  return {
    window, document, navigator, timers, idleCallbacks,
    runTimer() {
      const entry = timers.entries().next().value;
      expect(entry).toBeDefined();
      const [id, callback] = entry!;
      timers.delete(id);
      callback();
    },
    runIdle() {
      const entry = idleCallbacks.entries().next().value;
      expect(entry).toBeDefined();
      const [id, callback] = entry!;
      idleCallbacks.delete(id);
      callback({ didTimeout: false, timeRemaining: () => 50 });
    },
  };
}

test.afterEach(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("waits for page resources, then warms each adjacent full page once during idle time", () => {
  const browser = browserScheduler();
  browser.document.readyState = "loading";
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router, "/");
  expect(browser.timers.size).toBe(0);
  browser.document.readyState = "complete";
  browser.window.dispatchEvent(new Event("load"));
  expect(router.calls).toEqual([]);
  browser.runTimer();
  expect(router.calls).toEqual([]);
  browser.runIdle();
  expect(router.calls.map(({ href }) => href)).toEqual(["/positions"]);
  browser.runTimer();
  browser.runIdle();
  expect(router.calls).toEqual([
    { href: "/positions", options: { kind: "full" } },
    { href: "/clubs", options: { kind: "full" } },
  ]);
  browser.window.dispatchEvent(new Event("online"));
  browser.document.dispatchEvent(new Event("visibilitychange"));
  expect(browser.timers.size).toBe(0);
  stop();
});

test("pauses hidden or offline tabs and resumes the remaining routes", () => {
  const browser = browserScheduler();
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router, "/positions");
  browser.document.visibilityState = "hidden";
  browser.document.dispatchEvent(new Event("visibilitychange"));
  expect(browser.timers.size).toBe(0);
  browser.document.visibilityState = "visible";
  browser.document.dispatchEvent(new Event("visibilitychange"));
  browser.runTimer();
  browser.navigator.onLine = false;
  browser.window.dispatchEvent(new Event("offline"));
  expect(browser.idleCallbacks.size).toBe(0);
  browser.navigator.onLine = true;
  browser.window.dispatchEvent(new Event("online"));
  browser.runTimer();
  browser.runIdle();
  expect(router.calls.map(({ href }) => href)).toEqual(["/"]);
  stop();
});

test("respects data saver and slow connections while explicit intent can still prefetch", () => {
  const browser = browserScheduler();
  const router = recordingRouter();
  browser.navigator.connection.saveData = true;
  const stop = warmDiscoveryRoutes(router, "/");
  expect(browser.timers.size).toBe(0);
  browser.navigator.connection.saveData = false;
  browser.navigator.connection.effectiveType = "2g";
  browser.window.dispatchEvent(new Event("online"));
  expect(browser.timers.size).toBe(0);
  prefetchDiscoveryRoute(router, "/positions");
  prefetchDiscoveryRoute(router, "/contact");
  expect(router.calls).toEqual([{ href: "/positions", options: { kind: "full" } }]);
  stop();
});

test("cancels scheduled work on cleanup, including callbacks already queued", () => {
  const browser = browserScheduler();
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router, "/");
  browser.runTimer();
  const callback = [...browser.idleCallbacks.values()][0]!;
  stop();
  callback({ didTimeout: false, timeRemaining: () => 50 });
  browser.window.dispatchEvent(new Event("online"));
  expect(router.calls).toEqual([]);
  expect(browser.idleCallbacks.size).toBe(0);
  expect(browser.timers.size).toBe(0);
});

test("uses bounded deferred work when requestIdleCallback is unavailable", () => {
  const browser = browserScheduler();
  browser.window.requestIdleCallback = undefined;
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router, "/clubs");
  expect(router.calls).toEqual([]);
  browser.runTimer();
  browser.runTimer();
  expect(router.calls.map(({ href }) => href)).toEqual(["/", "/positions"]);
  expect(browser.timers.size).toBe(0);
  stop();
});
