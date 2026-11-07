import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import manifest from "../src/assets/event-mosaic-uwaterloo.json" with { type: "json" };

type Draw = { step: number; x: number; y: number; size: number; alpha: number };
type Controller = {
  cell: (index: number) => { poster: number } | null;
  stop: () => void;
  cellAt: (x: number, y: number) => { index: number; poster: number; x: number; y: number; size: number } | null;
  pin: (index: number | null) => void;
  wave: (topic: string | null) => void;
};
type Engine = {
  startEventPixelMosaic: (...args: unknown[]) => Controller;
  logoCells: (mask: readonly string[], columns: number, rows: number, box?: { left: number; top: number; columns: number; rows: number }) => Uint8Array;
};

/** Runs the mosaic engine against a recording canvas, a fake clock and controllable observers. */
const clock = { now: 0 };

function loadMosaic(width = 240, height = 120) {
  const draws: Draw[] = [];
  const frames: ((now: number) => void)[] = [];
  const observers: { intersect?: (entries: { isIntersecting: boolean }[]) => void } = {};
  const context = () => {
    const state = { globalAlpha: 1 };
    return Object.assign(state, {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "low",
      clearRect: () => {},
      drawImage: (_source: unknown, _sx: number, _sy: number, step: number, _sh: number, x: number, y: number, size: number) => {
        draws.push({ step, x, y, size, alpha: state.globalAlpha });
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    });
  };
  const element = () => ({ width: 0, height: 0, style: {} as Record<string, string>, getContext: context });
  const document = { visibilityState: "visible", createElement: element, addEventListener: () => {}, removeEventListener: () => {} };
  const source = readFileSync(new URL("../src/features/landing/lib/eventPixelMosaic.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  });
  const exports = {} as Engine;
  runInNewContext(outputText, {
    exports,
    document,
    window: { devicePixelRatio: 1, setTimeout: () => 0, clearTimeout: () => {} },
    requestAnimationFrame: (callback: (now: number) => void) => frames.push(callback),
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observers.intersect = callback; }
      observe() {}
      disconnect() {}
    },
    Math, Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, Map, Number, String,
    performance: { now: () => clock.now },
  });
  const canvas = { ...element(), parentElement: { getBoundingClientRect: () => ({ width, height }) } };
  const atlas = { image: {}, tilePixels: manifest.tilePixels, columns: manifest.columns, count: manifest.posters.length };
  return {
    draws,
    frames,
    observers,
    engine: exports,
    start: (animate: boolean, tone = "full") =>
      exports.startEventPixelMosaic(canvas, atlas, { tileSize: 24, gutter: 1, waveMs: 900, tone }, animate, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
      }),
  };
}

test("the atlas packs a few hundred real posters, each with the public event or position it came from", () => {
  expect(manifest.posters.length).toBeGreaterThanOrEqual(300);
  // Each headline topic has enough posters of its own for a wave.
  for (const topic of ["networking", "social", "position"]) {
    expect(manifest.posters.filter((poster) => poster.topic === topic).length).toBeGreaterThanOrEqual(40);
  }
  expect(manifest.tilePixels).toBeGreaterThanOrEqual(64);
  expect(manifest.eventCount).toBeGreaterThanOrEqual(manifest.posters.length);
  for (const poster of manifest.posters) {
    expect(poster.id).toBeGreaterThan(0);
    expect(poster.title.length).toBeGreaterThan(0);
    if (poster.kind === "event") expect(Number.isNaN(Date.parse(poster.start!))).toBe(false);
    expect(poster.image).toMatch(/^https:\/\//);
    expect(poster.colour).toMatch(/^#[0-9a-f]{6}$/);
  }
});

test("the logo lights up a recognisable share of its box in its own colours, and keeps inside its box", () => {
  const { engine } = loadMosaic();
  const columns = 80;
  const rows = 18;
  const cells = engine.logoCells(manifest.logoMask, columns, rows);
  const lit = cells.filter(Boolean).length;
  expect(lit / (columns * rows)).toBeGreaterThan(0.08);
  expect(lit / (columns * rows)).toBeLessThan(0.3);
  const letters = new Set([...cells].filter(Boolean).map((code) => String.fromCharCode(code)));
  expect(letters).toEqual(new Set(["b", "k", "n"]));
  // The logo keeps inside its box.
  const outside = engine.logoCells(manifest.logoMask, columns, rows, { left: 10, top: 2, columns: 40, rows: 12 });
  outside.forEach((value, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (value) expect(column >= 10 && column < 50 && row >= 2 && row < 14).toBe(true);
  });
});

test("reduced motion draws one still mosaic that fills its parent and never schedules a frame", () => {
  const mosaic = loadMosaic();
  mosaic.start(false);
  // 240 x 120 at 24px cells is a 10 x 5 grid, every cell a full-resolution poster inside its gutter.
  expect(mosaic.draws).toHaveLength(50);
  expect(mosaic.draws.every((draw) => draw.step === manifest.tilePixels && draw.size === 23 && draw.alpha === 1)).toBe(true);
  expect(mosaic.frames).toHaveLength(0);
});

test("muted cells are drawn faded into the surface behind them", () => {
  const mosaic = loadMosaic();
  mosaic.start(false, "muted");
  expect(mosaic.draws.filter((draw) => draw.size === 23).every((draw) => draw.alpha < 0.5)).toBe(true);
});

test("the grid is still until a wave is asked for; a wave resolves cells to one topic, a pinned cell holds still, and it pauses off screen", () => {
  const mosaic = loadMosaic();
  const controller = mosaic.start(true);
  expect(mosaic.frames).toHaveLength(0);

  const held = controller.cellAt(30, 30)!;
  controller.pin(held.index);
  mosaic.draws.length = 0;
  clock.now = 0;
  controller.wave("position");
  for (let step = 0; step < 60 && mosaic.frames.length; step += 1) {
    clock.now += 50;
    mosaic.frames.shift()!(clock.now);
  }
  // The wave ran its course and nothing is left scheduled.
  expect(mosaic.frames).toHaveLength(0);
  const steps = new Set(mosaic.draws.map((draw) => draw.step));
  expect(steps).toEqual(new Set([1, 3, 6, manifest.tilePixels]));
  expect(mosaic.draws.some((draw) => draw.x === held.x && draw.y === held.y)).toBe(false);
  expect(controller.cellAt(30, 30)!.poster).toBe(held.poster);
  for (const index of [0, 5, 20, 49]) {
    if (index === held.index) continue;
    expect(manifest.posters[controller.cell(index)!.poster].topic).toBe("position");
  }

  // A wave that starts off screen waits for the mosaic to come back into view.
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  controller.wave(null);
  expect(mosaic.frames).toHaveLength(0);
  mosaic.observers.intersect!([{ isIntersecting: true }]);
  expect(mosaic.frames).toHaveLength(1);
});
