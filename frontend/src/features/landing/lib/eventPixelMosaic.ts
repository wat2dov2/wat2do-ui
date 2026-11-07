/**
 * Draws a grid of real event posters onto one canvas that never stops
 * changing: a few squares at a time, scattered all over the grid, each swap
 * to another poster with a quick crossfade of that one square.
 *
 * Posters are drawn as they are, smoothed from an atlas at least twice the
 * cell size, onto a canvas backed at the screen's pixel ratio. The Wat2Do
 * logo reads out of the grid only because the cells on it are given posters
 * whose own dominant colour matches that part of the logo; nothing is tinted.
 * A headline is spelled the same way, in the heading's own typeface, out of
 * dark posters only, and its squares only ever swap among those, so the shapes
 * always stay legible. The phrase below its lead takes turns, respelling
 * square by square at scattered moments, never as a sweep.
 *
 * Squares avoid showing a poster that is already on screen while the posters
 * that keep their shape allow it, so the grid shows as many images as it can.
 *
 * All posters come from one atlas (`npm run build-event-mosaic`), so the page
 * loads a single image however many cells it shows. A small copy of the atlas
 * paints first; the full one replaces it when it arrives.
 */

import { canvasMeasure, layoutMosaicTitle, rasterizeTitle } from "@/features/landing/lib/eventMosaicTitle";

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
 * - `logo`: cells on the Wat2Do logo and the headline in full colour, the rest muted, so the shapes read out of the grid.
 */
export type MosaicTone = "muted" | "logo";

export interface MosaicLook {
  /** CSS pixels per cell side; a headline that needs finer cells to be legible gets them. */
  tileSize: number;
  /** CSS pixels of surface left between cells, so the grid reads as cells. */
  gutter: number;
  /** Share of the grid's cells that swap each second. */
  swapsPerSecond: number;
  tone: MosaicTone;
}

export interface MosaicRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the mosaic needs to know about each poster and about the shapes it can draw. */
export interface MosaicContent {
  /** Each poster's dominant colour (#rrggbb) and the share of the poster it covers, in atlas order. */
  posters: readonly { colour: string; share: number }[];
  /** The logo as rows of colour letters, "." for paper. */
  logoMask: readonly string[];
  /** Each logo colour letter's brand colour. */
  logoColours: Readonly<Record<string, string>>;
  /** Where the logo goes, in CSS pixels relative to the canvas; none draws no logo. */
  logoRegion?: () => MosaicRect | null;
  /** A headline to spell in cells: a fixed lead, and phrases that take turns below it. */
  title?: {
    lead: string;
    phrases: readonly string[];
    /** How long each phrase stays. */
    phraseMs: number;
    /** Where the headline goes: its top and width; its height is the layout's. */
    region: () => MosaicRect | null;
    /** The heading's font family, which the spelled letters are drawn in. */
    font: () => string;
    /** Told on every layout how tall the headline is in CSS pixels. */
    onLayout: (height: number) => void;
  };
}

export interface MosaicController {
  stop: () => void;
  /** Replaces the atlas (the full one after the first-paint copy) and redraws every cell. */
  setAtlas: (atlas: MosaicAtlas) => void;
  /** Lays the grid out again, as when the page's typeface finishes loading. */
  relayout: () => void;
}

/** How long one square takes to crossfade to its next poster. */
const FADE_MS = 360;
/** Squares are swapped this often, a few at a time. */
const TICK_MS = 90;
/** A phrase change respells its squares at scattered moments across this long. */
const RESPELL_MS = 900;
/** How strongly muted cells show through the surface behind them: faint, so dark letters stand out. */
const MUTED_ALPHA = 0.22;
/**
 * Logo cells choose among the posters whose dominant colour is within this
 * distance of their part of the logo, at least LOGO_MIN_CANDIDATES of the closest.
 */
