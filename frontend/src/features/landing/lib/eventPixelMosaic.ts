/**
 * Draws a grid of real event posters onto one canvas. The grid is still until
 * a wave is asked for: then a front sweeps across it and each cell it passes
 * crossfades to its next poster. A wave can refill the grid with one topic's
 * posters, so the hero's mosaic changes with its headline.
 *
 * Posters are drawn as they are, smoothed from an atlas at least twice the
 * cell size, onto a canvas backed at the screen's pixel ratio. The Wat2Do
 * logo reads out of the grid only because the cells on it are given posters
 * whose own dominant colour matches that part of the logo; nothing is tinted.
 *
 * All posters come from one atlas (`npm run build-event-mosaic`), so the page
 * loads a single image however many cells it shows. A small copy of the atlas
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
 * - `muted`: every cell greyed and faded into the surface behind it.
 * - `logo`: cells on the Wat2Do logo in full colour, the rest muted, so the logo reads out of the grid.
 */
export type MosaicTone = "muted" | "logo";

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
  /** Each poster's dominant colour (#rrggbb), the share of the poster it covers, and its topic, in atlas order. */
  posters: readonly { colour: string; colourShare: number; topic: string | null }[];
  /** The logo as rows of colour letters, "." for paper. */
  logoMask: readonly string[];
  /** Each logo colour letter's brand colour. */
  logoColours: Readonly<Record<string, string>>;
  /** Where the logo goes, in CSS pixels relative to the canvas; none draws no logo. */
  logoRegion?: () => { left: number; top: number; width: number; height: number } | null;
}

export interface MosaicController {
  stop: () => void;
  /** Replaces the atlas (the full one after the first-paint copy) and redraws every cell. */
  setAtlas: (atlas: MosaicAtlas) => void;
  /** Sweeps a wave across the grid that refills it with one topic's posters, or every poster for null. */
  wave: (topic: string | null) => void;
}

