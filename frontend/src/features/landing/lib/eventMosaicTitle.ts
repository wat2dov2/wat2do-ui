/**
 * Spells a headline in mosaic cells with the page's own heading typeface: each
 * line is drawn in the heading's family, at a heavy weight so every stroke is
 * at least two cells thick, onto a small canvas where
 * a few pixels stand for one cell, and a cell is part of a letter when at
 * least half of it is ink. Real type, not a bitmap font, so it reads like the
 * heading itself built out of squares, in every language's script.
 */

/** The largest and smallest type size in cells (one em). Below the smallest, even heavy strokes are under two cells and stop reading. */
const MAX_EM_CELLS = 24;
export const MIN_EM_CELLS = 13;
/** Rows per line, as a multiple of the type size: room for ascenders and descenders. */
const LINE_HEIGHT = 1.18;
/** No part of the headline wraps onto more than this many mosaic lines; legibility comes before fitting on one line. */
const MAX_LINES_PER_PART = 3;
/** The weight the letters are drawn at: heavy, so strokes stay solid at a few cells. */
const TITLE_WEIGHT = 800;
/** Pixels drawn per cell side when rasterizing, so each cell's coverage is measured, not guessed. */
const SUPERSAMPLE = 6;
/** A cell is a letter cell when at least this much of it is covered. */
const INK_COVERAGE = 0.5;
/** Cells kept clear on each side of a line. */
const SIDE_MARGIN = 1;

/** Measures a line's width in ems of the heading's type. */
export type MeasureEms = (text: string) => number;

/**
 * Greedy word wrap into lines no wider than `columns` cells at `em` cells per
 * em, or null when one word alone is too wide. With `breakWords`, a word too
 * wide for a line is split across lines instead, as a last resort on the
 * narrowest screens.
 */
export function wrapTitle(text: string, columns: number, em: number, measure: MeasureEms, breakWords = false): string[] | null {
  const fits = (line: string) => measure(line) * em <= columns;
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces: string[] = [];
    if (fits(word)) pieces.push(word);
    else if (!breakWords) return null;
    else {
      let piece = "";
      for (const character of word) {
        if (piece && !fits(piece + character)) {
          pieces.push(piece);
          piece = "";
        }
        piece += character;
      }
      pieces.push(piece);
    }
    for (const piece of pieces) {
      const last = lines[lines.length - 1];
      if (last !== undefined && pieces.length === 1 && fits(`${last} ${piece}`)) lines[lines.length - 1] = `${last} ${piece}`;
      else lines.push(piece);
    }
  }
  return lines;
}

export interface MosaicTitleLayout {
  /** The type size in cells. */
  em: number;
  /** Rows per line. */
  lineRows: number;
  /** The lead's lines, the same for every phrase. */
  lead: string[];
  /** Each phrase's lines. */
  phrases: string[][];
  /** Rows the title needs: the lead plus the longest phrase. */
  rows: number;
}

/**
 * Lays the lead and every phrase out in `columns` cells: in as few lines as
 * any legible size allows (no part on more than MAX_LINES_PER_PART), at the
 * largest size that keeps that many lines; null when even the smallest legible
 * size does not fit. With `breakWords`, the smallest size always fits by splitting words.
 */
export function layoutMosaicTitle(
  lead: string,
  phrases: readonly string[],
  columns: number,
  measure: MeasureEms,
  breakWords = false,
): MosaicTitleLayout | null {
  const width = columns - SIDE_MARGIN * 2;
  let best: (MosaicTitleLayout & { lines: number }) | null = null;
  for (let em = breakWords ? MIN_EM_CELLS : MAX_EM_CELLS; em >= MIN_EM_CELLS; em -= 1) {
    const leadLines = wrapTitle(lead, width, em, measure, breakWords);
    const phraseLines = phrases.map((phrase) => wrapTitle(phrase, width, em, measure, breakWords));
    const parts = [leadLines, ...phraseLines];
    if (parts.some((lines) => !lines || (!breakWords && lines.length > MAX_LINES_PER_PART))) continue;
    const lineRows = Math.ceil(em * LINE_HEIGHT);
    const longest = Math.max(...phraseLines.map((lines) => lines!.length));
    const lines = leadLines!.length + longest;
    // Sizes run largest first, so a later size wins only by needing fewer lines.
    if (!best || lines < best.lines) {
      best = { em, lineRows, lead: leadLines!, phrases: phraseLines as string[][], rows: lines * lineRows, lines };
    }
  }
  if (!best) return null;
  return { em: best.em, lineRows: best.lineRows, lead: best.lead, phrases: best.phrases, rows: best.rows };
}

/** The heading's family, heavy, at a pixel size. */
function fontAt(family: string, pixels: number) {
  return `${TITLE_WEIGHT} ${pixels}px ${family}`;
}

/** A measure in ems for the heading's family, from a scratch canvas. */
export function canvasMeasure(family: string): MeasureEms {
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = fontAt(family, 100);
  return (text) => context.measureText(text).width / 100;
}

/**
 * Which cells of a `columns`-wide box are ink for these lines, centred, one
 * line every `layout.lineRows` rows from the top.
 */
export function rasterizeTitle(lines: readonly string[], columns: number, layout: Pick<MosaicTitleLayout, "em" | "lineRows">, family: string): Uint8Array {
  const rows = lines.length * layout.lineRows;
  const canvas = document.createElement("canvas");
  canvas.width = columns * SUPERSAMPLE;
  canvas.height = rows * SUPERSAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.font = fontAt(family, layout.em * SUPERSAMPLE);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  lines.forEach((line, index) => {
    // The baseline sits where descenders still land inside the line.
    const baseline = (index * layout.lineRows + layout.em * 0.92) * SUPERSAMPLE;
    context.fillText(line, canvas.width / 2, baseline);
  });
  const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const ink = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let covered = 0;
      for (let y = 0; y < SUPERSAMPLE; y += 1) {
        for (let x = 0; x < SUPERSAMPLE; x += 1) {
          covered += alpha[(((row * SUPERSAMPLE + y) * canvas.width) + column * SUPERSAMPLE + x) * 4 + 3];
        }
      }
      if (covered / (255 * SUPERSAMPLE * SUPERSAMPLE) >= INK_COVERAGE) ink[row * columns + column] = 1;
    }
  }
  return ink;
}
