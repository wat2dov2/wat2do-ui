import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the actual hook's mount/reset behavior without launching a browser.
test("large cached directories mount in batches, grow on scroll and reset before filter rendering", () => {
  const state: unknown[] = [];
  let index = 0;
  let effect: (() => void | (() => void)) | undefined;
  let onIntersect: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  const ref = { current: {} };
  const source = readFileSync(new URL("../src/shared/hooks/useProgressiveList.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const hookModule = { exports: {} as typeof import("../src/shared/hooks/useProgressiveList") };
  runInNewContext(outputText, {
    exports: hookModule.exports,
    IntersectionObserver: class {
      constructor(callback: typeof onIntersect) { onIntersect = callback; }
      observe() {}
      disconnect() {}
    },
    require: () => ({
      useMemo: (fn: () => unknown) => fn(),
      useCallback: (fn: unknown) => fn,
      useRef: () => ref,
      useEffect: (fn: typeof effect) => { effect = fn; },
      useState: (initial: unknown) => {
        const slot = index++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], (next: unknown) => {
          state[slot] = typeof next === "function" ? next(state[slot]) : next;
        }];
      },
    }),
  });
  const clubs = Array.from({ length: 1000 }, (_, id) => ({ id }));
  const render = (items = clubs) => {
    index = 0;
    const result = hookModule.exports.useProgressiveList(items, 24);
    // React rerenders immediately when the hook resets state during render.
    if (result.visibleCount !== state[1]) { index = 0; return hookModule.exports.useProgressiveList(items, 24); }
    return result;
  };
  expect(render().visibleItems).toHaveLength(24);
  effect?.();
  onIntersect?.([{ isIntersecting: true }]);
  expect(render().visibleItems).toHaveLength(48);
  expect(render(clubs.slice(800)).visibleItems).toHaveLength(24);
  expect(clubs).toHaveLength(1000);
});
