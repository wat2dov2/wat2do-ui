/**
 * Draws a grid of real event posters onto one canvas that never stops
 * changing: a few squares at a time, scattered all over the grid, each swap
 * to another poster with a quick crossfade of that one square.
 *
 * Posters are drawn as they are, smoothed from an atlas at least twice the
 * cell size, onto a canvas backed at the screen's pixel ratio. The Wat2Do
 * logo reads out of the grid only because the cells on it are given posters
 * whose own dominant colour matches that part of the logo; nothing is tinted.
 * Its squares are finer than the grid's, so its outline reads sharper.
 * A headline is spelled the same way, in the heading's own typeface, out of
 * dark posters only, and its squares only ever swap among those, so the shapes
 * always stay legible. The phrase below its lead takes turns, respelling
 * square by square at scattered moments, never as a sweep.
 *
 * Buttons are spelled the same way, each label inside a border of squares, in
 * squares half the grid's size so they read at a button's size. Hovering one
 * slides its label aside while its hover label (the label and an arrow) slides
 * in, and leaving slides it back. Nothing moves: each square fades between
 * muted and full colour by how much of the gliding label covers it, so the
 * label seems to glide smoothly across squares that stay put.
 *
 * Squares avoid showing a poster that is already on screen while the posters
 * that keep their shape allow it, so the grid shows as many images as it can.
 *
 * All posters come from one atlas (`npm run build-event-mosaic`), so the page
 * loads a single image however many cells it shows. A small copy of the atlas
 * paints first; the full one replaces it when it arrives.
 */

import {
  GLYPH_ROWS,
  LINE_ROWS,
  TITLE_GAP_ROWS,
  TITLE_ROWS,
  lineColumns,
  rasterizeTitle,
  titleColumns,
} from "@/features/landing/lib/eventMosaicTitle";

export interface MosaicAtlas {
  image: CanvasImageSource;
  /** Pixels per poster side in this atlas. */
  tilePixels: number;
  /** Posters per atlas row. */
  columns: number;
  count: number;
}

export interface MosaicLook {
  /** CSS pixels per cell side; a headline that needs finer cells to be legible gets them. */
  tileSize: number;
  /** CSS pixels of surface left between cells, so the grid reads as cells. */
  gutter: number;
  /** Share of the grid's cells that swap each second. */
  swapsPerSecond: number;
}

export interface MosaicRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One button spelled in squares: its label, and the label hovering turns it into. */
export interface MosaicButton {
  label: string;
  hoverLabel: string;
}

/** Where the spelled buttons landed: the row's height and each button, relative to the buttons' region. */
export interface MosaicButtonLayout {
  height: number;
  rects: MosaicRect[];
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
  /** Whether the page is dark, which flips the headline from the darkest posters to the lightest. */
  onDark: boolean;
  /** A headline to spell in cells: a fixed lead, and phrases that take turns below it. */
  title?: {
    lead: string;
    phrases: readonly string[];
    /** How long each phrase stays. */
    phraseMs: number;
    /** Where the headline goes: its top and width; its height is the layout's. */
    region: () => MosaicRect | null;
    /** Told on every layout how tall the headline is in CSS pixels. */
    onLayout: (height: number) => void;
  };
  /**
   * Buttons to spell in a row at the top of a region (stacked when the row is
   * too wide). Told where they landed, or null when even one is too wide for
   * the region, so the page can draw ordinary buttons instead.
   */
  buttons?: {
    items: readonly MosaicButton[];
    region: () => MosaicRect | null;
    onLayout: (layout: MosaicButtonLayout | null) => void;
  };
}

