/**
 * Builds the landing page's event mosaic from a school's scraped events: the
 * newest posters packed into one WebP atlas at thumbnail resolution, a tiny
 * copy of the same atlas for first paint, and a manifest with each poster's
 * public event details and average colour, plus the Wat2Do logo as a colour mask. The page
 * draws from these files only, so it never downloads posters one by one.
 *
 * Reads the public events API (every event, past ones included) and each
 * poster's stored thumbnail; it writes nothing anywhere but the three assets.
 *
 *   npm run build-event-mosaic                      # uwaterloo from production
 *   npm run build-event-mosaic -- --school utsg --api http://127.0.0.1:8000
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import imageDelivery from "../../backend/controlbox/image_delivery.json" with { type: "json" };
import uploads from "../../backend/controlbox/uploads.json" with { type: "json" };

/** Pixels per poster side: sharp at the largest cell the page draws (40 CSS px) on a 2x screen, near enough. */
const TILE_PIXELS = 64;
/** Pixels per poster side in the first-paint atlas. */
const PREVIEW_TILE_PIXELS = 8;
/** Posters per atlas row. */
const ATLAS_COLUMNS = 20;
/**
 * The newest posters kept per topic the hero's headline names, so each of its
 * waves can refill the grid with that topic alone. About 400 in all, a few
 * hundred KB. Every open club position with a poster is kept.
 */
const TOPIC_QUOTAS = { networking: 100, social: 100, position: 80, other: 120 };
/** The logo mask's width in samples; its height follows the logo's shape. */
const LOGO_MASK_WIDTH = 80;
const PAGE_SIZE = 100;
const DOWNLOAD_CONCURRENCY = 8;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, "..");
const assetsDirectory = path.join(frontendDirectory, "src", "assets");

const { values: options } = parseArgs({
  options: {
    school: { type: "string", default: "uwaterloo" },
    api: { type: "string", default: "https://api.wat2do.io" },
  },
});

/** The stored thumbnail beside an uploaded poster (see `posterThumbnailUrl` in src/shared/utils/media.ts). */
function thumbnailUrl(src) {
  const url = new URL(src);
  const folder = "/event-images/";
  if (url.origin !== imageDelivery.media_origin || !url.pathname.startsWith(folder)) return src;
  const name = url.pathname.slice(folder.length);
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${url.origin}${folder}${stem}${uploads.thumbnail_suffix}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * Which headline topic an event's poster belongs to, from what the feed already
 * knows: employer events and business clubs are networking, games and
 * recreation clubs are social. Everything else shows only in the mixed grid.
 */
function eventTopic(event) {
  if (event.employers_on_campus || event.category === "Business") return "networking";
  if (event.category === "Games & Recreation") return "social";
  return "other";
}

/** One event per poster, newest event first, with only what its public card already shows. */
async function collectPosterEvents() {
  const byImage = new Map();
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), school: options.school, include_past: "true" });
    const body = await fetchJson(`${options.api.replace(/\/$/, "")}/events/?${params}`);
    for (const event of body.items) {
      const occurrence = event.occurrences?.[0];
      if (!event.source_image_url || event.cancelled || !occurrence?.dtstart_utc) continue;
      const known = byImage.get(event.source_image_url);
      if (known && known.id > event.id) continue;
      byImage.set(event.source_image_url, {
        id: event.id,
        kind: "event",
        topic: eventTopic(event),
        title: event.title,
        club: event.club ?? null,
        start: occurrence.dtstart_utc,
        end: occurrence.dtend_utc ?? null,
        image: event.source_image_url,
      });
    }
    if (page >= body.total_pages) return { total: body.total, events: [...byImage.values()].sort((a, b) => b.id - a.id) };
  }
}

/** Every open club position with a poster, as the positions page lists them. */
async function collectPositions() {
  const positions = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), school: options.school });
    const body = await fetchJson(`${options.api.replace(/\/$/, "")}/positions/?${params}`);
    for (const position of body.items) {
      if (!position.source_image_url) continue;
      positions.push({
        id: position.id,
        kind: "position",
        topic: "position",
        title: position.title,
        club: position.club_name ?? null,
        start: position.deadline_at ?? null,
        end: null,
        image: position.source_image_url,
      });
    }
    if (page >= body.total_pages) return positions.sort((a, b) => b.id - a.id);
  }
}

/** One poster as TILE_PIXELS square raw RGB, or null when it cannot be read. */
async function shrinkPoster(url) {
  for (const candidate of [thumbnailUrl(url), url]) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      return await sharp(Buffer.from(await response.arrayBuffer()))
        .resize(TILE_PIXELS, TILE_PIXELS, { fit: "cover", position: "attention" })
        .removeAlpha()
        .raw()
        .toBuffer();
    } catch {
      // A missing or unreadable file falls through to the original, then to skipping it.
    }
  }
  return null;
}

