"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * The page's one hand-drawn accent: three crayon marks bursting off the end of
 * the hero's highlighted words. Sized in `em` so it follows the word's font
 * size in every language and breakpoint.
 */
const BURST = {
  viewBox: "0 0 60 50",
  d: "M8 46 L 16 24 M28 44 L 30 12 M46 46 L 56 24",
  className: "-right-[0.86em] -top-[0.2em] h-[0.6em] w-[0.75em]",
} as const;

/**
 * One crayon stroke: a roughened, grainy line, as wax on paper. The stroke is
 * placed by a wrapper span because an absolutely positioned SVG is a replaced
 * element: it would ignore paired insets and fall back to its default size.
 */
function CrayonStroke({ viewBox, d, className }: { viewBox: string; d: string; className: string }) {
  // useId returns colons, which are not valid inside a CSS url() reference.
  const filterId = `crayon-${useId().replace(/:/g, "")}`;

  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute select-none", className)}>
    <svg
      focusable="false"
      viewBox={viewBox}
      fill="none"
      className="block h-full w-full overflow-visible"
      style={{ color: "var(--scribble-yellow)" }}
    >
      <defs>
        <filter id={filterId} x="-10%" y="-40%" width="120%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="1" seed="3" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="grainMask" />
          <feComposite in="rough" in2="grainMask" operator="in" />
        </filter>
      </defs>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
        filter={`url(#${filterId})`}
      />
    </svg>
    </span>
  );
}

/** Wraps the hero's highlighted words with the crayon burst. */
export function LandingBurst({ children }: { children: ReactNode }) {
  const { viewBox, d, className } = BURST;
  return (
    <span className="relative inline-block whitespace-nowrap">
      <CrayonStroke viewBox={viewBox} d={d} className={className} />
      <span className="relative">{children}</span>
    </span>
  );
}
