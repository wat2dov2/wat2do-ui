/**
 * Spells a headline in mosaic cells: each line of text is drawn in the page's
 * own typeface onto a small canvas where one pixel stands for one cell, and a
 * cell is part of a letter when most of it is ink. Drawing real type, rather
 * than a bitmap font, keeps every language's script legible the same way.
 */

/** Cells per line of text, descenders included. */
export const TITLE_LINE_ROWS = 9;
/** The type size in cells: tall enough that lower case reads at a few cells high, short enough to clear the line. */
const TITLE_FONT_CELLS = 8.2;
/** Pixels drawn per cell side when rasterizing, so each cell's coverage is measured, not guessed. */
const SUPERSAMPLE = 6;
/** A cell is ink when this much of it is covered. */
const INK_COVERAGE = 0.38;
/** Cells kept clear on each side of a line. */
const SIDE_MARGIN = 1;

/** Measures a line's width in cells. */
export type MeasureCells = (text: string) => number;

/** Greedy word wrap into lines no wider than `columns`, or null when one word alone is too wide. */
export function wrapTitle(text: string, columns: number, measure: MeasureCells): string[] | null {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (measure(word) > columns) return null;
    const last = lines[lines.length - 1];
    if (last !== undefined && measure(`${last} ${word}`) <= columns) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export interface MosaicTitleLayout {
  /** The lead's lines, the same for every phrase. */
  lead: string[];
  /** Each phrase's lines. */
  phrases: string[][];
  /** Rows the title needs: the lead plus the longest phrase. */
  rows: number;
}

/** Lays the lead and every phrase out in `columns`, or null when any of them cannot fit legibly. */
export function layoutMosaicTitle(lead: string, phrases: readonly string[], columns: number, measure: MeasureCells): MosaicTitleLayout | null {
  const width = columns - SIDE_MARGIN * 2;
  const leadLines = wrapTitle(lead, width, measure);
  const phraseLines = phrases.map((phrase) => wrapTitle(phrase, width, measure));
  if (!leadLines || phraseLines.some((lines) => !lines)) return null;
  const longest = Math.max(...phraseLines.map((lines) => lines!.length));
  return { lead: leadLines, phrases: phraseLines as string[][], rows: (leadLines.length + longest) * TITLE_LINE_ROWS };
}

function fontFor(family: string) {
  return `900 ${TITLE_FONT_CELLS * SUPERSAMPLE}px ${family}`;
}

/** A measure in cells for the page's typeface, from a scratch canvas. */
export function canvasMeasure(family: string): MeasureCells {
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = fontFor(family);
  return (text) => context.measureText(text).width / SUPERSAMPLE;
}

/**
 * Which cells of a `columns` x `rows` box are ink for these lines, centred,
 * one line every TITLE_LINE_ROWS rows from the top.
 */
export function rasterizeTitle(lines: readonly string[], columns: number, rows: number, family: string): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = columns * SUPERSAMPLE;
  canvas.height = rows * SUPERSAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.font = fontFor(family);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  lines.forEach((line, index) => {
    // The baseline sits where descenders still land inside the line.
    const baseline = (index * TITLE_LINE_ROWS + TITLE_LINE_ROWS * 0.74) * SUPERSAMPLE;
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
