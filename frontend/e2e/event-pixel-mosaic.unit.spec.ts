import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import manifest from "../src/assets/event-mosaic-uwaterloo.json" with { type: "json" };

type Draw = { sx: number; sy: number; step: number; x: number; y: number; size: number };

/** Runs the mosaic engine against a recording canvas, a fake clock and controllable observers. */
function loadMosaic() {
  const draws: Draw[] = [];
  const frames: ((now: number) => void)[] = [];
  const observers: { intersect?: (entries: { isIntersecting: boolean }[]) => void } = {};
  const context = () => ({
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    clearRect: () => {},
    drawImage: (_source: unknown, sx: number, sy: number, step: number, _sh: number, x: number, y: number, size: number) => {
      draws.push({ sx, sy, step, x, y, size });
    },
  });
  const element = () => ({ width: 0, height: 0, style: {} as Record<string, string>, getContext: context });
  const document = { visibilityState: "visible", createElement: element, addEventListener: () => {}, removeEventListener: () => {} };
  const source = readFileSync(new URL("../src/features/landing/lib/eventPixelMosaic.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
  });
  const exports = {} as { startEventPixelMosaic: (...args: unknown[]) => () => void };
  runInNewContext(outputText, {
    exports,
    document,
    window: { devicePixelRatio: 1 },
    requestAnimationFrame: (callback: (now: number) => void) => frames.push(callback),
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observers.intersect = callback; }
      observe() {}
      disconnect() {}
    },
    Math, Uint16Array, Float32Array, Map,
  });
  const canvas = { ...element(), parentElement: { getBoundingClientRect: () => ({ width: 240, height: 120 }) } };
  const atlas = { image: {}, ...manifest };
  const look = { tileSize: 24, gutter: 1, waveSpeed: 12, twinkle: 0 };
  return { draws, frames, observers, start: (animate: boolean) => exports.startEventPixelMosaic(canvas, atlas, look, animate) };
}

test("the atlas packs several hundred real posters at a few pixels each", () => {
  expect(manifest.count).toBeGreaterThanOrEqual(300);
  expect(manifest.tilePixels).toBeLessThanOrEqual(16);
  expect(manifest.eventCount).toBeGreaterThanOrEqual(manifest.count);
});

test("reduced motion draws one still mosaic that fills its parent and never schedules a frame", () => {
  const mosaic = loadMosaic();
  mosaic.start(false);
  // 240 x 120 at 24px cells is a 10 x 5 grid, every cell a full-resolution poster inside its gutter.
  expect(mosaic.draws).toHaveLength(50);
  expect(mosaic.draws.every((draw) => draw.step === manifest.tilePixels && draw.size === 23)).toBe(true);
  expect(mosaic.frames).toHaveLength(0);
});

test("a wave swaps cells by resolving them from one colour to the full poster, and pauses off screen", () => {
  const mosaic = loadMosaic();
  mosaic.start(true);
  mosaic.draws.length = 0;
  let now = 0;
  for (let index = 0; index < 60; index += 1) {
    now += 50;
    mosaic.frames.shift()!(now);
  }
  const steps = new Set(mosaic.draws.map((draw) => draw.step));
  expect(steps).toEqual(new Set([1, 3, 6, manifest.tilePixels]));

  // Leaving the viewport stops scheduling frames until it comes back.
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  mosaic.frames.length = 0;
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  expect(mosaic.frames).toHaveLength(0);
  mosaic.observers.intersect!([{ isIntersecting: true }]);
  expect(mosaic.frames).toHaveLength(1);
});
