import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import manifest from "../src/assets/event-mosaic-uwaterloo.json" with { type: "json" };

type Draw = { source: unknown; sx: number; sy: number; pixels: number; x: number; y: number; size: number; alpha: number };
type Controller = { stop: () => void; setHover: (button: number | null) => void };
type Title = {
  titleColumns: (lead: string, phrases: readonly string[]) => number;
  rasterizeTitle: (line: string, columns: number) => Uint8Array;
  LINE_ROWS: number;
  TITLE_ROWS: number;
  splitInTwo: (text: string) => [string, string];
  lineColumns: (line: string) => number;
};
type Box = { left: number; top: number; columns: number; rows: number };
type Engine = {
  startEventPixelMosaic: (...args: unknown[]) => Controller;
  logoCells: (mask: readonly string[], columns: number, rows: number, box?: Box) => Uint8Array;
};

const clock = { now: 0 };

function transpile(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
}

/** The headline layout module, loaded on its own (its canvas helpers are not called in these tests). */
function loadTitle(): Title {
  const exports = {} as Title;
  runInNewContext(transpile("../src/features/landing/lib/eventMosaicTitle.ts"), { exports, Math });
  return exports;
}

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
  const document = { visibilityState: "visible", documentElement: { classList: { contains: () => false } }, createElement: element, addEventListener: () => {}, removeEventListener: () => {} };
  const exports = {} as Engine;
  const title = loadTitle();
  runInNewContext(transpile("../src/features/landing/lib/eventPixelMosaic.ts"), {
    exports,
    require: (id: string) => (id === "@/features/landing/lib/eventMosaicTitle" ? title : {}),
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
    atlas,
    start: (animate: boolean, logoRegion?: () => { left: number; top: number; width: number; height: number }) =>
      exports.startEventPixelMosaic(canvas, atlas, { tileSize: 24, gutter: 1, swapsPerSecond: 0.1 }, animate, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
        onDark: false,
        logoRegion,
      }),
  };
}

