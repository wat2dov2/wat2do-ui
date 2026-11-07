import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import manifest from "../src/assets/event-mosaic-uwaterloo.json" with { type: "json" };

type Draw = { source: unknown; sx: number; sy: number; pixels: number; x: number; y: number; size: number; alpha: number };
type Controller = { stop: () => void; wave: (topic: string | null) => void };
type Box = { left: number; top: number; columns: number; rows: number };
type Engine = {
  startEventPixelMosaic: (...args: unknown[]) => Controller;
  logoCells: (mask: readonly string[], columns: number, rows: number, box?: Box) => Uint8Array;
};

const clock = { now: 0 };

/** Runs the mosaic engine against a recording canvas, a fake clock and controllable observers. */
function loadMosaic(width = 240, height = 120) {
  const draws: Draw[] = [];
  const frames: ((now: number) => void)[] = [];
  const observers: { intersect?: (entries: { isIntersecting: boolean }[]) => void } = {};
  const contexts: { imageSmoothingEnabled: boolean; imageSmoothingQuality: string }[] = [];
  const context = () => {
    const state = { globalAlpha: 1, imageSmoothingEnabled: true, imageSmoothingQuality: "low" };
    contexts.push(state);
    return Object.assign(state, {
      clearRect: () => {},
      drawImage: (source: unknown, sx: number, sy: number, pixels: number, _sh: number, x: number, y: number, size: number) => {
        draws.push({ source, sx, sy, pixels, x, y, size, alpha: state.globalAlpha });
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
    window: { devicePixelRatio: 2, setTimeout: () => 0, clearTimeout: () => {} },
    performance: { now: () => clock.now },
    requestAnimationFrame: (callback: (now: number) => void) => frames.push(callback),
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observers.intersect = callback; }
      observe() {}
      disconnect() {}
    },
    Math, Uint8Array, Uint8ClampedArray, Uint16Array, Float32Array, Map, Number, String,
  });
  const image = { kind: "atlas" };
  const canvas = { ...element(), parentElement: { getBoundingClientRect: () => ({ width, height }) } };
  const atlas = { image, tilePixels: manifest.tilePixels, columns: manifest.columns, count: manifest.posters.length };
  return {
    draws,
    frames,
    observers,
    contexts,
    canvas,
    image,
    engine: exports,
    start: (animate: boolean, tone = "muted", logoRegion?: () => { left: number; top: number; width: number; height: number }) =>
      exports.startEventPixelMosaic(canvas, atlas, { tileSize: 24, gutter: 1, waveMs: 900, tone }, animate, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
        logoRegion,
      }),
  };
}

test("the atlas packs a few hundred real posters, each with the public event or position it came from", () => {
  expect(manifest.posters.length).toBeGreaterThanOrEqual(250);
  // Twice the largest cell the page draws (36 CSS px), so cells are crisp on a 2x screen.
  expect(manifest.tilePixels).toBeGreaterThanOrEqual(72);
  // Each headline topic has enough posters of its own for a wave.
  for (const topic of ["networking", "social", "position"]) {
    expect(manifest.posters.filter((poster) => poster.topic === topic).length).toBeGreaterThanOrEqual(40);
  }
  expect(manifest.eventCount).toBeGreaterThanOrEqual(manifest.posters.length);
  for (const poster of manifest.posters) {
    expect(poster.id).toBeGreaterThan(0);
    expect(poster.title.length).toBeGreaterThan(0);
    if (poster.kind === "event") expect(Number.isNaN(Date.parse(poster.start!))).toBe(false);
    expect(poster.image).toMatch(/^https:\/\//);
    expect(poster.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(poster.colourShare).toBeGreaterThan(0);
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
  const boxed = engine.logoCells(manifest.logoMask, columns, rows, { left: 10, top: 2, columns: 40, rows: 12 });
  boxed.forEach((value, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (value) expect(column >= 10 && column < 50 && row >= 2 && row < 14).toBe(true);
  });
});

test("reduced motion draws one still mosaic at the screen's pixel ratio, smoothed, and never schedules a frame", () => {
  const mosaic = loadMosaic();
  mosaic.start(false);
  // 240 x 120 at 24px cells is a 10 x 5 grid, drawn on a backing store twice its CSS size.
  expect(mosaic.canvas.width).toBe(480);
  const cells = mosaic.draws.filter((draw) => draw.pixels === manifest.tilePixels);
  expect(cells).toHaveLength(50);
  expect(cells.every((draw) => draw.size === 46)).toBe(true);
  // The first context is the visible canvas; later ones are the greyscale copy.
  expect(mosaic.contexts[0]).toMatchObject({ imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
  expect(mosaic.frames).toHaveLength(0);
});

test("logo cells are untouched posters whose own colour matches the logo, the rest are muted", () => {
  const mosaic = loadMosaic(480, 240);
  mosaic.start(false, "logo", () => ({ left: 0, top: 0, width: 480, height: 240 }));
  const logoDraws = mosaic.draws.filter((draw) => draw.source === mosaic.image);
  const mutedDraws = mosaic.draws.filter((draw) => draw.source !== mosaic.image);
  expect(logoDraws.length).toBeGreaterThan(10);
  // Drawn as they are: full strength, never washed with a colour.
  expect(logoDraws.every((draw) => draw.alpha === 1)).toBe(true);
  expect(mutedDraws.every((draw) => draw.alpha < 0.5)).toBe(true);
  // Every poster on the logo is one of the closest in colour to some part of it.
  const near = (poster: (typeof manifest.posters)[number]) => {
    const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(poster.colour.slice(start, start + 2), 16));
    return Object.values(manifest.logoColours).some((hex) => {
      const [lr, lg, lb] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
      return Math.hypot(r - lr, g - lg, b - lb) < 160;
    });
  };
  for (const draw of logoDraws) {
    const poster = manifest.posters[(draw.sy / manifest.tilePixels) * manifest.columns + draw.sx / manifest.tilePixels];
    expect(near(poster)).toBe(true);
  }
});

test("the grid is still until a wave is asked for; a wave crossfades cells to one topic, then stops", () => {
  const mosaic = loadMosaic();
  mosaic.start(true);
  expect(mosaic.frames).toHaveLength(0);

  mosaic.draws.length = 0;
  clock.now = 0;
  const controller = mosaic.start(true);
  mosaic.draws.length = 0;
  controller.wave("position");
  for (let step = 0; step < 80 && mosaic.frames.length; step += 1) {
    clock.now += 50;
    mosaic.frames.shift()!(clock.now);
  }
  // The wave ran its course and nothing is left scheduled.
  expect(mosaic.frames).toHaveLength(0);
  // A fade draws both posters at partial strength; nothing is ever drawn from a coarse copy.
  expect(mosaic.draws.some((draw) => draw.alpha > 0 && draw.alpha < MUTED_FULL)).toBe(true);
  expect(mosaic.draws.filter((draw) => draw.size === 46).every((draw) => draw.pixels === manifest.tilePixels)).toBe(true);

  // A wave that starts off screen waits for the mosaic to come back into view.
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  controller.wave(null);
  expect(mosaic.frames).toHaveLength(0);
  mosaic.observers.intersect!([{ isIntersecting: true }]);
  expect(mosaic.frames).toHaveLength(1);
});

/** A muted cell's full strength (MUTED_ALPHA in the engine); a fade passes below it. */
const MUTED_FULL = 0.3;