const LOGO_MATCH_DISTANCE = 120;
const LOGO_MIN_CANDIDATES = 24;
/** Headline posters are dark: a dominant colour no lighter than this (0 black, 1 white) covering at least this share of the poster. */
const TITLE_MAX_LIGHTNESS = 0.2;
const TITLE_MIN_SHARE = 0.35;
/** The smallest cell a headline may ask for, in CSS pixels: squares stay big enough to read as posters. */
const MIN_TILE_SIZE = 10;
/** Tries at a random unused poster before searching the pool for the least shown one. */
const PICK_TRIES = 8;

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
 * draws one still mosaic, with the headline's first phrase, and never swaps a square.
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
  if (!context || !parent) return { stop: () => {}, setAtlas: () => {}, relayout: () => {} };

  let atlas = firstAtlas;
  let grey = greyscale(firstAtlas);
  const count = Math.min(firstAtlas.count, content.posters.length);
  const everyPoster = Array.from({ length: count }, (_, index) => index);

  const distanceTo = (letter: string) => {
    const [r, g, b] = rgb(content.logoColours[letter] ?? "#000000");
    return (poster: number) => {
      const [pr, pg, pb] = rgb(content.posters[poster].colour);
      return Math.hypot(pr - r, pg - g, pb - b);
    };
  };
  /** Every poster, closest first to a logo letter's colour, weighted by how much of the poster wears it. */
  const rankFor = (letter: string) => {
    const distance = distanceTo(letter);
    const score = (poster: number) => distance(poster) / Math.max(0.2, content.posters[poster].share);
    return [...everyPoster].sort((a, c) => score(a) - score(c));
  };
  const logoChoices = new Map<string, number[]>();
  const logoChoicesFor = (letter: string) => {
    let choices = logoChoices.get(letter);
    if (!choices) {
      const distance = distanceTo(letter);
      const ranked = rankFor(letter);
      const matching = ranked.filter((poster) => distance(poster) <= LOGO_MATCH_DISTANCE);
      choices = matching.length >= LOGO_MIN_CANDIDATES ? matching : ranked.slice(0, LOGO_MIN_CANDIDATES);
      logoChoices.set(letter, choices);
    }
    return choices;
  };
  /**
   * The headline's posters: dark ones only, darkest first, so letters read as
   * solid dark shapes against the faint grid. A short list repeats posters
   * rather than ever reaching for a bright one.
   */
  const titleChoices = (() => {
    const lightness = (poster: number) => {
      const [r, g, b] = rgb(content.posters[poster].colour);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const dark = everyPoster.filter((poster) => lightness(poster) <= TITLE_MAX_LIGHTNESS);
    const solid = dark.filter((poster) => content.posters[poster].share >= TITLE_MIN_SHARE);
    return (solid.length ? solid : dark.length ? dark : rankFor("k").slice(0, 1)).sort((a, c) => lightness(a) - lightness(c));
  })();

  let tile = look.tileSize;
  let columns = 0;
  let rows = 0;
  let scale = 1;
  let posters = new Uint16Array(0);
  /** How many squares show each poster right now, so a pick can prefer one that is not on screen. */
  const shown = new Uint16Array(count);
  /** Each cell's logo letter as a char code, or 0 off the logo. */
  let logo: Uint8Array = new Uint8Array(0);
  /** Which cells spell the lead, and each phrase, on the full grid. */
  let leadInk: Uint8Array = new Uint8Array(0);
  let phraseInk: Uint8Array[] = [];
  let phrase = 0;
  let phraseSince = 0;
  /** Each cell's headline flag as shown now; it changes square by square as a phrase respells. */
  let ink: Uint8Array = new Uint8Array(0);
  /** Squares waiting to respell, by index, to the moment they are due, and the flags they are heading for. */
  const respelling = new Map<number, number>();
  let respellTarget: Uint8Array = new Uint8Array(0);
  /** Squares mid-swap, by index, to the poster they are leaving, whether it was in colour, and when they started. */
  const fading = new Map<number, { from: number; fromColour: boolean; start: number }>();
  let frame = 0;
  let lastSwap = 0;
  let visible = true;

  const isColour = (index: number) => look.tone === "logo" && (logo[index] !== 0 || ink[index] === 1);

  /**
   * A poster for a square, from the posters that keep its shape legible, and
   * not one already on screen while the pool still has an unused one.
   */
  const pick = (index: number) => {
    const letter = logo[index];
    const pool = letter ? logoChoicesFor(String.fromCharCode(letter)) : ink[index] ? titleChoices : everyPoster;
    for (let tries = 0; tries < PICK_TRIES; tries += 1) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (shown[candidate] === 0) return candidate;
    }
    // Most of the pool is on screen: the least shown poster, from a random start so ties spread out.
    const start = Math.floor(Math.random() * pool.length);
    let best = pool[start];
    for (let offset = 1; offset < pool.length && shown[best] > 0; offset += 1) {
      const candidate = pool[(start + offset) % pool.length];
      if (shown[candidate] < shown[best]) best = candidate;
    }
    return best;
  };
  /** Puts a poster on a square, keeping the on-screen counts. */
  const place = (index: number, poster: number) => {
    if (shown[posters[index]] > 0) shown[posters[index]] -= 1;
    posters[index] = poster;
    shown[poster] += 1;
  };

  /** The cells that spell the lead and one phrase, on the full grid. */
  function inkFor(phraseIndex: number): Uint8Array {
    const cells = new Uint8Array(columns * rows);
    for (const source of [leadInk, phraseInk[phraseIndex]]) {
      source?.forEach((value, index) => { if (value) cells[index] = 1; });
    }
    return cells;
  }

  /**
   * Chooses the cell size and lays the headline out: the largest cell (up to
   * the look's) at which the headline fits with letters still legible, wrapped
   * as needed, else the smallest cell with words split as a last resort.
   */
  function layoutTitle() {
    leadInk = new Uint8Array(0);
    phraseInk = [];
    tile = look.tileSize;
    const title = look.tone === "logo" ? content.title : undefined;
    const region = title?.region();
    if (!title || !region) return null;
    const font = title.font();
    const measure = canvasMeasure(font);
    for (let candidate = look.tileSize; candidate >= MIN_TILE_SIZE; candidate -= 1) {
      const layout = layoutMosaicTitle(title.lead, title.phrases, Math.floor(region.width / candidate), measure);
      if (layout) {
        tile = candidate;
        return { title, region, font, layout };
      }
    }
    tile = MIN_TILE_SIZE;
    const layout = layoutMosaicTitle(title.lead, title.phrases, Math.floor(region.width / tile), measure, true)!;
    return { title, region, font, layout };
  }

  /** Spells a laid-out headline onto the grid's cells. */
  function spellTitle({ title, region, font, layout }: NonNullable<ReturnType<typeof layoutTitle>>) {
    title.onLayout(layout.rows * tile);
    const regionColumns = Math.floor(region.width / tile);
    const left = Math.round(region.left / tile);
    const top = Math.round(region.top / tile);
    /** A block of lines' ink placed on the grid, `rowOffset` rows below the region's top. */
    const spell = (lines: readonly string[], rowOffset: number) => {
      const box = rasterizeTitle(lines, regionColumns, layout, font);
      const cells = new Uint8Array(columns * rows);
      box.forEach((value, index) => {
        const row = top + rowOffset + Math.floor(index / regionColumns);
        const column = left + (index % regionColumns);
        if (value && row < rows && column < columns) cells[row * columns + column] = 1;
      });
      return cells;
    };
    leadInk = spell(layout.lead, 0);
    phraseInk = layout.phrases.map((lines) => spell(lines, layout.lead.length * layout.lineRows));
  }

  function drawPoster(index: number, poster: number, alpha: number, colour: boolean) {
    const x = (index % columns) * tile * scale;
    const y = Math.floor(index / columns) * tile * scale;
    const size = (tile - look.gutter) * scale;
    const { tilePixels, columns: atlasColumns } = atlas;
    context!.globalAlpha = alpha * (colour ? 1 : MUTED_ALPHA);
    context!.drawImage(
      colour ? atlas.image : grey,
      (poster % atlasColumns) * tilePixels, Math.floor(poster / atlasColumns) * tilePixels, tilePixels, tilePixels,
      x, y, size, size,
    );
  }

  /** Draws one square, crossfading from the poster it is leaving while `progress` runs from 0 to 1. */
  function drawCell(index: number, fade?: { from: number; fromColour: boolean; progress: number }) {
    const x = (index % columns) * tile * scale;
    const y = Math.floor(index / columns) * tile * scale;
    context!.clearRect(x, y, tile * scale, tile * scale);
    if (fade) drawPoster(index, fade.from, 1 - fade.progress, fade.fromColour);
    drawPoster(index, posters[index], fade ? fade.progress : 1, isColour(index));
    context!.globalAlpha = 1;
  }

  function drawAll() {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < posters.length; index += 1) drawCell(index);
  }

  /** Swaps one square to a new poster for its shape, starting its crossfade. */
  function swap(index: number, now: number) {
    if (fading.has(index)) return;
    const from = posters[index];
    const fromColour = isColour(index);
    place(index, pick(index));
    fading.set(index, { from, fromColour, start: now });
  }

  function resize() {
    const { width, height } = parent!.getBoundingClientRect();
    const spelling = layoutTitle();
    // The backing store matches the screen's pixels, so a 2x screen draws every cell from twice its CSS size.
    scale = Math.min(window.devicePixelRatio || 1, 3);
    columns = Math.max(1, Math.ceil(width / tile));
    rows = Math.max(1, Math.ceil(height / tile));
    canvas.width = Math.round(columns * tile * scale);
    canvas.height = Math.round(rows * tile * scale);
    canvas.style.width = `${columns * tile}px`;
    canvas.style.height = `${rows * tile}px`;
    // Resizing the backing store resets the context, smoothing included.
    context!.imageSmoothingEnabled = true;
    context!.imageSmoothingQuality = "high";
    const region = look.tone === "logo" ? content.logoRegion?.() : null;
    logo = region
      ? logoCells(content.logoMask, columns, rows, {
        left: Math.round(region.left / tile),
        top: Math.round(region.top / tile),
        columns: Math.floor(region.width / tile),
        rows: Math.floor(region.height / tile),
      })
      : new Uint8Array(columns * rows);
    if (spelling) spellTitle(spelling);
    ink = inkFor(phrase);
    shown.fill(0);
    posters = new Uint16Array(columns * rows);
    // Shapes first, from their smaller pools, so the background never takes the posters they need.
    const shaped = (index: number) => Number(logo[index] !== 0 || ink[index] === 1);
    const order = Array.from({ length: columns * rows }, (_, index) => index).sort((a, c) => shaped(c) - shaped(a));
    for (const index of order) {
      const poster = pick(index);
      posters[index] = poster;
      shown[poster] += 1;
    }
    respelling.clear();
    fading.clear();
    drawAll();
  }

  /** Turns the headline to its next phrase: the squares that differ respell, each at its own moment. */
  function nextPhrase(now: number) {
    if (phraseInk.length < 2) return;
    phrase = (phrase + 1) % phraseInk.length;
    respellTarget = inkFor(phrase);
    respellTarget.forEach((value, cell) => {
      if (value !== ink[cell]) respelling.set(cell, now + Math.random() * RESPELL_MS);
    });
  }

  function tick(now: number) {
    frame = 0;
    if (content.title && now - phraseSince >= content.title.phraseMs) {
      if (phraseSince) nextPhrase(now);
      phraseSince = now;
    }
    // A few scattered squares at a time, at the look's rate, whichever they are.
    if (now - lastSwap >= TICK_MS) {
      const due = posters.length * look.swapsPerSecond * ((lastSwap ? now - lastSwap : TICK_MS) / 1000);
      lastSwap = now;
      for (let swaps = Math.floor(due + Math.random()); swaps > 0; swaps -= 1) {
        swap(Math.floor(Math.random() * posters.length), now);
      }
    }
    // Squares whose letter changed with the phrase, each at its own moment.
    for (const [index, at] of respelling) {
      if (at > now || fading.has(index)) continue;
      const from = posters[index];
      const fromColour = isColour(index);
      ink[index] = respellTarget[index];
      place(index, pick(index));
      fading.set(index, { from, fromColour, start: now });
      respelling.delete(index);
    }
    for (const [index, { from, fromColour, start }] of fading) {
      const progress = Math.min(1, (now - start) / FADE_MS);
      drawCell(index, progress < 1 ? { from, fromColour, progress } : undefined);
      if (progress >= 1) fading.delete(index);
    }
    schedule();
  }

  function schedule() {
    if (animate && !frame && visible && document.visibilityState === "visible") frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastSwap = 0;
  }

  function onVisibility() {
    if (visible && document.visibilityState === "visible") schedule();
    else pause();
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
  schedule();

  return {
    stop: () => {
      pause();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    setAtlas: (next) => {
      atlas = next;
      grey = greyscale(next);
      drawAll();
    },
    relayout: resize,
  };
}
