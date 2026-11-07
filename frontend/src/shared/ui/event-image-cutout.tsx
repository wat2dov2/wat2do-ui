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
import { posterThumbnailUrl } from "@/shared/utils/media";

const useSafeLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface MeasuredCutout {
  corner: BadgeMaskVariant;
  width: number;
  height: number;
}

/** The measured card face and the notch geometry it is cut with. */
export interface CutoutBox {
  width: number;
  height: number;
  /** `--notch-fillet`: the concave curve where a notch leaves the card edge. */
  fillet: number;
  /** `--notch-radius`: the convex corner a notch turns around its badge. */
  radius: number;
}

/**
 * The notch geometry comes from the same tokens BadgeMask draws with, read
 * where the face is, so a surface that scales its notches (or a breakpoint
 * that does) cuts exactly the shape its badges sit in.
 */
function readCutoutBox(surface: HTMLElement): CutoutBox {
  // getBoundingClientRect, not offsetWidth: the latter rounds to whole
  // pixels, so a 241.6px face reported 242 and the notches were cut from a
  // space fractionally wider than the one they were drawn into.
  const { width, height } = surface.getBoundingClientRect();
  const style = getComputedStyle(surface);
  return {
    width,
    height,
    fillet: parseFloat(style.getPropertyValue("--notch-fillet")),
    radius: parseFloat(style.getPropertyValue("--notch-radius")),
  };
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
  const [box, setBox] = useState<CutoutBox>({ width: 0, height: 0, fillet: 0, radius: 0 });
  const [cutouts, setCutouts] = useState<MeasuredCutout[]>([]);

  /*
   * Measuring writes state and state re-renders, so both setters bail when
   * nothing moved, and the callback refs below keep a stable identity. Without
   * either guard React detaches/reattaches the refs every render and loops.
   */
  const measure = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const next = readCutoutBox(surface);
    setBox((prev) =>
      prev.width === next.width &&
      prev.height === next.height &&
      prev.fillet === next.fillet &&
      prev.radius === next.radius
        ? prev
        : next,
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
  /** Profile pictures stay compact instead of filling a poster frame. */
  imageVariant?: "poster" | "profile";
  videoSrc?: string | null;
  /** Load the poster immediately for LCP candidates; defer off-screen cards. */
  imageLoading?: "eager" | "lazy";
  imageFallback?: ReactNode;
  /** Custom image content shares the same measured transparent face. */
  imageContent?: ReactNode;
  /** Measured badge sizes from `useEventImageCutouts`. */
  cutouts: MeasuredCutout[];
  /** Measured face and notch geometry from `useEventImageCutouts`. */
  box: CutoutBox;
  /** HTML overlaid above the clipped face - text, buttons, links stay real DOM. */
  children?: ReactNode;
  className?: string;
}

/**
 * Trace the face clockwise, stepping around each measured corner badge.
 * A direct CSS path clips the photo, video and loading state together without
 * SVG fragment references, image decoding or alpha-mask compositing.
 */
export function createClipPath(cutouts: MeasuredCutout[], { width, height, fillet, radius: innerRadius }: CutoutBox) {
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
    const radius = Math.min(innerRadius, horizontal, vertical);
    return [
      `${start}${point(0, vertical + fillet)}`,
      `A${fillet} ${fillet} 0 0 1 ${point(fillet, vertical)}`,
      `L${point(horizontal - radius, vertical)}`,
      `A${radius} ${radius} 0 0 0 ${point(horizontal, vertical - radius)}`,
      `L${point(horizontal, fillet)}`,
      `A${fillet} ${fillet} 0 0 1 ${point(horizontal + fillet, 0)}`,
    ].join(" ");
  });
  return `path("${segments.join(" ")} Z")`;
}

export function EventImageCutout({
  backgroundColor,
  imageSrc,
  imageAlt = "",
  imageVariant = "poster",
  videoSrc,
  imageLoading = "eager",
  imageFallback,
  imageContent,
  cutouts,
  box,
  children,
  className,
}: EventImageCutoutProps) {
  const clipPath = useMemo(() => createClipPath(cutouts, box), [cutouts, box]);

  const compactProfile = imageVariant === "profile" && Boolean(imageSrc) && !videoSrc;

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
        {imageContent ?? (
          <div className={cn("absolute inset-0", compactProfile && "flex items-center justify-center")}>
            <LazyImage
              // A poster frame is at most about 480 px wide, which the stored
              // thumbnail covers at 2x; the full image opens on demand.
              src={imageSrc && posterThumbnailUrl(imageSrc)}
              alt={imageAlt}
              videoSrc={videoSrc}
              fit={compactProfile ? "contain" : "cover"}
              loading={imageLoading}
              fallback={imageFallback}
              className={compactProfile ? "size-24 rounded-md" : "absolute inset-0"}
            />
          </div>
        )}
      </div>

      {Children.toArray(children).length ? (
        <div data-slot="event-image-overlay" className="relative z-10 size-full">{children}</div>
      ) : null}
    </div>
  );
}
