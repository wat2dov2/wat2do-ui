"use client";

import { useEffect, useRef } from "react";
import atlasImage from "@/assets/event-mosaic-uwaterloo.webp";
import atlasManifest from "@/assets/event-mosaic-uwaterloo.json";
import { startEventPixelMosaic, type MosaicLook } from "@/features/landing/lib/eventPixelMosaic";
import { cn } from "@/shared/lib/utils";

/**
 * - `spotlight`: large cells behind a headline, calm in the middle where the words sit.
 * - `ambient`: smaller cells under a product illustration, evenly dimmed.
 * - `band`: smaller cells shown nearly at full colour, where nothing has to be read.
 */
export type EventPixelMosaicVariant = "spotlight" | "ambient" | "band";

const LOOKS: Record<EventPixelMosaicVariant, MosaicLook> = {
  spotlight: { tileSize: 36, gutter: 2, waveSpeed: 9, twinkle: 0.01 },
  ambient: { tileSize: 24, gutter: 1, waveSpeed: 12, twinkle: 0.015 },
  band: { tileSize: 24, gutter: 1, waveSpeed: 14, twinkle: 0.02 },
};

/** The page's background washed over the posters, so text and cards on top stay readable in either theme. */
const SCRIMS: Record<EventPixelMosaicVariant, string> = {
  spotlight:
    "bg-background/85 sm:bg-transparent sm:bg-[radial-gradient(ellipse_70%_65%_at_center,color-mix(in_oklab,var(--background)_94%,transparent)_35%,color-mix(in_oklab,var(--background)_45%,transparent)_100%)]",
  ambient: "bg-background/75",
  band: "bg-background/15",
};

/**
 * A full-bleed grid of real scraped event posters, each a few pixels square,
 * swapping in waves. Fills its positioned parent; decorative only. Under
 * reduced motion it is a still mosaic.
 */
export function EventPixelMosaic({ variant }: { variant: EventPixelMosaicVariant }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const image = new Image();
    let stop = () => {};
    const start = () => {
      if (!image.complete || image.naturalWidth === 0) return;
      stop();
      stop = startEventPixelMosaic(canvas, { image, ...atlasManifest }, LOOKS[variant], !motion.matches);
    };
    image.decoding = "async";
    image.onload = start;
    image.src = atlasImage.src;
    motion.addEventListener("change", start);
    return () => {
      image.onload = null;
      motion.removeEventListener("change", start);
      stop();
    };
  }, [variant]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} data-slot="event-pixel-mosaic" className="block [image-rendering:pixelated]" />
      <div className={cn("absolute inset-0", SCRIMS[variant])} />
    </div>
  );
}
