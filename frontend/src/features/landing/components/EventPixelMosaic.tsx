"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { loadFullAtlas, loadMosaicManifest, loadPreviewAtlas } from "@/features/landing/lib/eventMosaicAtlas";
import { startEventPixelMosaic, type MosaicController, type MosaicLook } from "@/features/landing/lib/eventPixelMosaic";
import { cn } from "@/shared/lib/utils";

/**
 * - `logo`: small cells that spell the Wat2Do logo, in posters that wear its
 *   colours, out of a muted grid; still until its page asks for a wave.
 * - `ambient`: larger muted cells behind a closing line, with one slow wave of
 *   the whole collection now and then.
 * The atlas holds 80 px posters, at least twice either cell size, so cells stay crisp on a 2x screen.
 */
export type EventPixelMosaicVariant = "logo" | "ambient";

const LOOKS: Record<EventPixelMosaicVariant, MosaicLook> = {
  logo: { tileSize: 18, gutter: 2, waveMs: 900, tone: "logo" },
  ambient: { tileSize: 28, gutter: 2, waveMs: 1800, idleWaveMs: 11000, tone: "muted" },
};

interface EventPixelMosaicProps {
  variant: EventPixelMosaicVariant;
  /** For `logo`: the element the logo is drawn behind, in the same card. */
  logoRegion?: RefObject<HTMLElement | null>;
  /** Hands over the running mosaic, for a page that drives its waves. */
  onReady?: (controller: MosaicController) => void;
}

/**
 * A grid of real scraped event posters. Fills its positioned parent and is
 * decorative. Nothing downloads until it nears the viewport; a 16 px copy
 * paints first and the sharp atlas follows. Under reduced motion it is a still
 * mosaic of every poster.
 */
export function EventPixelMosaic({ variant, logoRegion, onReady }: EventPixelMosaicProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let controller: MosaicController | null = null;
    let cancelled = false;

    const region = () => {
      const element = logoRegion?.current;
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const origin = canvas.getBoundingClientRect();
      return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
    };

    const start = async () => {
      const [manifest, preview] = await Promise.all([loadMosaicManifest(), loadPreviewAtlas()]);
      if (cancelled) return;
      controller?.stop();
      controller = startEventPixelMosaic(canvas, preview, LOOKS[variant], !motion.matches, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
        logoRegion: region,
      });
      setReady(true);
      onReadyRef.current?.(controller);
      const full = await loadFullAtlas();
      if (!cancelled) controller.setAtlas(full);
    };
    const restart = () => void start().catch(() => {});

    // Wait until the mosaic is about to scroll into view before fetching anything.
    const nearby = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      nearby.disconnect();
      restart();
    }, { rootMargin: "400px" });
    nearby.observe(canvas);
    motion.addEventListener("change", restart);
    return () => {
      cancelled = true;
      nearby.disconnect();
      motion.removeEventListener("change", restart);
      controller?.stop();
    };
  }, [variant, logoRegion]);

  return (
    // Until the first atlas paints, the face shows the skeleton tone the rest of the app loads with.
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", !ready && "bg-muted")}>
      <canvas
        ref={canvasRef}
        data-slot="event-pixel-mosaic"
        className={cn("block motion-safe:transition-opacity motion-safe:duration-500", ready ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}

/** A soft wash of the card's face behind a block of text on a mosaic, so the text reads at AA whatever the posters are. */
export function LandingMosaicScrim() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-x-6 -inset-y-10 bg-[radial-gradient(closest-side,var(--surface-elevated)_72%,transparent)] sm:-inset-x-24 sm:-inset-y-16"
    />
  );
}
