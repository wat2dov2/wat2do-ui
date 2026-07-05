import { useEffect, useRef, useState, useMemo } from "react";
import { Skeleton } from "@/shared/ui/skeleton";

export function OrganizationCardSkeleton() {
  const cardRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 0, h: 0, cw: 0, ch: 0 });

  useEffect(() => {
    const cardEl = cardRef.current;
    const badgeEl = badgeRef.current;
    if (!cardEl) return;

    const updateDimensions = () => {
      setDimensions({
        w: cardEl.offsetWidth,
        h: cardEl.offsetHeight,
        cw: badgeEl ? badgeEl.offsetWidth : 0,
        ch: badgeEl ? badgeEl.offsetHeight : 0,
      });
    };

    updateDimensions();

    const observer = new ResizeObserver(() => {
      updateDimensions();
    });

    observer.observe(cardEl);
    if (badgeEl) observer.observe(badgeEl);

    return () => {
      observer.disconnect();
    };
  }, []);

  const paths = useMemo(() => {
    const { w, h, cw, ch } = dimensions;
    if (w === 0 || h === 0) return { border: "", clip: "" };

    const R = 12; // Card corner radius
    const r = 8;  // Cutout transition radius
    const gap = 4; // Space around badge

    // Cutout dimensions including the gap
    const cw_c = cw > 0 ? cw + gap : 0;
    const ch_c = ch > 0 ? ch + gap : 0;

    // Standard rounded rect path if no badge
    if (cw_c === 0 || ch_c === 0) {
      const standardPath = `M ${R} 0 L ${w - R} 0 A ${R} ${R} 0 0 1 ${w} ${R} L ${w} ${h - R} A ${R} ${R} 0 0 1 ${w - R} ${h} L ${R} ${h} A ${R} ${R} 0 0 1 0 ${h - R} L 0 ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`;
      return { border: standardPath, clip: standardPath };
    }

    const offset = 0.5;
    const w_b = w - offset;
    const h_b = h - offset;
    const cw_b = cw_c - offset;
    const ch_b = ch_c - offset;

    // Border path with 0.5px offset, completely flattened to prevent newline parsing errors in browser engines
    const borderPath = `M ${cw_b + r} ${offset} L ${w_b - R} ${offset} A ${R} ${R} 0 0 1 ${w_b} ${R} L ${w_b} ${h_b - R} A ${R} ${R} 0 0 1 ${w_b - R} ${h_b} L ${R} ${h_b} A ${R} ${R} 0 0 1 ${offset} ${h_b - R} L ${offset} ${ch_b + r} A ${r} ${r} 0 0 1 ${r + offset} ${ch_b} L ${cw_b - r} ${ch_b} A ${r} ${r} 0 0 0 ${cw_b} ${ch_b - r} L ${cw_b} ${r + offset} A ${r} ${r} 0 0 1 ${cw_b + r} ${offset} Z`;

    // Clip path (running along the absolute outer edge), completely flattened to prevent browser parsing bugs
    const clipPath = `M ${cw_c + r} 0 L ${w - R} 0 A ${R} ${R} 0 0 1 ${w} ${R} L ${w} ${h - R} A ${R} ${R} 0 0 1 ${w - R} ${h} L ${R} ${h} A ${R} ${R} 0 0 1 0 ${h - R} L 0 ${ch_c + r} A ${r} ${r} 0 0 1 ${r} ${ch_c} L ${cw_c - r} ${ch_c} A ${r} ${r} 0 0 0 ${cw_c} ${ch_c - r} L ${cw_c} ${r} A ${r} ${r} 0 0 1 ${cw_c + r} 0 Z`;

    return { border: borderPath, clip: clipPath };
  }, [dimensions]);

  return (
    <article
      data-organization-card-skeleton
      className="relative flex flex-col h-full rounded-xl cursor-default animate-pulse"
      ref={cardRef}
    >
      {/* 1. Custom Background with clip-path (including -webkit support for Safari compatibility) */}
      <div
        className="absolute inset-0 rounded-xl bg-card"
        style={{
          clipPath: paths.clip ? `path('${paths.clip}')` : undefined,
          WebkitClipPath: paths.clip ? `path('${paths.clip}')` : undefined,
        }}
      />

      {/* 2. Custom Border SVG overlay */}
      {paths.border && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          <path
            d={paths.border}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-border/50"
          />
        </svg>
      )}

      {/* 3. Category badge skeleton */}
      <div ref={badgeRef} className="absolute top-0 left-0 z-30">
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      {/* 4. Simplified skeleton body: just 2 horizontal rectangles inside the outlined card */}
      <div className="relative z-10 flex flex-col flex-1 p-4 pt-20 pb-8 gap-3">
        <Skeleton className="h-4 w-3/4 rounded-lg" />
        <Skeleton className="h-4 w-1/2 rounded-lg" />
      </div>
    </article>
  );
}