export interface MosaicController {
  stop: () => void;
  /** Replaces the atlas (the full one after the first-paint copy) and redraws every cell. */
  setAtlas: (atlas: MosaicAtlas) => void;
  /** Respells a button as hovered (by its index), or every button as at rest (null). */
  setHover: (button: number | null) => void;
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
/** On a dark page the headline's posters are at least this light instead. */
const TITLE_MIN_LIGHTNESS_ON_DARK = 0.6;
/** The smallest cell a headline may ask for, in CSS pixels, so its widest line still fits on one line on the narrowest phones. */
const MIN_TILE_SIZE = 2;
/** Each grid square the logo touches splits into this many squares a side, so the logo reads at a finer grain than the grid. */
const LOGO_SPLIT = 2;
/** Logo squares never split smaller than this, in CSS pixels; on a fine grid they stay whole. */
const MIN_LOGO_SQUARE = 3;
/** Tries at a random unused poster before searching the pool for the least shown one. */
const PICK_TRIES = 8;
/** A button's squares split this many a side, at least MIN_LOGO_SQUARE pixels each, so its label reads at a button's size. */
const BUTTON_SPLIT = 2;
/** Squares between a button's border and its label, across and down. */
const BUTTON_PAD_X = 4;
const BUTTON_PAD_Y = 2;
/** Grid squares between neighbouring buttons. */
const BUTTON_GAP = 2;
/** How long a hovered button's label takes to glide one square aside. */
const HOVER_STEP_MS = 60;

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
  if (!context || !parent) return { stop: () => {}, setAtlas: () => {}, setHover: () => {} };

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
    // On a dark page dark letters vanish, so the headline takes the lightest posters instead.
    const { onDark } = content;
    const stand = everyPoster.filter((poster) => (onDark ? lightness(poster) >= TITLE_MIN_LIGHTNESS_ON_DARK : lightness(poster) <= TITLE_MAX_LIGHTNESS));
    const solid = stand.filter((poster) => content.posters[poster].share >= TITLE_MIN_SHARE);
    const order = onDark ? (a: number, c: number) => lightness(c) - lightness(a) : (a: number, c: number) => lightness(a) - lightness(c);
    return (solid.length ? solid : stand.length ? stand : rankFor("k").slice(0, 1)).sort(order);
  })();

  let tile = look.tileSize;
  let columns = 0;
  let rows = 0;
  let scale = 1;
  /** Each square's top-left corner and side, in CSS pixels. */
  let cellX = new Float32Array(0);
  let cellY = new Float32Array(0);
  let cellSize = new Float32Array(0);
  /** Grid squares the logo split, drawn as their finer squares instead. */
  let hidden: Uint8Array = new Uint8Array(0);
  /** The lowest grid row the logo reaches, or -1 without a logo. */
  let logoBottom = -1;
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
  /** Each square's button index, or -1 off the buttons. */
  let buttonOf = new Int16Array(0);
  /** Each button square's place in its button's own grid of squares, row by row. */
  let buttonCell = new Uint32Array(0);
  /** Each button's grid of squares: its width, and its ink frame by frame from rest to hovered. */
  let buttonInk: { width: number; frames: Uint8Array[] }[] = [];
  /**
   * Where each button's label is between its frames, from 0 (at rest) to its
   * last frame (hovered); between two frames its squares blend the two.
   */
  let buttonPosition: number[] = [];
  let hover: number | null = null;
  let lastTick = 0;
  /** Squares mid-swap, by index, to the poster they are leaving, whether it was in colour, and when they started. */
  const fading = new Map<number, { from: number; fromColour: number; start: number }>();
  let frame = 0;
  let lastSwap = 0;
  let visible = true;

  /** Squares on the logo or a headline letter are drawn in full colour; every other square is muted. */
  const isColour = (index: number) => logo[index] !== 0 || ink[index] === 1;
  /** How much of a square's colour shows, 0 muted to 1 full; a button square blends its label's two nearest frames. */
  const colourOf = (index: number) => {
    const button = buttonOf[index];
    if (button < 0) return isColour(index) ? 1 : 0;
    const { frames } = buttonInk[button];
    const position = buttonPosition[button];
    const below = Math.floor(position);
    const above = Math.min(below + 1, frames.length - 1);
    const share = position - below;
    const cell = buttonCell[index];
    return frames[below][cell] * (1 - share) + frames[above][cell] * share;
  };

  /**
   * A poster for a square, from the posters that keep its shape legible, and
   * not one already on screen while the pool still has an unused one.
   */
  const pick = (index: number) => {
    const letter = logo[index];
    // Button squares always hold dark posters, so a hover only fades them, never swaps them.
    const pool = letter ? logoChoicesFor(String.fromCharCode(letter)) : ink[index] || buttonOf[index] >= 0 ? titleChoices : everyPoster;
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
    const cells = new Uint8Array(posters.length);
    for (const source of [leadInk, phraseInk[phraseIndex]]) {
      source?.forEach((value, index) => { if (value) cells[index] = 1; });
    }
    buttonOf.forEach((button, index) => {
      if (button < 0) return;
      cells[index] = buttonInk[button].frames[Math.round(buttonPosition[button])][buttonCell[index]];
    });
    return cells;
  }

  /** A button's label inside its border, on its own `width` x `height` grid of squares, `shift` squares right of centre. */
  function buttonGlyphs(label: string, width: number, height: number, shift = 0): Uint8Array {
    const cells = new Uint8Array(width * height);
    const inner = width - 2;
    const text = rasterizeTitle(label, inner);
    const top = Math.floor((height - GLYPH_ROWS) / 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const glyphRow = y - top;
        const textColumn = x - 1 - shift;
        const lit = glyphRow >= 0 && glyphRow < GLYPH_ROWS && textColumn >= 0 && textColumn < inner && text[glyphRow * inner + textColumn] === 1;
        if (border || lit) cells[y * width + x] = 1;
      }
    }
    return cells;
  }

  /**
   * A button's ink from its label to its hover label: the hover label starts
   * where the label sits and moves left a square a frame, so the label slides
   * aside and the arrow slides in after it.
   */
  function slideFrames(label: string, hoverLabel: string, width: number, height: number): Uint8Array[] {
    const inner = width - 2;
    const start = (line: string) => Math.floor((inner - lineColumns(line)) / 2);
    const distance = Math.max(1, start(label) - start(hoverLabel));
    return [
      buttonGlyphs(label, width, height),
      ...Array.from({ length: distance }, (_, step) => buttonGlyphs(hoverLabel, width, height, distance - 1 - step)),
    ];
  }

  /** The frame a button's label is heading for: its last when hovered, its first at rest. */
  const targetFrame = (button: number) => (button === hover ? buttonInk[button].frames.length - 1 : 0);

  /** Redraws a button's squares that are not mid-crossfade (those draw themselves). */
  function drawButton(button: number) {
    buttonOf.forEach((owner, index) => {
      if (owner === button && !fading.has(index)) drawCell(index);
    });
  }

  /** Glides every button's label toward its target by `elapsed` milliseconds' worth. */
  function glideButtons(elapsed: number) {
    buttonInk.forEach((_, button) => {
      const target = targetFrame(button);
      const position = buttonPosition[button];
      if (position === target || elapsed <= 0) return;
      const step = elapsed / HOVER_STEP_MS;
      buttonPosition[button] = position < target ? Math.min(target, position + step) : Math.max(target, position - step);
      drawButton(button);
    });
  }

  /**
   * Where each button goes, in grid squares: in one row centred at the top of
   * its region, or stacked when the row is too wide; null when one alone is
   * too wide, or there are none.
   */
  function placeButtons(split: number) {
    const { buttons } = content;
    const region = buttons?.region();
    if (!buttons || !region || !buttons.items.length) return null;
    const regionColumns = Math.floor(region.width / tile);
    const left = Math.round(region.left / tile);
    const top = Math.round(region.top / tile);
    const roundUp = (cells: number) => Math.ceil(cells / split) * split;
    const sizes = buttons.items.map(({ label, hoverLabel }) => ({
      width: roundUp(Math.max(lineColumns(label), lineColumns(hoverLabel)) + 2 * BUTTON_PAD_X + 2),
      height: roundUp(GLYPH_ROWS + 2 * BUTTON_PAD_Y + 2),
    }));
    const squares = sizes.map(({ width, height }) => ({ columns: width / split, rows: height / split }));
    if (squares.some(({ columns }) => columns > regionColumns)) return null;
    const rowWidth = squares.reduce((sum, { columns }) => sum + columns, 0) + BUTTON_GAP * (squares.length - 1);
    const inRow = rowWidth <= regionColumns;
    let x = left + Math.floor((regionColumns - rowWidth) / 2);
    let y = top;
    const boxes = squares.map((box, index) => {
      const column = inRow ? x : left + Math.floor((regionColumns - box.columns) / 2);
      const placed = { left: column, top: y, ...box, ...sizes[index] };
      if (inRow) x += box.columns + BUTTON_GAP;
      else y += box.rows + BUTTON_GAP;
      return placed;
    });
    const bottom = Math.max(...boxes.map((box) => box.top + box.rows));
    buttons.onLayout({
      height: (bottom - top) * tile,
      rects: boxes.map((box) => ({
        left: box.left * tile - region.left,
        top: box.top * tile - region.top,
        width: box.columns * tile,
        height: box.rows * tile,
      })),
    });
    return boxes;
  }

  /**
   * Chooses the cell size for the headline: the largest (up to the look's) at
   * which its widest line fits the region, one pixel of its font to a cell.
   */
  function layoutTitle() {
    leadInk = new Uint8Array(0);
    phraseInk = [];
    tile = look.tileSize;
    const { title } = content;
    const region = title?.region();
    if (!title || !region) return null;
    const needed = titleColumns(title.lead, title.phrases);
    tile = Math.max(MIN_TILE_SIZE, Math.min(look.tileSize, Math.floor(region.width / needed)));
    return { title, region };
  }

  /** Spells a laid-out headline onto the grid's cells. */
  function spellTitle({ title, region }: NonNullable<ReturnType<typeof layoutTitle>>) {
    const regionColumns = Math.floor(region.width / tile);
    const left = Math.round(region.left / tile);
    // The headline starts a gap of empty rows below the logo's lowest cell, at every cell size.
    const regionTop = Math.round(region.top / tile);
    // Exactly the gap, even where the logo's box leaves empty rows below it; the region's height follows.
    const top = logoBottom >= 0 ? logoBottom + 1 + TITLE_GAP_ROWS : regionTop;
    title.onLayout(Math.max(0, top - regionTop + TITLE_ROWS) * tile);
    /** A line's ink placed on the grid, `rowOffset` rows below the region's top. */
    const spell = (line: string, rowOffset: number) => {
      const box = rasterizeTitle(line, regionColumns);
      const cells = new Uint8Array(columns * rows);
      box.forEach((value, index) => {
        const row = top + rowOffset + Math.floor(index / regionColumns);
        const column = left + (index % regionColumns);
        if (value && row < rows && column < columns) cells[row * columns + column] = 1;
      });
      return cells;
    };
    leadInk = spell(title.lead, 0);
    phraseInk = title.phrases.map((phrase) => spell(phrase, LINE_ROWS));
  }

  /** Draws a poster at `alpha`, `colour` of the way from muted grey (0) to full colour (1). */
  function drawPoster(index: number, poster: number, alpha: number, colour: number) {
    const x = cellX[index] * scale;
    const y = cellY[index] * scale;
    // The gutter shrinks with the square, so split logo squares keep the grid's proportions.
    const size = cellSize[index] * (1 - look.gutter / tile) * scale;
    const { tilePixels, columns: atlasColumns } = atlas;
    const layer = (image: CanvasImageSource, layerAlpha: number) => {
      if (layerAlpha <= 0) return;
      context!.globalAlpha = layerAlpha;
      context!.drawImage(
        image,
        (poster % atlasColumns) * tilePixels, Math.floor(poster / atlasColumns) * tilePixels, tilePixels, tilePixels,
        x, y, size, size,
      );
    };
    layer(grey, alpha * (1 - colour) * MUTED_ALPHA);
    layer(atlas.image, alpha * colour);
  }

  /** Draws one square, crossfading from the poster it is leaving while `progress` runs from 0 to 1. */
  function drawCell(index: number, fade?: { from: number; fromColour: number; progress: number }) {
    context!.clearRect(cellX[index] * scale, cellY[index] * scale, cellSize[index] * scale, cellSize[index] * scale);
    if (fade) drawPoster(index, fade.from, 1 - fade.progress, fade.fromColour);
    drawPoster(index, posters[index], fade ? fade.progress : 1, colourOf(index));
    context!.globalAlpha = 1;
  }

  function drawAll() {
    context!.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < posters.length; index += 1) if (!hidden[index]) drawCell(index);
  }

  /** Swaps one square to a new poster for its shape, starting its crossfade. */
  function swap(index: number, now: number) {
    if (hidden[index] || fading.has(index)) return;
    const from = posters[index];
    const fromColour = colourOf(index);
    place(index, pick(index));
    fading.set(index, { from, fromColour, start: now });
  }

  /**
   * Lays out every square: the plain grid, then, where the logo falls, each
   * grid square it touches split LOGO_SPLIT a side, its finer squares taking
   * the logo's letters from a mask traced at that finer grain.
   */
  function layoutLogo() {
    // The plain grid's squares come first; the logo's split squares follow them.
    const gridCount = columns * rows;
    const region = content.logoRegion?.();
    const split = region && tile / LOGO_SPLIT >= MIN_LOGO_SQUARE ? LOGO_SPLIT : 1;
    const fineColumns = columns * split;
    const fine = region
      ? logoCells(content.logoMask, fineColumns, rows * split, {
        left: Math.round(region.left / tile) * split,
        top: Math.round(region.top / tile) * split,
        columns: Math.floor(region.width / tile) * split,
        rows: Math.floor(region.height / tile) * split,
      })
      : new Uint8Array(gridCount);
    const xs: number[] = [];
    const ys: number[] = [];
    const sizes: number[] = [];
    const letters: number[] = [];
    const add = (x: number, y: number, size: number, letter: number) => {
      xs.push(x);
      ys.push(y);
      sizes.push(size);
      letters.push(letter);
    };
    hidden = new Uint8Array(gridCount);
    logoBottom = -1;
    for (let index = 0; index < gridCount; index += 1) {
      const row = Math.floor(index / columns);
      add((index % columns) * tile, row * tile, tile, split === 1 ? fine[index] : 0);
      if (split === 1 && fine[index]) logoBottom = row;
    }
    if (split > 1) {
      const fineIndex = (index: number, sx: number, sy: number) =>
        (Math.floor(index / columns) * split + sy) * fineColumns + (index % columns) * split + sx;
      for (let index = 0; index < gridCount; index += 1) {
        let touched = false;
        for (let sy = 0; sy < split && !touched; sy += 1) {
          for (let sx = 0; sx < split && !touched; sx += 1) touched = fine[fineIndex(index, sx, sy)] !== 0;
        }
        if (!touched) continue;
        hidden[index] = 1;
        logoBottom = Math.max(logoBottom, Math.floor(index / columns));
        const side = tile / split;
        for (let sy = 0; sy < split; sy += 1) {
          for (let sx = 0; sx < split; sx += 1) {
            add((index % columns) * tile + sx * side, Math.floor(index / columns) * tile + sy * side, side, fine[fineIndex(index, sx, sy)]);
          }
        }
      }
    }
    // The buttons' squares follow the logo's, each grid square under a button split like the logo's.
    const buttonSplit = tile / BUTTON_SPLIT >= MIN_LOGO_SQUARE ? BUTTON_SPLIT : 1;
    const boxes = placeButtons(buttonSplit);
    if (!boxes) content.buttons?.onLayout(null);
    const owners: number[] = new Array(xs.length).fill(-1);
    const places: number[] = new Array(xs.length).fill(0);
    buttonInk = [];
    (boxes ?? []).forEach((box, button) => {
      const { label, hoverLabel } = content.buttons!.items[button];
      buttonInk.push({ width: box.width, frames: slideFrames(label, hoverLabel, box.width, box.height) });
      const side = tile / buttonSplit;
      for (let row = box.top; row < Math.min(rows, box.top + box.rows); row += 1) {
        for (let column = box.left; column < Math.min(columns, box.left + box.columns); column += 1) {
          hidden[row * columns + column] = 1;
          for (let sy = 0; sy < buttonSplit; sy += 1) {
            for (let sx = 0; sx < buttonSplit; sx += 1) {
              add(column * tile + sx * side, row * tile + sy * side, side, 0);
              owners.push(button);
              places.push(((row - box.top) * buttonSplit + sy) * box.width + (column - box.left) * buttonSplit + sx);
            }
          }
        }
      }
    });
    buttonPosition = buttonInk.map((_, button) => targetFrame(button));
    buttonOf = Int16Array.from(owners);
    buttonCell = Uint32Array.from(places);
    hidden = Uint8Array.from({ length: xs.length }, (_, index) => (index < gridCount ? hidden[index] : 0));
    cellX = Float32Array.from(xs);
    cellY = Float32Array.from(ys);
    cellSize = Float32Array.from(sizes);
    logo = Uint8Array.from(letters);
    posters = new Uint16Array(xs.length);
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
    layoutLogo();
    if (spelling) spellTitle(spelling);
    ink = inkFor(phrase);
    shown.fill(0);
    // Shapes first, from their smaller pools, so the background never takes the posters they need.
    const shaped = (index: number) => Number(logo[index] !== 0 || ink[index] === 1);
    const order = Array.from({ length: posters.length }, (_, index) => index)
      .filter((index) => !hidden[index])
      .sort((a, c) => shaped(c) - shaped(a));
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
      // Buttons keep their own ink; only the headline respells.
      if (value !== ink[cell] && buttonOf[cell] < 0) respelling.set(cell, now + Math.random() * RESPELL_MS);
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
    glideButtons(lastTick ? now - lastTick : 0);
    lastTick = now;
    // Squares whose letter changed with the phrase, each at its own moment.
    for (const [index, at] of respelling) {
      if (at > now || fading.has(index)) continue;
      const from = posters[index];
      const fromColour = colourOf(index);
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
    lastTick = 0;
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
    setHover: (button) => {
      if (button === hover) return;
      hover = button;
      if (animate) {
        schedule();
        return;
      }
      buttonPosition = buttonInk.map((_, index) => targetFrame(index));
      buttonInk.forEach((_, index) => drawButton(index));
    },
  };
}
