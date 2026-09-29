import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("late badges stay measured through resize, replacement and removal", () => {
  type Box = { width: number; height: number };
  type Node = { getBoundingClientRect: () => Box };
  const observed = new Set<Node>();
  const state: unknown[] = [];
  let effect!: () => () => void;
  let resize!: () => void;
  const source = readFileSync(new URL("../src/shared/ui/event-image-cutout.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {} as { useEventImageCutouts: () => {
    surfaceRef: { current: Node | null };
    registerCorner: (corner: string) => (node: Node | null) => void;
  } };
  runInNewContext(outputText, {
    exports,
    require: (id: string) => id === "react" ? {
      useRef: (current: unknown) => ({ current }),
      useCallback: (callback: unknown) => callback,
      useEffect: (callback: typeof effect) => { effect = callback; },
      useState: (initial: unknown) => {
        const index = state.length;
        state.push(initial);
        return [initial, (update: (previous: unknown) => unknown) => { state[index] = update(state[index]); }];
      },
    } : {},
    ResizeObserver: class {
      constructor(callback: () => void) { resize = callback; }
      observe(node: Node) { observed.add(node); }
      unobserve(node: Node) { observed.delete(node); }
      disconnect() { observed.clear(); }
    },
  });
  const hook = exports.useEventImageCutouts();
  const surface = { getBoundingClientRect: () => ({ width: 240.5, height: 208 }) };
  hook.surfaceRef.current = surface;
  const cleanup = effect();
  let badgeWidth = 90;
  const badge = { getBoundingClientRect: () => ({ width: badgeWidth, height: 24 }) };
  const register = hook.registerCorner("bottom-left");
  register(badge);
  expect(observed.has(badge)).toBe(true);
  badgeWidth = 160;
  resize();
  expect(state[1]).toEqual([{ corner: "bottom-left", width: 160, height: 24 }]);
  const replacement = { getBoundingClientRect: () => ({ width: 120, height: 28 }) };
  register(replacement);
  expect(observed.has(badge)).toBe(false);
  expect(observed.has(replacement)).toBe(true);
  register(null);
  expect(observed.has(replacement)).toBe(false);
  expect(state[1]).toEqual([]);
  cleanup();
  expect(observed.size).toBe(0);
});
