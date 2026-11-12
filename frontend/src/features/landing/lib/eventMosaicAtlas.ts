import fullAtlasImage from "@/assets/event-mosaic-uwaterloo.webp";
import previewAtlasImage from "@/assets/event-mosaic-uwaterloo-preview.webp";
import type { MosaicAtlas } from "@/features/landing/lib/eventPixelMosaic";

/** The manifest `npm run build-event-mosaic` writes beside the atlases. */
export type MosaicManifest = typeof import("@/assets/event-mosaic-uwaterloo.json");

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

let manifest: Promise<MosaicManifest> | null = null;
let preview: Promise<MosaicAtlas> | null = null;
let full: Promise<MosaicAtlas> | null = null;

/**
 * The manifest and both atlases, each fetched once however many mosaics the
 * page shows. The manifest is its own chunk, so a page without a mosaic in
 * view never downloads it.
 */
export function loadMosaicManifest(): Promise<MosaicManifest> {
  manifest ??= import("@/assets/event-mosaic-uwaterloo.json").then((module) => module.default);
  return manifest;
}

/** Where the first-paint copy is, for a page whose mosaic shows first to preload. */
export const previewAtlasUrl = previewAtlasImage.src;

/** The 16 px copy for first paint. */
export function loadPreviewAtlas(): Promise<MosaicAtlas> {
  preview ??= Promise.all([loadMosaicManifest(), loadImage(previewAtlasImage.src)]).then(([{ previewTilePixels, columns, posters }, image]) => ({
    image, tilePixels: previewTilePixels, columns, count: posters.length,
  }));
  return preview;
}

/** The full-resolution atlas, sharp at the page's largest cells on a 2x screen. */
export function loadFullAtlas(): Promise<MosaicAtlas> {
  full ??= Promise.all([loadMosaicManifest(), loadImage(fullAtlasImage.src)]).then(([{ tilePixels, columns, posters }, image]) => ({
    image, tilePixels, columns, count: posters.length,
  }));
  return full;
}
