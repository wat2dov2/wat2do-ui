import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, type Font } from "@shuding/opentype.js";

// Images drawn on the server (carousel slides, link previews) are set in
// Satoshi, the site's face. Every weight the templates ask for is loaded,
// since satori substitutes the nearest weight it has.
//
// These are static instances rather than the variable `Satoshi-Variable.woff2`
// the app itself loads, for two reasons: satori reads ttf/otf/woff and not
// woff2, and it renders a variable font at a single instance rather than
// honouring the weight axis. Generated from that same source file with fontTools:
//   instantiateVariableFont(TTFont(src), {"wght": w}) for w in 400/500/600/700.
// They are read from disk at request time, so next.config.ts traces them into
// every route that draws an image.
const FONT_FILES = [
  { file: "Satoshi-400.ttf", weight: 400 as const },
  { file: "Satoshi-500.ttf", weight: 500 as const },
  { file: "Satoshi-600.ttf", weight: 600 as const },
  { file: "Satoshi-700.ttf", weight: 700 as const },
];

type ImageFontWeight = (typeof FONT_FILES)[number]["weight"];

let fontsPromise: Promise<
  { name: string; data: Buffer; weight: ImageFontWeight; style: "normal" }[]
> | null = null;

/** Satoshi at every drawn weight, read once per server process. */
export function loadImageFonts() {
  fontsPromise ??= Promise.all(
    FONT_FILES.map(async ({ file, weight }) => ({
      name: "Satoshi",
      data: await readFile(
        path.join(process.cwd(), "public", "fonts", "slides", file),
      ),
      weight,
      style: "normal" as const,
    })),
  );
  return fontsPromise;
}

/** The faces satori parses from the same files, keyed by weight. */
let facesPromise: Promise<Map<ImageFontWeight, Font>> | null = null;

function loadImageFaces() {
  facesPromise ??= loadImageFonts().then(fonts => new Map(fonts.map(({ weight, data }) => [
    weight,
    parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { lowMemory: true }),
  ])));
  return facesPromise;
}

const ELLIPSIS = "…";

/**
 * `text` as one line of at most `maxWidth` pixels: whole, or cut after the
 * grapheme where satori's own ellipsis would cut it, with "…" appended.
 *
 * satori ellipsizes inside a box that keeps the full width, which leaves a gap
 * of up to a glyph after the "…". Cutting the text here instead lets its box end
 * exactly where its last glyph does, so whatever follows (a verified check)
 * sits right after it. Widths are measured as satori lays text out: each
 * grapheme's advance, from the same font engine and files.
 */
export async function fitImageText(
  text: string,
  maxWidth: number,
  { fontSize, fontWeight }: { fontSize: number; fontWeight: ImageFontWeight },
): Promise<string> {
  const face = (await loadImageFaces()).get(fontWeight);
  if (!face) throw new Error(`Satoshi ${fontWeight} is not loaded for image text`);
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(({ segment }) => segment);
  const widths = graphemes.map(grapheme => face.getAdvanceWidth(grapheme, fontSize));
  if (widths.reduce((sum, width) => sum + width, 0) <= maxWidth) return text;
  const room = maxWidth - face.getAdvanceWidth(ELLIPSIS, fontSize);
  let kept = 1;
  for (let used = widths[0]; kept < graphemes.length && used + widths[kept] <= room; kept++) used += widths[kept];
  return `${graphemes.slice(0, kept).join("").trimEnd()}${ELLIPSIS}`;
}