/** How long one cell takes to crossfade to its next poster. */
const FADE_MS = 420;
/** How strongly muted cells show through the surface behind them. */
const MUTED_ALPHA = 0.3;
/** A poster counts as wearing a logo colour when its dominant colour is this near (RGB distance). */
const LOGO_MATCH_DISTANCE = 110;
/** Logo cells choose among this many matching posters; a topic with fewer borrows from the whole collection. */
const LOGO_CANDIDATES = 12;

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A greyscale copy of the atlas for muted cells (CSS filters on canvas are not supported everywhere). */
function greyscale(atlas: MosaicAtlas): HTMLCanvasElement {
  const width = atlas.columns * atlas.tilePixels;
  const height = Math.ceil(atlas.count / atlas.columns) * atlas.tilePixels;
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
  if (!context || !parent) return { stop: () => {}, setAtlas: () => {}, wave: () => {} };

  let atlas = firstAtlas;
  let grey = greyscale(firstAtlas);
  const count = Math.min(firstAtlas.count, content.posters.length);
  /** Poster indices per topic, null for all of them. */
  const topics = new Map<string | null, number[]>([[null, Array.from({ length: count }, (_, index) => index)]]);
  content.posters.slice(0, count).forEach(({ topic }, index) => {
    if (topic) topics.set(topic, [...(topics.get(topic) ?? []), index]);
  });

  /**
   * Per topic and logo letter, the posters whose dominant colour best matches
   * that letter's brand colour, weighted by how much of the poster it covers.
   * When the topic has too few close matches, the closest from the whole
   * collection fill in, so the logo stays legible without touching a poster.
   */
  const logoChoices = new Map<string, number[]>();
  const logoChoicesFor = (topic: string | null, letter: string) => {
    const key = `${topic}:${letter}`;
    let choices = logoChoices.get(key);
    if (!choices) {
      const [r, g, b] = rgb(content.logoColours[letter] ?? "#000000");
      const distance = (poster: number) => {
        const [pr, pg, pb] = rgb(content.posters[poster].colour);
        return Math.hypot(pr - r, pg - g, pb - b);
      };
      const score = (poster: number) => distance(poster) / Math.max(0.2, content.posters[poster].colourShare);
      const rank = (pool: readonly number[]) => [...pool].sort((a, c) => score(a) - score(c));
      const own = rank(topics.get(topic) ?? []).filter((poster) => distance(poster) <= LOGO_MATCH_DISTANCE);
      const borrowed = rank(topics.get(null)!).filter((poster) => !own.includes(poster));
      choices = [...own, ...borrowed].slice(0, LOGO_CANDIDATES);
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
  /** Cells mid-fade, by index, to the poster they are leaving and when they started. */
  const fading = new Map<number, { from: number; start: number }>();
  let frame = 0;
  let visible = true;
  let idleTimer: number | undefined;

  const pick = (index: number, topic: string | null) => {
    const letter = logo[index];
    const pool = letter ? logoChoicesFor(topic, String.fromCharCode(letter)) : topics.get(topic) ?? topics.get(null)!;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  const fill = (topic: string | null) => Uint16Array.from({ length: columns * rows }, (_, index) => pick(index, topic));

  function drawPoster(index: number, poster: number, alpha: number) {
    const colour = logo[index] !== 0;
    const x = (index % columns) * look.tileSize * scale;
    const y = Math.floor(index / columns) * look.tileSize * scale;
    const size = (look.tileSize - look.gutter) * scale;
    const { tilePixels, columns: atlasColumns } = atlas;
    context!.globalAlpha = alpha * (colour ? 1 : MUTED_ALPHA);
    context!.drawImage(
      colour ? atlas.image : grey,
      (poster % atlasColumns) * tilePixels, Math.floor(poster / atlasColumns) * tilePixels, tilePixels, tilePixels,
      x, y, size, size,
    );
  }

  /** Draws one cell, crossfading from the poster it is leaving while `progress` runs from 0 to 1. */
  function drawCell(index: number, fade?: { from: number; progress: number }) {
    const x = (index % columns) * look.tileSize * scale;
    const y = Math.floor(index / columns) * look.tileSize * scale;
    context!.clearRect(x, y, look.tileSize * scale, look.tileSize * scale);
    if (fade) drawPoster(index, fade.from, 1 - fade.progress);
    drawPoster(index, posters[index], fade ? fade.progress : 1);
    context!.globalAlpha = 1;
  }

  function drawAll() {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < posters.length; index += 1) drawCell(index);
  }

  function resize() {
    const { width, height } = parent!.getBoundingClientRect();
    // The backing store matches the screen's pixels, so a 2x screen draws every cell from twice its CSS size.
    scale = Math.min(window.devicePixelRatio || 1, 3);
    columns = Math.max(1, Math.ceil(width / look.tileSize));
    rows = Math.max(1, Math.ceil(height / look.tileSize));
    canvas.width = Math.round(columns * look.tileSize * scale);
    canvas.height = Math.round(rows * look.tileSize * scale);
    canvas.style.width = `${columns * look.tileSize}px`;
    canvas.style.height = `${rows * look.tileSize}px`;
    // Resizing the backing store resets the context, smoothing included.
    context!.imageSmoothingEnabled = true;
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
    fading.clear();
    drawAll();
  }

  function tick(now: number) {
    frame = 0;
    if (incoming) {
      const front = ((now - waveStart) / look.waveMs) * waveSpan;
      for (let index = 0; index < posters.length; index += 1) {
        if (wavePlace[index] <= front && posters[index] !== incoming[index] && !fading.has(index)) {
          fading.set(index, { from: posters[index], start: now });
          posters[index] = incoming[index];
        }
      }
      if (front > waveSpan) incoming = null;
    }
    for (const [index, { from, start }] of fading) {
      const progress = Math.min(1, (now - start) / FADE_MS);
      drawCell(index, progress < 1 ? { from, progress } : undefined);
      if (progress >= 1) fading.delete(index);
    }
    // Between waves nothing is scheduled at all.
    if (incoming || fading.size) schedule();
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
    if (incoming || fading.size) schedule();
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

  return {
    stop: () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(idleTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    setAtlas: (next) => {
      atlas = next;
      grey = greyscale(next);
      drawAll();
    },
    wave,
  };
}
