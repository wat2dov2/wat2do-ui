/**
 * Builds the landing page's event mosaic: the posters of a school's scraped
 * events, each shrunk to a few pixels square and packed into one WebP atlas,
 * with a small manifest beside it. The landing page draws from this file only,
 * so it never downloads hundreds of posters at runtime.
 *
 * Reads the public events API (every event, past ones included) and each
 * poster's stored thumbnail; it writes nothing anywhere but the two assets.
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

/** Pixels on each side of one poster in the atlas; the page scales them up crisp. */
const TILE_PIXELS = 12;
/** Posters per atlas row. */
const ATLAS_COLUMNS = 32;
/** The newest posters kept: enough that the mosaic rarely repeats, small enough to load with the page. */
const MAX_POSTERS = 768;
const PAGE_SIZE = 100;
const DOWNLOAD_CONCURRENCY = 8;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const assetsDirectory = path.resolve(scriptDirectory, "..", "src", "assets");

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

/** Every poster URL the school's events carry, newest event first, each once. */
async function collectPosterUrls() {
  const posters = new Map();
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), school: options.school, include_past: "true" });
    const body = await fetchJson(`${options.api.replace(/\/$/, "")}/events/?${params}`);
    for (const event of body.items) {
      if (event.source_image_url && !posters.has(event.source_image_url)) posters.set(event.source_image_url, event.id);
    }
    if (page >= body.total_pages) return { total: body.total, urls: [...posters].sort((a, b) => b[1] - a[1]).map(([url]) => url) };
  }
}

/** One poster as TILE_PIXELS square raw RGB, or null when it cannot be read. */
async function shrinkPoster(url) {
  for (const candidate of [thumbnailUrl(url), url]) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      return await sharp(Buffer.from(await response.arrayBuffer()))
        .resize(TILE_PIXELS, TILE_PIXELS, { fit: "cover", position: "attention", kernel: "lanczos3" })
        .removeAlpha()
        .raw()
        .toBuffer();
    } catch {
      // A missing or unreadable file falls through to the original, then to skipping it.
    }
  }
  return null;
}

async function shrinkAll(urls) {
  const tiles = [];
  let next = 0;
  async function worker() {
    while (next < urls.length && tiles.length < MAX_POSTERS) {
      const tile = await shrinkPoster(urls[next++]);
      if (tile && tiles.length < MAX_POSTERS) tiles.push(tile);
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  return tiles;
}

const { total, urls } = await collectPosterUrls();
console.log(`${total} ${options.school} events, ${urls.length} distinct posters`);
const tiles = await shrinkAll(urls);
if (tiles.length === 0) throw new Error("No posters could be read");

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

// Quality 90 keeps each poster's few pixels true at about a third of the lossless size.
await sharp(atlas, { raw: { width, height: rows * TILE_PIXELS, channels: 3 } })
  .webp({ quality: 90, effort: 6 })
  .toFile(path.join(assetsDirectory, `event-mosaic-${options.school}.webp`));
await writeFile(
  path.join(assetsDirectory, `event-mosaic-${options.school}.json`),
  `${JSON.stringify({ school: options.school, tilePixels: TILE_PIXELS, columns: ATLAS_COLUMNS, count: tiles.length, eventCount: total }, null, 2)}\n`,
);
console.log(`Packed ${tiles.length} posters into a ${width}x${rows * TILE_PIXELS} atlas`);
