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

test("warms full Events and Positions payloads without depending on visible links", () => {
  const router = recordingRouter();
  warmDiscoveryRoutes(router);
  expect(router.calls.map(({ href }) => href)).toEqual(["/", "/positions"]);
  for (const call of router.calls) expect(call.options?.kind).toBe("full");
});

test("refreshes each stale discovery route independently instead of leaving a one-shot warmup", () => {
  const router = recordingRouter();
  warmDiscoveryRoutes(router);
  router.calls[1].options?.onInvalidate?.();
  expect(router.calls.map(({ href }) => href)).toEqual(["/", "/positions", "/positions"]);
  router.calls[2].options?.onInvalidate?.();
  expect(router.calls[3].href).toBe("/positions");
  router.calls[0].options?.onInvalidate?.();
  expect(router.calls[4].href).toBe("/");
  for (const call of router.calls) expect(call.options?.kind).toBe("full");
});

test("stops invalidation callbacks after cleanup, including replaced StrictMode effects", () => {
  const router = recordingRouter();
  const stop = warmDiscoveryRoutes(router);
  const oldCalls = [...router.calls];
  stop();
  for (const call of oldCalls) call.options?.onInvalidate?.();
  expect(router.calls).toHaveLength(2);
  const stopReplacement = warmDiscoveryRoutes(router);
  for (const call of oldCalls) call.options?.onInvalidate?.();
  expect(router.calls).toHaveLength(4);
  router.calls[3].options?.onInvalidate?.();
  expect(router.calls).toHaveLength(5);
  stopReplacement();
  router.calls[4].options?.onInvalidate?.();
  expect(router.calls).toHaveLength(5);
});
