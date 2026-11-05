import { readFile } from "node:fs/promises";
import path from "node:path";

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
