"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/utils";
import { BadgeMaskShape } from "@/shared/ui/badge-mask";
import type { BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Size of the corner fillet glyph, matching the `size-2` used by BadgeMask. */
const FILLET = 8;
/** Inner-corner radius of the notch, matching BadgeMask's `rounded-*-xl`. */
const INNER_RADIUS = 12;

interface MeasuredCutout {
  corner: BadgeMaskVariant;
  width: number;
  height: number;
}

/**
 * Measures the corner badges so their notches can be knocked out of the card face.
 *
 * Sizes are measured rather than hardcoded because badge width depends on its
 * text - organization name, category label, translated strings - so a fixed
 * placement would drift the moment a label or locale changes.
 */
export function useEventImageCutouts() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<BadgeMaskVariant, HTMLElement>());
  const callbacks = useRef(new Map<BadgeMaskVariant, (node: HTMLElement | null) => void>());
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [cutouts, setCutouts] = useState<MeasuredCutout[]>([]);

  /*
   * Measuring writes state and state re-renders, so both setters bail when
   * nothing moved, and the callback refs below keep a stable identity. Without
   * either guard React detaches/reattaches the refs every render and loops.
   */
  const measure = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const next = { width: surface.offsetWidth, height: surface.offsetHeight };
    setBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));

    const measured = [...nodes.current.entries()].map(([corner, node]) => ({
      corner,
      width: node.offsetWidth,
      height: node.offsetHeight,
    }));
    setCutouts((prev) =>
      prev.length === measured.length &&
      prev.every((p, i) => {
        const m = measured[i]!;
        return p.corner === m.corner && p.width === m.width && p.height === m.height;
      })
        ? prev
        : measured,
    );
  }, []);

  const registerCorner = useCallback(
    (corner: BadgeMaskVariant) => {
      const cached = callbacks.current.get(corner);
      if (cached) return cached;
      const callback = (node: HTMLElement | null) => {
        if (node) nodes.current.set(corner, node);
        else nodes.current.delete(corner);
        measure();
      };
      callbacks.current.set(corner, callback);
      return callback;
    },
    [measure],
  );

  useSafeLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    nodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [measure]);

  return { surfaceRef, registerCorner, cutouts, box };
}

/** Notch rect plus its two fillet glyphs, placed for a given corner. */
function cornerPieces(cutout: MeasuredCutout, w: number, h: number) {
  // The measured element already includes BadgeMask's own padding, which is the
  // visual gap - adding more here double-counts it and leaves a dead band.
  const nw = cutout.width;
  const nh = cutout.height;
  const r = INNER_RADIUS;

  /*
   * The knockout rect is overhung by `r` on its two outward sides. `rx` rounds
   * all four corners, but only the inner one lands inside the card - the other
   * three curve off-canvas - so the notch gets the rounded inner corner that
   * BadgeMask draws with `rounded-*-xl`, and no square corner remains.
   */
  switch (cutout.corner) {
    case "top-left":
      return {
        rect: { x: -r, y: -r, width: nw + r, height: nh + r, rx: r },
        fillets: [{ x: nw, y: 0 }, { x: 0, y: nh }],
      };
    case "top-right":
      return {
        rect: { x: w - nw, y: -r, width: nw + r, height: nh + r, rx: r },
        fillets: [{ x: w - nw - FILLET, y: 0 }, { x: w - FILLET, y: nh }],
      };
    case "bottom-left":
      return {
        rect: { x: -r, y: h - nh, width: nw + r, height: nh + r, rx: r },
        fillets: [{ x: nw, y: h - nh }, { x: 0, y: h - nh - FILLET }],
      };
    case "bottom-right":
      return {
        rect: { x: w - nw, y: h - nh, width: nw + r, height: nh + r, rx: r },
        fillets: [{ x: w - nw - FILLET, y: h - nh }, { x: w - FILLET, y: h - nh - FILLET }],
      };
  }
}

interface EventImageCutoutProps {
  /** Fill for the card face that the notches are knocked out of. */
  backgroundColor: string;
  /** Optional photo, drawn inside the mask so it is cut by the notches too. */
  imageSrc?: string | null;
  imageAlt?: string;
  /** Measured badge sizes from `useEventImageCutouts`. */
  cutouts: MeasuredCutout[];
  width: number;
  height: number;
  /** HTML overlaid above the SVG face - text, buttons, links stay real DOM. */
  children?: ReactNode;
  className?: string;
}

/**
 * Card image face rendered as a masked SVG, so its notches are genuinely
 * transparent and the page backdrop - dotted grid and radial glow - shows
 * through rather than being simulated with a background-coloured overlay.
 *
 * The knockout reuses the existing `BadgeMaskShape` artwork; nothing here
 * recreates it as path data. Each notch is a plain rect plus that component's
 * two fillet glyphs, positioned per corner.
 *
 * The mask id comes from `useId()`, so any number of cards can share a page
 * without colliding, and it stays stable across SSR and hydration.
 */
export function EventImageCutout({
  backgroundColor,
  imageSrc,
  imageAlt = "",
  cutouts,
  width,
  height,
  children,
  className,
}: EventImageCutoutProps) {
  const maskId = useId();
  const ready = width > 0 && height > 0;

  return (
    <div className={cn("relative", className)}>
      {/*
       * Server render and first paint happen before the badges can be measured,
       * so fall back to an unmasked face. Without it the image area would flash
       * blank until the layout effect lands; the holes appear on measurement.
       */}
      {!ready && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{
            backgroundColor,
            backgroundImage: imageSrc ? `url(${imageSrc})` : undefined,
          }}
        />
      )}
      {ready && (
        <svg
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
              {/* White keeps the face visible; black removes it. */}
              <rect x={0} y={0} width={width} height={height} fill="white" />
              {cutouts.map((cutout) => {
                const { rect, fillets } = cornerPieces(cutout, width, height);
                return (
                  <g key={cutout.corner}>
                    <rect {...rect} fill="black" />
                    {fillets.map((f, i) => (
                      // Nested <svg> so the artwork keeps its own aspect ratio
                      // instead of stretching with the background rect.
                      <svg
                        key={i}
                        x={f.x}
                        y={f.y}
                        width={FILLET}
                        height={FILLET}
                        viewBox="0 0 64 64"
                        preserveAspectRatio="xMidYMid meet"
                      >
                        <BadgeMaskShape variant={cutout.corner} fill="black" />
                      </svg>
                    ))}
                  </g>
                );
              })}
            </mask>
          </defs>

          <g mask={`url(#${maskId})`}>
            <rect x={0} y={0} width={width} height={height} fill={backgroundColor} />
            {imageSrc && (
              <image
                href={imageSrc}
                x={0}
                y={0}
                width={width}
                height={height}
                preserveAspectRatio="xMidYMid slice"
              >
                <title>{imageAlt}</title>
              </image>
            )}
          </g>
        </svg>
      )}

      <div className="relative z-10 size-full">{children}</div>
    </div>
  );
}
