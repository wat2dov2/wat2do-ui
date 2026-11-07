/**
 * Draws a grid of real event posters onto one canvas. The grid is still until
 * a wave is asked for: then a front sweeps across it and each cell it passes
 * resolves, from one colour through coarse pixels, to its next poster. A wave
 * can refill the grid with one topic's posters, so the hero's mosaic changes
 * with its headline.
 *
 * All posters come from one atlas (`npm run build-event-mosaic`), so the page
 * loads a single image however many cells it shows. A tiny copy of the atlas
 * paints first; the full one replaces it when it arrives.
 */

export interface MosaicAtlas {
  image: CanvasImageSource;
  /** Pixels per poster side in this atlas. */
  tilePixels: number;
  /** Posters per atlas row. */
  columns: number;
  count: number;
}

/**
 * - `full`: every cell in full colour.
 * - `muted`: every cell greyed and faded into the surface behind it.
 * - `logo`: cells on the Wat2Do logo in its own colours, the rest muted, so the logo reads out of the grid.
 */
export type MosaicTone = "full" | "muted" | "logo";

export interface MosaicLook {
  /** CSS pixels per cell side. */
  tileSize: number;
  /** CSS pixels of surface left between cells, so the grid reads as cells. */
  gutter: number;
  /** How long a wave takes to cross the grid. */
  waveMs: number;
  /** A wave of the whole collection runs on its own this often; none when left out. */
  idleWaveMs?: number;
  tone: MosaicTone;
}

/** What the mosaic needs to know about each poster and about the logo it can draw. */
export interface MosaicContent {
  /** Each poster's average colour (#rrggbb) and topic, in atlas order. */
  posters: readonly { colour: string; topic: string | null }[];
  /** The logo as rows of colour letters, "." for paper. */
  logoMask: readonly string[];
  /** Each logo colour letter's brand colour. */
  logoColours: Readonly<Record<string, string>>;
  /** Where the logo goes, in CSS pixels relative to the canvas; none draws no logo. */
  logoRegion?: () => { left: number; top: number; width: number; height: number } | null;
}

export interface MosaicCell {
  /** Cell index, row by row. */
  index: number;
  /** Poster index into the manifest. */
  poster: number;
  /** The cell's box in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  size: number;
}

export interface MosaicController {
  stop: () => void;
  /** Replaces the atlas (the full one after the first-paint copy) and redraws every cell. */
  setAtlas: (atlas: MosaicAtlas) => void;
  /** Sweeps a wave across the grid that refills it with one topic's posters, or every poster for null. */
  wave: (topic: string | null) => void;
  /** The cell under a point in CSS pixels relative to the canvas, or null past the grid. */
  cellAt: (x: number, y: number) => MosaicCell | null;
  /** The cell at an index, or null past the grid. */
  cell: (index: number) => MosaicCell | null;
  columns: () => number;
  /** Holds one cell's poster still (while someone is looking at it); null releases it. */
  pin: (index: number | null) => void;
}

/** How long one cell takes to resolve, and the coarse steps it shows on the way. */
const RESOLVE_MS = 420;
const RESOLVE_STEPS = [1, 3, 6] as const;
/** How strongly muted cells show through the surface behind them. */
const MUTED_ALPHA = 0.3;
/** How much of the brand colour washes over a logo cell's poster, so the shape reads in the logo's colours. */
const LOGO_TINT_ALPHA = 0.45;
/** Logo cells choose among this many of their topic's posters closest to their brand colour. */
const LOGO_CANDIDATES = 12;

