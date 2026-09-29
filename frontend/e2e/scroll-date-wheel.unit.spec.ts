import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function mountWheel() {
  type WheelState = { visible: boolean; rotation: number; dates: string[]; active: number };
  let state: WheelState;
  let pendingFrame: (() => void) | undefined;
  let mutation: () => void;
  let timeout: (() => void) | undefined;
  let rows = [{ top: 200, date: "2026-10-01" }, { top: 200, date: "2026-10-02" }, { top: 600, date: "2026-10-03" }, { top: 1000, date: "" }];
  const listeners = new Map<string, () => void>();
  let reads = 0;
  const root = {
    scrollTop: 0, clientHeight: 600, children: [],
    getBoundingClientRect: () => ({ top: 80 }),
    querySelectorAll: () => rows.map(row => ({
      dataset: { scrollDate: row.date },
      getBoundingClientRect: () => { reads++; return { top: row.top + 80 - root.scrollTop }; },
    })),
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const effects: (() => (() => void))[] = [];
  const source = readFileSync(new URL("../src/shared/hooks/useScrollDateWheel.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } });
  const exports = {} as { useScrollDateWheel: () => void };
  runInNewContext(outputText, {
    exports,
    require: (id: string) => id === "react"
      ? { useState: (initial: WheelState) => { state = initial; return [state, (next: WheelState) => { state = next; }]; }, useEffect: (effect: () => (() => void)) => effects.push(effect) }
      : { MAIN_CONTENT_SCROLL_ROOT_SELECTOR: ".main-content-grid" },
    document: { querySelector: () => root },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    MutationObserver: class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (callback: () => void) => { pendingFrame = callback; return 1; },
    cancelAnimationFrame: () => { pendingFrame = undefined; },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; },
    clearTimeout: () => { timeout = undefined; },
  });
  const flush = () => { const callback = pendingFrame; pendingFrame = undefined; callback?.(); };
  exports.useScrollDateWheel();
  const cleanup = effects[0]();
  flush();
  return {
    get state() { return state; },
    get reads() { return reads; },
    scroll(top: number) { root.scrollTop = top; listeners.get("scroll")?.(); flush(); },
    replace(next: typeof rows) { rows = next; mutation(); flush(); },
    idle() { timeout?.(); flush(); },
    cleanup() { cleanup(); },
    listeners,
  };
}

test("wheel follows real grid rows in both directions without remeasuring on scroll", () => {
  const wheel = mountWheel();
  expect(wheel.state.visible).toBe(false);
  expect(wheel.state.dates).toEqual(["2026-10-01", "2026-10-03", ""]);
  const measured = wheel.reads;
  wheel.scroll(400);
  expect(wheel.state.visible).toBe(true);
  expect(wheel.state.dates[wheel.state.active]).toBe("2026-10-03");
  const rotation = wheel.state.rotation;
  wheel.scroll(800);
  expect(wheel.state.dates[wheel.state.active]).toBe("");
  expect(wheel.state.rotation).toBeGreaterThan(rotation);
  wheel.scroll(20);
  expect(wheel.state.dates[wheel.state.active]).toBe("2026-10-01");
  expect(wheel.reads).toBe(measured);
  wheel.idle();
  expect(wheel.state.visible).toBe(false);
  wheel.cleanup();
  expect(wheel.listeners.size).toBe(0);
});

test("filtered, empty and newly appended results replace stale wheel dates", () => {
  const wheel = mountWheel();
  wheel.scroll(400);
  wheel.replace([{ top: 200, date: "2026-11-12" }]);
  expect(wheel.state.dates).toEqual(["2026-11-12"]);
  expect(wheel.state.active).toBe(0);
  wheel.replace([]);
  expect(wheel.state.visible).toBe(false);
  wheel.replace([{ top: 200, date: "2026-11-12" }, { top: 600, date: "2026-11-13" }]);
  expect(wheel.state.dates[wheel.state.active]).toBe("2026-11-13");
  wheel.cleanup();
});

test("wheel rotation interpolates actual date distances and clamps at the ends", () => {
  const wheel = mountWheel();
  wheel.replace([{ top: 300, date: "2026-10-01" }, { top: 700, date: "2026-10-02" }, { top: 1500, date: "2026-10-03" }]);
  wheel.scroll(0);
  expect(wheel.state.rotation).toBe(0);
  wheel.scroll(248); // Reading line at 500, halfway through the first date interval.
  expect(wheel.state.rotation).toBe(18);
  expect(wheel.state.active).toBe(0);
  wheel.scroll(448);
  expect(wheel.state.rotation).toBe(36);
  expect(wheel.state.active).toBe(1);
  wheel.scroll(848); // The second interval is twice as tall.
  expect(wheel.state.rotation).toBe(54);
  expect(wheel.state.active).toBe(1);
  wheel.scroll(1500);
  expect(wheel.state.rotation).toBe(72);
  expect(wheel.state.active).toBe(2);
  wheel.scroll(248);
  expect(wheel.state.rotation).toBe(18);
  wheel.replace([]);
  expect(wheel.state.rotation).toBe(0);
  wheel.cleanup();
});
