import { expect, test } from "@playwright/test";
import { environmentManager, focusManager, onlineManager, QueryObserver, type UseQueryOptions } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getQueryClient } from "../src/shared/lib/queryClient";
import { queryKeys } from "../src/shared/lib/queryKeys";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalIsServer = environmentManager.isServer();
const intervals = new Map<ReturnType<typeof setInterval>, () => void>();
const observers: QueryObserver[] = [];
const requests: string[] = [];
let failRead = false;

function logQuery(senderId?: string): UseQueryOptions {
  const filename = new URL("../src/features/admin/api/automateLogsApi.ts", import.meta.url);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as { useAutomateLogs: (senderId?: string) => UseQueryOptions } };
  runInNewContext(source, {
    exports: module.exports,
    require: (id: string) => {
      if (id === "@tanstack/react-query") return { useQuery: (options: UseQueryOptions) => options };
      if (id === "@/shared/lib/queryKeys") return { queryKeys };
      if (id === "@/shared/services/apiClient") return { api: { get: async (url: string) => {
        requests.push(url);
        if (failRead) throw new Error("Diagnostics unavailable");
        return [{ id: `log-${requests.length}`, event: "SCRAPE_COMPLETED" }];
      } } };
      throw new Error(`Unexpected diagnostics dependency: ${id}`);
    },
  });
  return { ...module.exports.useAutomateLogs(senderId), retry: false };
}

function observe(options: UseQueryOptions) {
  const observer = new QueryObserver(getQueryClient(), options);
  observers.push(observer);
  observer.subscribe(() => {});
  return observer;
}

// Flush query-manager notifications without a browser or an arbitrary delay.
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  environmentManager.setIsServer(() => false);
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  globalThis.setInterval = ((callback: () => void) => {
    const timer = {} as ReturnType<typeof setInterval>;
    intervals.set(timer, callback);
    return timer;
  }) as typeof setInterval;
  globalThis.clearInterval = timer => { intervals.delete(timer as ReturnType<typeof setInterval>); };
  requests.length = 0;
  failRead = false;
  getQueryClient().clear();
  getQueryClient().mount();
});

test.afterEach(() => {
  for (const observer of observers.splice(0)) observer.destroy();
  getQueryClient().unmount();
  getQueryClient().clear();
  intervals.clear();
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  environmentManager.setIsServer(() => originalIsServer);
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

for (const senderId of [undefined, "instagram-browser-worker"]) {
  test(`${senderId ?? "Automate"} logs load once and refresh only on request`, async () => {
    const options = logQuery(senderId);
    let observer = observe(options);
    await expect.poll(() => observer.getCurrentResult().isSuccess).toBe(true);
    const first = observer.getCurrentResult().data;
    expect(requests).toEqual([`/webhooks/automate/logs${senderId ? `?sender_id=${senderId}` : ""}`]);

    // Invoke any registered polling callbacks as if their intervals elapsed.
    for (const callback of [...intervals.values()]) callback();
    await settle();
    expect(requests).toHaveLength(1);

    // A stale snapshot must remain stable through tab navigation and resume.
    await getQueryClient().invalidateQueries({ queryKey: options.queryKey, refetchType: "none" });
    observer.destroy();
    observer = observe(options);
    focusManager.setFocused(false);
    onlineManager.setOnline(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    await settle();
    expect(requests).toHaveLength(1);
    expect(observer.getCurrentResult().data).toEqual(first);

    const refreshed = await observer.refetch();
    expect(requests).toHaveLength(2);
    expect(refreshed.data).toEqual([{ id: "log-2", event: "SCRAPE_COMPLETED" }]);
    expect(getQueryClient().getQueryData(options.queryKey)).toEqual(refreshed.data);
  });
}

test("returning to failed diagnostics waits for an explicit retry", async () => {
  failRead = true;
  const options = logQuery();
  let observer = observe(options);
  await expect.poll(() => observer.getCurrentResult().isError).toBe(true);
  expect(requests).toHaveLength(1);
  observer.destroy();
  failRead = false;
  observer = observe(options);
  await settle();
  expect(requests).toHaveLength(1);
  expect(observer.getCurrentResult().isError).toBe(true);
  expect((await observer.refetch()).isSuccess).toBe(true);
  expect(requests).toHaveLength(2);
});
