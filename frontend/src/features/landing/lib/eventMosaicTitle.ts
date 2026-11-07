/**
 * Spells a headline in mosaic cells with a rudimentary 5×7 pixel font: every
 * stroke is one cell wide, like a dot-matrix sign, in capitals. The lead takes
 * one line and each phrase the line below, so the headline is always two
 * lines. A line with a character the font lacks (another script) is drawn in
 * the system's sans-serif instead, at the same height.
 */

/** Each glyph, row by row, "#" for a lit cell; all are seven rows tall. */
const GLYPHS: Record<string, readonly string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  ":": [".", "#", ".", ".", ".", "#", "."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
};
const GLYPH_ROWS = 7;
/** Empty cells between the logo and the headline, between its lines, and below it, so the stack is evenly spaced. */
export const TITLE_GAP_ROWS = 4;
/** Rows per line: a glyph's seven and the gap below it. */
export const LINE_ROWS = GLYPH_ROWS + TITLE_GAP_ROWS;
/** Rows the headline needs: the lead's line and a phrase's. */
export const TITLE_ROWS = 2 * LINE_ROWS;
/** Cells kept clear on each side of a line. */
const SIDE_MARGIN = 1;
/** Another script's type size in cells (one em), about the pixel font's height. */
const FALLBACK_EM = 8;
const FALLBACK_FONT = "700 {size}px system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif";
/** Pixels drawn per cell side when rasterizing another script, so each cell's coverage is measured. */
const SUPERSAMPLE = 6;
/** Another script's cell is ink when at least this much of it is covered. */
const INK_COVERAGE = 0.42;

/** The line's glyphs, accents dropped (É is drawn as E), or null when the pixel font lacks one of its characters. */
function glyphsOf(line: string): (readonly string[])[] | null {
  const plain = line.toLocaleUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  const glyphs = [...plain].map((character) => GLYPHS[character]);
  return glyphs.every(Boolean) ? glyphs : null;
}

function fallbackFont(pixels: number) {
  return FALLBACK_FONT.replace("{size}", String(pixels));
}

/** How many cells wide a line is drawn, with a cell's gap between glyphs. */
function lineColumns(line: string): number {
  const glyphs = glyphsOf(line);
  if (glyphs) return glyphs.reduce((width, glyph) => width + glyph[0].length + 1, -1);
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = fallbackFont(FALLBACK_EM * SUPERSAMPLE);
  return Math.ceil(context.measureText(line).width / SUPERSAMPLE);
}

/** The cells across the headline needs: its widest line and a margin each side. */
export function titleColumns(lead: string, phrases: readonly string[]): number {
  return Math.max(...[lead, ...phrases].map(lineColumns)) + SIDE_MARGIN * 2;
}

/** Which cells of a `columns`-wide box, LINE_ROWS tall, are ink for this line, centred. */
export function rasterizeTitle(line: string, columns: number): Uint8Array {
  const ink = new Uint8Array(columns * LINE_ROWS);
  const glyphs = glyphsOf(line);
  if (!glyphs) return rasterizeFallback(line, columns, ink);
  let column = Math.floor((columns - lineColumns(line)) / 2);
  for (const glyph of glyphs) {
    glyph.forEach((cells, row) => {
      [...cells].forEach((cell, offset) => {
        const x = column + offset;
        if (cell === "#" && x >= 0 && x < columns) ink[row * columns + x] = 1;
      });
    });
    column += glyph[0].length + 1;
  }
  return ink;
}

/** A line the pixel font cannot draw, in the system's sans-serif at about its height. */
function rasterizeFallback(line: string, columns: number, ink: Uint8Array): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = columns * SUPERSAMPLE;
  canvas.height = LINE_ROWS * SUPERSAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.font = fallbackFont(FALLBACK_EM * SUPERSAMPLE);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  context.fillText(line, canvas.width / 2, GLYPH_ROWS * SUPERSAMPLE);
  const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let row = 0; row < LINE_ROWS; row += 1) {
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

/**
 * Splits a headline into two lines at the word break that balances them best
 * by length, for a headline spelled as a lead and one phrase; text with no
 * spaces (Chinese, for one) splits at its middle character.
 */
export function splitInTwo(text: string): [string, string] {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) {
    const characters = [...text.trim()];
    const middle = Math.ceil(characters.length / 2);
    return [characters.slice(0, middle).join(""), characters.slice(middle).join("")];
  }
  const longest = (lines: readonly string[]) => Math.max(...lines.map((line) => line.length));
  let best: [string, string] = [words[0], words.slice(1).join(" ")];
  for (let split = 2; split < words.length; split += 1) {
    const candidate: [string, string] = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    if (longest(candidate) < longest(best)) best = candidate;
  }
  return best;
}
