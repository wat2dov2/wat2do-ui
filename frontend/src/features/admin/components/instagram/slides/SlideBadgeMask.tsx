import type { ReactNode } from "react";

import {
  BADGE_MASK_PATHS,
  type BadgeMaskVariant,
} from "@/shared/ui/badge-mask-paths";

/**
 * The event card's notched badge corner, redrawn for a slide.
 *
 * The card knocks a real hole through its face with an SVG mask, which satori
 * does not support - no `mask`, no `clip-path`. The notch is opaque here
 * instead: a band of the slide's own backdrop colour behind the badge, with the
 * inner corner rounded and the two adjoining fillets painted on top. That is
 * exactly what `BadgeMask` draws in its non-cutout form, so a slide and a card
 * end up the same shape by the same geometry rather than by eye.
 *
 * The fillet artwork is `BADGE_MASK_PATHS`, the same source the card uses,
 * inlined as a data URI because satori renders `<img>` but not inline `<svg>`.
 */

/** Card values scaled to the slide card's exact 3x corner geometry. */
const FILLET = 24;
const INNER_RADIUS = 36;
const NOTCH_PADDING = 12;

function fillet(variant: BadgeMaskVariant, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<path d="${BADGE_MASK_PATHS[variant].fillPath}" fill="${color}"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function FilletImage({
  variant,
  color,
  style,
}: {
  variant: BadgeMaskVariant;
  color: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={fillet(variant, color)}
      width={FILLET}
      height={FILLET}
      alt=""
      style={{ width: FILLET, height: FILLET, ...style }}
    />
  );
}

interface SlideBadgeMaskProps {
  variant: Extract<BadgeMaskVariant, "top-left" | "bottom-left">;
  /** The colour the notch reads as - the slide backdrop behind the card. */
  color: string;
  children: ReactNode;
}

export function SlideBadgeMask({
  variant,
  color,
  children,
}: SlideBadgeMaskProps) {
  const notch = {
    display: "flex",
    backgroundColor: color,
  } as const;

  if (variant === "top-left") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          top: 0,
          left: 0,
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex" }}>
          <div
            style={{
              ...notch,
              paddingBottom: NOTCH_PADDING,
              paddingRight: NOTCH_PADDING,
              borderBottomRightRadius: INNER_RADIUS,
            }}
          >
            {children}
          </div>
          <FilletImage variant="top-left" color={color} />
        </div>
        <FilletImage variant="top-left" color={color} />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        bottom: 0,
        left: 0,
        alignItems: "flex-start",
      }}
    >
      <FilletImage variant="bottom-left" color={color} />
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div
          style={{
            ...notch,
            paddingTop: NOTCH_PADDING,
            paddingRight: NOTCH_PADDING,
            borderTopRightRadius: INNER_RADIUS,
          }}
        >
          {children}
        </div>
        <FilletImage variant="bottom-left" color={color} />
      </div>
    </div>
  );
}