/** Shrinks posters in order until `quota` are read, keeping each tile beside its event. */
async function shrinkAll(events, quota) {
  const results = new Array(events.length);
  let next = 0;
  async function worker() {
    while (next < events.length) {
      const index = next++;
      if (results.slice(0, index).filter(Boolean).length >= quota) return;
      results[index] = await shrinkPoster(events[index].image);
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  return events
    .map((event, index) => ({ event, tile: results[index] }))
    .filter(({ tile }) => tile)
    .slice(0, quota);
}

async function writeAtlas(tiles, tilePixels, fileName, quality) {
  const rows = Math.ceil(tiles.length / ATLAS_COLUMNS);
  const width = ATLAS_COLUMNS * TILE_PIXELS;
  const atlas = Buffer.alloc(width * rows * TILE_PIXELS * 3);
  tiles.forEach((tile, index) => {
    const left = (index % ATLAS_COLUMNS) * TILE_PIXELS;
    const top = Math.floor(index / ATLAS_COLUMNS) * TILE_PIXELS;
    for (let y = 0; y < TILE_PIXELS; y += 1) {
      tile.copy(atlas, ((top + y) * width + left) * 3, y * TILE_PIXELS * 3, (y + 1) * TILE_PIXELS * 3);
    }
  });
  const output = path.join(assetsDirectory, fileName);
  const info = await sharp(atlas, { raw: { width, height: rows * TILE_PIXELS, channels: 3 } })
    .resize(ATLAS_COLUMNS * tilePixels, rows * tilePixels, { kernel: "lanczos3" })
    .webp({ quality, effort: 6, smartSubsample: true })
    .toFile(output);
  console.log(`${fileName}: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB`);
}

/**
 * The Wat2Do logo's own colours (the strokes in public/wat2do-logo.svg), by the
 * letter the mask uses for each. The beak's grey reads as the head's black.
 */
const LOGO_COLOURS = { b: "#0056D6", k: "#1E1E1E", n: "#835B40" };
const LOGO_PALETTE = [
  ["b", [0x00, 0x56, 0xd6]],
  ["k", [0x1e, 0x1e, 0x1e]],
  ["k", [0x47, 0x47, 0x47]],
  ["n", [0x83, 0x5b, 0x40]],
  [".", [0xff, 0xff, 0xff]],
];
/** Pixels sampled per mask cell side, so each cell takes the colour most of it is. */
const LOGO_SUPERSAMPLE = 4;

/**
 * The logo as rows of colour letters, one per sample: "b" blue lettering, "k"
 * the goose's black, "n" its brown, "." paper (the logo's white counters and
 * cheek are paper too). Small enough to ship in the manifest.
 */
async function logoMask() {
  const logo = path.join(frontendDirectory, "public", "wat2do-logo.svg");
  const { width, height } = await sharp(logo).metadata();
  const maskHeight = Math.round((LOGO_MASK_WIDTH * height) / width);
  const sampleWidth = LOGO_MASK_WIDTH * LOGO_SUPERSAMPLE;
  const pixels = await sharp(logo, { density: 216 })
    .flatten({ background: "#ffffff" })
    .resize(sampleWidth, maskHeight * LOGO_SUPERSAMPLE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const nearest = (offset) => {
    let best = ".";
    let distance = Infinity;
    for (const [letter, [r, g, b]] of LOGO_PALETTE) {
      const d = (pixels[offset] - r) ** 2 + (pixels[offset + 1] - g) ** 2 + (pixels[offset + 2] - b) ** 2;
      if (d < distance) [best, distance] = [letter, d];
    }
    return best;
  };
  return Array.from({ length: maskHeight }, (_, y) => Array.from({ length: LOGO_MASK_WIDTH }, (_, x) => {
    const votes = {};
    for (let sy = 0; sy < LOGO_SUPERSAMPLE; sy += 1) {
      for (let sx = 0; sx < LOGO_SUPERSAMPLE; sx += 1) {
        const letter = nearest(((y * LOGO_SUPERSAMPLE + sy) * sampleWidth + x * LOGO_SUPERSAMPLE + sx) * 3);
        votes[letter] = (votes[letter] ?? 0) + 1;
      }
    }
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  }).join(""));
}

/** A tile's average colour, so the logo can be built from posters that already wear its colours. */
function averageColour(tile) {
  const sums = [0, 0, 0];
  for (let offset = 0; offset < tile.length; offset += 3) for (let channel = 0; channel < 3; channel += 1) sums[channel] += tile[offset + channel];
  const pixels = tile.length / 3;
  return `#${sums.map((sum) => Math.round(sum / pixels).toString(16).padStart(2, "0")).join("")}`;
}

const { total, events } = await collectPosterEvents();
const positions = await collectPositions();
console.log(`${total} ${options.school} events, ${events.length} distinct posters with a date, ${positions.length} open positions with a poster`);
const packed = [];
for (const [topic, quota] of Object.entries(TOPIC_QUOTAS)) {
  const candidates = topic === "position" ? positions : events.filter((event) => event.topic === topic);
  const read = await shrinkAll(candidates, quota);
  console.log(`${topic}: ${read.length} posters`);
  packed.push(...read);
}
if (packed.length === 0) throw new Error("No posters could be read");
const tiles = packed.map(({ tile }) => tile);

await writeAtlas(tiles, TILE_PIXELS, `event-mosaic-${options.school}.webp`, 72);
await writeAtlas(tiles, PREVIEW_TILE_PIXELS, `event-mosaic-${options.school}-preview.webp`, 70);
await writeFile(
  path.join(assetsDirectory, `event-mosaic-${options.school}.json`),
  `${JSON.stringify({
    school: options.school,
    tilePixels: TILE_PIXELS,
    previewTilePixels: PREVIEW_TILE_PIXELS,
    columns: ATLAS_COLUMNS,
    eventCount: total,
    logoColours: LOGO_COLOURS,
    logoMask: await logoMask(),
    // "other" only ever shows in the mixed grid, so it is stored as no topic.
    posters: packed.map(({ event, tile }) => ({ ...event, topic: event.topic === "other" ? null : event.topic, colour: averageColour(tile) })),
  })}\n`,
);
console.log(`Packed ${packed.length} posters`);
