import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const { warmDiscoveryRoutes }: typeof import("../src/app/hooks/useAppNavigation") =
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

test("warms full Events, Positions and Clubs payloads without visible links", () => {
  const router = recordingRouter();
  warmDiscoveryRoutes(router);
  expect(router.calls.map(({ href }) => href)).toEqual(["/", "/positions", "/clubs"]);
  for (const call of router.calls) expect(call.options?.kind).toBe("full");
});

test("refreshes each stale discovery route independently and repeatedly", () => {
  const router = recordingRouter();
  warmDiscoveryRoutes(router);
  for (const initial of [...router.calls]) {
    initial.options?.onInvalidate?.();
    const refreshed = router.calls.at(-1)!;
    expect(refreshed.href).toBe(initial.href);
    refreshed.options?.onInvalidate?.();
    expect(router.calls.at(-1)?.href).toBe(initial.href);
  }
  expect(router.calls).toHaveLength(9);
  for (const call of router.calls) expect(call.options?.kind).toBe("full");
});

test("stops invalidation callbacks after cleanup, including replaced StrictMode effects", () => {
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router);
  const oldCalls = [...router.calls];
  stop();
  for (const call of oldCalls) call.options?.onInvalidate?.();
  expect(router.calls).toHaveLength(3);
  const stopReplacement = warmDiscoveryRoutes(router);
  for (const call of oldCalls) call.options?.onInvalidate?.();
  expect(router.calls).toHaveLength(6);
  router.calls[5].options?.onInvalidate?.();
  expect(router.calls).toHaveLength(7);
  stopReplacement();
  router.calls[6].options?.onInvalidate?.();
  expect(router.calls).toHaveLength(7);
});
