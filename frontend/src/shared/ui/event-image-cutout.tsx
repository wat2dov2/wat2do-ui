"use client";

import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/utils";
import type { BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";
import { LazyImage } from "@/shared/ui/lazy-image";
import { CARD_GRID_IMAGE_SIZES } from "@/shared/constants/ui";

const useSafeLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
 * text - club name, category label, translated strings - so a fixed
 * placement would drift the moment a label or locale changes.
 */
export function useEventImageCutouts() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<BadgeMaskVariant, HTMLElement>());
  const callbacks = useRef(
    new Map<BadgeMaskVariant, (node: HTMLElement | null) => void>(),
  );
  const resizeObserver = useRef<ResizeObserver | null>(null);
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
        const previous = nodes.current.get(corner);
        if (previous) resizeObserver.current?.unobserve(previous);
        if (node) {
          nodes.current.set(corner, node);
          resizeObserver.current?.observe(node);
        } else {
          nodes.current.delete(corner);
        }
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
    resizeObserver.current = observer;
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    nodes.current.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      resizeObserver.current = null;
    };
  }, [measure]);

  return { surfaceRef, registerCorner, cutouts, box };
}

interface EventImageCutoutProps {
  /** Fill for the card face that the notches are knocked out of. */
  backgroundColor: string;
  /** Optional photo, drawn inside the mask so it is cut by the notches too. */
  imageSrc?: string | null;
  imageAlt?: string;
  videoSrc?: string | null;
  /** Load the poster immediately for LCP candidates; defer off-screen cards. */
  imageLoading?: "eager" | "lazy";
  imageSizes?: string;
  imageFallback?: ReactNode;
  /** Custom image content shares the same measured transparent face. */
  imageContent?: ReactNode;
  /** Measured badge sizes from `useEventImageCutouts`. */
  cutouts: MeasuredCutout[];
  width: number;
  height: number;
  /** HTML overlaid above the clipped face - text, buttons, links stay real DOM. */
  children?: ReactNode;
  className?: string;
}

/**
 * Trace the face clockwise, stepping around each measured corner badge.
 * A direct CSS path clips the photo, video and loading state together without
 * SVG fragment references, image decoding or alpha-mask compositing.
 */
function createClipPath(cutouts: MeasuredCutout[], width: number, height: number) {
  if (width <= 0 || height <= 0) return undefined;

  const corners: BadgeMaskVariant[] = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const segments = corners.map((corner, index) => {
    const cutout = cutouts.find((entry) => entry.corner === corner);
    // Rotate one corner's contour so every corner uses identical roundings.
    const point = (x: number, y: number) => {
      const [px, py] = index === 0 ? [x, y]
        : index === 1 ? [width - y, x]
        : index === 2 ? [width - x, height - y]
        : [y, height - x];
      return `${px} ${py}`;
    };
    const start = index === 0 ? "M" : "L";
    if (!cutout || cutout.width <= 0 || cutout.height <= 0) {
      return `${start}${point(0, 0)}`;
    }
    const horizontal = index % 2 === 0 ? cutout.width : cutout.height;
    const vertical = index % 2 === 0 ? cutout.height : cutout.width;
    const radius = Math.min(INNER_RADIUS, horizontal, vertical);
    return [
      `${start}${point(0, vertical + FILLET)}`,
      `A${FILLET} ${FILLET} 0 0 1 ${point(FILLET, vertical)}`,
      `L${point(horizontal - radius, vertical)}`,
      `A${radius} ${radius} 0 0 0 ${point(horizontal, vertical - radius)}`,
      `L${point(horizontal, FILLET)}`,
      `A${FILLET} ${FILLET} 0 0 1 ${point(horizontal + FILLET, 0)}`,
    ].join(" ");
  });
  return `path("${segments.join(" ")} Z")`;
}

export function EventImageCutout({
  backgroundColor,
  imageSrc,
  imageAlt = "",
  videoSrc,
  imageLoading = "eager",
  imageSizes = CARD_GRID_IMAGE_SIZES,
  imageFallback,
  imageContent,
  cutouts,
  width,
  height,
  children,
  className,
}: EventImageCutoutProps) {
  const clipPath = useMemo(
    () => createClipPath(cutouts, width, height),
    [cutouts, width, height],
  );

  return (
    <div className={cn("relative", className)}>
      <div
        data-slot="event-image-face"
        className="absolute inset-0"
        style={{
          backgroundColor,
          clipPath,
          WebkitClipPath: clipPath,
        }}
      >
        {imageContent ?? <LazyImage
          src={imageSrc}
          alt={imageAlt}
          videoSrc={videoSrc}
          sizes={imageSizes}
          loading={imageLoading}
          fallback={imageFallback}
          className="absolute inset-0"
        />}
      </div>

      {Children.toArray(children).length ? (
        <div data-slot="event-image-overlay" className="relative z-10 size-full">{children}</div>
      ) : null}
    </div>
  );
}
