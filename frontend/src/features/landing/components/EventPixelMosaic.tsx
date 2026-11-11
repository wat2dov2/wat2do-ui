"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { loadFullAtlas, loadMosaicManifest, loadPreviewAtlas } from "@/features/landing/lib/eventMosaicAtlas";
import {
  startEventPixelMosaic,
  type MosaicButton,
  type MosaicButtonLayout,
  type MosaicController,
  type MosaicLook,
} from "@/features/landing/lib/eventPixelMosaic";
import { cn } from "@/shared/lib/utils";

/**
 * Small squares with half-pixel gutters, many changing every second. The atlas
 * holds 32 px posters, over twice the square, so squares stay crisp on 2x and 3x screens.
 */
const LOOK: MosaicLook = { tileSize: 10, gutter: 0.5, swapsPerSecond: 0.4 };

interface EventPixelMosaicProps {
  /** The element the Wat2Do logo is drawn behind, in the same card; none draws no logo. */
  logoRegion?: RefObject<HTMLElement | null>;
  /**
   * A headline to spell in the grid's cells, below the logo if there is one,
   * at the top of `region`, in the pixel font: the lead on one line and a
   * phrase on the next, the phrases taking turns every PHRASE_MS. `onLayout`
   * gives its height so the page can size the region; on narrow screens the
   * squares shrink until the widest line fits.
   */
  title?: {
    lead: string;
    phrases: readonly string[];
    region: RefObject<HTMLElement | null>;
    onLayout: (height: number) => void;
  };
  /**
   * Buttons spelled in the grid's squares at the top of `region`, each label
   * in a border of squares; `hover` respells that one as its hover label.
   * `onLayout` says where they landed, or null when they do not fit.
   */
  buttons?: {
    items: readonly MosaicButton[];
    region: RefObject<HTMLElement | null>;
    hover: number | null;
    onLayout: (layout: MosaicButtonLayout | null) => void;
  };
}

/** How long each headline phrase stays, long enough to read without the words feeling restless. */
const PHRASE_MS = 9000;

/**
 * A grid of real scraped event posters. Fills its positioned parent and is
 * decorative. Nothing downloads until it nears the viewport; an 8 px copy
 * paints first and the sharp atlas follows. Under reduced motion it is a still
 * mosaic.
 */
export function EventPixelMosaic({ logoRegion, title, buttons }: EventPixelMosaicProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<MosaicController | null>(null);
  const [ready, setReady] = useState(false);
  const titleRef = useRef(title);
  const buttonsRef = useRef(buttons);
  useEffect(() => {
    titleRef.current = title;
    buttonsRef.current = buttons;
  }, [title, buttons]);
  // The mosaic restarts only when the words it spells change, not on every render.
  const titleWords = [
    ...(title ? [title.lead, ...title.phrases] : []),
    ...(buttons?.items.flatMap(({ label, hoverLabel }) => [label, hoverLabel]) ?? []),
  ].join("\n");
  const hover = buttons?.hover ?? null;
  useEffect(() => {
    controllerRef.current?.setHover(hover);
  }, [hover]);

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
    const spelledButtons = buttonsRef.current;

    const start = async () => {
      const [manifest, preview] = await Promise.all([loadMosaicManifest(), loadPreviewAtlas()]);
      if (cancelled) return;
      controller?.stop();
      controller = startEventPixelMosaic(canvas, preview, LOOK, !motion.matches, {
        posters: manifest.posters,
        logoMask: manifest.logoMask,
        logoColours: manifest.logoColours,
        logoRegion: () => regionOf(logoRegion?.current),
        title: headline && {
          lead: headline.lead,
          phrases: headline.phrases,
          phraseMs: PHRASE_MS,
          region: () => regionOf(headline.region.current),
          onLayout: (height) => titleRef.current?.onLayout(height),
        },
        buttons: spelledButtons && {
          items: spelledButtons.items,
          region: () => regionOf(spelledButtons.region.current),
          onLayout: (layout) => buttonsRef.current?.onLayout(layout),
        },
      });
      controllerRef.current = controller;
      controller.setHover(buttonsRef.current?.hover ?? null);
      setReady(true);
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
      controllerRef.current = null;
      nearby.disconnect();
      motion.removeEventListener("change", restart);
      controller?.stop();
    };
    // titleWords stands in for the headline and buttons, which are read through refs.
  }, [logoRegion, titleWords]);

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
