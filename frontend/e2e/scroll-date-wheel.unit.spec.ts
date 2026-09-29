import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

interface WheelGroup { key: string; dates: string[] }
interface WheelRow { top: number; date: string; height?: number; group?: string }

function mountWheel(initialGroups?: WheelGroup[]) {
  type WheelState = { visible: boolean; rotation: number; dates: string[]; active: number };
  let state: WheelState;
  let groups = initialGroups;
  let pendingFrame: (() => void) | undefined;
  let mutation: () => void;
  let timeout: (() => void) | undefined;
  let rows: WheelRow[] = [{ top: 200, date: "2026-10-01" }, { top: 200, date: "2026-10-02" }, { top: 600, date: "2026-10-03" }, { top: 1000, date: "" }];
  const listeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  let reads = 0;
  let columns = 2;
  const card = (row: WheelRow) => ({
    dataset: { scrollDate: row.date },
    getBoundingClientRect: () => { reads++; return { top: row.top + 80 - root.scrollTop, height: row.height ?? 392 }; },
  });
  const root = {
    scrollTop: 0, clientHeight: 600, children: [],
    getBoundingClientRect: () => ({ top: 80 }),
    querySelectorAll: (selector: string) => {
      if (selector === "[data-scroll-date]") return rows.map(card);
      const keys = [...new Set(rows.map(row => row.group ?? "feed"))];
      return keys.map(key => {
        const gridRows = rows.filter(row => (row.group ?? "feed") === key);
        return {
          dataset: { scrollDateGroup: key },
          children: gridRows.map(row => ({ querySelector: () => card(row) })),
          querySelector: () => card(gridRows[0]),
          getBoundingClientRect: () => ({ top: gridRows[0].top + 80 - root.scrollTop }),
          closest: () => ({
            getBoundingClientRect: () => ({ top: gridRows[0].top + 80 - root.scrollTop - 34 }),
          }),
        };
      });
    },
    addEventListener: (name: string, handler: () => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  let effect: () => (() => void) | undefined;
  let effectDependencies: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  let stateCursor = 0;
  const states: unknown[] = [];
  const source = readFileSync(new URL("../src/shared/hooks/useScrollDateWheel.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } });
  const exports = {} as { useScrollDateWheel: (groups?: WheelGroup[]) => WheelState };
  const render = () => { stateCursor = 0; state = exports.useScrollDateWheel(groups); };
  runInNewContext(outputText, {
    exports,
    require: (id: string) => id === "react"
      ? {
          useState: (initial: unknown) => {
            const index = stateCursor++;
            if (!(index in states)) states[index] = initial;
            return [states[index], (next: unknown) => { states[index] = next; render(); }];
          },
          useEffect: (nextEffect: typeof effect, dependencies: unknown[]) => {
            if (!effectDependencies || dependencies.some((value, index) => value !== effectDependencies?.[index])) {
              effect = nextEffect;
              effectDependencies = dependencies;
            }
          },
        }
      : { MAIN_CONTENT_SCROLL_ROOT_SELECTOR: ".main-content-grid" },
    document: { querySelector: () => root },
    window: {
      addEventListener: (name: string, handler: () => void) => windowListeners.set(name, handler),
      removeEventListener: (name: string) => windowListeners.delete(name),
    },
    getComputedStyle: () => ({ gridTemplateColumns: Array(columns).fill("208px").join(" "), rowGap: "8px", marginBottom: "20px" }),
    MutationObserver: class { constructor(callback: () => void) { mutation = callback; } observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (callback: () => void) => { pendingFrame = callback; return 1; },
    cancelAnimationFrame: () => { pendingFrame = undefined; },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; },
    clearTimeout: () => { timeout = undefined; },
  });
  const flush = () => {
    if (effect) {
      const callback = effect;
      effect = undefined;
      cleanup?.();
      cleanup = callback();
    }
    const callback = pendingFrame;
    pendingFrame = undefined;
    callback?.();
  };
  render();
  flush();
  return {
    get state() { return state; },
    get reads() { return reads; },
    scroll(top: number) { root.scrollTop = top; listeners.get("scroll")?.(); flush(); },
    replace(next: WheelRow[]) { rows = next; mutation(); flush(); },
    resize(nextColumns: number, nextRows: WheelRow[]) { columns = nextColumns; rows = nextRows; windowListeners.get("resize")?.(); flush(); },
    setGroups(nextGroups?: WheelGroup[]) { groups = nextGroups; render(); flush(); },
    idle() { timeout?.(); flush(); },
    cleanup() { cleanup?.(); },
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


test("complete cached groups forecast future rows before progressive cards mount", () => {
  const wheel = mountWheel([
    { key: "feed", dates: ["2026-10-01", "2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-03"] },
    { key: "next-week", dates: ["2026-10-08", "2026-10-08", "2026-10-09"] },
  ]);
  wheel.replace([{ top: 200, date: "2026-10-01" }, { top: 200, date: "2026-10-01" }]);
  expect(wheel.state.dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-08", "2026-10-09"]);
  const measured = wheel.reads;
  wheel.scroll(348); // Reading line reaches the predicted second row at 600.
  expect(wheel.state.active).toBe(1);
  expect(wheel.state.rotation).toBe(36);
  wheel.scroll(1194); // Three rows plus the next section heading and section gap.
  expect(wheel.state.dates[wheel.state.active]).toBe("2026-10-08");
  expect(wheel.reads).toBe(measured);
  wheel.cleanup();
});

test("responsive column changes regroup cached dates and correct newly rendered row positions", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
  const wheel = mountWheel([{ key: "feed", dates }]);
  wheel.replace([{ top: 200, date: dates[0] }, { top: 200, date: dates[1] }]);
  expect(wheel.state.dates).toEqual([dates[0], dates[2], dates[4]]);
  wheel.resize(3, dates.slice(0, 3).map(date => ({ top: 200, date })));
  expect(wheel.state.dates).toEqual([dates[0], dates[3]]);
  wheel.scroll(348);
  expect(wheel.state.active).toBe(1);
  wheel.replace(dates.map((date, index) => ({ top: index < 3 ? 200 : 800, date })));
  expect(wheel.state.active).toBe(0);
  expect(wheel.state.rotation).toBe(24);
  wheel.scroll(548);
  expect(wheel.state.active).toBe(1);
  wheel.cleanup();
});

test("filter changes switch forecasts back to actual rows and empty lists clear stale dates", () => {
  const wheel = mountWheel([{ key: "feed", dates: ["2026-10-01", "2026-10-01", "2026-10-08"] }]);
  wheel.replace([{ top: 200, date: "2026-10-01" }]);
  expect(wheel.state.dates).toEqual(["2026-10-01", "2026-10-08"]);
  wheel.setGroups(undefined);
  expect(wheel.state.dates).toEqual(["2026-10-01"]);
  wheel.replace([]);
  expect(wheel.state.dates).toEqual([]);
  wheel.setGroups([]);
  expect(wheel.state.visible).toBe(false);
  wheel.cleanup();
});
