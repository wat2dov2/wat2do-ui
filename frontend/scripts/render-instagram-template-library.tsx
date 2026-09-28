/** Offline artwork review. No browser, server, credentials, or remote images. */
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import sharp from "sharp";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG = await readFile(path.join(frontendRoot, "public/instagram-cover-logo.svg"), "utf8");
const doodleDirectory = path.join(frontendRoot, "public/icons/club-categories");
process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS = JSON.stringify(Object.fromEntries(await Promise.all(
  (await readdir(doodleDirectory)).filter(file => file.endsWith(".svg")).map(async file => [
    `/icons/club-categories/${file}`, await readFile(path.join(doodleDirectory, file), "utf8"),
  ]),
)));
const { CAROUSEL_TEMPLATES, LibraryCoverSlide, LibraryEventSlide } = await import("../src/features/admin/components/instagram/slides/CarouselTemplateLibrary");
const { EventSlideTemplate } = await import("../src/features/admin/components/instagram/slides/SlideTemplates");
const { SLIDE_WIDTH, SLIDE_HEIGHT, buildCoverSlideModel, buildEventSlideModel } = await import("../src/features/admin/lib/instagramSlides");
const output = path.resolve(process.argv[2] ?? path.join(frontendRoot, "verify-out/instagram-library"));
await mkdir(output, { recursive: true });
const fonts = await Promise.all(([400, 500, 600, 700] as const).map(async weight => ({
  name: "Satoshi", weight, style: "normal" as const,
  data: await readFile(path.join(frontendRoot, `public/fonts/slides/Satoshi-${weight}.ttf`)),
})));
await initWasm(await readFile(path.join(frontendRoot, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));

async function png(element: ReactElement, width = SLIDE_WIDTH, height = SLIDE_HEIGHT) {
  const svg = await satori(element, { width, height, fonts });
  const bytes = Buffer.from(new Resvg(svg).render().asPng());
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  return bytes;
}

// Original sample artwork, explicitly labelled as examples in the review sheet.
const posters = await Promise.all([
  { title: "AFTER CLASS", detail: "Film night + conversation", color: "#ECC2F0", ink: "#31204C", width: 700, height: 900 },
  { title: "MAKE SOMETHING", detail: "A campus creative workshop", color: "#EB602E", ink: "#FFF2D7", width: 700, height: 900 },
  { title: "MEET YOUR PEOPLE", detail: "Clubs. Friends. New plans.", color: "#D1ECF5", ink: "#23393D", width: 700, height: 900 },
  { title: "AFTER CLASS", detail: "Film night + conversation", color: "#ECC2F0", ink: "#31204C", width: 1200, height: 800 },
].map(async ({ title, detail, color, ink, width, height }) => {
  const element = createElement("div", { style: { display: "flex", flexDirection: "column", justifyContent: "space-between", width, height, backgroundColor: color, color: ink, padding: 48, fontFamily: "Satoshi" } },
    createElement("div", { style: { display: "flex", fontSize: 25, letterSpacing: 5 } }, "CAMPUS / SAMPLE"),
    createElement("div", { style: { display: "flex", width: 260, height: 260, border: `45px solid ${ink}`, borderRadius: 130 } }),
    createElement("div", { style: { display: "flex", fontSize: 94, fontWeight: 700, lineHeight: 0.98, letterSpacing: -5 } }, title),
    createElement("div", { style: { display: "flex", fontSize: 29 } }, detail));
  return `data:image/png;base64,${(await png(element, width, height)).toString("base64")}`;
}));
const tiles = posters.slice(0, 3);
const avatar = `data:image/png;base64,${(await png(createElement("div", {
  style: { display: "flex", alignItems: "center", justifyContent: "center", width: 176, height: 176, backgroundColor: "#31204C", color: "#ECC2F0", fontFamily: "Satoshi", fontSize: 64, fontWeight: 700 },
}, "CF"), 176, 176)).toString("base64")}`;

const event = {
  id: 1, title: "Film night, then the conversation", category: "Arts & Culture",
  club: "Campus Film Society", ig_handle: "@campus.film", club_logo_url: avatar, school: "uwaterloo", tz: "America/Toronto",
  description: "Meet us after class for a film and a conversation. Bring a friend, or find your next film buddy here.",
  dtstart_utc: "2026-10-02T23:00:00Z", dtend_utc: "2026-10-03T01:00:00Z",
  location: "Student Life Centre · Room 210", source_image_url: tiles[0],
};
const outputs: Buffer[] = [];
const productionOutputs: Buffer[] = [];
for (const language of ["en", "fr"] as const) {
  const cover = buildCoverSlideModel({
    school: "uwaterloo", language, colors: { primary: "#FFD54A", secondary: "#171A16" },
    localDate: "2026-09-25", newEventCount: 8, eventCount: 8,
    body: language === "en" ? "Your next plan is in here. Save this for the group chat." : "Votre prochaine sortie est ici. À partager avec vos amis.", tiles,
  });
  const slide = await buildEventSlideModel(event, language);
  for (const template of CAROUSEL_TEMPLATES) {
    for (const [kind, element] of [
      ["cover", createElement(LibraryCoverSlide, { model: cover, template: template.id })],
      ["event", createElement(LibraryEventSlide, { model: slide, template: template.id })],
    ] as const) {
      const bytes = await png(element);
      await writeFile(path.join(output, `${template.id}-${kind}-${language}.png`), bytes);
      if (language === "en") outputs.push(bytes);
    }
    await png(createElement(LibraryCoverSlide, { model: { ...cover, tiles: [], newEventCount: 125 }, template: template.id }));
    await png(createElement(LibraryEventSlide, { model: { ...slide, imageSrc: "", author: "", siteName: "", badges: [] }, template: template.id }));
  }
  const caption = language === "en" ? event.description : "Après les cours, retrouvons-nous pour un film et une discussion. Venez avec des amis ou rencontrez d’autres cinéphiles sur place.";
  const productionEvent = { ...event, description: caption };
  const productionExamples = [
    ["landscape", await buildEventSlideModel({ ...productionEvent, source_image_url: posters[3] }, language)],
    ["portrait", await buildEventSlideModel(productionEvent, language)],
    ["long-caption", await buildEventSlideModel({ ...productionEvent, source_image_url: posters[3], description: Array(12).fill(caption).join(" ") }, language)],
    ["sparse", await buildEventSlideModel({ id: 2, title: "A campus gathering", category: "Arts & Culture", school: "uwaterloo", tz: "America/Toronto" }, language)],
  ] as const;
  for (const [kind, model] of productionExamples) {
    const bytes = await png(createElement(EventSlideTemplate, { model }));
    await writeFile(path.join(output, `production-event-${kind}-${language}.png`), bytes);
    productionOutputs.push(bytes);
  }
}
assert.equal(new Set(outputs.map(bytes => bytes.toString("base64"))).size, 8, "Every design must produce distinct artwork");
const libraryRows = [0, 1].flatMap(row => outputs.filter((_, index) => index % 2 === row));
for (const [filename, slides] of [["contact-sheet.png", libraryRows], ["production-contact-sheet.png", productionOutputs]] as const) {
  const thumbs = await Promise.all(slides.map(input => sharp(input).resize(270, 338).png().toBuffer()));
  await sharp({ create: { width: 1128, height: 716, channels: 4, background: "#DADAD5" } })
    .composite(thumbs.map((input, index) => ({ input, left: 12 + (index % 4) * 282, top: 12 + Math.floor(index / 4) * 354 })))
    .png().toFile(path.join(output, filename));
}
await writeFile(path.join(output, "README.md"), `# Wat2Do carousel template library\n\nSample event data and original demonstration posters.\nNot real event announcements.\n\n${CAROUSEL_TEMPLATES.map(template => `- **${template.name}** (${template.id}): ${template.use}`).join("\n")}\n\nEach library family has English and French cover and event PNGs, all 1080 × 1350.\nThe library contact sheet preserves the four alternative design families.\n\nThe eight production-event PNGs use the same EventSlideTemplate as the publishing preview and render route.\nThey show landscape posters, portrait posters, long captions, and sparse data in English and French.\nThe production contact sheet has English examples in the first row and French examples in the second row.\nAll sample artwork, including the club avatar, is generated offline.\n`);
process.stdout.write(`Rendered 16 library PNGs and 8 production PNGs; 16 additional sparse-data library renders passed.\n${output}\n`);