test("the atlas packs over a thousand real posters, each with the dominant colour that places it", () => {
  expect(manifest.posters.length).toBeGreaterThanOrEqual(1000);
  // Twice the largest cell the page draws (16 CSS px), so cells are crisp on a 2x screen.
  expect(manifest.tilePixels).toBeGreaterThanOrEqual(32);
  expect(manifest.eventCount).toBeGreaterThanOrEqual(manifest.posters.length);
  for (const poster of manifest.posters) {
    expect(poster.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(poster.share).toBeGreaterThan(0);
  }
  // Deep pools for the shapes: plenty of dark posters for the headline's letters.
  const lightness = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  expect(manifest.posters.filter((poster) => lightness(poster.colour) <= 0.2 && poster.share >= 0.35).length).toBeGreaterThanOrEqual(200);
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
  mosaic.start(false, () => ({ left: 0, top: 0, width: 480, height: 240 }));
  // Square draws only, not the one that copies the whole atlas into its greyscale twin.
  const logoDraws = mosaic.draws.filter((draw) => draw.source === mosaic.image && draw.pixels === manifest.tilePixels);
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

test("the mosaic keeps changing a few scattered squares at a time, each with a quick crossfade, and pauses off screen", () => {
  const mosaic = loadMosaic();
  clock.now = 0;
  mosaic.start(true);
  // It starts changing straight away.
  expect(mosaic.frames).toHaveLength(1);
  mosaic.draws.length = 0;
  for (let step = 0; step < 40; step += 1) {
    clock.now += 50;
    mosaic.frames.shift()!(clock.now);
  }
  const fades = mosaic.draws.filter((draw) => draw.alpha > 0 && draw.alpha < MUTED_FULL);
  expect(fades.length).toBeGreaterThan(0);
  // Over two seconds a few squares change, never the whole grid at once.
  const changed = new Set(mosaic.draws.map((draw) => `${draw.x},${draw.y}`));
  expect(changed.size).toBeGreaterThan(1);
  expect(changed.size).toBeLessThan(50);
  expect(mosaic.draws.filter((draw) => draw.size === 46).every((draw) => draw.pixels === manifest.tilePixels)).toBe(true);
  // It keeps going: a frame is always waiting while it is on screen.
  expect(mosaic.frames).toHaveLength(1);

  // Off screen it stops, and comes back when it scrolls into view.
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  mosaic.frames.length = 0;
  mosaic.observers.intersect!([{ isIntersecting: false }]);
  expect(mosaic.frames).toHaveLength(0);
  mosaic.observers.intersect!([{ isIntersecting: true }]);
  expect(mosaic.frames).toHaveLength(1);
});

test("the mosaic redraws at most about thirty times a second, however fast the screen refreshes", () => {
  const mosaic = loadMosaic();
  clock.now = 0;
  mosaic.start(true);
  let redraws = 0;
  // One second of a 120 Hz screen.
  for (let step = 0; step < 120; step += 1) {
    clock.now += 1000 / 120;
    mosaic.draws.length = 0;
    mosaic.frames.shift()!(clock.now);
    if (mosaic.draws.length > 0) redraws += 1;
  }
  expect(redraws).toBeGreaterThan(0);
  expect(redraws).toBeLessThanOrEqual(31);
  // Between redraws a frame is still always waiting.
  expect(mosaic.frames).toHaveLength(1);
});

test("a headline is spelled in a 5x7 pixel font, one cell per stroke, in capitals", () => {
  const title = loadTitle();
  // "NETWORKING EVENT": 15 letters five cells wide, a three-cell space, a cell between glyphs, a margin each side.
  expect(title.titleColumns("Every campus", ["event", "networking event"])).toBe(15 * 5 + 3 + 15 + 2);
  expect(title.TITLE_ROWS).toBe(2 * title.LINE_ROWS);

  // A lowercase "e" draws the capital, centred in its box.
  const ink = title.rasterizeTitle("e", 7);
  const rows = Array.from({ length: 7 }, (_, row) => [...ink.slice(row * 7, row * 7 + 7)].map((cell) => (cell ? "#" : ".")).join(""));
  expect(rows).toEqual([".#####.", ".#.....", ".#.....", ".####..", ".#.....", ".#.....", ".#####."]);
  expect([...ink.slice(7 * 7)].every((cell) => cell === 0)).toBe(true);
});

/** A muted cell's full strength (MUTED_ALPHA in the engine); a fade passes below it. */
const MUTED_FULL = 0.22;

test("a closing line splits into two balanced lines, at a word break where there is one", () => {
  const title = loadTitle();
  expect(title.splitInTwo("Stop finding out the day after.")).toEqual(["Stop finding out", "the day after."]);
  expect(title.splitInTwo("别再事后才知道")).toEqual(["别再事后", "才知道"]);
});

test("buttons are spelled in half-size squares inside a border, and a hover respells them", () => {
  const title = loadTitle();
  // "GO" is two glyphs; hovered, "GO →" adds a space and the six-cell arrow.
  expect(title.lineColumns("GO →")).toBe(5 + 1 + 5 + 1 + 3 + 1 + 6);

  const mosaic = loadMosaic(480, 240);
  const layouts: unknown[] = [];
  const buttons = (width: number) => ({
    items: [{ label: "GO", hoverLabel: "GO →" }],
    region: () => ({ left: 0, top: 0, width, height: 240 }),
    onLayout: (layout: unknown) => layouts.push(layout),
  });
  const start = (width: number) =>
    mosaic.engine.startEventPixelMosaic(mosaic.canvas, mosaic.atlas, { tileSize: 24, gutter: 1, swapsPerSecond: 0.1 }, false, {
      posters: manifest.posters,
      logoMask: manifest.logoMask,
      logoColours: manifest.logoColours,
      onDark: false,
      buttons: buttons(width),
    });

  const controller = start(480);
  // The widest label, padding and border: 32 squares of 12 px across (16 grid squares), centred; 14 down.
  // On the 2x backing store a half square draws 23 px (its 12 px less its share of the gutter, doubled).
  expect(layouts.at(-1)).toEqual({ height: 7 * 24, rects: [{ left: 2 * 24, top: 0, width: 16 * 24, height: 7 * 24 }] });
  const halfSquares = mosaic.draws.filter((draw) => draw.size === 23);
  expect(halfSquares.length).toBe(32 * 14);
  // Its border and label are full-colour posters; the rest of it is muted like the grid.
  const lit = halfSquares.filter((draw) => draw.source === mosaic.image);
  expect(lit.length).toBeGreaterThan(2 * 32 + 2 * 12);
  expect(lit.length).toBeLessThan(32 * 14 / 2);

  // Still under reduced motion, a hover jumps straight to the hovered label.
  mosaic.draws.length = 0;
  controller.setHover(0);
  expect(mosaic.draws.length).toBeGreaterThan(10);
  mosaic.draws.length = 0;
  controller.setHover(0);
  expect(mosaic.draws).toHaveLength(0);

  // A region too narrow for even one button draws none, and says so.
  start(200);
  expect(layouts.at(-1)).toBeNull();
});

test("a hovered button's label glides by fading its squares, never moving them, and glides back on leaving", () => {
  const mosaic = loadMosaic(480, 240);
  clock.now = 0;
  // No background swaps, so every draw below is the label gliding.
  const controller = mosaic.engine.startEventPixelMosaic(mosaic.canvas, mosaic.atlas, { tileSize: 24, gutter: 1, swapsPerSecond: 0 }, true, {
    posters: manifest.posters,
    logoMask: manifest.logoMask,
    logoColours: manifest.logoColours,
    onDark: false,
    buttons: {
      items: [{ label: "GO", hoverLabel: "GO →" }],
      region: () => ({ left: 0, top: 0, width: 480, height: 240 }),
      onLayout: () => {},
    },
  });
  /** The draws of each of the next `count` frames, 30 ms apart. */
  const run = (count: number) => Array.from({ length: count }, () => {
    clock.now += 30;
    mosaic.draws.length = 0;
    mosaic.frames.shift()!(clock.now);
    return [...mosaic.draws];
  });
  // The first frame only starts the clock.
  run(1);
  // "GO" sits 9 squares into the button and "GO →" 4: five squares at 60 ms each, so ten 30 ms frames.
  controller.setHover(0);
  const over = run(12);
  expect(over.slice(0, 10).every((draws) => draws.length > 0)).toBe(true);
  expect(over.slice(10).every((draws) => draws.length === 0)).toBe(true);
  // Only the button's half-size squares redraw, in place; mid-glide some show part of their colour.
  const glided = over.slice(0, 10).flat();
  expect(glided.every((draw) => draw.size === 23)).toBe(true);
  expect(glided.some((draw) => draw.source === mosaic.image && draw.alpha > 0 && draw.alpha < 1)).toBe(true);

  controller.setHover(null);
  const back = run(12);
  expect(back.slice(0, 10).every((draws) => draws.length > 0)).toBe(true);
  expect(back.slice(10).every((draws) => draws.length === 0)).toBe(true);
});
