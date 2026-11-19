/**
 * The blue "Featured" sticker the emulator puts on each carousel story, drawn like the
 * slides' stickers (SlideSticker's pill, Satoshi bold, white outline, a slight tilt).
 * Transparent margins keep it badge-sized: Instagram shows a photo sticker at a fixed
 * width, whatever its pixel size. Run from frontend/: node scripts/render-featured-story-sticker.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(frontendRoot, "../backend/services/instagram_emulator/assets");
const fonts = [{ name: "Satoshi", weight: 700, style: "normal", data: await readFile(path.join(frontendRoot, "public/fonts/slides/Satoshi-700.ttf")) }];
await initWasm(await readFile(path.join(frontendRoot, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));

const SCALE = 3;
const WIDTH = 208 * SCALE, HEIGHT = 90 * SCALE, MARGIN = 80 * SCALE;
const BLUE = "#C5EDFF"; // SlideSticker's blue
const h = (type, style, ...children) => ({ type, props: { style, children } });
for (const [language, label] of [["en", "Featured"], ["fr", "En vedette"]]) {
  const pill = { type: "svg", props: { width: WIDTH, height: HEIGHT, viewBox: "0 0 260 108", style: { position: "absolute", left: 0, top: 0 },
    children: { type: "rect", props: { x: 4, y: 4, width: 252, height: 100, rx: 50, fill: BLUE, stroke: "white", strokeWidth: 6 } } } };
  const sticker = h("div", { display: "flex", width: WIDTH + MARGIN * 2, height: HEIGHT + MARGIN * 2, alignItems: "center", justifyContent: "center" },
    h("div", { display: "flex", position: "relative", width: WIDTH, height: HEIGHT, alignItems: "center", justifyContent: "center", transform: "rotate(4deg)" },
      pill,
      h("div", { display: "flex", position: "relative", fontFamily: "Satoshi", fontWeight: 700, fontSize: 30 * SCALE, color: "#171717" }, label)));
  const svg = await satori(sticker, { width: WIDTH + MARGIN * 2, height: HEIGHT + MARGIN * 2, fonts });
  await writeFile(path.join(output, `featured_sticker_${language}.png`), Buffer.from(new Resvg(svg).render().asPng()));
}
