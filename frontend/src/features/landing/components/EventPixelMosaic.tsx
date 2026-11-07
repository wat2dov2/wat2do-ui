"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { loadFullAtlas, loadMosaicManifest, loadPreviewAtlas } from "@/features/landing/lib/eventMosaicAtlas";
import { startEventPixelMosaic, type MosaicController, type MosaicLook } from "@/features/landing/lib/eventPixelMosaic";
import { cn } from "@/shared/lib/utils";

/**
 * - `logo`: cells that spell the Wat2Do logo and a headline, in posters that
 *   wear their colours, out of a muted grid.
 * - `ambient`: larger muted cells behind a closing line.
 * Both keep changing a few squares at a time. The atlas holds 80 px posters,
 * at least twice either cell size, so cells stay crisp on a 2x screen.
 */
export type EventPixelMosaicVariant = "logo" | "ambient";

const LOOKS: Record<EventPixelMosaicVariant, MosaicLook> = {
  logo: { tileSize: 12, gutter: 1, swapsPerSecond: 0.04, tone: "logo" },
  ambient: { tileSize: 28, gutter: 2, swapsPerSecond: 0.03, tone: "muted" },
};

interface EventPixelMosaicProps {
  variant: EventPixelMosaicVariant;
  /** For `logo`: the element the logo is drawn behind, in the same card. */
  logoRegion?: RefObject<HTMLElement | null>;
  /**
   * For `logo`: a headline to spell in the grid's cells below the logo, at the
   * top of `region`. `onLayout` says whether it fits legibly and how tall it is,
   * so the page can size the region or show the headline as text instead.
   */
  title?: {
    lead: string;
    phrases: readonly string[];
    region: RefObject<HTMLElement | null>;
    onLayout: (layout: { fits: boolean; height: number }) => void;
  };
  /** Hands over the running mosaic, for a page that changes its headline's phrase. */
  onReady?: (controller: MosaicController) => void;
}

/**
 * A grid of real scraped event posters. Fills its positioned parent and is
 * decorative. Nothing downloads until it nears the viewport; a 16 px copy
 * paints first and the sharp atlas follows. Under reduced motion it is a still
 * mosaic.
 */
export function EventPixelMosaic({ variant, logoRegion, title, onReady }: EventPixelMosaicProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const onReadyRef = useRef(onReady);
  const titleRef = useRef(title);
  useEffect(() => {
    onReadyRef.current = onReady;
    titleRef.current = title;
  }, [onReady, title]);
  // The mosaic restarts only when the headline's words change, not on every render.
  const titleWords = title ? [title.lead, ...title.phrases].join("\n") : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let controller: MosaicController | null = null;
    let cancelled = false;

    const regionOf = (element: HTMLElement | null | undefined) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const origin = canvas.getBoundingClientRect();
      return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
    };
    const headline = titleRef.current;

    const start = async () => {
      const [manifest, preview] = await Promise.all([loadMosaicManifest(), loadPreviewAtlas()]);
      if (cancelled) return;
      controller?.stop();
      controller = startEventPixelMosaic(canvas, preview, LOOKS[variant], !motion.matches, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
        logoRegion: () => regionOf(logoRegion?.current),
        title: headline && {
          lead: headline.lead,
          phrases: headline.phrases,
          region: () => regionOf(headline.region.current),
          onLayout: (layout) => titleRef.current?.onLayout(layout),
        },
      });
      setReady(true);
      onReadyRef.current?.(controller);
      // Letters are measured in the page's typeface, so lay out again once it has loaded.
      void document.fonts.ready.then(() => { if (!cancelled) controller?.relayout(); });
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
    // titleWords stands in for the headline itself, which is read through titleRef.
  }, [variant, logoRegion, titleWords]);

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
