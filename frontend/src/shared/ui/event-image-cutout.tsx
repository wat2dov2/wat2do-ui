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
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { BadgeMaskShape } from "@/shared/ui/badge-mask";
import type { BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";

const useSafeLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Size of the corner fillet glyph, matching the `size-2` used by BadgeMask. */
const FILLET = 8;
/** Subpixel overlap keeps each fillet visually joined to its badge. */
const FILLET_BADGE_OVERLAP = 0.25;
/** Inner-corner radius of the notch, matching BadgeMask's `rounded-*-xl`. */
const INNER_RADIUS = 12;
/** Stable coordinate space so the server and hydrated SVG keep identical geometry. */
const MASK_VIEWBOX_SIZE = 100;

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
  const callbacks = useRef(
    new Map<BadgeMaskVariant, (node: HTMLElement | null) => void>(),
  );
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

    // getBoundingClientRect, not offsetWidth: the latter rounds to whole
    // pixels, so a 241.6px face reported 242 and the notches were cut from a
    // space fractionally wider than the one they were drawn into.
    const surfaceRect = surface.getBoundingClientRect();
    const next = { width: surfaceRect.width, height: surfaceRect.height };
    setBox((prev) =>
      prev.width === next.width && prev.height === next.height ? prev : next,
    );

    const measured = [...nodes.current.entries()].map(([corner, node]) => {
      const rect = node.getBoundingClientRect();
      return { corner, width: rect.width, height: rect.height };
    });
    setCutouts((prev) =>
      prev.length === measured.length &&
      prev.every((p, i) => {
        const m = measured[i]!;
        return (
          p.corner === m.corner && p.width === m.width && p.height === m.height
        );
      })
        ? prev
        : measured,
    );
  }, [surfaceRef]);

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
function cornerPieces(
  cutout: MeasuredCutout,
  surfaceWidth: number,
  surfaceHeight: number,
) {
  // The measured element already includes BadgeMask's own padding, which is the
  // visual gap - adding more here double-counts it and leaves a dead band.
  const nw = cutout.width;
  const nh = cutout.height;
  const rx = INNER_RADIUS;
  const ry = INNER_RADIUS;
  const filletWidth = FILLET;
  const filletHeight = FILLET;
  const w = surfaceWidth;
  const h = surfaceHeight;

  /*
   * Everything here is in CSS pixels, the same units the badges were measured
   * in, so a notch lands exactly on its badge. Scaling the measurements into a
   * fixed square space and letting the browser scale them back left the hole
   * up to a pixel out of step with the badge it was cut for, which showed as a
   * hairline of card edge along one side. One radius, not separate x/y ones:
   * in an unscaled space a corner is round rather than elliptical.
   *
   * The knockout rect is overhung on its two outward sides.
   */
  switch (cutout.corner) {
    case "top-left":
      return {
        rect: { x: -rx, y: -ry, width: nw + rx, height: nh + ry, rx, ry },
        fillets: [
          { x: nw - FILLET_BADGE_OVERLAP, y: 0 },
          { x: 0, y: nh - FILLET_BADGE_OVERLAP },
        ],
        filletWidth,
        filletHeight,
      };
    case "top-right":
      return {
        rect: { x: w - nw, y: -ry, width: nw + rx, height: nh + ry, rx, ry },
        fillets: [
          {
            x: w - nw - filletWidth + FILLET_BADGE_OVERLAP,
            y: 0,
          },
          { x: w - filletWidth, y: nh - FILLET_BADGE_OVERLAP },
        ],
        filletWidth,
        filletHeight,
      };
    case "bottom-left":
      return {
        rect: { x: -rx, y: h - nh, width: nw + rx, height: nh + ry, rx, ry },
        fillets: [
          { x: nw - FILLET_BADGE_OVERLAP, y: h - filletHeight },
          {
            x: 0,
            y: h - nh - filletHeight + FILLET_BADGE_OVERLAP,
          },
        ],
        filletWidth,
        filletHeight,
      };
    case "bottom-right":
      return {
        rect: { x: w - nw, y: h - nh, width: nw + rx, height: nh + ry, rx, ry },
        fillets: [
          {
            x: w - nw - filletWidth + FILLET_BADGE_OVERLAP,
            y: h - filletHeight,
          },
          {
            x: w - filletWidth,
            y: h - nh - filletHeight + FILLET_BADGE_OVERLAP,
          },
        ],
        filletWidth,
        filletHeight,
      };
  }
}

interface EventImageCutoutProps {
  /** Fill for the card face that the notches are knocked out of. */
  backgroundColor: string;
  /** Optional photo, drawn inside the mask so it is cut by the notches too. */
  imageSrc?: string | null;
  imageAlt?: string;
  /** Load the poster immediately for LCP candidates; defer off-screen cards. */
  imageLoading?: "eager" | "lazy";
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
  imageLoading = "eager",
  cutouts,
  width,
  height,
  children,
  className,
}: EventImageCutoutProps) {
  const maskId = useId();
  const ready = width > 0 && height > 0;
  // Before measurement there are no pixels to draw in, so the square stands in
  // and renders the unmasked face; the same element stays mounted either way.
  const faceWidth = ready ? width : MASK_VIEWBOX_SIZE;
  const faceHeight = ready ? height : MASK_VIEWBOX_SIZE;
  const { ref: imageRef, hasIntersected } =
    useIntersectionObserver<HTMLDivElement>({
      rootMargin: "200px",
      enabled: Boolean(imageSrc) && imageLoading === "lazy",
    });
  const shouldLoadImage = imageLoading === "eager" || hasIntersected;
  const displayedImageSrc = imageSrc
    ? imageSrc
    : null;
  const priorityAttributes =
    imageLoading === "eager" ? { fetchPriority: "high" as const } : {};

  return (
    <div ref={imageRef} className={cn("relative", className)}>
      {/*
       * The same SVG and image stay mounted before and after
       * measurement. Its fixed coordinate space renders the unmasked face on
       * the server; measurement only adds scaled notch geometry, so hydration
       * cannot repaint the poster as a new LCP candidate.
       */}
      <svg
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute inset-0 size-full"
        viewBox={`0 0 ${faceWidth} ${faceHeight}`}
        preserveAspectRatio="none"
      >
        {ready ? (
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={faceWidth}
              height={faceHeight}
            >
              {/* White keeps the face visible; black removes it. */}
              <rect
                x={0}
                y={0}
                width={faceWidth}
                height={faceHeight}
                fill="white"
              />
              {cutouts.map((cutout) => {
                const { rect, fillets, filletWidth, filletHeight } =
                  cornerPieces(cutout, width, height);
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
                        width={filletWidth}
                        height={filletHeight}
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
        ) : null}

        <g mask={ready ? `url(#${maskId})` : undefined}>
          <rect
            x={0}
            y={0}
            width={faceWidth}
            height={faceHeight}
            fill={backgroundColor}
          />
          {displayedImageSrc && shouldLoadImage ? (
            /*
             * The face now draws in unscaled pixels, so the poster can cover
             * honestly here: no parent stretch to undo, and "slice" crops to
             * the card without altering the poster's proportions.
             */
            <image
              href={displayedImageSrc}
              {...priorityAttributes}
              x={0}
              y={0}
              width={faceWidth}
              height={faceHeight}
              preserveAspectRatio="xMidYMid slice"
            >
              <title>{imageAlt}</title>
            </image>
          ) : null}
        </g>
      </svg>

      <div className="relative z-10 size-full">{children}</div>
    </div>
  );
}