interface AtlasSet {
  atlas: MosaicAtlas;
  grey: HTMLCanvasElement | null;
  /** The atlas at each coarse step, in colour and in grey. */
  levels: HTMLCanvasElement[];
  greyLevels: HTMLCanvasElement[];
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function atlasRows({ count, columns }: MosaicAtlas) {
  return Math.ceil(count / columns);
}

/** A greyscale copy of the atlas for muted cells (CSS filters on canvas are not supported everywhere). */
function greyscale(atlas: MosaicAtlas): HTMLCanvasElement {
  const width = atlas.columns * atlas.tilePixels;
  const height = atlasRows(atlas) * atlas.tilePixels;
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(atlas.image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    data[offset] = data[offset + 1] = data[offset + 2] = luminance;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** The atlas at each coarser resolution a swap passes through, so a step is one drawImage. */
function levelsOf(source: CanvasImageSource, atlas: MosaicAtlas): HTMLCanvasElement[] {
  return RESOLVE_STEPS.map((step) => {
    const level = canvasOf(atlas.columns * step, atlasRows(atlas) * step);
    const context = level.getContext("2d")!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, atlas.columns * atlas.tilePixels, atlasRows(atlas) * atlas.tilePixels, 0, 0, level.width, level.height);
    return level;
  });
}

function prepare(atlas: MosaicAtlas, tone: MosaicTone, animate: boolean): AtlasSet {
  const grey = tone === "full" ? null : greyscale(atlas);
  return {
    atlas,
    grey,
    // A still mosaic never resolves a swap, so it skips the coarser copies.
    levels: animate && tone !== "muted" ? levelsOf(atlas.image, atlas) : [],
    greyLevels: animate && grey ? levelsOf(grey, atlas) : [],
  };
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Which colour letter of the logo each cell of a columns x rows grid takes, or
 * 0 for none: the logo centred in the given box of cells, keeping its shape,
 * each cell taking the letter most of it shows.
 */
export function logoCells(
  mask: readonly string[],
  columns: number,
  rows: number,
  box = { left: 0, top: 0, columns, rows },
): Uint8Array {
  const cells = new Uint8Array(columns * rows);
  const maskHeight = mask.length;
  const maskWidth = mask[0]?.length ?? 0;
  if (!maskWidth || box.rows < 3 || box.columns < 3) return cells;
  const scale = Math.min(box.columns / maskWidth, box.rows / maskHeight);
  const left = box.left + (box.columns - maskWidth * scale) / 2;
  const top = box.top + (box.rows - maskHeight * scale) / 2;
  const letterAt = (x: number, y: number) => {
    const mx = Math.floor((x - left) / scale);
    const my = Math.floor((y - top) / scale);
    if (mx < 0 || my < 0 || mx >= maskWidth || my >= maskHeight) return ".";
    return mask[my][mx];
  };
  for (let row = Math.max(0, box.top); row < Math.min(rows, box.top + box.rows); row += 1) {
    for (let column = Math.max(0, box.left); column < Math.min(columns, box.left + box.columns); column += 1) {
      // Nine samples across the cell; a letter needs most of them.
      const votes = new Map<string, number>();
      for (let sy = 1; sy <= 3; sy += 1) {
        for (let sx = 1; sx <= 3; sx += 1) {
          const letter = letterAt(column + sx / 4, row + sy / 4);
          votes.set(letter, (votes.get(letter) ?? 0) + 1);
        }
      }
      let best = ".";
      let bestVotes = 0;
      votes.forEach((count, letter) => {
        if (count > bestVotes) [best, bestVotes] = [letter, count];
      });
      if (best !== "." && bestVotes >= 4) cells[row * columns + column] = best.charCodeAt(0);
    }
  }
  return cells;
}

/**
 * Starts the mosaic on `canvas`, sized to its parent. With `animate` false it
 * draws one still mosaic of every poster and never runs a wave.
 */
export function startEventPixelMosaic(
  canvas: HTMLCanvasElement,
  firstAtlas: MosaicAtlas,
  look: MosaicLook,
  animate: boolean,
  content: MosaicContent,
): MosaicController {
  const context = canvas.getContext("2d");
  const parent = canvas.parentElement;
  const idle: MosaicController = { stop: () => {}, setAtlas: () => {}, wave: () => {}, cellAt: () => null, cell: () => null, columns: () => 0, pin: () => {} };
  if (!context || !parent) return idle;

  let set = prepare(firstAtlas, look.tone, animate);
  const count = Math.min(firstAtlas.count, content.posters.length);
  const posterColours = content.posters.slice(0, count).map(({ colour }) => rgb(colour));
  /** Poster indices per topic, null for all of them. */
  const topics = new Map<string | null, number[]>([[null, Array.from({ length: count }, (_, index) => index)]]);
  content.posters.slice(0, count).forEach(({ topic }, index) => {
    if (topic) topics.set(topic, [...(topics.get(topic) ?? []), index]);
  });
  /** Per topic and logo letter, the posters closest to that letter's brand colour. */
  const logoChoices = new Map<string, number[]>();
  const logoChoicesFor = (topic: string | null, letter: string) => {
    const key = `${topic}:${letter}`;
    let choices = logoChoices.get(key);
    if (!choices) {
      const [r, g, b] = rgb(content.logoColours[letter] ?? "#000000");
      const distance = (poster: number) => {
        const [pr, pg, pb] = posterColours[poster];
        return (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
      };
      choices = [...(topics.get(topic) ?? topics.get(null)!)].sort((a, b) => distance(a) - distance(b)).slice(0, LOGO_CANDIDATES);
      logoChoices.set(key, choices);
    }
    return choices;
  };

  let columns = 0;
  let rows = 0;
  let scale = 1;
  let posters = new Uint16Array(0);
  /** Each cell's logo letter as a char code, or 0 off the logo. */
  let logo: Uint8Array = new Uint8Array(0);
  /** Each cell's place along the wave's diagonal, with jitter so the front frays like a real wave. */
  let wavePlace = new Float32Array(0);
  let waveSpan = 1;
  /** The posters the running wave is bringing in, and when it started. */
  let incoming: Uint16Array | null = null;
  let waveStart = 0;
  /** Cells mid-swap, by index, to the time their swap started. */
  const resolving = new Map<number, number>();
  let pinned: number | null = null;
  let frame = 0;
  let visible = true;
  let idleTimer: number | undefined;

  const pick = (index: number, topic: string | null) => {
    const letter = logo[index];
    const pool = letter ? logoChoicesFor(topic, String.fromCharCode(letter)) : topics.get(topic) ?? topics.get(null)!;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  const fill = (topic: string | null) => Uint16Array.from({ length: columns * rows }, (_, index) => pick(index, topic));

  /** Draws one cell; a coarse `step` shows a stage of a swap. */
  function drawTile(index: number, step?: number) {
    const { atlas } = set;
    const letter = logo[index];
    const colour = look.tone === "full" || letter !== 0;
    const levelIndex = step === undefined ? -1 : RESOLVE_STEPS.indexOf(step as (typeof RESOLVE_STEPS)[number]);
    const coarse = levelIndex >= 0 ? (colour ? set.levels : set.greyLevels)[levelIndex] : undefined;
    const source = coarse ?? (colour ? atlas.image : set.grey ?? atlas.image);
    const pixels = coarse ? RESOLVE_STEPS[levelIndex] : atlas.tilePixels;
    const poster = posters[index];
    const x = (index % columns) * look.tileSize * scale;
    const y = Math.floor(index / columns) * look.tileSize * scale;
    const size = (look.tileSize - look.gutter) * scale;
    context!.clearRect(x, y, look.tileSize * scale, look.tileSize * scale);
    context!.globalAlpha = colour ? 1 : MUTED_ALPHA;
    // Coarse stages stay blocky on purpose; the finished poster is drawn smooth.
    context!.imageSmoothingEnabled = !coarse;
    context!.drawImage(source, (poster % atlas.columns) * pixels, Math.floor(poster / atlas.columns) * pixels, pixels, pixels, x, y, size, size);
    if (letter) {
      context!.globalAlpha = LOGO_TINT_ALPHA;
      context!.fillStyle = content.logoColours[String.fromCharCode(letter)] ?? "transparent";
      context!.fillRect(x, y, size, size);
    }
    context!.globalAlpha = 1;
  }

  function drawAll() {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < posters.length; index += 1) drawTile(index);
  }

  function resize() {
    const { width, height } = parent!.getBoundingClientRect();
    scale = Math.min(window.devicePixelRatio || 1, 2);
    columns = Math.max(1, Math.ceil(width / look.tileSize));
    rows = Math.max(1, Math.ceil(height / look.tileSize));
    canvas.width = Math.round(columns * look.tileSize * scale);
    canvas.height = Math.round(rows * look.tileSize * scale);
    canvas.style.width = `${columns * look.tileSize}px`;
    canvas.style.height = `${rows * look.tileSize}px`;
    context!.imageSmoothingQuality = "high";
    const region = look.tone === "logo" ? content.logoRegion?.() : null;
    logo = region
      ? logoCells(content.logoMask, columns, rows, {
        left: Math.round(region.left / look.tileSize),
        top: Math.round(region.top / look.tileSize),
        columns: Math.floor(region.width / look.tileSize),
        rows: Math.floor(region.height / look.tileSize),
      })
      : new Uint8Array(columns * rows);
    posters = fill(null);
    wavePlace = Float32Array.from({ length: columns * rows }, (_, index) =>
      (index % columns) + Math.floor(index / columns) * 0.6 + Math.random() * 3);
    waveSpan = columns + rows * 0.6 + 3;
    incoming = null;
    resolving.clear();
    drawAll();
  }

  function tick(now: number) {
    frame = 0;
    if (incoming) {
      const front = ((now - waveStart) / look.waveMs) * waveSpan;
      for (let index = 0; index < posters.length; index += 1) {
        if (wavePlace[index] <= front && posters[index] !== incoming[index] && index !== pinned && !resolving.has(index)) {
          posters[index] = incoming[index];
          resolving.set(index, now);
        }
      }
      if (front > waveSpan) incoming = null;
    }
    for (const [index, start] of resolving) {
      const progress = (now - start) / RESOLVE_MS;
      if (progress >= 1) {
        drawTile(index);
        resolving.delete(index);
      } else {
        drawTile(index, RESOLVE_STEPS[Math.min(RESOLVE_STEPS.length - 1, Math.floor(progress * RESOLVE_STEPS.length))]);
      }
    }
    // Between waves nothing is scheduled at all.
    if (incoming || resolving.size) schedule();
  }

  function schedule() {
    if (!frame && visible && document.visibilityState === "visible") frame = requestAnimationFrame(tick);
  }

  function scheduleIdleWave() {
    window.clearTimeout(idleTimer);
    if (!animate || !look.idleWaveMs) return;
    idleTimer = window.setTimeout(() => {
      wave(null);
      scheduleIdleWave();
    }, look.idleWaveMs);
  }

  function wave(topic: string | null) {
    if (!animate) return;
    incoming = fill(topic);
    waveStart = performance.now();
    schedule();
  }

  function onVisibility() {
    if (frame && (!visible || document.visibilityState !== "visible")) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (incoming || resolving.size) schedule();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(parent);
  resize();

  // Off screen or in a background tab, nothing is drawn at all.
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    onVisibility();
  });
  intersectionObserver.observe(canvas);
  document.addEventListener("visibilitychange", onVisibility);
  scheduleIdleWave();

  const cell = (index: number): MosaicCell | null => {
    if (index < 0 || index >= posters.length) return null;
    return {
      index,
      poster: posters[index],
      x: (index % columns) * look.tileSize,
      y: Math.floor(index / columns) * look.tileSize,
      size: look.tileSize - look.gutter,
    };
  };

  return {
    stop: () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    setAtlas: (atlas) => {
      set = prepare(atlas, look.tone, animate);
      drawAll();
    },
    wave,
    cellAt: (x, y) => {
      if (x < 0 || y < 0) return null;
      const column = Math.floor(x / look.tileSize);
      const row = Math.floor(y / look.tileSize);
      return column < columns && row < rows ? cell(row * columns + column) : null;
    },
    cell,
    columns: () => columns,
    pin: (index) => {
      pinned = index;
      if (index !== null && resolving.has(index)) {
        resolving.delete(index);
        drawTile(index);
      }
    },
  };
}
