"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Crayon marks that emphasise a word, in the spirit of hand-drawn editorial
 * annotations. Each mark's geometry is drawn to stretch over the word it
 * wraps, and is sized in `em` so it follows the word's font size in every
 * language and breakpoint.
 */
const MARKS = {
  /** A loose loop around the word: "this is the point". */
  circle: {
    viewBox: "0 0 200 80",
    d: "M150 10 C 104 0, 28 4, 12 34 C 0 62, 70 78, 140 72 C 196 66, 204 30, 168 14 C 140 4, 96 4, 66 10",
    className: "-inset-x-[0.3em] -inset-y-[0.16em]",
  },
  /** A wavy stroke under the word: "remember this". */
  underline: {
    viewBox: "0 0 200 20",
    d: "M4 12 C 30 4, 52 18, 80 10 S 132 4, 156 12 S 186 16, 196 8",
    className: "inset-x-0 -bottom-[0.22em] h-[0.3em]",
  },
  /** A scribbled cross-out through the word: "no more of this". */
  strike: {
    viewBox: "0 0 200 30",
    d: "M4 18 C 50 8, 120 22, 196 10 M10 24 C 70 14, 140 26, 192 16",
    className: "-inset-x-[0.1em] top-[0.42em] h-[0.32em]",
  },
  /** Three marks bursting off the word's end: "!". */
  burst: {
    viewBox: "0 0 60 50",
    d: "M8 46 L 16 24 M28 44 L 30 12 M46 46 L 56 24",
    className: "-right-[1.05em] top-[0.05em] h-[0.6em] w-[0.75em]",
  },
} as const;

export type LandingMarkKind = keyof typeof MARKS;
export type LandingScribbleTone = "yellow" | "pink" | "blue" | "green";

/**
 * One crayon stroke: a roughened, grainy line, as wax on paper. The stroke is
 * placed by a wrapper span because an absolutely positioned SVG is a replaced
 * element: it would ignore paired insets and fall back to its default size.
 */
function CrayonStroke({ viewBox, d, tone, stretch, className }: {
  viewBox: string;
  d: string;
  tone: LandingScribbleTone;
  /** Stretch to the wrapped word's box rather than keeping the drawing's proportions. */
  stretch: boolean;
  className: string;
}) {
  // useId returns colons, which are not valid inside a CSS url() reference.
  const filterId = `crayon-${useId().replace(/:/g, "")}`;

  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute select-none", className)}>
    <svg
      focusable="false"
      viewBox={viewBox}
      preserveAspectRatio={stretch ? "none" : undefined}
      fill="none"
      className="block h-full w-full overflow-visible"
      style={{ color: `var(--scribble-${tone})` }}
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
        // A stretched mark keeps an even crayon width however wide the word is.
        vectorEffect="non-scaling-stroke"
        filter={`url(#${filterId})`}
      />
    </svg>
    </span>
  );
}

/**
 * Wraps the word a sentence is about with a crayon mark. Used through
 * `<Trans components={{ mark: <LandingMark … /> }}>` so each translation
 * chooses which of its own words carries the emphasis.
 */
export function LandingMark({ kind, tone, children }: { kind: LandingMarkKind; tone: LandingScribbleTone; children?: ReactNode }) {
  const { viewBox, d, className } = MARKS[kind];
  return (
    <span className="relative inline-block whitespace-nowrap">
      <CrayonStroke viewBox={viewBox} d={d} tone={tone} stretch={kind !== "burst"} className={className} />
      <span className="relative">{children}</span>
    </span>
  );
}

/**
 * A curved crayon arrow from the hero's actions down to the live views
 * beneath them. Wide layouts only, where there is room beside the buttons.
 */
export function LandingArrowToViews() {
  return (
    <CrayonStroke
      viewBox="0 0 120 110"
      d="M8 10 C 60 0, 104 24, 100 70 C 99 80, 97 88, 94 96 M80 82 L 94 98 L 108 82"
      tone="pink"
      stretch={false}
      className="top-2 -right-36 hidden aspect-[12/11] w-28 lg:block"
    />
  );
}
