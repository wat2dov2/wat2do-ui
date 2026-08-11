import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import QRCode from "qrcode";
import { createElement } from "react";
import satori from "satori";
import { z } from "zod";
import {
  LANDSCAPE_HEIGHT,
  LANDSCAPE_WIDTH,
  RECAP_HEIGHT,
  RECAP_WIDTH,
  SchoolClaimPoster,
  SchoolRecapPoster,
} from "./SchoolPosterTemplates.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDirectory, "..", "..");
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const imageUrl = z.string();
const schoolSchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    primary_color: z.string().min(1),
    secondary_color: z.string().min(1),
    timezone: z.string().min(1),
    site_url: z.string().min(1),
  })
  .strict();
const awardSchema = z
  .object({
    title: z.string(),
    organization: z.string(),
    handle: z.string(),
    description: z.string(),
    logo_url: imageUrl,
  })
  .strict();
const posterSchema = z
  .object({
    schema_version: z.literal(1),
    school: schoolSchema,
    term: z.object({ label: z.string(), start: z.string(), end: z.string() }).strict(),
    claims: z
      .object({
        observed_club_count: z.number().int().nonnegative(),
        all_time_event_count: z.number().int().nonnegative(),
      })
      .strict(),
    background_images: z.array(imageUrl),
    recap: z
      .object({
        event_count: z.number().int().nonnegative(),
        top_clubs: z.array(
          z
            .object({
              name: z.string(),
              handle: z.string(),
              logo_url: imageUrl,
              event_count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        food_linked_event_count: z.number().int().nonnegative(),
        food_mentions: z.array(
          z.object({ label: z.string(), count: z.number().int().nonnegative() }).strict(),
        ),
        food_examples: z.array(
          z.object({ title: z.string(), image_url: imageUrl }).strict(),
        ),
        busiest_date: z
          .object({ date: z.string(), label: z.string(), count: z.number().int().nonnegative() })
          .strict(),
        busiest_weekday: z.string(),
        quietest_weekday: z.string(),
        heatmap: z.array(
          z.object({ date: z.string(), count: z.number().int().nonnegative() }).strict(),
        ),
        awards: z.array(awardSchema).length(4),
      })
      .strict(),
  })
  .strict();

const FONT_FILES = [
  { file: "Satoshi-400.ttf", weight: 400 },
  { file: "Satoshi-500.ttf", weight: 500 },
  { file: "Satoshi-600.ttf", weight: 600 },
  { file: "Satoshi-700.ttf", weight: 700 },
];

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  const input = values.get("--input");
  const outputDirectory = values.get("--output-dir");
  if (!input || !outputDirectory) {
    throw new Error("Usage: render-school-posters.mjs --input FILE --output-dir DIRECTORY");
  }
  return { input: path.resolve(input), outputDirectory: path.resolve(outputDirectory) };
}

function localDataUri(file, mimeType) {
  return readFile(file).then((bytes) => `data:${mimeType};base64,${bytes.toString("base64")}`);
}

function isAllowedImageUrl(source) {
  if (!source) return false;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === "https:" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1" &&
    hostname !== "169.254.169.254" &&
    !hostname.endsWith(".local")
  );
}

async function inlineImage(source) {
  if (!isAllowedImageUrl(source)) return "";
  try {
    const response = await fetch(source, { redirect: "error" });
    if (!response.ok) return "";
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0];
    if (!contentType.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return "";
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

async function inlineModelImages(model) {
  const urls = new Set([
    ...model.background_images,
    ...model.recap.top_clubs.map((club) => club.logo_url),
    ...model.recap.food_examples.map((event) => event.image_url),
    ...model.recap.awards.map((award) => award.logo_url),
  ]);
  urls.delete("");

  const resolved = new Map();
  for (const source of [...urls].sort()) {
    resolved.set(source, await inlineImage(source));
  }
  const inline = (source) => resolved.get(source) ?? "";

  return {
    ...model,
    background_images: model.background_images.map(inline).filter(Boolean),
    recap: {
      ...model.recap,
      top_clubs: model.recap.top_clubs.map((club) => ({
        ...club,
        logo_url: inline(club.logo_url),
      })),
      food_examples: model.recap.food_examples
        .map((event) => ({ ...event, image_url: inline(event.image_url) }))
        .filter((event) => event.image_url),
      awards: model.recap.awards.map((award) => ({
        ...award,
        logo_url: inline(award.logo_url),
      })),
    },
  };
}

async function loadFonts() {
  return Promise.all(
    FONT_FILES.map(async ({ file, weight }) => ({
      name: "Satoshi",
      data: await readFile(path.join(frontendRoot, "public", "fonts", "slides", file)),
      weight,
      style: "normal",
    })),
  );
}

function pngDimensions(png) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Expected PNG output");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function renderPng(element, width, height, fonts) {
  const svg = await satori(element, { width, height, fonts });
  const png = Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "#FFFFFF" })
      .render()
      .asPng(),
  );
  assert.deepEqual(pngDimensions(png), { width, height });
  return png;
}

async function main() {
  const { input, outputDirectory } = parseArguments(process.argv.slice(2));
  const rawModel = posterSchema.parse(JSON.parse(await readFile(input, "utf8")));
  const [fonts, wasm, logo, goose, qr] = await Promise.all([
    loadFonts(),
    readFile(path.join(frontendRoot, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm")),
    localDataUri(path.join(frontendRoot, "public", "wat2do-logo.svg"), "image/svg+xml"),
    localDataUri(path.join(frontendRoot, "public", "images", "mr-goose.png"), "image/png"),
    QRCode.toDataURL("https://wat2do.io", {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
      color: { dark: "#000000", light: "#FFFFFF" },
    }),
  ]);
  await initWasm(wasm);
  const model = await inlineModelImages(rawModel);
  const assets = { logo, goose, qr };

  const outputs = [
    {
      file: "observed-clubs.png",
      width: LANDSCAPE_WIDTH,
      height: LANDSCAPE_HEIGHT,
      element: createElement(SchoolClaimPoster, { model, assets, kind: "clubs" }),
    },
    {
      file: "found-events.png",
      width: LANDSCAPE_WIDTH,
      height: LANDSCAPE_HEIGHT,
      element: createElement(SchoolClaimPoster, { model, assets, kind: "events" }),
    },
    {
      file: "semester-recap.png",
      width: RECAP_WIDTH,
      height: RECAP_HEIGHT,
      element: createElement(SchoolRecapPoster, { model, assets }),
    },
  ];

  for (const output of outputs) {
    const png = await renderPng(output.element, output.width, output.height, fonts);
    const outputPath = path.join(outputDirectory, output.file);
    await writeFile(outputPath, png);
    process.stdout.write(`Rendered ${output.file} (${output.width}x${output.height})\n`);
  }
}

await main();
