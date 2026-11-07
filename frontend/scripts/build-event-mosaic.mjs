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

/** Pixels per poster side: at least twice the largest cell the page draws (36 CSS px), so every cell is crisp on a 2x screen. */
const TILE_PIXELS = 80;
/** Pixels per poster side in the first-paint atlas, drawn smoothed until the full one arrives. */
const PREVIEW_TILE_PIXELS = 16;
/** Posters per atlas row. */
const ATLAS_COLUMNS = 20;
/**
 * The newest posters kept per topic the hero's headline names, so each of its
 * waves can refill the grid with that topic alone. About 400 in all, a few
 * hundred KB. Every open club position with a poster is kept.
 */
const TOPIC_QUOTAS = { networking: 70, social: 70, position: 80, other: 80 };
/**
 * How many of the newest untopical posters are read to choose the "other"
 * quota from: the ones whose dominant colour is nearest each logo colour go in
 * first, so the logo can be built from untouched posters.
 */
const OTHER_CANDIDATES = 1200;
/** Of the "other" quota, how many are chosen per logo colour before the newest fill the rest: most for the blue lettering, the bulk of the logo. */
const LOGO_PICKS = { b: 44, k: 12, n: 12 };
/** How near (RGB distance) a dominant colour must be to count as matching a logo colour, for the build's report. */
const LOGO_MATCH_DISTANCE = 90;
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

const hex = (rgb) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * A poster's dominant colour: k-means over its pixels, the centre of the
 * largest cluster, with the share of the poster it covers. An average would
 * call a blue-and-orange poster grey; this calls it blue or orange.
 */
function dominantColour(tile) {
  const pixels = [];
  // Every fourth pixel in both directions is plenty for a colour census.
  for (let y = 0; y < TILE_PIXELS; y += 4) {
    for (let x = 0; x < TILE_PIXELS; x += 4) {
      const offset = (y * TILE_PIXELS + x) * 3;
      pixels.push([tile[offset], tile[offset + 1], tile[offset + 2]]);
    }
  }
  const byLight = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = [0.1, 0.4, 0.6, 0.9].map((share) => [...byLight[Math.floor(share * (byLight.length - 1))]]);
  let members = [];
  for (let round = 0; round < 10; round += 1) {
    members = centres.map(() => []);
    for (const pixel of pixels) {
      let best = 0;
      for (let index = 1; index < centres.length; index += 1) if (distance(pixel, centres[index]) < distance(pixel, centres[best])) best = index;
      members[best].push(pixel);
    }
    centres = centres.map((centre, index) => members[index].length
      ? [0, 1, 2].map((channel) => members[index].reduce((sum, pixel) => sum + pixel[channel], 0) / members[index].length)
      : centre);
  }
  const largest = members.reduce((best, cluster, index) => (cluster.length > members[best].length ? index : best), 0);
  return { colour: hex(centres[largest]), share: Math.round((members[largest].length / pixels.length) * 100) / 100, rgb: centres[largest] };
}

const LOGO_RGB = Object.fromEntries(Object.entries(LOGO_COLOURS).map(([letter, value]) => [letter, [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16))]));

/** The newest untopical posters, with those nearest each logo colour moved in first. */
function chooseOthers(read) {
  const withColour = read.map((entry) => ({ ...entry, dominant: dominantColour(entry.tile) }));
  const chosen = new Set();
  for (const [letter, target] of Object.entries(LOGO_RGB)) {
    withColour
      .filter((entry) => !chosen.has(entry))
      .sort((a, b) => distance(a.dominant.rgb, target) / a.dominant.share - distance(b.dominant.rgb, target) / b.dominant.share)
      .slice(0, LOGO_PICKS[letter])
      .forEach((entry) => chosen.add(entry));
  }
  for (const entry of withColour) {
    if (chosen.size >= TOPIC_QUOTAS.other) break;
    chosen.add(entry);
  }
  return [...chosen];
}

const { total, events } = await collectPosterEvents();
const positions = await collectPositions();
console.log(`${total} ${options.school} events, ${events.length} distinct posters with a date, ${positions.length} open positions with a poster`);
const packed = [];
for (const [topic, quota] of Object.entries(TOPIC_QUOTAS)) {
  const candidates = topic === "position" ? positions : events.filter((event) => event.topic === topic);
  const read = topic === "other" ? chooseOthers(await shrinkAll(candidates, OTHER_CANDIDATES)) : await shrinkAll(candidates, quota);
  console.log(`${topic}: ${read.length} posters`);
  packed.push(...read);
}
if (packed.length === 0) throw new Error("No posters could be read");
const tiles = packed.map(({ tile }) => tile);

await writeAtlas(tiles, TILE_PIXELS, `event-mosaic-${options.school}.webp`, 74);
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
    posters: packed.map(({ event, tile }) => {
      const { colour, share } = dominantColour(tile);
      return { ...event, topic: event.topic === "other" ? null : event.topic, colour, colourShare: share };
    }),
  })}\n`,
);
console.log(`Packed ${packed.length} posters`);
for (const [letter, target] of Object.entries(LOGO_RGB)) {
  const near = packed.filter(({ tile }) => distance(dominantColour(tile).rgb, target) < LOGO_MATCH_DISTANCE).length;
  console.log(`posters whose dominant colour is near logo "${letter}": ${near}`);
}
